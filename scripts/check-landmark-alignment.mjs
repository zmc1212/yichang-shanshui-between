/** Regression checks for the observed map/model registration failures.
 * Run: node scripts/check-landmark-alignment.mjs
 * Uses the real scene placement and model factory, without a WebGL context.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { createLandmark } from '../src/scene/landmarks.js';
import { resolveLandmarkSpec } from '../src/scene/landmarkPlacement.js';
import { planWaterfront } from '../src/scene/waterfront.js';

const data = JSON.parse(fs.readFileSync(new URL('../public/data/city.json', import.meta.url), 'utf8'));
const close = (a, b, message, epsilon = 1e-6) => assert.ok(Math.abs(a - b) <= epsilon, `${message}: ${a} vs ${b}`);
const samePoint = (a, b, message) => a.forEach((v, i) => close(v, b[i], message));
const bearing = v => (Math.atan2(v.x, -v.z) * 180 / Math.PI + 360) % 360;
function inRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
const water = data.water.map(p => ({ ...p, minX: Math.min(...p.rings[0].map(v => v[0])), maxX: Math.max(...p.rings[0].map(v => v[0])), minZ: Math.min(...p.rings[0].map(v => v[1])), maxZ: Math.max(...p.rings[0].map(v => v[1])) }));
const inWater = (x, z) => water.some(p => x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ && inRing(x, z, p.rings[0]) && !p.rings.slice(1).some(r => inRing(x, z, r)));
const specs = data.landmarks.map(spec => resolveLandmarkSpec(spec, { roads: data.roads, inWater }));
const models = new Map(), modelBounds = new Map(), report = [];
for (const spec of specs) {
  const group = createLandmark(spec);
  samePoint(group.position.toArray(), [0, 0, 0], `${spec.id}: factory must not translate a geographic anchor`);
  const localBounds = new THREE.Box3().setFromObject(group);
  modelBounds.set(spec.id, { minX: localBounds.min.x, maxX: localBounds.max.x, minZ: localBounds.min.z, maxZ: localBounds.max.z });
  group.position.set(spec.x, 0, spec.z); group.updateMatrixWorld(true);
  models.set(spec.id, group);
  if (spec.frontHeadingDeg !== undefined) {
    close(bearing(new THREE.Vector3(0, 0, 1).transformDirection(group.matrixWorld)), spec.frontHeadingDeg, `${spec.id}: entrance bearing`, 1e-5);
  }
  if (spec.endpoints) {
    const length = group.userData.span.length;
    close(group.scale.x, 1, `${spec.id}: registered span must not be scaled twice`);
    const actualA = group.localToWorld(new THREE.Vector3(-length / 2, 0, 0));
    const actualB = group.localToWorld(new THREE.Vector3(length / 2, 0, 0));
    samePoint([actualA.x, actualA.z], spec.endpoints[0], `${spec.id}: first endpoint`);
    samePoint([actualB.x, actualB.z], spec.endpoints[1], `${spec.id}: second endpoint`);
  }
  report.push({ id: spec.id, anchor: [spec.x, spec.z], axisHeadingDeg: group.userData.axisHeadingDeg, scale: group.scale.x });
}

const dam = specs.find(s => s.id === 'gezhouba-dam');
assert.equal(dam.spanSource, 'mapped-western-main-channel-dam-crest');
close(models.get(dam.id).userData.span.length, 12.29769, 'dam mapped segment length', 0.001);
const conflicting = createLandmark({ ...dam, axisHeadingDeg: 0, modelScale: 2 });
close(conflicting.rotation.y, models.get(dam.id).rotation.y, 'endpoints must override a conflicting heading');
close(conflicting.scale.x, 1, 'endpoints must override an accidental display scale');

const waterfront = planWaterfront({ data, landmarks: specs, modelBounds, inWater, heightAt: () => 0 });
let landSamples = 0;
for (const id of ['zhenjiang-pavilion', 'tianran-pagoda']) {
  const source = data.landmarks.find(s => s.id === id), site = waterfront.getSite(id), model = models.get(id);
  assert.ok(site, `${id}: waterfront site exists`);
  samePoint(site.center, [source.x, source.z], `${id}: original point must not drift inland`);
  close(site.shift, 0, `${id}: no display translation`);
  const b = modelBounds.get(id), clearance = 0.06;
  const nx = Math.ceil((b.maxX - b.minX + 2 * clearance) / 0.04), nz = Math.ceil((b.maxZ - b.minZ + 2 * clearance) / 0.04);
  for (let ix = 0; ix <= nx; ix++) for (let iz = 0; iz <= nz; iz++) {
    const x = source.x + b.minX - clearance + (b.maxX - b.minX + 2 * clearance) * ix / nx;
    const z = source.z + b.minZ - clearance + (b.maxZ - b.minZ + 2 * clearance) * iz / nz;
    assert.ok(!inWater(x, z), `${id}: oriented footprint crosses mapped water at ${x},${z}`); landSamples++;
  }
  const front = new THREE.Vector3(0, 0, 1).transformDirection(model.matrixWorld);
  const landwardDot = front.x * site.shore.normal[0] + front.z * site.shore.normal[1];
  assert.ok(id === 'zhenjiang-pavilion' ? landwardDot > 0.98 : landwardDot < -0.98, `${id}: documented front/back relationship`);
}

const zhixi = specs.find(s => s.id === 'zhixi-bridge'), bridge = models.get(zhixi.id);
assert.ok(zhixi.mainSpanEndpoints && zhixi.mainSpanEndpoints[0][0] < zhixi.mainSpanEndpoints[1][0], 'Zhixi main span uses stable west-to-east order');
const towers = bridge.userData.bridgeStructure.towerBaseCenters.map(p => bridge.localToWorld(new THREE.Vector3(...p)));
assert.equal(towers.length, 2);
towers.forEach((p, i) => {
  samePoint([p.x, p.z], zhixi.mainSpanEndpoints[i], 'Zhixi tower must use the main-span endpoint');
  assert.ok(!inWater(p.x, p.z), 'Zhixi tower must stand on the mapped bank');
});
const reversedRoads = data.roads.map(r => r.name === zhixi.name ? { ...r, points: [...r.points].reverse() } : r);
const reversed = resolveLandmarkSpec(data.landmarks.find(s => s.id === zhixi.id), { roads: reversedRoads, inWater });
reversed.endpoints.forEach((p, i) => samePoint(p, zhixi.endpoints[i], 'Road storage direction must not flip or move Zhixi'));

console.log(JSON.stringify({ status: 'passed', landmarks: report, waterfrontShift: 0, landFootprintSamples: landSamples, zhixiTowers: towers.map(p => [p.x, p.z]), checks: ['single yaw and scale', 'dam endpoints and midpoint', 'fixed historic-building anchors', 'opposite documented entrance directions', 'rotated footprints remain on source land', 'Zhixi towers on banks', 'road-point reversal invariant'] }, null, 2));
const geometries = new Set(), materials = new Set(), textures = new Set();
for (const model of [...models.values(), conflicting]) model.traverse(o => {
  if (o.geometry) geometries.add(o.geometry);
  for (const material of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) {
    materials.add(material); for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
  }
});
textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose()); geometries.forEach(g => g.dispose());
