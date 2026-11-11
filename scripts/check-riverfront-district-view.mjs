import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { AUTHORED_MODELS } from '../src/scene/buildingCatalog.js';
import { resolveAuthoredPlacement, authoredWorldBounds } from '../src/scene/authoredPlacement.js';
import { planRiverfrontDistrictView, RIVERFRONT_DISTRICT_IDS } from '../src/scene/riverfrontDistrictView.js';

const data = JSON.parse(fs.readFileSync(new URL('../public/data/city.json', import.meta.url), 'utf8'));
const models = AUTHORED_MODELS.map(spec => resolveAuthoredPlacement(spec, data.meta)).filter(Boolean);
const selected = models.filter(model => RIVERFRONT_DISTRICT_IDS.includes(model.id));
const inputSnapshot = JSON.stringify({ selected, roads: data.roads, water: data.water });
const extent = Math.max(data.meta.width, data.meta.depth), baseHalfHeight = extent * .53;
const common = { models, roads: data.roads, water: data.water, baseHalfHeight, cameraDistance: extent * 1.6, unitsPerMeter: data.meta.unitsPerMeter };
const boxCorners = box => {
  const points = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) points.push(new THREE.Vector3(x, y, z));
  return points;
};

// Independent real-camera projection verifies both complete world boxes,
// including roof/base corners, in landscape, portrait and top views.
let cameraCases = 0;
for (const heightAt of [() => 0, (x, z) => 2 + .15 * x - .06 * z]) for (const view of ['perspective', 'top']) for (const aspect of [.45, .6, 1, 16 / 9, 2.4, 3.2]) {
  const frame = planRiverfrontDistrictView({ ...common, aspect, view, heightAt });
  assert.deepEqual(frame.ids, RIVERFRONT_DISTRICT_IDS);
  assert.ok(Number.isFinite(frame.zoom) && frame.zoom > 0);
  assert.ok(!frame.bounds.isEmpty());
  const camera = new THREE.OrthographicCamera(-baseHalfHeight * aspect, baseHalfHeight * aspect, baseHalfHeight, -baseHalfHeight, .1, extent * 16);
  camera.position.copy(frame.position); camera.lookAt(frame.target); camera.zoom = frame.zoom;
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  const mustFit = selected.flatMap(model => boxCorners(authoredWorldBounds(model, heightAt(model.x, model.z) + .065)));
  mustFit.push(...frame.framePoints.map(point => new THREE.Vector3(...point)));
  for (const world of mustFit) {
    assert.ok(frame.bounds.containsPoint(world), 'Framing bounds omit a model/context point');
    const screen = world.clone().project(camera);
    assert.ok(Math.abs(screen.x) <= .8400001 && Math.abs(screen.y) <= .8400001, `Clipped ${view} aspect ${aspect}: ${screen.toArray()}`);
    assert.ok(screen.z > -1 && screen.z < 1, 'Near/far plane clips a framed point');
  }
  cameraCases++;
}

const frame = planRiverfrontDistrictView({ ...common, aspect: 16 / 9 });
assert.ok(frame.roadSegments.length >= 2, 'Both directions of the local road should be framed');
assert.ok(frame.roadSegments.some(segment => segment.osmId === 'way/1543968654'));
for (const segment of frame.roadSegments) {
  const road = data.roads[segment.sourceRoadIndex], a = road.points[segment.sourceSegmentIndex], b = road.points[segment.sourceSegmentIndex + 1];
  assert.ok(segment.from >= 0 && segment.to <= 1 && segment.to > segment.from);
  for (const [index, t] of [segment.from, segment.to].entries()) for (const axis of [0, 1]) assert.ok(Math.abs(segment.endpoints[index][axis] - (a[axis] + (b[axis] - a[axis]) * t)) < 1e-10, 'Road extent left its source segment');
}

// Ray casting here checks source polygons independently of the module's
// shoreline sampling; all interior holes must remain land.
function containsRing([x, z], ring) {
  let crossings = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    if ((az > z) !== (bz > z) && x < ax + (z - az) / (bz - az) * (bx - ax)) crossings++;
  }
  return crossings % 2 === 1;
}
assert.equal(frame.waterSamples.length, 3);
for (const sample of frame.waterSamples) {
  const polygon = data.water[sample.sourceWaterIndex], rings = polygon.rings || [polygon.ring];
  assert.equal(polygon.name, '长江');
  assert.ok(containsRing(sample.water, rings[0]) && !rings.slice(1).some(ring => containsRing(sample.water, ring)), 'River extent enters land or a hole');
  assert.ok(sample.depthMeters > 0 && sample.depthMeters <= 70.000001);
  assert.ok(Math.abs(Math.hypot(sample.water[0] - sample.shore[0], sample.water[1] - sample.shore[1]) / data.meta.unitsPerMeter - sample.depthMeters) < 1e-9);
}

assert.ok(frame.visibleHeight / data.meta.unitsPerMeter < 650, 'Default district is too distant');
assert.ok(frame.visibleWidth / data.meta.unitsPerMeter < 1200, 'Default district includes too much city');
assert.ok(frame.bounds.getSize(new THREE.Vector3()).length() < extent / 10, 'District framing regressed to the full map');
assert.equal(planRiverfrontDistrictView({ ...common, models: selected.slice(0, 1), aspect: 1 }), null, 'A missing required landmark should use the caller fallback');
assert.throws(() => planRiverfrontDistrictView({ ...common, aspect: 0 }), /positive/);
const noContext = planRiverfrontDistrictView({ ...common, aspect: 1, roads: [], water: [] });
assert.equal(noContext.roadSegments.length, 0); assert.equal(noContext.waterSamples.length, 0);
assert.equal(JSON.stringify({ selected, roads: data.roads, water: data.water }), inputSnapshot, 'Source geometry or registration mutated');
console.log(JSON.stringify({ passed: true, cameraCases, sourceRoadSegments: frame.roadSegments.length, waterSamples: frame.waterSamples.length,
  defaultVisibleMetres: { width: Math.round(frame.visibleWidth / data.meta.unitsPerMeter), height: Math.round(frame.visibleHeight / data.meta.unitsPerMeter) },
  defaultZoom: Number(frame.zoom.toFixed(3)), fullModels: frame.ids }));
