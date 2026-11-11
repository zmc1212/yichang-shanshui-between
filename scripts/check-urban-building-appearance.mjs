import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { urbanBuildingFrame, createUrbanBuildingAppearance } from '../src/scene/urbanBuildingAppearance.js';

const checks = [];
const frame = urbanBuildingFrame({ base: 1.25, height: .912, sourceHeight: .24, sourceId: 'source-a' });
assert.equal(frame.storeys, 4);
assert.equal(frame.floorHeight, .228);
assert.equal(urbanBuildingFrame({ base: 1.25, height: .24, sourceHeight: .24, sourceId: 'source-a' }).storeys, frame.storeys,
  'display exaggeration cannot invent more storeys');
assert.equal(urbanBuildingFrame({ base: 1.25, height: .24, sourceHeight: .24, sourceId: 'source-a' }).seed, frame.seed);
assert.notEqual(urbanBuildingFrame({ height: .24, sourceId: 'source-b' }).seed, frame.seed);
assert.equal(urbanBuildingFrame({ height: NaN }), null);
assert.equal(urbanBuildingFrame({ height: -1 }), null);
assert.equal(urbanBuildingFrame({ height: 1, base: Infinity }), null);
checks.push('source-height storey proportions survive display exaggeration; source identity determines stable appearance');

const appearance = createUrbanBuildingAppearance({ unitsPerMeter: .02 });
const outlines = [
  [[0, 0], [1.6, .3], [1.2, 1.5], [-.4, 1.2]],
  [[3, 0], [4.4, 0], [4.4, 1.2], [3.8, 1.2], [3.8, .6], [3, .6]],
];
const geometries = [];
for (let i = 0; i < outlines.length; i++) {
  const shape = new THREE.Shape(outlines[i].map(([x, z]) => new THREE.Vector2(x, -z)));
  const base = i * .7 + .06, height = i ? 1.64 : .912;
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1, curveSegments: 1 });
  geometry.rotateX(-Math.PI / 2); geometry.translate(0, base, 0);
  const positions = [...geometry.attributes.position.array], normals = [...geometry.attributes.normal.array];
  const index = geometry.index?.array && [...geometry.index.array];
  const groups = JSON.stringify(geometry.groups);
  geometry.computeBoundingBox(); const box = geometry.boundingBox.clone();
  assert.equal(appearance.prepareGeometry(geometry, { base, height, sourceHeight: height / 3.8, sourceId: `source-${i}` }), true);
  assert.deepEqual([...geometry.attributes.position.array], positions, 'facade articulation does not move a vertex');
  assert.deepEqual([...geometry.attributes.normal.array], normals, 'source shading normals remain intact');
  assert.deepEqual(geometry.index?.array && [...geometry.index.array], index);
  assert.equal(JSON.stringify(geometry.groups), groups);
  geometry.computeBoundingBox(); assert(geometry.boundingBox.equals(box), 'building world bounds remain identical');
  const attribute = geometry.getAttribute('urbanBuilding');
  assert.equal(attribute.itemSize, 4); assert.equal(attribute.count, geometry.attributes.position.count);
  for (let vertex = 0; vertex < attribute.count; vertex++) {
    assert.equal(attribute.getX(vertex), Math.fround(base));
    assert.equal(attribute.getY(vertex), Math.fround(height));
    assert(attribute.getZ(vertex) > 0 && attribute.getW(vertex) >= 0 && attribute.getW(vertex) < 1);
  }
  geometries.push(geometry);
}
const merged = mergeGeometries(geometries, false);
assert(merged, 'existing city batches remain mergeable');
assert.equal(merged.getAttribute('urbanBuilding').count, geometries.reduce((n, geometry) => n + geometry.attributes.position.count, 0));
checks.push('oblique and concave source extrusions retain every position, normal, bound and group; metadata survives batched merging');

const city = JSON.parse(fs.readFileSync(new URL('../public/data/city.json', import.meta.url), 'utf8'));
const sourceSnapshot = JSON.stringify(city.buildings);
for (const building of city.buildings) {
  const detail = urbanBuildingFrame({ base: 0, height: building.height * 3.8, sourceHeight: building.height, sourceId: building.sourceFeatureId }, city.meta.unitsPerMeter);
  assert(detail && detail.floorHeight > 0 && Number.isFinite(detail.seed));
  assert(detail.storeys >= 1 && detail.storeys <= 80);
}
assert.equal(JSON.stringify(city.buildings), sourceSnapshot);
checks.push('all 16000 current source-building records yield finite detail scales without mutating city data');

const material = new THREE.MeshStandardMaterial({ color: '#edf3ec', toneMapped: false });
const originalColor = material.color.clone();
appearance.applyToMaterial(material); const compile = material.onBeforeCompile;
appearance.applyToMaterial(material);
assert.equal(material.onBeforeCompile, compile, 'reapplication cannot duplicate shader declarations');
assert(material.color.equals(originalColor)); assert.equal(material.toneMapped, true);
const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
material.onBeforeCompile(shader);
for (const chunk of ['lights_physical_fragment', 'lights_fragment_begin', 'shadowmap_pars_fragment', 'tonemapping_fragment', 'colorspace_fragment']) {
  assert(shader.fragmentShader.includes(`#include <${chunk}>`), `standard ${chunk} path remains`);
}
assert(shader.vertexShader.includes('attribute vec4 urbanBuilding;'));
assert(shader.fragmentShader.includes('fwidth(urbanUv)'), 'window filtering is based on actual projected derivatives');
assert(shader.fragmentShader.indexOf('float urbanWindows') < shader.fragmentShader.indexOf('totalEmissiveRadiance += vec3(1.0, .72, .38)'), 'night emission uses a previously declared facade mask');
assert.equal(shader.uniforms.uUrbanUnits.value, .02);
appearance.setEnvironment({ timeOfDay: 'night', weather: 'mist' });
assert.equal(shader.uniforms.uUrbanLampStrength.value, .24);
appearance.setEnvironment({ timeOfDay: 'sunset' }); assert.equal(shader.uniforms.uUrbanLampStrength.value, .055);
appearance.setEnvironment({ timeOfDay: 'day' }); assert.equal(shader.uniforms.uUrbanLampStrength.value, 0);
assert.equal(appearance.getStats().additionalDrawCalls, 0); assert.equal(appearance.getStats().textures, 0);
assert.equal(appearance.getStats().materials, 1);
assert.equal(appearance.getStats().attributeBytes, merged.attributes.position.count * 16);
checks.push('installed standard material keeps its lighting, shadows and output conversion; environment changes reuse shader uniforms without new draws/textures');

for (const geometry of [...geometries, merged]) geometry.dispose();
material.dispose(); appearance.dispose();
assert.equal(appearance.prepareGeometry(new THREE.BufferGeometry(), { height: 1 }), false);
console.log(JSON.stringify({ ok: true, checks, scope: 'Source geometry and installed shader integration, not a substitute for a real WebGL visual check.' }, null, 2));
