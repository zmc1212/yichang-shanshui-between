import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const WATERFRONT_IDS = new Set(['zhenjiang-pavilion', 'tianran-pagoda']);
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const offset = (p, n, amount) => [p[0] + n[0] * amount, p[1] + n[1] * amount];
function boundsOf(ring) {
  const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}
function inRect(x, z, b, margin = 0) {
  return x >= b.minX - margin && x <= b.maxX + margin && z >= b.minZ - margin && z <= b.maxZ + margin;
}
function inRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function projection(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], squared = dx * dx + dz * dz;
  const t = squared ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / squared, 0, 1) : 0;
  const point = [a[0] + dx * t, a[1] + dz * t];
  return { point, t, distance: distance(p, point) };
}
function overlapsRect(ring, box) {
  const b = boundsOf(ring);
  if (b.maxX < box.minX || b.minX > box.maxX || b.maxZ < box.minZ || b.minZ > box.maxZ) return false;
  if (ring.some(p => inRect(p[0], p[1], box))) return true;
  const corners = [[box.minX, box.minZ], [box.maxX, box.minZ], [box.maxX, box.maxZ], [box.minX, box.maxZ]];
  if (corners.some(p => inRing(p[0], p[1], ring))) return true;
  // Liang–Barsky clipping catches a long footprint edge crossing the box.
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], c = ring[(i + 1) % ring.length], dx = c[0] - a[0], dz = c[1] - a[1];
    let low = 0, high = 1, hit = true;
    const ps = [-dx, dx, -dz, dz], qs = [a[0] - box.minX, box.maxX - a[0], a[1] - box.minZ, box.maxZ - a[1]];
    for (let j = 0; j < 4; j++) {
      if (Math.abs(ps[j]) < 1e-9) { if (qs[j] < 0) hit = false; }
      else if (ps[j] < 0) low = Math.max(low, qs[j] / ps[j]);
      else high = Math.min(high, qs[j] / ps[j]);
    }
    if (hit && low <= high) return true;
  }
  return false;
}
function makeIndex(items, cellSize = 4) {
  const cells = new Map();
  for (const item of items) {
    const b = item.bounds;
    for (let x = Math.floor((b.minX - 2) / cellSize); x <= Math.floor((b.maxX + 2) / cellSize); x++) {
      for (let z = Math.floor((b.minZ - 2) / cellSize); z <= Math.floor((b.maxZ + 2) / cellSize); z++) {
        const key = `${x},${z}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(item);
      }
    }
  }
  return (x, z) => cells.get(`${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`) || [];
}
function shoreNormal(point, tangent, inWater) {
  const normal = [-tangent[1], tangent[0]];
  for (const delta of [0.3, 0.65]) {
    const a = offset(point, normal, delta), b = offset(point, normal, -delta);
    const waterA = inWater(a[0], a[1]), waterB = inWater(b[0], b[1]);
    if (waterA !== waterB) return waterA ? [-normal[0], -normal[1]] : normal;
  }
  return null;
}
function pointOnShore(shore, at, inWater) {
  const s = (at % shore.length + shore.length) % shore.length;
  let index = shore.lengths.findIndex((v, i) => i < shore.points.length && shore.lengths[i + 1] >= s);
  if (index < 0) index = shore.points.length - 1;
  const a = shore.points[index], b = shore.points[(index + 1) % shore.points.length];
  const length = distance(a, b), t = length ? (s - shore.lengths[index]) / length : 0;
  const point = [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
  const tangent = length ? [(b[0] - a[0]) / length, (b[1] - a[1]) / length] : [1, 0];
  return { point, tangent, normal: shoreNormal(point, tangent, inWater), at: s };
}
function quadSamples(points, check) {
  for (let u = 0; u <= 4; u++) for (let v = 0; v <= 6; v++) {
    const a = [lerp(points[0][0], points[1][0], u / 4), lerp(points[0][1], points[1][1], u / 4)];
    const b = [lerp(points[3][0], points[2][0], u / 4), lerp(points[3][1], points[2][1], u / 4)];
    if (!check(lerp(a[0], b[0], v / 6), lerp(a[1], b[1], v / 6))) return false;
  }
  return true;
}

/** Local, illustrative furnishings fitted to the source shoreline. No source
 * POI or water geometry is changed. This planner is independent of WebGL. */
export function planWaterfront({ data, landmarks, modelBounds, inWater, heightAt }) {
  const width = data.meta.width, depth = data.meta.depth;
  const insideBoard = (x, z, margin = 0) => Math.abs(x) < width / 2 - margin && Math.abs(z) < depth / 2 - margin;
  const shores = [];
  for (const polygon of data.water || []) for (const source of polygon.rings || []) {
    const points = source.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (points.length > 2 && distance(points[0], points.at(-1)) < 0.0001) points.pop();
    if (points.length < 3) continue;
    let area = 0; const lengths = [0];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      area += a[0] * b[1] - b[0] * a[1]; lengths.push(lengths.at(-1) + distance(a, b));
    }
    if (Math.abs(area) < 120) continue;
    shores.push({ points, lengths, length: lengths.at(-1) });
  }
  const sites = [];
  for (const spec of landmarks) {
    if (!WATERFRONT_IDS.has(spec.id)) continue;
    let nearest = null;
    for (const shore of shores) for (let i = 0; i < shore.points.length; i++) {
      const a = shore.points[i], b = shore.points[(i + 1) % shore.points.length];
      const p = projection([spec.x, spec.z], a, b);
      if (!insideBoard(p.point[0], p.point[1], 2) || (nearest && nearest.distance <= p.distance)) continue;
      const sample = pointOnShore(shore, shore.lengths[i] + distance(a, b) * p.t, inWater);
      if (sample.normal) nearest = { ...sample, distance: p.distance, shore };
    }
    if (!nearest || nearest.distance > 14) continue;
    const footprint = modelBounds.get(spec.id) || { minX: -2.5, maxX: 2.5, minZ: -2.5, maxZ: 2.5 };
    // Anchors are geographic inputs, never a search variable. Scale/yaw are
    // resolved by the model factory before the complete bbox reaches here.
    const center = [spec.x, spec.z], clearance = 0.04;
    const minX = footprint.minX - clearance, maxX = footprint.maxX + clearance;
    const minZ = footprint.minZ - clearance, maxZ = footprint.maxZ + clearance;
    const countX = Math.max(1, Math.ceil((maxX - minX) / 0.12));
    const countZ = Math.max(1, Math.ceil((maxZ - minZ) / 0.12));
    let found = true;
    for (let i = 0; i <= countX; i++) for (let j = 0; j <= countZ; j++) {
      const x = center[0] + lerp(minX, maxX, i / countX), z = center[1] + lerp(minZ, maxZ, j / countZ);
      if (!insideBoard(x, z, 0.04) || inWater(x, z)) found = false;
    }
    const padding = clamp(Math.max(maxX - minX, maxZ - minZ) * 0.04, 0.04, 0.12);
    const footprintWorld = { minX: center[0] + footprint.minX - padding, maxX: center[0] + footprint.maxX + padding, minZ: center[1] + footprint.minZ - padding, maxZ: center[1] + footprint.maxZ + padding };
    const furnitureScale = clamp(Number.isFinite(spec.modelScale) && spec.modelScale > 0 ? spec.modelScale : 1, 0.28, 1);
    sites.push({ id: spec.id, original: [spec.x, spec.z], center, footprint: footprintWorld, footprintFitsLand: found, fitClearance: clearance, anchorPolicy: 'fixed-source-poi', shift: 0, furnitureScale, shore: nearest, paving: [], rails: [], benches: [], lamps: [], routes: [] });
  }
  const omittedBuildingIndices = new Set();
  const buildings = [];
  (data.buildings || []).forEach((building, index) => {
    if (!building.ring?.length) return;
    if (sites.some(s => overlapsRect(building.ring, s.footprint))) { omittedBuildingIndices.add(index); return; }
    buildings.push({ ring: building.ring, bounds: boundsOf(building.ring) });
  });
  const nearbyBuildings = makeIndex(buildings);
  const buildingBlocked = (x, z, margin = 0) => nearbyBuildings(x, z).some(b => {
    if (!inRect(x, z, b.bounds, margin)) return false;
    if (inRing(x, z, b.ring)) return true;
    return margin > 0 && b.ring.some((a, i) => projection([x, z], a, b.ring[(i + 1) % b.ring.length]).distance < margin);
  });
  const roads = [];
  for (const road of data.roads || []) for (let i = 1; i < (road.points || []).length; i++) {
    const a = road.points[i - 1], b = road.points[i];
    roads.push({ a, b, width: road.width || 0.1, kind: road.kind, bounds: boundsOf([a, b]) });
  }
  const nearbyRoads = makeIndex(roads);
  const roadBlocked = (x, z, margin) => nearbyRoads(x, z).some(r => projection([x, z], r.a, r.b).distance < r.width / 2 + margin);
  const safeLand = (x, z) => insideBoard(x, z, 0.1) && !inWater(x, z) && !buildingBlocked(x, z);
  const occupied = [];
  for (const site of sites) {
    const samples = [];
    for (let at = -12; at <= 12.01; at += 0.6) samples.push(pointOnShore(site.shore.shore, site.shore.at + at, inWater));
    const accepted = new Set();
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i]; if (!a.normal || !b.normal) continue;
      const points = [offset(a.point, a.normal, 0.22), offset(b.point, b.normal, 0.22), offset(b.point, b.normal, 1.42), offset(a.point, a.normal, 1.42)];
      if (!quadSamples(points, safeLand)) continue;
      site.paving.push({ points, plaza: false });
      site.rails.push({ a: offset(a.point, a.normal, 0.29), b: offset(b.point, b.normal, 0.29) });
      accepted.add(i - 1); accepted.add(i);
    }
    // A small square-paved forecourt connects the model to the river walk.
    // Its individual cells are retained only when entirely on source land.
    const b = site.footprint, step = 0.42;
    for (let x = b.minX - 0.35; x < b.maxX + 0.35; x += step) for (let z = b.minZ - 0.35; z < b.maxZ + 0.35; z += step) {
      const x1 = Math.min(x + step, b.maxX + 0.35), z1 = Math.min(z + step, b.maxZ + 0.35);
      const points = [[x, z], [x1, z], [x1, z1], [x, z1]];
      if (quadSamples(points, safeLand)) site.paving.push({ points, plaza: true });
    }
    function addFurniture(sample, kind) {
      if (!sample.normal) return;
      const center = offset(sample.point, sample.normal, kind === 'bench' ? 1.02 : 1.18);
      const radius = kind === 'bench' ? 0.42 : 0.2;
      if (inRect(center[0], center[1], site.footprint, 0.45) || roadBlocked(center[0], center[1], radius * 0.65) || occupied.some(p => distance(p, center) < 0.8)) return;
      for (let j = 0; j < 8; j++) {
        const x = center[0] + Math.cos(j * Math.PI / 4) * radius, z = center[1] + Math.sin(j * Math.PI / 4) * radius;
        if (!safeLand(x, z)) return;
      }
      const item = { x: center[0], z: center[1], y: heightAt(center[0], center[1]) + 0.09, angle: Math.atan2(sample.normal[0], sample.normal[1]) };
      site[kind === 'bench' ? 'benches' : 'lamps'].push(item); occupied.push(center);
    }
    samples.forEach((sample, i) => {
      if (!accepted.has(i)) return;
      if (i % 6 === 1) addFurniture(sample, 'bench');
      if (i % 8 === 4) addFurniture(sample, 'lamp');
    });
    site.bounds = { minX: Math.min(b.minX, ...site.paving.flatMap(p => p.points.map(q => q[0]))) - 1.4, maxX: Math.max(b.maxX, ...site.paving.flatMap(p => p.points.map(q => q[0]))) + 1.4, minZ: Math.min(b.minZ, ...site.paving.flatMap(p => p.points.map(q => q[1]))) - 1.4, maxZ: Math.max(b.maxZ, ...site.paving.flatMap(p => p.points.map(q => q[1]))) + 1.4 };
  }
  const hazards = landmarks.filter(l => l.kind === 'bridge' || l.kind === 'dam');
  const safeWater = (x, z, margin = 1.7) => {
    if (!insideBoard(x, z, margin) || !inWater(x, z)) return false;
    for (let i = 0; i < 12; i++) if (!inWater(x + Math.cos(i * Math.PI / 6) * margin, z + Math.sin(i * Math.PI / 6) * margin)) return false;
    if (nearbyRoads(x, z).some(r => r.kind === 'bridge' && projection([x, z], r.a, r.b).distance < 2.1 + margin)) return false;
    return !hazards.some(l => {
      if (l.endpoints) return projection([x, z], l.endpoints[0], l.endpoints[1]).distance < 2.3 + margin;
      const b = modelBounds.get(l.id), radius = b ? Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 : 10;
      return Math.hypot(x - l.x, z - l.z) < radius + margin + 2;
    });
  };
  const routes = [], boats = [];
  for (const site of sites) {
    const normal = site.shore.normal, tangent = site.shore.tangent;
    let route = null;
    for (const inland of [5.3, 6.5, 4.3, 7.5]) {
      for (const length of [4.3, 3.6, 2.8]) {
        const center = offset(site.shore.point, normal, -inland), points = [];
        for (let i = 0; i < 120; i++) {
          const t = i / 120 * Math.PI * 2;
          points.push([center[0] + tangent[0] * Math.cos(t) * length + normal[0] * Math.sin(t) * 0.9, center[1] + tangent[1] * Math.cos(t) * length + normal[1] * Math.sin(t) * 0.9]);
        }
        if (!points.every(p => safeWater(p[0], p[1]))) continue;
        const lengths = [0]; points.forEach((p, i) => lengths.push(lengths.at(-1) + distance(p, points[(i + 1) % points.length])));
        route = { id: `${site.id}-river-loop`, siteId: site.id, points, lengths, length: lengths.at(-1), elapsed: 0, safetyMargin: 1.7 };
        break;
      }
      if (route) break;
    }
    if (!route) continue;
    routes.push(route); site.routes.push(route.id);
    boats.push({ routeId: route.id, siteId: site.id, phase: 0.16, scale: site.id === 'tianran-pagoda' ? 1.06 : 0.92, palette: boats.length % 3 });
    if (site.id === 'zhenjiang-pavilion') boats.push({ routeId: route.id, siteId: site.id, phase: 0.67, scale: 0.76, palette: 2 });
  }
  return {
    sites, routes, boats, omittedBuildingIndices,
    getSite: id => sites.find(s => s.id === id),
    reserveTree(x, z) {
      for (const site of sites) {
        if (!inRect(x, z, site.bounds)) continue;
        if (inRect(x, z, site.footprint, 1)) return true;
        if (site.paving.some(p => inRing(x, z, p.points) || p.points.some((a, i) => projection([x, z], a, p.points[(i + 1) % 4]).distance < 0.9))) return true;
      }
      return false;
    },
  };
}

class Batches {
  constructor() { this.geometries = new Map(); }
  add(role, source, x = 0, y = 0, z = 0, rotation = null) {
    const geometry = source.index ? source.toNonIndexed() : source;
    if (source !== geometry) source.dispose();
    geometry.deleteAttribute('uv');
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    if (rotation) geometry.applyQuaternion(rotation);
    geometry.translate(x, y, z); geometry.clearGroups();
    if (!this.geometries.has(role)) this.geometries.set(role, []);
    this.geometries.get(role).push(geometry);
  }
  box(role, x, y, z, w, h, d, angle = 0) {
    this.add(role, new THREE.BoxGeometry(w, h, d), x, y, z, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle));
  }
  rod(role, a, b, radius = 0.025) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), direction = end.clone().sub(start), center = start.clone().add(end).multiplyScalar(0.5);
    if (direction.length() < 0.001) return;
    this.add(role, new THREE.CylinderGeometry(radius, radius, direction.length(), 5), center.x, center.y, center.z, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
  }
  finish(group, materials) {
    for (const [role, parts] of this.geometries) {
      const geometry = mergeGeometries(parts, false); parts.forEach(g => g.dispose());
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, materials[role]); mesh.name = `waterfront ${role}`;
      mesh.castShadow = !['paving', 'pavingAlt', 'light'].includes(role); mesh.receiveShadow = role !== 'light';
      group.add(mesh);
    }
  }
}
function quadGeometry(points, heightAt, lift = 0.085) {
  const positions = [];
  for (const index of [0, 2, 1, 0, 3, 2]) {
    const p = points[index]; positions.push(p[0], heightAt(p[0], p[1]) + lift, p[1]);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.computeVertexNormals();
  return g;
}

/** Batched scenery plus three instanced miniature boats. */
export function createWaterfront(plan, { heightAt, makeMaterial }) {
  const group = new THREE.Group(); group.name = 'local river walks';
  const batches = new Batches();
  const materials = {
    paving: makeMaterial('#d8d1b9', '#526e68', { side: THREE.DoubleSide }),
    pavingAlt: makeMaterial('#d3cbb1', '#4e6863', { side: THREE.DoubleSide }),
    stone: makeMaterial('#c5bca1', '#65776d'), metal: makeMaterial('#527b6d', '#718e7f'),
    wood: makeMaterial('#a67b50', '#8e7756'), light: makeMaterial('#f3dda8', '#ffdaa0'),
  };
  const lampPositions = [];
  for (const site of plan.sites) {
    const scale = site.furnitureScale || 1;
    site.paving.forEach((p, i) => batches.add(p.plaza && i % 9 === 0 ? 'pavingAlt' : 'paving', quadGeometry(p.points, heightAt, p.plaza ? 0.091 : 0.085)));
    for (const rail of site.rails) {
      // Keep the mapped shoreline endpoints; only the rail profile scales
      // above the existing paving surface.
      const ay = heightAt(rail.a[0], rail.a[1]) + 0.085, by = heightAt(rail.b[0], rail.b[1]) + 0.085;
      const rise = height => (height - 0.085) * scale;
      batches.rod('stone', [rail.a[0], ay + rise(0.11), rail.a[1]], [rail.b[0], by + rise(0.11), rail.b[1]], 0.075 * scale);
      for (const h of [0.23, 0.4]) batches.rod('metal', [rail.a[0], ay + rise(h), rail.a[1]], [rail.b[0], by + rise(h), rail.b[1]], 0.018 * scale);
      batches.rod('metal', [rail.a[0], ay + rise(0.14), rail.a[1]], [rail.a[0], ay + rise(0.43), rail.a[1]], 0.026 * scale);
    }
    for (const bench of site.benches) {
      const sin = Math.sin(bench.angle), cos = Math.cos(bench.angle);
      const local = (x, y, z) => [bench.x + (cos * x + sin * z) * scale, bench.y + y * scale, bench.z + (-sin * x + cos * z) * scale];
      for (const x of [-0.23, 0.23]) for (const z of [-0.07, 0.07]) {
        const p = local(x, 0.12, z); batches.box('metal', ...p, 0.04 * scale, 0.24 * scale, 0.04 * scale, bench.angle);
      }
      for (let i = 0; i < 3; i++) { const p = local(0, 0.25, (i - 1) * 0.065); batches.box('wood', ...p, 0.65 * scale, 0.045 * scale, 0.052 * scale, bench.angle); }
      const back = local(0, 0.38, 0.105); batches.box('wood', ...back, 0.65 * scale, 0.19 * scale, 0.045 * scale, bench.angle);
    }
    for (const lamp of site.lamps) {
      batches.box('stone', lamp.x, lamp.y + 0.04 * scale, lamp.z, 0.15 * scale, 0.08 * scale, 0.15 * scale);
      batches.rod('metal', [lamp.x, lamp.y + 0.06 * scale, lamp.z], [lamp.x, lamp.y + 0.96 * scale, lamp.z], 0.024 * scale);
      batches.box('metal', lamp.x, lamp.y + 0.98 * scale, lamp.z, 0.17 * scale, 0.045 * scale, 0.17 * scale);
      batches.box('light', lamp.x, lamp.y + 0.91 * scale, lamp.z, 0.105 * scale, 0.11 * scale, 0.105 * scale);
      lampPositions.push(lamp.x, lamp.y + 0.91 * scale, lamp.z);
    }
  }
  batches.finish(group, materials);
  const lampGlowMaterial = new THREE.PointsMaterial({ color: '#ffd798', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.86, depthWrite: false, toneMapped: false });
  const lampGeometry = new THREE.BufferGeometry(); lampGeometry.setAttribute('position', new THREE.Float32BufferAttribute(lampPositions, 3));
  const lampGlow = new THREE.Points(lampGeometry, lampGlowMaterial); lampGlow.name = 'river walk warm lamps'; lampGlow.visible = false; group.add(lampGlow);

  const boatGroup = new THREE.Group(); boatGroup.name = 'river miniature boats';
  const count = plan.boats.length, boatBatches = new Batches();
  const hullShape = new THREE.Shape([[0.64, 0], [0.38, -0.19], [-0.48, -0.19], [-0.61, -0.1], [-0.61, 0.1], [0.38, 0.19]].map(p => new THREE.Vector2(p[0], -p[1])));
  const hull = new THREE.ExtrudeGeometry(hullShape, { depth: 0.16, bevelEnabled: false, curveSegments: 1 }); hull.rotateX(-Math.PI / 2);
  boatBatches.add('hull', hull, 0, 0.01, 0);
  boatBatches.box('deck', -0.04, 0.185, 0, 0.88, 0.045, 0.31);
  boatBatches.box('deck', -0.07, 0.3, 0, 0.47, 0.22, 0.25);
  boatBatches.box('hull', -0.07, 0.43, 0, 0.53, 0.05, 0.29);
  for (const side of [-1, 1]) for (const x of [-0.23, -0.08, 0.07]) boatBatches.box('glass', x, 0.32, side * 0.128, 0.11, 0.095, 0.012);
  boatBatches.box('glass', 0.17, 0.32, 0, 0.012, 0.095, 0.2);
  const boatMaterials = {
    hull: makeMaterial('#ffffff', '#b8d0c4'), deck: makeMaterial('#fff8df', '#c7d0b9'), glass: makeMaterial('#53848d', '#f3c67d'),
  };
  const boatMeshes = [];
  for (const [role, parts] of boatBatches.geometries) {
    const geometry = mergeGeometries(parts, false); parts.forEach(g => g.dispose());
    const mesh = new THREE.InstancedMesh(geometry, boatMaterials[role], count); mesh.name = `river boats ${role}`;
    mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false; boatGroup.add(mesh); boatMeshes.push(mesh);
    if (role === 'hull') plan.boats.forEach((boat, i) => mesh.setColorAt(i, new THREE.Color(['#558392', '#d8bb7a', '#c27756'][boat.palette])));
  }
  const wakePositions = [];
  for (const sign of [-1, 1]) {
    const a = [-0.55, 0.016, sign * 0.12], b = [-1.45, 0.016, sign * 0.48], c = [-1.45, 0.016, sign * 0.505], d = [-0.55, 0.016, sign * 0.145];
    for (const p of [a, b, c, a, c, d]) wakePositions.push(...p);
  }
  const wakeGeometry = new THREE.BufferGeometry(); wakeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wakePositions, 3));
  const wakeMaterial = new THREE.MeshBasicMaterial({ color: '#daf2ed', transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
  const wakes = new THREE.InstancedMesh(wakeGeometry, wakeMaterial, count); wakes.name = 'small river wakes'; wakes.frustumCulled = false; boatGroup.add(wakes); boatMeshes.push(wakes);
  const boatLampGeo = new THREE.BufferGeometry(); boatLampGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  const boatLampMaterial = new THREE.PointsMaterial({ color: '#ffd895', size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false });
  const boatLamps = new THREE.Points(boatLampGeo, boatLampMaterial); boatLamps.frustumCulled = false; boatLamps.visible = false; boatGroup.add(boatLamps);
  const dummy = new THREE.Object3D();
  const routeMap = new Map(plan.routes.map(r => [r.id, r]));
  function locateBoat(boat) {
    const route = routeMap.get(boat.routeId);
    const s = (boat.phase * route.length + route.elapsed * 0.16) % route.length;
    let index = 0; while (index < route.points.length - 1 && route.lengths[index + 1] < s) index++;
    const a = route.points[index], b = route.points[(index + 1) % route.points.length];
    const t = (s - route.lengths[index]) / Math.max(0.0001, route.lengths[index + 1] - route.lengths[index]);
    return { x: lerp(a[0], b[0], t), z: lerp(a[1], b[1], t), angle: -Math.atan2(b[1] - a[1], b[0] - a[0]) };
  }
  function writeBoats() {
    plan.boats.forEach((boat, i) => {
      const point = locateBoat(boat); dummy.position.set(point.x, 0.155, point.z); dummy.rotation.set(0, point.angle, 0); dummy.scale.setScalar(boat.scale); dummy.updateMatrix();
      boatMeshes.forEach(mesh => mesh.setMatrixAt(i, dummy.matrix)); boatLampGeo.attributes.position.setXYZ(i, point.x, 0.155 + 0.35 * boat.scale, point.z);
    });
    boatMeshes.forEach(mesh => { mesh.instanceMatrix.needsUpdate = true; }); boatLampGeo.attributes.position.needsUpdate = true;
  }
  writeBoats();
  return {
    group, boatGroup,
    update(delta, selectedId) {
      let changed = false;
      for (const route of plan.routes) if (route.siteId === selectedId) { route.elapsed += Math.min(delta, 0.1); changed = true; }
      if (changed) writeBoats();
      return changed;
    },
    setTheme(night) {
      materials.light.emissive.set(night ? '#ffd49a' : '#000000'); materials.light.emissiveIntensity = night ? 0.65 : 0;
      boatMaterials.glass.emissive.set(night ? '#eac070' : '#000000'); boatMaterials.glass.emissiveIntensity = night ? 0.35 : 0;
      lampGlow.visible = boatLamps.visible = night; wakeMaterial.opacity = night ? 0.2 : 0.28;
    },
    stats: { waterfrontSites: plan.sites.length, waterfrontPavingCells: plan.sites.reduce((n, s) => n + s.paving.length, 0), waterfrontRailSegments: plan.sites.reduce((n, s) => n + s.rails.length, 0), waterfrontBenches: plan.sites.reduce((n, s) => n + s.benches.length, 0), waterfrontLamps: plan.sites.reduce((n, s) => n + s.lamps.length, 0), boats: count, boatRoutes: plan.routes.length, wakes: count, clearedOverlappingBuildings: plan.omittedBuildingIndices.size },
  };
}
