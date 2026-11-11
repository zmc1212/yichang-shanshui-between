import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getRoadGrade, getRoadHighway, getRoadWidth } from './roadNetwork.js';
import { createStreetPavingTexture, streetPavingUv } from './streetPavingTexture.js';

// Bounded decorative streetscape, not surveyed sidewalks or an access network.
// Every strip follows an unchanged, retained source-road segment. The planner
// never creates junctions, entrances, crossings, ramps or model exceptions.
export const URBAN_STREET_LIMITS = Object.freeze({
  focusModelIds: Object.freeze(['wanda-soho-s01', 'yichang-international-s01']),
  focusRadiusMetres: 340,
  cellLengthMetres: 8,
  sidewalkWidthMetres: 3.6,
  treeStepMetres: 16,
  lampStepMetres: 34,
  maxCells: 1600,
  maxTrees: 120,
  maxLamps: 80,
  // Source road surfaces use a 0.12 lift. This adds 20 cm of display height
  // at the retained scale; the strips are thin tops, never raised platforms.
  pavingLift: 0.124,
  curbHeightMetres: 0.16,
});

const EPS = 1e-9;
const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const validPoint = p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const edges = ring => ring.map((p, i) => [p, ring[(i + 1) % ring.length]]);
const signedArea = ring => edges(ring).reduce((sum, [a, b]) => sum + a[0] * b[1] - b[0] * a[1], 0) / 2;
const add = (p, tangent, at, normal, offset) => [p[0] + tangent[0] * at + normal[0] * offset, p[1] + tangent[1] * at + normal[1] * offset];
const boxOf = points => ({ minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])), minZ: Math.min(...points.map(p => p[1])), maxZ: Math.max(...points.map(p => p[1])) });
const boxesNear = (a, b, pad = 0) => a.minX <= b.maxX + pad && b.minX <= a.maxX + pad && a.minZ <= b.maxZ + pad && b.minZ <= a.maxZ + pad;
const padded = (b, pad) => ({ minX: b.minX - pad, maxX: b.maxX + pad, minZ: b.minZ - pad, maxZ: b.maxZ + pad });

function pointDistance(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], lengthSq = dx * dx + dz * dz;
  const t = lengthSq ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / lengthSq, 0, 1) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}
function inside(p, ring, boundary = true) {
  let hit = false;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (boundary && pointDistance(p, a, b) < EPS) return true;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}
function segmentDistance(a, b, c, d) {
  if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return 0;
  return Math.min(pointDistance(a, c, d), pointDistance(b, c, d), pointDistance(c, a, b), pointDistance(d, a, b));
}
function boundaryDistance(a, b) {
  let nearest = Infinity;
  for (const [p, q] of edges(a)) for (const [r, s] of edges(b)) nearest = Math.min(nearest, segmentDistance(p, q, r, s));
  return nearest;
}
function ringDistance(a, b) {
  if (a.some(p => inside(p, b)) || b.some(p => inside(p, a))) return 0;
  return boundaryDistance(a, b);
}
function overlapsConvex(a, b) {
  // SAT permits adjoining cells to share an edge but rejects positive-area
  // overlap at source bends or neighbouring roads, avoiding stacked paving.
  for (const ring of [a, b]) for (const [p, q] of edges(ring)) {
    const normal = [p[1] - q[1], q[0] - p[0]];
    const ap = a.map(v => v[0] * normal[0] + v[1] * normal[1]);
    const bp = b.map(v => v[0] * normal[0] + v[1] * normal[1]);
    if (Math.max(...ap) <= Math.min(...bp) + EPS || Math.max(...bp) <= Math.min(...ap) + EPS) return false;
  }
  return true;
}
function rectangle(a, tangent, normal, start, end, inner, outer) {
  return [add(a, tangent, start, normal, inner), add(a, tangent, end, normal, inner), add(a, tangent, end, normal, outer), add(a, tangent, start, normal, outer)];
}
function circle(center, radius, count = 16) {
  // Circumscribed polygon contains the entire rendered crown, not just its
  // sample vertices. This also bounds lamp arms and their small base plates.
  const r = radius / Math.cos(Math.PI / count);
  return Array.from({ length: count }, (_, i) => [center[0] + Math.cos(i * Math.PI * 2 / count) * r, center[1] + Math.sin(i * Math.PI * 2 / count) * r]);
}
function makeIndex(region, cellSize) {
  const grid = new Map();
  function keys(bounds) {
    if (!boxesNear(bounds, region)) return [];
    const keys = [];
    const x0 = Math.floor(Math.max(region.minX, bounds.minX) / cellSize), x1 = Math.floor(Math.min(region.maxX, bounds.maxX) / cellSize);
    const z0 = Math.floor(Math.max(region.minZ, bounds.minZ) / cellSize), z1 = Math.floor(Math.min(region.maxZ, bounds.maxZ) / cellSize);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) keys.push(`${x}:${z}`);
    return keys;
  }
  return {
    add(value, bounds) { for (const key of keys(bounds)) { if (!grid.has(key)) grid.set(key, []); grid.get(key).push(value); } },
    query(bounds) { const result = new Set(); for (const key of keys(bounds)) for (const value of grid.get(key) || []) result.add(value); return result; },
  };
}
function ringsOf(polygon) {
  const rings = polygon.rings || (polygon.ring ? [polygon.ring] : []);
  return rings.filter(ring => ring?.length >= 3 && ring.every(validPoint));
}
function emptyPlan(units) {
  return { cells: [], curbs: [], trees: [], lamps: [], bounds: null, units, focusModelIds: [],
    stats: { urbanStreetCells: 0, urbanStreetCurbs: 0, urbanStreetTrees: 0, urbanStreetLamps: 0, urbanStreetRoads: 0, urbanStreetLengthMetres: 0, urbanStreetIllustrative: true, urbanStreetConnections: 0 }, reserveTree: () => false };
}

export function planUrbanStreetGround({ data, models = [], heightAt = () => 0, inWater = () => false, existingStreetPlan, unitsPerMeter }) {
  const units = Number(unitsPerMeter || data?.meta?.unitsPerMeter) || .02;
  const focus = models.filter(model => URBAN_STREET_LIMITS.focusModelIds.includes(model.id) && Number.isFinite(model.x) && Number.isFinite(model.z));
  if (!focus.length) return emptyPlan(units);
  const radius = URBAN_STREET_LIMITS.focusRadiusMetres * units;
  const region = padded(boxOf(focus.map(model => [model.x, model.z])), radius);
  const indexRegion = padded(region, 12 * units);
  const obstacleIndex = makeIndex(indexRegion, 30 * units), roadIndex = makeIndex(indexRegion, 30 * units), pavingIndex = makeIndex(indexRegion, 30 * units), fixtureIndex = makeIndex(indexRegion, 30 * units);
  const clear = .2 * units, edgePad = .026, innerGap = Math.max(.03, edgePad + clear);
  const within = p => focus.some(model => Math.hypot(p[0] - model.x, p[1] - model.z) <= radius);
  const stats = { urbanStreetCells: 0, urbanStreetCurbs: 0, urbanStreetTrees: 0, urbanStreetLamps: 0, urbanStreetRoads: 0, urbanStreetLengthMetres: 0,
    urbanStreetIllustrative: true, urbanStreetConnections: 0, urbanStreetRejected: {}, urbanStreetFocusIds: focus.map(model => model.id), urbanStreetFocusRadiusMetres: URBAN_STREET_LIMITS.focusRadiusMetres };
  const reject = reason => { stats.urbanStreetRejected[reason] = (stats.urbanStreetRejected[reason] || 0) + 1; return false; };
  function obstacle(rings, kind) {
    if (!rings.length) return;
    const value = { rings, kind, bounds: boxOf(rings[0]) };
    if (boxesNear(value.bounds, indexRegion)) {
      value.boundary = rings.flatMap(ring => edges(ring).map(([a, b]) => ({ a, b, bounds: boxOf([a, b]) }))).filter(edge => boxesNear(edge.bounds, indexRegion, clear));
      obstacleIndex.add(value, padded(value.bounds, clear));
    }
  }
  // All retained source footprints are conservative obstacles, even source
  // buildings replaced by an authored model. No parcel is silently exempted.
  for (const building of data.buildings || []) obstacle(ringsOf(building), 'building');
  for (const model of models) if (model.footprint?.length >= 3) obstacle([model.footprint], 'model');
  for (const water of data.water || []) obstacle(ringsOf(water), 'water');
  for (const site of [...(existingStreetPlan?.sites || []), ...(existingStreetPlan?.links || []), ...(existingStreetPlan?.extensions || [])]) {
    for (const cell of site.paving || []) obstacle([cell.points], 'existing-paving');
    for (const curb of site.curbs || []) if (curb.footprint) obstacle([curb.footprint], 'existing-curb');
    for (const kind of ['trees', 'lamps', 'benches']) for (const item of site[kind] || []) if (item.safetyFootprint || item.footprint) obstacle([item.safetyFootprint || item.footprint], 'existing-fixture');
  }
  const paths = [];
  for (const [sourceRoadIndex, road] of (data.roads || []).entries()) {
    const width = getRoadWidth(road), grade = getRoadGrade(road), highway = getRoadHighway(road);
    const explicitLayerInvalid = road.layer != null && road.layer !== '' && !Number.isFinite(Number(road.layer));
    const eligible = !grade.bridge && !grade.tunnel && !explicitLayerInvalid && (grade.layer == null || grade.layer === 0) && grade.joinable && ['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'service'].includes(highway) && width >= 5 * units;
    let pathAt = 0;
    for (let i = 1; i < (road.points || []).length; i++) {
      const a = road.points[i - 1], b = road.points[i];
      if (!validPoint(a) || !validPoint(b)) continue;
      const length = distance(a, b); if (length < EPS) continue;
      const segment = { a, b, width, bounds: boxOf([a, b]), road, sourceRoadIndex, sourceSegmentIndex: i - 1, pathAt, length };
      pathAt += length;
      if (!boxesNear(padded(segment.bounds, width / 2 + 12 * units), region)) continue;
      // Every road is a physical exclusion, including bridges and footways;
      // structures simply never become candidate sidewalk alignments.
      roadIndex.add(segment, padded(segment.bounds, width / 2 + edgePad + clear));
      if (eligible) paths.push(segment);
    }
  }
  paths.sort((a, b) => {
    const priority = segment => Math.min(...focus.map(model => pointDistance([model.x, model.z], segment.a, segment.b)));
    return priority(a) - priority(b) || a.sourceRoadIndex - b.sourceRoadIndex || a.sourceSegmentIndex - b.sourceSegmentIndex;
  });
  function safe(ring, { overlap = false, fixtures = false } = {}) {
    const bounds = boxOf(ring);
    if (ring.some(p => !within(p) || (data.meta?.width && Math.abs(p[0]) >= data.meta.width / 2) || (data.meta?.depth && Math.abs(p[1]) >= data.meta.depth / 2))) return reject('extent');
    for (const object of obstacleIndex.query(padded(bounds, clear))) {
      if (!boxesNear(bounds, object.bounds, clear)) continue;
      // One containment probe plus all local boundary intersections is a full
      // polygon test. A large river polygon needs only its nearby edges here;
      // its complete ring still supplies the containment/water-hole decision.
      const contained = inside(ring[0], object.rings[0], false) && !object.rings.slice(1).some(hole => inside(ring[0], hole, false));
      if (contained) return reject(object.kind);
      for (const edge of object.boundary) {
        if (!boxesNear(bounds, edge.bounds, clear)) continue;
        if (inside(edge.a, ring, false) || inside(edge.b, ring, false) || edges(ring).some(([a, b]) => segmentDistance(a, b, edge.a, edge.b) <= clear)) return reject(object.kind);
      }
    }
    for (const segment of roadIndex.query(padded(bounds, clear))) {
      const margin = segment.width / 2 + edgePad + clear;
      if (!boxesNear(bounds, segment.bounds, margin)) continue;
      if (inside(segment.a, ring) || inside(segment.b, ring) || edges(ring).some(([a, b]) => segmentDistance(a, b, segment.a, segment.b) < margin - EPS)) return reject('carriageway');
    }
    if (overlap) {
      for (const cell of pavingIndex.query(bounds)) if (boxesNear(bounds, cell.bounds) && overlapsConvex(ring, cell.points)) return reject('new-paving');
      for (const item of fixtureIndex.query(bounds)) if (overlapsConvex(ring, item.footprint)) return reject('new-fixture-footprint');
    }
    if (fixtures) for (const item of fixtureIndex.query(padded(bounds, clear))) if (ringDistance(ring, item.safetyFootprint) <= clear) return reject('new-fixture');
    // Boundary and interior samples include callers' additional water masks.
    // The imported polygon boundaries above prevent tiny source islands of
    // water from hiding between samples; sampled callbacks remain conservative.
    const nx = Math.max(2, Math.ceil((bounds.maxX - bounds.minX) / (1.5 * units))), nz = Math.max(2, Math.ceil((bounds.maxZ - bounds.minZ) / (1.5 * units)));
    for (let ix = 0; ix <= nx; ix++) for (let iz = 0; iz <= nz; iz++) {
      const p = [bounds.minX + (bounds.maxX - bounds.minX) * ix / nx, bounds.minZ + (bounds.maxZ - bounds.minZ) * iz / nz];
      if (inside(p, ring, false) && (inWater(p[0], p[1]) || !Number.isFinite(heightAt(p[0], p[1])))) return reject('sampled-water-or-height');
    }
    if (ring.some(p => inWater(...p) || !Number.isFinite(heightAt(...p)))) return reject('sampled-water-or-height');
    return true;
  }
  const cells = [], curbs = [], trees = [], lamps = [], usedRoads = new Set();
  const cellLength = URBAN_STREET_LIMITS.cellLengthMetres * units, sidewalkWidth = URBAN_STREET_LIMITS.sidewalkWidthMetres * units, curbWidth = .22 * units;
  for (const segment of paths) {
    if (cells.length >= URBAN_STREET_LIMITS.maxCells) break;
    const { a, b, length, width, road, sourceRoadIndex, sourceSegmentIndex } = segment;
    const tangent = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    const count = Math.ceil(length / cellLength), step = length / count;
    for (const side of [-1, 1]) {
      const normal = [-tangent[1] * side, tangent[0] * side], inner = width / 2 + innerGap, outer = inner + sidewalkWidth;
      for (let i = 0; i < count && cells.length < URBAN_STREET_LIMITS.maxCells; i++) {
        const start = i * step, end = (i + 1) * step, midpoint = add(a, tangent, (start + end) / 2, normal, (inner + outer) / 2);
        if (!within(midpoint)) continue;
        const points = rectangle(a, tangent, normal, start, end, inner, outer);
        if (!safe(points, { overlap: true })) continue;
        const cell = { points, bounds: boxOf(points), role: 'sidewalk', sourceRoadIndex, sourceSegmentIndex, side, roadName: road.name || '', roadSourceId: road.osmId || road.id || null,
          sourceEndpoints: [[...a], [...b]], sourceRoadWidth: width, sourceDistanceStart: start, sourceDistanceEnd: end,
          frame: { origin: [...a], tangent: [...tangent], units }, illustrative: true };
        cells.push(cell); pavingIndex.add(cell, cell.bounds); usedRoads.add(sourceRoadIndex);
        stats.urbanStreetLengthMetres += (end - start) / units;
        // Curbs lie wholly INSIDE the accepted strip. No curb closes its end,
        // so independent safe strips do not imply a blocked or linked route.
        for (const [lo, hi] of [[inner, inner + curbWidth], [outer - curbWidth, outer]]) {
          const footprint = rectangle(a, tangent, normal, start, end, lo, hi);
          curbs.push({ footprint, sourceRoadIndex, sourceSegmentIndex, side });
        }
      }
      const fixtures = [{ kind: 'trees', list: trees, spacing: URBAN_STREET_LIMITS.treeStepMetres * units, cap: URBAN_STREET_LIMITS.maxTrees, offset: outer + 2 * units, radius: 2.7 * units, phase: 0 },
        { kind: 'lamps', list: lamps, spacing: URBAN_STREET_LIMITS.lampStepMetres * units, cap: URBAN_STREET_LIMITS.maxLamps, offset: outer + .7 * units, radius: .68 * units, phase: 8 * units }];
      for (const config of fixtures) {
        let at = ((config.phase - segment.pathAt) % config.spacing + config.spacing) % config.spacing;
        for (; at < length && config.list.length < config.cap; at += config.spacing) {
          const nearWalk = add(a, tangent, at, normal, (inner + outer) / 2);
          if (![...pavingIndex.query(boxOf([nearWalk]))].some(cell => cell.sourceRoadIndex === sourceRoadIndex && cell.side === side && inside(nearWalk, cell.points))) continue;
          const center = add(a, tangent, at, normal, config.offset), safetyFootprint = circle(center, config.radius);
          if (!safe(safetyFootprint, { fixtures: true })) continue;
          const footprint = rectangle(center, tangent, normal, -1.45 * units, 1.45 * units, -1.05 * units, 1.05 * units);
          const physicalFootprint = config.kind === 'trees' ? footprint : safetyFootprint;
          if ([...pavingIndex.query(boxOf(physicalFootprint))].some(cell => overlapsConvex(physicalFootprint, cell.points))) { reject('fixture-on-paving'); continue; }
          const item = { x: center[0], z: center[1], y: heightAt(...center) + URBAN_STREET_LIMITS.pavingLift,
            angle: Math.atan2(tangent[1], tangent[0]), footprint: physicalFootprint,
            safetyFootprint, sourceRoadIndex, sourceSegmentIndex, side, illustrative: true };
          config.list.push(item); fixtureIndex.add(item, padded(boxOf(safetyFootprint), clear));
        }
      }
    }
  }
  const allPoints = [...cells.flatMap(cell => cell.points), ...trees.flatMap(item => item.safetyFootprint), ...lamps.flatMap(item => item.safetyFootprint)];
  const bounds = allPoints.length ? boxOf(allPoints) : null;
  Object.assign(stats, { urbanStreetCells: cells.length, urbanStreetCurbs: curbs.length, urbanStreetTrees: trees.length, urbanStreetLamps: lamps.length, urbanStreetRoads: usedRoads.size,
    urbanStreetLengthMetres: Math.round(stats.urbanStreetLengthMetres), urbanStreetBounds: bounds,
    urbanStreetRoadNames: [...new Set(cells.map(cell => cell.roadName).filter(Boolean))], urbanStreetCapped: cells.length >= URBAN_STREET_LIMITS.maxCells || trees.length >= URBAN_STREET_LIMITS.maxTrees || lamps.length >= URBAN_STREET_LIMITS.maxLamps });
  return { cells, curbs, trees, lamps, bounds, units, focusModelIds: focus.map(model => model.id), stats,
    reserveTree(x, z, radius = 0) {
      const p = [x, z], query = padded(boxOf([p]), Math.max(0, radius));
      for (const cell of pavingIndex.query(query)) if (inside(p, cell.points) || edges(cell.points).some(([a, b]) => pointDistance(p, a, b) <= radius)) return true;
      for (const item of fixtureIndex.query(query)) if (inside(p, item.safetyFootprint) || edges(item.safetyFootprint).some(([a, b]) => pointDistance(p, a, b) <= radius)) return true;
      return false;
    },
  };
}

function surfaceGeometry(cells, heightAt, lift) {
  const positions = [], normals = [], uvs = [];
  for (const cell of cells) {
    const ring = cell.points, reverse = signedArea(ring) > 0;
    for (let i = 1; i < ring.length - 1; i++) for (const index of reverse ? [0, i + 1, i] : [0, i, i + 1]) {
      const p = ring[index], h = heightAt(...p) + lift, delta = .002;
      const nx = -(heightAt(p[0] + delta, p[1]) - heightAt(p[0] - delta, p[1])) / (delta * 2), nz = -(heightAt(p[0], p[1] + delta) - heightAt(p[0], p[1] - delta)) / (delta * 2), n = Math.hypot(nx, 1, nz);
      positions.push(p[0], h, p[1]); normals.push(nx / n, 1 / n, nz / n); uvs.push(...streetPavingUv(p, cell.frame));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();
  return geometry;
}
function curbsGeometry(curbs, heightAt, lift, height) {
  const positions = [];
  for (const curb of curbs) {
    const ring = signedArea(curb.footprint) > 0 ? [...curb.footprint].reverse() : curb.footprint;
    const top = ring.map(p => [p[0], heightAt(...p) + lift + height, p[1]]), base = ring.map(p => [p[0], heightAt(...p) + lift, p[1]]);
    for (const index of [0, 1, 2, 0, 2, 3]) positions.push(...top[index]);
    for (let i = 0; i < ring.length; i++) { const j = (i + 1) % ring.length; for (const v of [base[i], top[i], top[j], base[i], top[j], base[j]]) positions.push(...v); }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.computeVertexNormals(); geometry.computeBoundingSphere(); return geometry;
}
function boxGeometry(w, h, d, x = 0, y = h / 2, z = 0) { const geometry = new THREE.BoxGeometry(w, h, d); geometry.translate(x, y, z); return geometry; }
function combine(parts) { const geometry = mergeGeometries(parts); for (const part of parts) part.dispose(); return geometry; }

export function createUrbanStreetGround(plan, { heightAt = () => 0, makeMaterial = (day, _night, options) => new THREE.MeshStandardMaterial({ color: day, ...options }) } = {}) {
  const group = new THREE.Group(), pavingGroup = new THREE.Group(), plantingGroup = new THREE.Group(), fixtureGroup = new THREE.Group();
  group.name = 'Illustrative road-side urban streetscape'; pavingGroup.name = 'retained-road paving and curbs'; plantingGroup.name = 'road-side planting'; fixtureGroup.name = 'road-side lamps'; group.add(pavingGroup, plantingGroup, fixtureGroup);
  const unit = plan.units, texture = createStreetPavingTexture(), ownedMaterials = [];
  const material = (day, night, options = {}) => { const value = makeMaterial(day, night, options); ownedMaterials.push(value); return value; };
  const materials = {
    paving: material('#c9c3b5', '#53666b', { map: texture, roughness: .92 }), curb: material('#ded8c8', '#758686', { roughness: .9 }),
    soil: material('#777361', '#3d4d48', { roughness: 1 }), trunk: material('#7e6950', '#665b4b', { roughness: 1 }),
    crown: material('#81975e', '#536b54', { flatShading: true, roughness: 1 }), metal: material('#414b4c', '#617777', { roughness: .65 }),
    lamp: material('#f3e5c6', '#ffdda4', { roughness: .5 }),
  };
  function mesh(name, geometry, mat, parent) { const value = new THREE.Mesh(geometry, mat); value.name = name; value.receiveShadow = true; value.castShadow = false; parent.add(value); return value; }
  function instanced(name, geometry, mat, items, parent, vary = false) {
    if (!items.length) { geometry.dispose(); return null; }
    const value = new THREE.InstancedMesh(geometry, mat, items.length), dummy = new THREE.Object3D(), color = new THREE.Color();
    for (let i = 0; i < items.length; i++) { const item = items[i]; dummy.position.set(item.x, item.y, item.z); dummy.rotation.set(0, -item.angle, 0); dummy.scale.setScalar(1); dummy.updateMatrix(); value.setMatrixAt(i, dummy.matrix); if (vary) { color.setHSL(.22 + (i % 5) * .008, .19 + (i % 3) * .02, .77 + (i % 4) * .035); value.setColorAt(i, color); } }
    value.name = name; value.instanceMatrix.needsUpdate = true; if (value.instanceColor) value.instanceColor.needsUpdate = true; value.receiveShadow = true; value.castShadow = false; value.computeBoundingSphere(); parent.add(value); return value;
  }
  if (plan.cells.length) mesh('continuous stone paving strips', surfaceGeometry(plan.cells, heightAt, URBAN_STREET_LIMITS.pavingLift), materials.paving, pavingGroup);
  if (plan.curbs.length) mesh('thin roadside curbs', curbsGeometry(plan.curbs, heightAt, URBAN_STREET_LIMITS.pavingLift, URBAN_STREET_LIMITS.curbHeightMetres * unit), materials.curb, pavingGroup);
  // The whole 2.9 × 2.1 m bed and the 4.8 m crown remain inside the
  // planner's circumscribed 2.7 m safety envelope. All repeats are instanced.
  const bedRim = .16 * unit, bedHeight = .1 * unit, bedX = 2.9 * unit, bedZ = 2.1 * unit;
  const rim = combine([boxGeometry(bedX, bedHeight, bedRim, 0, bedHeight / 2, -(bedZ - bedRim) / 2), boxGeometry(bedX, bedHeight, bedRim, 0, bedHeight / 2, (bedZ - bedRim) / 2), boxGeometry(bedRim, bedHeight, bedZ - bedRim * 2, -(bedX - bedRim) / 2), boxGeometry(bedRim, bedHeight, bedZ - bedRim * 2, (bedX - bedRim) / 2)]);
  instanced('row tree bed rims', rim, materials.curb, plan.trees, plantingGroup);
  instanced('row tree bed soil', boxGeometry(bedX - bedRim * 2, .05 * unit, bedZ - bedRim * 2), materials.soil, plan.trees, plantingGroup);
  const trunk = new THREE.CylinderGeometry(.13 * unit, .19 * unit, 3.2 * unit, 6); trunk.translate(0, 1.6 * unit, 0);
  instanced('row tree trunks', trunk, materials.trunk, plan.trees, plantingGroup);
  const crown = new THREE.IcosahedronGeometry(1, 1); crown.scale(2.4 * unit, 2.7 * unit, 2.4 * unit); crown.translate(0, 5.25 * unit, 0);
  instanced('row tree crowns', crown, materials.crown, plan.trees, plantingGroup, true);
  const pole = new THREE.CylinderGeometry(.065 * unit, .09 * unit, 6 * unit, 6); pole.translate(0, 3 * unit, 0);
  instanced('road-side lamp poles', combine([pole, boxGeometry(.48 * unit, .13 * unit, .48 * unit), boxGeometry(.65 * unit, .18 * unit, .85 * unit, 0, 6 * unit, 0)]), materials.metal, plan.lamps, fixtureGroup);
  instanced('road-side warm lamp heads', boxGeometry(.5 * unit, .08 * unit, .65 * unit, 0, 5.89 * unit, 0), materials.lamp, plan.lamps, fixtureGroup);
  const worldBounds = new THREE.Box3().setFromObject(group), geometries = new Set();
  let meshCount = 0, triangles = 0, geometryBytes = 0;
  group.traverse(object => { if (!object.isMesh) return; meshCount++; geometries.add(object.geometry); const geometry = object.geometry;
    triangles += (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3 * (object.isInstancedMesh ? object.count : 1);
    for (const attribute of Object.values(geometry.attributes)) geometryBytes += attribute.array.byteLength;
    if (geometry.index) geometryBytes += geometry.index.array.byteLength;
    for (const attribute of [object.instanceMatrix, object.instanceColor]) if (attribute) geometryBytes += attribute.array.byteLength;
  });
  const resourceStats = { ...plan.stats, urbanStreetMeshes: meshCount, urbanStreetTriangles: triangles, urbanStreetGeometryBytes: geometryBytes, urbanStreetTextureCount: 1, urbanStreetTextureBytes: texture.image.data.byteLength };
  let tier = 0, night = false, treesVisible = false, disposed = false;
  group.visible = false;
  return { group, stats: resourceStats,
    update({ pixelsPerUnit = 0, frustum, enabled = true, treesEnabled = true } = {}) {
      if (disposed) return false;
      const roadPixels = 9.6 * unit * pixelsPerUnit, previousTier = tier;
      tier = roadPixels >= (tier === 2 ? 6.5 : 9) ? 2 : roadPixels >= (tier >= 1 ? 1.5 : 2.2) ? 1 : 0;
      const visible = Boolean(enabled && tier > 0 && !worldBounds.isEmpty() && (!frustum || frustum.intersectsBox(worldBounds)));
      const showTrees = Boolean(treesEnabled && 4.8 * unit * pixelsPerUnit >= (treesVisible ? 2.4 : 3));
      const changed = previousTier !== tier || group.visible !== visible || plantingGroup.visible !== showTrees || fixtureGroup.visible !== (tier === 2);
      group.visible = visible; plantingGroup.visible = showTrees; fixtureGroup.visible = tier === 2; treesVisible = showTrees;
      return changed;
    },
    setTheme(value) { night = Boolean(value); materials.lamp.emissive.set(night ? '#ffd595' : '#000000'); materials.lamp.emissiveIntensity = night ? .8 : 0; },
    getStats() { let visibleDrawCalls = 0; group.traverseVisible(object => { if (object.isMesh) visibleDrawCalls++; }); return { ...resourceStats, urbanStreetVisible: group.visible, urbanStreetVisibleTier: tier, urbanStreetVisibleDrawCalls: visibleDrawCalls, urbanStreetTreesVisible: group.visible && plantingGroup.visible, urbanStreetNight: night, urbanStreetDisposed: disposed }; },
    dispose() { if (disposed) return; disposed = true; group.removeFromParent(); group.visible = false; for (const geometry of geometries) geometry.dispose(); for (const mat of ownedMaterials) mat.dispose(); texture.dispose(); },
  };
}
