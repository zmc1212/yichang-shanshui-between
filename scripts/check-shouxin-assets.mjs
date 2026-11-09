import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// GPU-independent asset gate: parse the real GLBs using the production loader,
// check flat shading, complete detail topology, equal anchors and LOD identity.
// It does not assert WebGL, appearance, frame rate or physical-phone testing.
const report = JSON.parse(fs.readFileSync('docs/models/shouxin-asset-report.json', 'utf8'));
const loader = new GLTFLoader();
function decode(buffer) {
  const jsonLength = buffer.readUInt32LE(12);
  return JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
}
function inspect(group) {
  group.updateMatrixWorld(true);
  const box = new Box3().setFromObject(group), primitives = [];
  let triangles = 0, vertices = 0;
  group.traverse(object => {
    if (!object.isMesh) return;
    assert.equal(object.geometry.hasAttribute('normal'), false, `${object.name}: smoothing normals must not be introduced`);
    assert.equal(object.material.flatShading, true, `${object.name}: glTF material must shade flat`);
    assert.equal(object.material.transparent, false, `${object.name}: facade remains opaque`);
    const count = object.geometry.index?.count || object.geometry.getAttribute('position').count;
    triangles += count / 3;
    vertices += object.geometry.getAttribute('position').count;
    primitives.push(object);
  });
  return { box, triangles, vertices, primitives };
}
function close(actual, expected, description) {
  actual.forEach((value, i) => assert(Math.abs(value - expected[i]) < 0.00002, `${description}[${i}] ${value} != ${expected[i]}`));
}
const outputs = {};
for (const tier of ['light', 'detail']) {
  const bytes = fs.readFileSync(`public/models/shouxin-s01/${tier}.glb`), expected = report.tiers[tier];
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expected.sha256);
  const gltf = decode(bytes);
  assert.equal(gltf.buffers.length, 1); assert.equal(gltf.buffers[0].uri, undefined);
  assert.equal(gltf.images, undefined); assert.equal(gltf.textures, undefined); assert.equal(gltf.extensionsRequired, undefined);
  const asset = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const result = inspect(asset.scene);
  assert.equal(result.triangles, expected.triangles);
  assert.equal(result.vertices, expected.vertices);
  assert.equal(result.primitives.length, expected.drawCalls);
  close(result.box.min.toArray(), report.source.bounds.min, `${tier} min`);
  close(result.box.max.toArray(), report.source.bounds.max, `${tier} max`);
  close(result.box.getSize(new Vector3()).toArray(), report.source.bounds.size, `${tier} size`);
  const sourceNodes = new Set(gltf.nodes.flatMap(node => node.extras.sourceNodes));
  for (const retained of ['Front_21_primary_stone_ribs_and_2_edge_frames', 'Front_880_individual_glass_band_panes', 'Front_transoms_reveals_and_closed_sash_profiles', 'Podium_front_7_wide_2_narrow_stone_grid', 'Crown_open_louver_frame_and_horizontal_blades', 'Crown_2022_period_Huaxia_four_glyphs_and_emblem', 'Pit_side_visible_gold_Shoushin_wealth_vertical_glyphs']) assert(sourceNodes.has(retained), `${tier} must retain ${retained}`);
  assert(sourceNodes.has('Podium_fine_mullions') === (tier === 'detail'));
  outputs[tier] = { ...result, asset };
}
assert.equal(outputs.detail.triangles, report.source.triangles);
assert(outputs.light.triangles < outputs.detail.triangles * 0.7);
assert(outputs.detail.primitives.length <= report.source.originalRenderPrimitives / 5);

// When the input handoff is available, compare every complete detail triangle
// by material and float32 world-space vertex position, independently of index
// order and vertex deduplication. This catches lost, added or shifted faces.
if (process.argv[2]) {
  const bytes = fs.readFileSync(process.argv[2]);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), report.source.sha256);
  const original = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const source = inspect(original.scene);
  function trianglesCanonical(parts) {
    const result = [], v = new Vector3();
    for (const mesh of parts.primitives) {
      const position = mesh.geometry.getAttribute('position'), index = mesh.geometry.index;
      const count = index?.count || position.count;
      for (let offset = 0; offset < count; offset += 3) {
        const points = [];
        for (let n = 0; n < 3; n++) {
          v.fromBufferAttribute(position, index ? index.getX(offset + n) : offset + n).applyMatrix4(mesh.matrixWorld);
          points.push([v.x, v.y, v.z].map(Math.fround).join(','));
        }
        result.push(`${mesh.material.name}:${points.sort().join(';')}`);
      }
    }
    return result.sort();
  }
  assert.deepEqual(trianglesCanonical(outputs.detail), trianglesCanonical(source), 'Every detail triangle and material must equal the supplied web source');
}
console.log(JSON.stringify({ passed: true, assetOnly: true, webglVerified: false, sourceComparison: Boolean(process.argv[2]), uniformSourceBounds: report.source.bounds, tiers: Object.fromEntries(['light', 'detail'].map(tier => [tier, { bytes: report.tiers[tier].bytes, triangles: outputs[tier].triangles, drawCalls: outputs[tier].primitives.length, flatShading: true }])) }, null, 2));
