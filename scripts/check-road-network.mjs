import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {
  buildRoadStrokeGeometry, buildRoadTopology, createRoadNetwork,
  getRoadClass, getRoadGrade, getRoadWidth, isBridgeRoad,
} from '../src/scene/roadNetwork.js';

let passed = 0;
function check(name, run) { run(); passed++; console.log(`PASS ${name}`); }
function positions(geometry) {
  const attribute = geometry.getAttribute('position');
  return Array.from({ length: attribute.count }, (_, i) => [attribute.getX(i), attribute.getY(i), attribute.getZ(i)]);
}
function distanceToSegment(point, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], lengthSquared = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[2] - a[1]) * dz) / lengthSquared));
  return Math.hypot(point[0] - a[0] - dx * t, point[2] - a[1] - dz * t);
}
const surface = (points, width, options) => buildRoadStrokeGeometry(points, width, options);

check('explicit widths are retained, including values outside old display clamps', () => {
  for (const width of [0.014, 0.192, 0.92]) {
    assert.equal(getRoadWidth({ width, kind: 'primary' }), width);
    const geometry = surface([[0, 0], [8, 0]], width), p = positions(geometry);
    assert(Math.abs(p[0][2] - p[1][2] - width) < 1e-7);
    assert(Math.abs(p[2][2] - p[3][2] - width) < 1e-7);
    geometry.dispose();
  }
});

check('acute bends and hairpins stay inside the half-width swept envelope', () => {
  for (const input of [[[0, 0], [3, 0], [0.1, 0.05]], [[0, 0], [3, 0], [0, 0]], [[0, 0], [3, 0], [3.01, -3]]]) {
    const geometry = surface(input, 0.4);
    for (const point of positions(geometry)) {
      const nearest = Math.min(...input.slice(1).map((next, i) => distanceToSegment(point, input[i], next)));
      assert(nearest <= 0.200001, `Spiked join: ${point}, distance ${nearest}`);
    }
    geometry.dispose();
  }
});

check('duplicate vertices and malformed coordinates cannot create NaN or degenerate triangles', () => {
  const geometry = surface([[0, 0], [0, 0], null, [NaN, 0], [3, 0], [3, 0], [3, 2]], 0.2);
  assert(positions(geometry).flat().every(Number.isFinite));
  const p = positions(geometry), indices = geometry.index.array;
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [p[indices[i]], p[indices[i + 1]], p[indices[i + 2]]];
    const area = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
    assert(area < 0, 'Every triangle must be nondegenerate and upward facing');
  }
  assert.equal(surface([[0, 0], [0, 0]], 0.2), null);
  geometry.dispose();
});

check('both edges follow terrain, and water surfaces retain their existing clearance', () => {
  const geometry = surface([[0, 0], [4, 0]], 0.4, { heightAt: (x, z) => 1 + x * 0.04 + z * 0.3 });
  const p = positions(geometry);
  assert(Math.abs((p[0][1] - p[1][1]) - 0.12) < 1e-7);
  const water = surface([[0, 0], [4, 0]], 0.4, { inWater: () => true });
  assert(positions(water).every(point => Math.abs(point[1] - 0.29) < 1e-6));
  geometry.dispose(); water.dispose();
});

check('recovered highway applies across bridges and links; unknown bridges remain explicit', () => {
  assert.equal(getRoadClass({ kind: 'bridge', highway: 'primary_link' }), 'major');
  assert.equal(getRoadClass({ kind: 'bridge', highway: 'tertiary' }), 'secondary');
  assert.equal(getRoadClass({ highway: 'footway' }), 'pedestrian');
  assert.equal(isBridgeRoad({ kind: 'primary', bridge: 'viaduct' }), true);
  assert.equal(getRoadGrade({ bridge: 'yes' }).joinable, false);
  assert.equal(getRoadGrade({ tunnel: 'building_passage' }).joinable, false);
  assert.equal(getRoadGrade({ bridge: 'viaduct', layer: '1' }).key, 'bridge:1');
});

check('shared same-level T junctions join; different levels and unshared X crossings do not', () => {
  const main = { points: [[-2, 0], [0, 0], [2, 0]], width: 0.3, highway: 'primary', layer: '0' };
  const branch = { points: [[0, 0], [0, 2]], width: 0.15, highway: 'residential', layer: '0' };
  assert.equal(buildRoadTopology([main, branch]).junctions.length, 1);
  assert.equal(buildRoadTopology([main, { ...branch, layer: '1', bridge: 'yes' }]).junctions.length, 0);
  assert.equal(buildRoadTopology([main, { ...branch, layer: undefined, bridge: 'yes' }]).junctions.length, 0);
  assert.equal(buildRoadTopology([{ ...main, points: [[-2, 0], [2, 0]] }, { ...branch, points: [[0, -2], [0, 2]] }]).junctions.length, 0);
});

check('known grade junction radius never exceeds the widest source half-width', () => {
  const roads = [
    { points: [[-2, 0], [0, 0], [2, 0]], width: 0.3, highway: 'primary' },
    { points: [[0, 0], [0, 2]], width: 0.15, highway: 'residential' },
  ];
  const junction = buildRoadTopology(roads).junctions[0];
  assert.equal(junction.radius, 0.15);
  assert.equal(junction.role, 'major');
});

check('full source network is static, bounded in draw calls, and leaves inputs untouched', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../public/data/city.json', import.meta.url), 'utf8'));
  const before = JSON.stringify(data.roads);
  const { group, stats } = createRoadNetwork({ roads: data.roads, makeMaterial: colour => new THREE.MeshStandardMaterial({ color: colour }) });
  assert.equal(JSON.stringify(data.roads), before);
  assert.equal(stats.renderedRoads, data.roads.length);
  assert(stats.meshes <= 6);
  assert(stats.triangles < 150000, `Unexpected road triangle count: ${stats.triangles}`);
  for (const mesh of group.children) {
    assert(positions(mesh.geometry).flat().every(Number.isFinite));
    mesh.geometry.dispose(); mesh.material.dispose();
  }
  console.log(JSON.stringify(stats));
});

console.log(`Road network: ${passed} meaningful checks passed.`);
