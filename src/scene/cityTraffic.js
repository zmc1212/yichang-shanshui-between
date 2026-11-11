import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getRoadClass, getRoadGrade, getRoadWidth } from './roadNetwork.js';

const MAX_VEHICLES = 36;
const EPSILON = 1e-8;
const PALETTE = ['#f8eed8', '#a9b7aa', '#d5b47a', '#bf7567', '#c9d7db', '#e9e5d7'];
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const pointValid = point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]);
const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;

function oneWayDirection(value) {
  if (String(value) === '-1' || String(value).toLowerCase() === 'reverse') return -1;
  return ['yes', 'true', '1'].includes(String(value).toLowerCase()) ? 1 : 0;
}

/**
 * A bounded illustration of flow on source road segments, not live traffic.
 * Each route retains exactly one existing centreline segment. Cars shrink out
 * at the two ends before recycling; no end-to-start chord is ever traversed.
 * Segment boundaries also avoid inventing turns at grade-separated crossings.
 */
export function planTrafficRoutes({ roads = [], inWater = () => false,
  extent = 320, worldUnitsPerMeter = 0.02, maxVehicles = MAX_VEHICLES, roadSurface = null } = {}) {
  const units = positive(worldUnitsPerMeter, 0.02);
  const carLength = 4.6 * units, carWidth = 1.9 * units;
  const limit = clamp(Math.floor(Number(maxVehicles) || 0), 0, MAX_VEHICLES);
  const cellSize = positive(extent, 320) / 12;
  const candidates = [], routes = [], vehicles = [];
  const omitted = { structures: 0, minorRoads: 0, narrowSegments: 0, shortSegments: 0, invalidSegments: 0, waterSegments: 0, unavailableSurfaces: 0 };
  roads.forEach((road, roadIndex) => {
    const grade = getRoadGrade(road), role = getRoadClass(road);
    // The road export has no surveyed deck elevations. Do not place cars on
    // the flat water ribbon beneath the separate, raised bridge models.
    const hasLayer = road.layer != null && String(road.layer).trim() !== '';
    if (grade.bridge || grade.tunnel || (hasLayer && Number(road.layer) !== 0)) { omitted.structures++; return; }
    if (!['major', 'secondary'].includes(role)) { omitted.minorRoads++; return; }
    const width = getRoadWidth(road), oneWay = oneWayDirection(road.oneway);
    if (width < carWidth * (oneWay ? 1.65 : 2.5)) { omitted.narrowSegments++; return; }
    const laneOffset = oneWay ? 0 : Math.min(width * 0.23, width / 2 - carWidth * 0.7);
    for (let index = 1; index < (road.points || []).length; index++) {
      const sourceA = road.points[index - 1], sourceB = road.points[index];
      if (!pointValid(sourceA) || !pointValid(sourceB)) { omitted.invalidSegments++; continue; }
      const a = [...sourceA], b = [...sourceB], dx = b[0] - a[0], dz = b[1] - a[1];
      const length = Math.hypot(dx, dz);
      if (length < Math.max(65 * units, carLength * 14)) { omitted.shortSegments++; continue; }
      const tangent = [dx / length, dz / length], normal = [-tangent[1], tangent[0]];
      const center = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const name = String(road.name || '');
      const localPriority = /沿江|夷陵|西陵|东山|云集|胜利|城东|伍临|发展/.test(name) ? 18 : 0;
      const score = localPriority + (name ? 5 : 0) + (role === 'secondary' ? 6 : 4)
        + Math.min(length / units / 180, 4) - Math.hypot(...center) / positive(extent, 320) * 5;
      const padding = carLength * 1.5;
      candidates.push({ id: `traffic-${roadIndex}-${index - 1}`, sourceRoadIndex: roadIndex,
        sourceSegmentIndex: index - 1, osmId: road.osmId || null, name,
        role, width, oneWay, a, b, tangent, normal, length, padding,
        usableLength: length - padding * 2, carLength, carWidth, laneOffset, center, score,
        cell: `${Math.floor(center[0] / cellSize)},${Math.floor(center[1] / cellSize)}` });
    }
  });
  candidates.sort((a, b) => b.score - a.score || a.sourceRoadIndex - b.sourceRoadIndex || a.sourceSegmentIndex - b.sourceSegmentIndex);
  const cells = new Map(), sourceCounts = new Map();
  for (const candidate of candidates) {
    if (vehicles.length >= limit) break;
    // Spread a small budget through neighbourhoods instead of filling one
    // long motorway or displaying the same source road over and over.
    if ((cells.get(candidate.cell) || 0) >= 2 || (sourceCounts.get(candidate.sourceRoadIndex) || 0) >= 1) continue;
    const checks = Math.max(2, Math.ceil(candidate.length / (8 * units)));
    let blocked = false;
    for (let i = 0; i <= checks && !blocked; i++) {
      const t = i / checks;
      for (const offset of [-candidate.width * 0.4, 0, candidate.width * 0.4]) {
        const x = candidate.a[0] + (candidate.b[0] - candidate.a[0]) * t + candidate.normal[0] * offset;
        const z = candidate.a[1] + (candidate.b[1] - candidate.a[1]) * t + candidate.normal[1] * offset;
        if (inWater(x, z)) { blocked = true; break; }
      }
    }
    if (blocked) { omitted.waterSegments++; continue; }
    // Only the chosen routes need a cached local triangle query. Do not
    // allocate one for every rejected city-wide planning candidate.
    const surface = roadSurface?.getSegment(candidate.sourceRoadIndex, candidate.sourceSegmentIndex);
    if (roadSurface && !surface) { omitted.unavailableSurfaces++; continue; }
    if (surface) candidate.surface = surface;
    const routeIndex = routes.length;
    routes.push(candidate);
    cells.set(candidate.cell, (cells.get(candidate.cell) || 0) + 1);
    sourceCounts.set(candidate.sourceRoadIndex, 1);
    const directions = candidate.oneWay ? [candidate.oneWay, candidate.oneWay] : [1, -1];
    for (let lane = 0; lane < directions.length && vehicles.length < limit; lane++) {
      const phase = (0.17 + routeIndex * 0.381966 + lane * 0.51) % 1;
      vehicles.push({ routeIndex, direction: directions[lane],
        distance: phase * candidate.usableLength,
        speed: (candidate.role === 'major' ? 8.5 : 6.5) * units,
        colour: PALETTE[vehicles.length % PALETTE.length] });
    }
  }
  return { routes, vehicles, unitsPerMeter: units,
    stats: { routeCount: routes.length, vehicleCount: vehicles.length, maxVehicles: MAX_VEHICLES,
      carLengthMeters: 4.6, carWidthMeters: 1.9, omitted,
      policy: 'illustrative-source-segments; no-live-data; no-unregistered-bridge-decks; no-shortcut-chords' } };
}

/** Position on a single source segment; direction follows any oneway tag. */
export function sampleTrafficRoute(route, distance, direction = 1) {
  const sign = direction === -1 ? -1 : 1;
  const span = Math.max(EPSILON, route.usableLength);
  const travelled = ((Number.isFinite(distance) ? distance : 0) % span + span) % span;
  const along = sign > 0 ? route.padding + travelled : route.length - route.padding - travelled;
  const offset = route.laneOffset * sign;
  const edge = Math.min(travelled, span - travelled);
  const t = clamp(edge / (route.carLength * 2.1), 0, 1);
  return {
    x: route.a[0] + route.tangent[0] * along + route.normal[0] * offset,
    z: route.a[1] + route.tangent[1] * along + route.normal[1] * offset,
    yaw: -Math.atan2(route.tangent[1] * sign, route.tangent[0] * sign),
    scale: t * t * (3 - 2 * t),
  };
}

function pairedLamps(length, width, height, front) {
  const pieces = [-1, 1].map(side => {
    const geometry = new THREE.BoxGeometry(length * 0.045, height * 0.18, width * 0.2);
    geometry.translate(length * (front ? 0.502 : -0.502), height * 0.49, width * 0.29 * side);
    return geometry;
  });
  const result = mergeGeometries(pieces, false);
  pieces.forEach(geometry => geometry.dispose());
  return result;
}

export function createCityTraffic({ roads = [], roadSurface, inWater = () => false,
  extent = 320, worldUnitsPerMeter = 0.02 } = {}) {
  if (typeof roadSurface?.getSegment !== 'function') {
    throw new TypeError('createCityTraffic requires the rendered road network roadSurface');
  }
  const plan = planTrafficRoutes({ roads, roadSurface, inWater, extent, worldUnitsPerMeter });
  const group = new THREE.Group(); group.name = 'illustrative road traffic'; group.visible = false;
  const length = plan.unitsPerMeter * 4.6, width = plan.unitsPerMeter * 1.9, height = plan.unitsPerMeter * 1.55;
  const bodyGeometry = new THREE.BoxGeometry(length, height * 0.54, width);
  bodyGeometry.translate(0, height * 0.32, 0);
  const cabinGeometry = new THREE.BoxGeometry(length * 0.5, height * 0.46, width * 0.86);
  cabinGeometry.translate(-length * 0.035, height * 0.77, 0);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.65, metalness: 0.08 });
  const cabinMaterial = new THREE.MeshStandardMaterial({ color: '#517176', roughness: 0.42, metalness: 0.14 });
  const headMaterial = new THREE.MeshBasicMaterial({ color: '#ffedb9', toneMapped: false });
  const tailMaterial = new THREE.MeshBasicMaterial({ color: '#d77d62', toneMapped: false });
  const meshes = [
    new THREE.InstancedMesh(bodyGeometry, bodyMaterial, plan.vehicles.length),
    new THREE.InstancedMesh(cabinGeometry, cabinMaterial, plan.vehicles.length),
    new THREE.InstancedMesh(pairedLamps(length, width, height, true), headMaterial, plan.vehicles.length),
    new THREE.InstancedMesh(pairedLamps(length, width, height, false), tailMaterial, plan.vehicles.length),
  ];
  meshes.forEach((mesh, index) => {
    mesh.name = ['traffic car bodies', 'traffic car cabins', 'traffic headlamps', 'traffic tail lamps'][index];
    mesh.castShadow = false; mesh.receiveShadow = index < 2;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(mesh);
  });
  plan.vehicles.forEach((vehicle, index) => meshes[0].setColorAt(index, new THREE.Color(vehicle.colour)));
  if (meshes[0].instanceColor) meshes[0].instanceColor.needsUpdate = true;
  meshes[2].visible = meshes[3].visible = false;
  const dummy = new THREE.Object3D();
  const forward = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3();
  const rotationBasis = new THREE.Matrix4();
  const clearance = plan.unitsPerMeter * 0.05;
  let enabled = true, motionEnabled = true, night = false, disposed = false, frames = 0;
  let unplacedVehicles = 0;
  let pixelsPerUnit = 0, visibleRouteCount = plan.routes.length;
  const routeBounds = plan.routes.map(route => route.surface.bounds.clone().expandByScalar(Math.max(width, height)));
  // Derive the rigid car pose from its own rendered source segment. A global
  // downward ray would incorrectly pull ground traffic onto an overpass.
  // Sampling the wheel footprint also smooths the tiny normal changes where
  // a car straddles two triangles, without cutting corners in the source path.
  const placeOnRoad = (route, point, direction) => {
    const sample = route.surface.sample;
    const center = sample(point.x, point.z);
    if (!center) return false;
    const sign = direction === -1 ? -1 : 1;
    const tx = route.tangent[0] * sign, tz = route.tangent[1] * sign;
    const nx = -tz, nz = tx;
    const front = sample(point.x + tx * length / 2, point.z + tz * length / 2);
    const back = sample(point.x - tx * length / 2, point.z - tz * length / 2);
    const right = sample(point.x + nx * width / 2, point.z + nz * width / 2);
    const left = sample(point.x - nx * width / 2, point.z - nz * width / 2);
    if (!front || !back || !right || !left) return false;
    forward.set(tx, (front.height - back.height) / length, tz);
    side.set(nx, (right.height - left.height) / width, nz);
    up.crossVectors(side, forward).normalize();
    if (!Number.isFinite(up.y) || up.y <= 0) return false;
    forward.set(tx, -(up.x * tx + up.z * tz) / up.y, tz).normalize();
    side.crossVectors(forward, up).normalize();
    rotationBasis.makeBasis(forward, up, side);
    // Check the complete body/lamp footprint after rotation, then use the
    // smallest vertical offset that keeps every corner above the asphalt.
    let elevation = center.height;
    for (const localX of [-length * 0.525 * point.scale, length * 0.525 * point.scale]) {
      for (const localZ of [-width / 2 * point.scale, width / 2 * point.scale]) {
        const x = point.x + forward.x * localX + side.x * localZ;
        const z = point.z + forward.z * localX + side.z * localZ;
        const contact = sample(x, z);
        if (!contact) return false;
        elevation = Math.max(elevation, contact.height - forward.y * localX - side.y * localZ);
      }
    }
    dummy.position.set(point.x, elevation + clearance, point.z);
    dummy.quaternion.setFromRotationMatrix(rotationBasis);
    dummy.scale.setScalar(point.scale);
    return true;
  };
  // Physical car dimensions stay fixed. Do not enlarge cars as the city zooms
  // out; hide the entire layer before tiny cars become screen-space noise.
  const minimumPixelsPerUnit = 1.7 / length;
  const write = () => {
    unplacedVehicles = 0;
    plan.vehicles.forEach((vehicle, index) => {
      const route = plan.routes[vehicle.routeIndex], point = sampleTrafficRoute(route, vehicle.distance, vehicle.direction);
      if (!placeOnRoad(route, point, vehicle.direction)) {
        // An absent or invalid surface must never leave a car at a stale pose
        // or manufacture a terrain height that differs from the visible road.
        dummy.position.set(0, 0, 0); dummy.quaternion.identity(); dummy.scale.setScalar(0);
        unplacedVehicles++;
      }
      dummy.updateMatrix();
      for (const mesh of meshes) mesh.setMatrixAt(index, dummy.matrix);
    });
    meshes.forEach(mesh => { mesh.instanceMatrix.needsUpdate = true; });
    frames++;
  };
  write();
  return {
    group,
    setEnabled(value) { enabled = Boolean(value); if (!enabled) group.visible = false; },
    setTheme(value) {
      night = Boolean(value);
      bodyMaterial.color.set(night ? '#a9b7b0' : '#ffffff');
      cabinMaterial.color.set(night ? '#344a52' : '#517176');
      meshes[2].visible = meshes[3].visible = night;
    },
    update(deltaSeconds, options = {}) {
      if (disposed) return false;
      if (options.enabled != null) enabled = Boolean(options.enabled);
      if (options.motionEnabled != null) motionEnabled = Boolean(options.motionEnabled);
      if (options.pixelsPerUnit != null) pixelsPerUnit = Number.isFinite(options.pixelsPerUnit) ? options.pixelsPerUnit : 0;
      // Test route bounds, not only the current car positions: an offscreen
      // car still needs to move into a visible part of its own road.
      if (options.frustum) visibleRouteCount = routeBounds.filter(bounds => options.frustum.intersectsBox(bounds)).length;
      else visibleRouteCount = plan.routes.length;
      const wasVisible = group.visible;
      group.visible = enabled && plan.vehicles.length > 0 && visibleRouteCount > 0 && pixelsPerUnit >= minimumPixelsPerUnit;
      const delta = clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0, 0.06);
      const moving = group.visible && motionEnabled && delta > 0;
      if (moving) {
        for (const vehicle of plan.vehicles) {
          const route = plan.routes[vehicle.routeIndex];
          vehicle.distance = (vehicle.distance + vehicle.speed * delta) % route.usableLength;
        }
        write();
      }
      return moving || wasVisible !== group.visible;
    },
    shouldAnimate() { return !disposed && enabled && group.visible && motionEnabled && plan.vehicles.length > 0; },
    getStats() { return { ...plan.stats, enabled, visible: group.visible, moving: this.shouldAnimate(), night,
      drawCalls: group.visible ? (night ? 4 : 2) : 0, minimumPixelsPerUnit, matrixUpdates: frames,
      visibleRouteCount, unplacedVehicles, roadContactPolicy: 'rendered-source-road-triangles-with-footprint-slope',
      routes: plan.routes.map(route => ({ id: route.id, name: route.name, osmId: route.osmId,
        sourceRoadIndex: route.sourceRoadIndex, sourceSegmentIndex: route.sourceSegmentIndex, oneWay: route.oneWay })) }; },
    dispose() {
      if (disposed) return; disposed = true;
      for (const mesh of meshes) { mesh.geometry.dispose(); mesh.material.dispose(); }
      group.clear(); group.removeFromParent();
    },
  };
}
