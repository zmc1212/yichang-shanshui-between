import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { AUTHORED_MODELS } from '../src/scene/authoredModels.js';
import { resolveAuthoredPlacement, planAuthoredGround } from '../src/scene/authoredPlacement.js';
import { planStreetDetails } from '../src/scene/streetDetails.js';
import { getRoadWidth } from '../src/scene/roadNetwork.js';
import { URBAN_STREET_LIMITS, planUrbanStreetGround, createUrbanStreetGround } from '../src/scene/urbanStreetGround.js';

// Data/geometry/resource checks, not a GPU screenshot or a device frame-rate
// claim. This verifies the current retained models without the old guarded
// International ramp, inlay or foreground-source whitelist.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pairs = ring => ring.map((p, i) => [p, ring[(i + 1) % ring.length]]);
const orient = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
const box = ring => ({ x0: Math.min(...ring.map(p => p[0])), x1: Math.max(...ring.map(p => p[0])), z0: Math.min(...ring.map(p => p[1])), z1: Math.max(...ring.map(p => p[1])) });
const near = (a, b, pad = 0) => a.x0 <= b.x1 + pad && b.x0 <= a.x1 + pad && a.z0 <= b.z1 + pad && b.z0 <= a.z1 + pad;
function pointDistance(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], d = dx * dx + dz * dz;
  const t = d ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / d)) : 0;
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
}
function winding(p, ring) {
  let count = 0;
  for (const [a, b] of pairs(ring)) {
    const sign = orient(a, b, p);
    if (a[1] <= p[1] && b[1] > p[1] && sign > 0) count++;
    if (a[1] > p[1] && b[1] <= p[1] && sign < 0) count--;
  }
  return count !== 0;
}
function edgeDistance(a, b, c, d) {
  if (orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0) return 0;
  return Math.min(pointDistance(a, c, d), pointDistance(b, c, d), pointDistance(c, a, b), pointDistance(d, a, b));
}
function intersectionArea(subject, clip) {
  const sign = Math.sign(pairs(clip).reduce((sum, [a, b]) => sum + a[0] * b[1] - b[0] * a[1], 0));
  let output = subject.map(p => [...p]);
  for (const [a, b] of pairs(clip)) {
    const input = output; output = [];
    for (let i = 0; i < input.length; i++) {
      const p = input[i], q = input[(i + 1) % input.length], dp = sign * orient(a, b, p), dq = sign * orient(a, b, q), pi = dp >= -1e-12, qi = dq >= -1e-12;
      if (pi) output.push(p);
      if (pi !== qi) { const t = dp / (dp - dq); output.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
  }
  return Math.abs(pairs(output).reduce((sum, [a, b]) => sum + a[0] * b[1] - b[0] * a[1], 0)) / 2;
}
const square = (x, z, r) => [[x - r, z - r], [x + r, z - r], [x + r, z + r], [x - r, z + r]];
function normalized(polygon) { return polygon.rings || [polygon.ring]; }
function assertPlanClear(plan, { data, models, existingStreetPlan }) {
  const rings = [...plan.cells.map(cell => ({ points: cell.points, kind: 'paving' })), ...plan.curbs.map(curb => ({ points: curb.footprint, kind: 'curb' })), ...plan.trees.map(item => ({ points: item.safetyFootprint, kind: 'tree envelope' })), ...plan.lamps.map(item => ({ points: item.safetyFootprint, kind: 'lamp envelope' }))];
  const overall = box(rings.flatMap(item => item.points));
  const polygons = [...(data.buildings || []).map(b => ({ rings: normalized(b), kind: 'source building' })), ...models.map(m => ({ rings: [m.footprint], kind: `model ${m.id}` })), ...(data.water || []).map(w => ({ rings: normalized(w), kind: 'water' }))];
  for (const site of [...(existingStreetPlan?.sites || []), ...(existingStreetPlan?.links || []), ...(existingStreetPlan?.extensions || [])]) {
    for (const cell of site.paving) polygons.push({ rings: [cell.points], kind: 'retained paving' });
    for (const curb of site.curbs) polygons.push({ rings: [curb.footprint], kind: 'retained curb' });
    for (const kind of ['trees', 'lamps', 'benches']) for (const item of site[kind]) polygons.push({ rings: [item.safetyFootprint || item.footprint], kind: 'retained fixture' });
  }
  const localPolygons = polygons.map(polygon => ({ ...polygon, box: box(polygon.rings[0]) })).filter(polygon => near(overall, polygon.box, .01)).map(polygon => ({ ...polygon, boundary: polygon.rings.flatMap(pairs).map(([a, b]) => ({ a, b, box: box([a, b]) })) }));
  const segments = data.roads.flatMap((road, roadIndex) => road.points.slice(1).map((b, i) => ({ a: road.points[i], b, width: getRoadWidth(road), box: box([road.points[i], b]), roadIndex }))).filter(segment => near(overall, segment.box, segment.width));
  for (const candidate of rings) {
    const candidateBox = box(candidate.points);
    assert(candidate.points.every(p => p.every(Number.isFinite)), `${candidate.kind}: finite coordinates`);
    for (const polygon of localPolygons) {
      if (!near(candidateBox, polygon.box, .003999)) continue;
      for (const p of candidate.points) assert(!(winding(p, polygon.rings[0]) && !polygon.rings.slice(1).some(hole => winding(p, hole))), `${candidate.kind}: outside ${polygon.kind}`);
      for (const edge of polygon.boundary) {
        if (!near(candidateBox, edge.box, .003999)) continue;
        assert(!winding(edge.a, candidate.points), `${candidate.kind}: must not enclose ${polygon.kind}`);
        for (const [a, b] of pairs(candidate.points)) assert(edgeDistance(a, b, edge.a, edge.b) >= .003999, `${candidate.kind}: full boundary clearance from ${polygon.kind}`);
      }
    }
    for (const segment of segments) {
      const required = segment.width / 2 + .03;
      if (!near(candidateBox, segment.box, required)) continue;
      assert(!winding(segment.a, candidate.points) && !winding(segment.b, candidate.points), `${candidate.kind}: never enclose a carriageway end`);
      for (const [a, b] of pairs(candidate.points)) assert(edgeDistance(a, b, segment.a, segment.b) >= required - 1e-8, `${candidate.kind}: carriageway and rendered road edge remain clear`);
    }
  }
  for (let i = 0; i < plan.cells.length; i++) for (let j = i + 1; j < plan.cells.length; j++) {
    if (near(box(plan.cells[i].points), box(plan.cells[j].points))) assert(intersectionArea(plan.cells[i].points, plan.cells[j].points) < 1e-9, 'no stacked paving at bends or intersections');
  }
  for (const item of [...plan.trees, ...plan.lamps]) for (const cell of plan.cells) {
    if (near(box(item.footprint), box(cell.points))) assert(intersectionArea(item.footprint, cell.points) < 1e-9, 'fixture base never obstructs a new paving strip');
  }
}

const synthetic = {
  meta: { width: 30, depth: 30, unitsPerMeter: .02 },
  roads: [
    { name: 'retained avenue', highway: 'primary', points: [[-3, 0], [3, 0]], width: .2 },
    { name: 'retained crossing', highway: 'secondary', points: [[0, -2], [0, 2]], width: .18 },
    { name: 'unknown bridge', highway: 'primary', bridge: 'yes', points: [[-3, 1], [3, 1]], width: .2 },
    { name: 'known bridge', highway: 'primary', bridge: 'yes', layer: 1, points: [[-3, 2], [3, 2]], width: .2 },
    { name: 'tunnel', highway: 'secondary', tunnel: 'yes', layer: -1, points: [[-3, -1], [3, -1]], width: .2 },
    { name: 'invalid layer', highway: 'primary', layer: 'unknown', points: [[-3, -2], [3, -2]], width: .2 },
    { name: 'nonzero surface', highway: 'primary', layer: 2, points: [[-3, -3], [3, -3]], width: .2 },
  ],
  buildings: [{ ring: [[-1.2, .13], [-.85, .13], [-.85, .3], [-1.2, .3]] }],
  water: [{ rings: [[[.8, .125], [1.25, .125], [1.25, .4], [.8, .4]]] }],
};
const syntheticModels = [{ id: 'wanda-soho-s01', x: 0, z: .7, footprint: square(0, .7, .1) }];
const syntheticSnapshot = hash({ data: synthetic, models: syntheticModels });
const sampleMask = (x, z) => x > 1.6 && x < 2.1 && z < -.14 && z > -.23;
const syntheticPlan = planUrbanStreetGround({ data: synthetic, models: syntheticModels, inWater: sampleMask });
assert(syntheticPlan.cells.length > 15, 'synthetic test produces meaningful positive coverage');
assert(syntheticPlan.cells.every(cell => cell.sourceRoadIndex <= 1), 'bridge, tunnel, invalid layer and nonzero layer roads never generate paving');
assert.equal(hash({ data: synthetic, models: syntheticModels }), syntheticSnapshot, 'synthetic source inputs immutable');
assertPlanClear(syntheticPlan, { data: synthetic, models: syntheticModels });
assert(syntheticPlan.stats.urbanStreetRejected['sampled-water-or-height'] > 0, 'additional inWater mask rejects interior samples');
assert.equal(planUrbanStreetGround({ data: synthetic, models: [] }).cells.length, 0, 'missing focus models do not produce an unrelated neighbourhood');

const data = JSON.parse(fs.readFileSync(path.join(root, 'public/data/city.json'), 'utf8'));
const models = AUTHORED_MODELS.map(spec => resolveAuthoredPlacement(spec, data.meta)).filter(Boolean);
const authoredGround = planAuthoredGround(models, data, 3.8);
const water = data.water.map(w => ({ rings: normalized(w), box: box(normalized(w)[0]) }));
const inWater = (x, z) => water.some(p => x >= p.box.x0 && x <= p.box.x1 && z >= p.box.z0 && z <= p.box.z1 && winding([x, z], p.rings[0]) && !p.rings.slice(1).some(hole => winding([x, z], hole)));
const heightAt = (x, z) => .001 * Math.sin(x * .04) * Math.cos(z * .08);
const existingStreetPlan = planStreetDetails({ data, authoredModels: models, authoredGround, waterfrontPlan: { omittedBuildingIndices: new Set() }, heightAt, inWater });
const snapshot = hash({ data, models, existingStreetPlan });
const before = performance.now();
const plan = planUrbanStreetGround({ data, models, heightAt, inWater, existingStreetPlan, unitsPerMeter: data.meta.unitsPerMeter });
const planMilliseconds = performance.now() - before;
assert(plan.cells.length > 300 && plan.cells.length <= URBAN_STREET_LIMITS.maxCells, 'bounded neighbourhood coverage');
assert(plan.trees.length > 30 && plan.trees.length <= URBAN_STREET_LIMITS.maxTrees, 'bounded planted rows');
assert(plan.lamps.length > 20 && plan.lamps.length <= URBAN_STREET_LIMITS.maxLamps, 'bounded lamp rows');
assert.equal(hash({ data, models, existingStreetPlan }), snapshot, 'source roads, model registrations and complete retained street plans unchanged');
assert.deepEqual(plan.focusModelIds, ['wanda-soho-s01', 'yichang-international-s01'], 'focus follows the actual retained models');
assert.equal(plan.stats.urbanStreetConnections, 0, 'decorative coverage does not claim access or building connections');
assertPlanClear(plan, { data, models, existingStreetPlan });
for (const cell of plan.cells) {
  const source = data.roads[cell.sourceRoadIndex];
  assert.deepEqual(cell.sourceEndpoints, source.points.slice(cell.sourceSegmentIndex, cell.sourceSegmentIndex + 2), 'unchanged retained source segment');
  assert.equal(cell.sourceRoadWidth, source.width, 'explicit road width unchanged');
  for (const point of cell.points) assert(models.filter(model => plan.focusModelIds.includes(model.id)).some(model => Math.hypot(point[0] - model.x, point[1] - model.z) <= URBAN_STREET_LIMITS.focusRadiusMetres * plan.units + 1e-9), 'bounded radius around retained model positions');
  const centroid = cell.points.reduce((p, q) => [p[0] + q[0] / 4, p[1] + q[1] / 4], [0, 0]);
  assert(plan.reserveTree(...centroid), 'background scatter respects new paving');
}

const beforeGeometry = performance.now(), controller = createUrbanStreetGround(plan, { heightAt });
const geometryMilliseconds = performance.now() - beforeGeometry;
const resourceStats = controller.getStats();
assert(resourceStats.urbanStreetMeshes <= 8, 'fixed maximum of eight batched draw calls');
assert(resourceStats.urbanStreetGeometryBytes < 3_000_000, 'geometry stays under the bounded resource budget');
assert(resourceStats.urbanStreetTriangles < 70_000, 'rendered triangle budget includes every instance');
controller.group.traverse(object => {
  if (!object.isMesh) return;
  assert.equal(object.castShadow, /tree trunks|tree crowns/.test(object.name), 'only tree instances cast shadows; their LOD changes invalidate the cached sun map in the scene');
  for (const attribute of Object.values(object.geometry.attributes)) assert([...attribute.array].every(Number.isFinite), `${object.name}: finite GPU attributes`);
  if (object.instanceMatrix) assert([...object.instanceMatrix.array].every(Number.isFinite), `${object.name}: finite transforms`);
});
controller.update({ pixelsPerUnit: 100 });
assert.equal(controller.getStats().urbanStreetVisibleDrawCalls, 8);
assert.equal(controller.getStats().urbanStreetTreesVisible, true);
controller.update({ pixelsPerUnit: 100, treesEnabled: false });
assert.equal(controller.getStats().urbanStreetVisibleDrawCalls, 4, 'tree toggle hides beds, soil, trunks and crowns');
assert.equal(controller.getStats().urbanStreetTreesVisible, false);
controller.update({ pixelsPerUnit: 100, enabled: false });
assert.equal(controller.getStats().urbanStreetVisibleDrawCalls, 0, 'street details toggle hides all new draws');
controller.update({ pixelsPerUnit: .2 });
assert.equal(controller.getStats().urbanStreetVisibleDrawCalls, 0, 'overview suppresses subpixel scenery');
controller.update({ pixelsPerUnit: 100, frustum: { intersectsBox: () => false } });
assert.equal(controller.getStats().urbanStreetVisibleDrawCalls, 0, 'offscreen district is culled');
controller.update({ pixelsPerUnit: 100 });
assert.equal(controller.update({ pixelsPerUnit: 100 }), false, 'static camera adds no perpetual invalidation');
controller.setTheme(true); assert.equal(controller.getStats().urbanStreetNight, true);
let disposedGeometry = 0, disposedMaterial = 0, disposedTexture = 0;
const materialSet = new Set();
controller.group.traverse(object => { if (!object.isMesh) return; object.geometry.addEventListener('dispose', () => disposedGeometry++); materialSet.add(object.material); });
for (const material of materialSet) { material.addEventListener('dispose', () => disposedMaterial++); if (material.map) material.map.addEventListener('dispose', () => disposedTexture++); }
const host = new THREE.Group(); host.add(controller.group); controller.dispose(); controller.dispose();
assert.equal(host.children.length, 0, 'dispose removes the group before generic scene teardown');
assert.equal(disposedGeometry, resourceStats.urbanStreetMeshes, 'each batched geometry disposed once');
assert.equal(disposedMaterial, materialSet.size, 'each used material disposed once');
assert.equal(disposedTexture, 1, 'shared paving atlas disposed once');
assert.equal(controller.getStats().urbanStreetVisibleDrawCalls, 0);
console.log(JSON.stringify({ pass: true, checks: ['source and registration immutability', 'unknown/raised structure exclusion', 'whole-polygon building/water/model/road clearance', 'existing street geometry preservation', 'no overlapping new paving or fixture bases', 'bounded resources and static LOD', 'tree/street toggles, frustum and disposal'], planMilliseconds: Math.round(planMilliseconds), geometryMilliseconds: Math.round(geometryMilliseconds), stats: resourceStats }, null, 2));
