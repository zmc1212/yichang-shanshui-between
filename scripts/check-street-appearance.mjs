import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { AUTHORED_MODELS } from '../src/scene/authoredModels.js';
import { resolveAuthoredPlacement, planAuthoredGround } from '../src/scene/authoredPlacement.js';
import { planStreetDetails, createStreetDetails } from '../src/scene/streetDetails.js';

// Read-only integration checks. This script writes no reports or assets and
// does not create a browser/WebGL context; image quality and GPU timings are
// deliberately outside its scope. Curb openings have their own geometry test.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'public/data/city.json'), 'utf8'));
const models = AUTHORED_MODELS.map(spec => resolveAuthoredPlacement(spec, data.meta)).filter(Boolean);
const sourceSnapshot = JSON.stringify({ data, models });
const units = data.meta.unitsPerMeter;
const edges = ring => ring.map((p, i) => [p, ring[(i + 1) % ring.length]]);
function inRing(x, z, ring) {
  let inside = false;
  for (const [a, b] of edges(ring)) {
    if ((a[1] > z) !== (b[1] > z) && x < a[0] + (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1])) inside = !inside;
  }
  return inside;
}
const inWater = (x, z) => data.water.some(p => {
  const [outer, ...holes] = p.rings || [p.ring];
  return inRing(x, z, outer) && !holes.some(hole => inRing(x, z, hole));
});
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
function heightAt(x, z) {
  if (inWater(x, z)) return 0;
  const t = data.terrain;
  if (t?.cols > 1 && t?.rows > 1 && t.heights?.length >= t.cols * t.rows) {
    const fx = clamp((x / (t.width || data.meta.width) + .5) * (t.cols - 1), 0, t.cols - 1.001);
    const fz = clamp((z / (t.depth || data.meta.depth) + .5) * (t.rows - 1), 0, t.rows - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const a = Number(t.heights[iz * t.cols + ix]) || 0, b = Number(t.heights[iz * t.cols + ix + 1]) || 0;
    const c = Number(t.heights[(iz + 1) * t.cols + ix]) || 0, d = Number(t.heights[(iz + 1) * t.cols + ix + 1]) || 0;
    return clamp((a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz, 0, Math.max(data.meta.width, data.meta.depth) * .12);
  }
  const radius = Math.max(data.meta.width, data.meta.depth) * .065;
  return data.landmarks.filter(l => /磨基山|白马山|东山/.test(l.name || '')).reduce((sum, l) =>
    sum + (/磨基山/.test(l.name) ? 4.8 : 2.4) * Math.exp(-((x - l.x) ** 2 + (z - l.z) ** 2) / (radius ** 2 * .55)), 0);
}
const authoredGround = planAuthoredGround(models, data, 3.8);
const plan = planStreetDetails({ data, authoredModels: models, authoredGround,
  waterfrontPlan: { omittedBuildingIndices: new Set() }, inWater, heightAt });
assert.equal(plan.sites.length, 5);
const themes = [];
const street = createStreetDetails(plan, { heightAt, makeMaterial(day, night, options = {}) {
  const material = new THREE.MeshStandardMaterial({ color: day, roughness: .94, metalness: 0, ...options });
  themes.push({ material, day, night });
  return material;
} });
street.group.updateMatrixWorld(true);
const passed = [], resources = { geometries: new Set(), materials: new Set(), textures: new Set() };
let meshCount = 0, triangleCount = 0, geometryBytes = 0;
const mappedMeshes = [];
street.group.traverse(object => {
  if (!object.isMesh) return;
  meshCount++;
  const g = object.geometry;
  triangleCount += (g.index?.count || g.attributes.position.count) / 3 * (object.isInstancedMesh ? object.count : 1);
  geometryBytes += Object.values(g.attributes).reduce((sum, a) => sum + a.array.byteLength, 0) + (g.index?.array.byteLength || 0);
  for (const attribute of [object.instanceMatrix, object.instanceColor]) if (attribute) geometryBytes += attribute.array.byteLength;
  resources.geometries.add(g);
  for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
    resources.materials.add(material);
    for (const value of Object.values(material)) if (value?.isTexture) resources.textures.add(value);
    if (material.map) mappedMeshes.push(object);
  }
});
assert.equal(mappedMeshes.length, 10, 'Both paving materials on every site use the shared map');
assert.equal(resources.textures.size, 1, 'Street sites share one texture instance');
const [texture] = resources.textures;
assert(texture.isDataTexture);
assert.equal(texture.image.width, 256); assert.equal(texture.image.height, 256);
assert.equal(texture.image.data.length, 256 * 256 * 4);
assert.equal(texture.wrapS, THREE.RepeatWrapping); assert.equal(texture.wrapT, THREE.RepeatWrapping);
assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter); assert.equal(texture.magFilter, THREE.LinearFilter);
assert.equal(texture.generateMipmaps, true); assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
for (let i = 0; i < texture.image.data.length; i += 4) {
  assert.equal(texture.image.data[i + 3], 255, 'Every atlas texel is opaque');
  assert.equal(texture.image.data[i], texture.image.data[i + 1]);
  assert.equal(texture.image.data[i], texture.image.data[i + 2], 'Neutral atlas retains material theme tint');
}
for (const mesh of mappedMeshes) {
  assert.equal(mesh.material.map, texture);
  assert.equal(mesh.material.transparent, false); assert.equal(mesh.material.opacity, 1);
  assert.equal(mesh.material.depthWrite, true); assert.equal(mesh.material.alphaTest, 0);
}
passed.push('Ten paving meshes share one opaque, neutral, repeat-wrapped 256² RGBA atlas with mipmap filtering');

const positionKey = (x, y, z) => `${Math.fround(x)},${Math.fround(y)},${Math.fround(z)}`;
let sharedUvVertices = 0, maximumUvProjectionError = 0, jiuzhouEntryVertexCount = 0;
for (const site of plan.sites) {
  const group = street.group.getObjectByName(site.id), model = models.find(m => m.id === site.id);
  const cos = Math.cos(model.yaw), sin = Math.sin(model.yaw), commonUv = new Map();
  for (const accent of [false, true]) {
    const cells = site.paving.filter(p => (p.role === 'accent') === accent);
    const mesh = group.getObjectByName(accent ? 'street paving insets' : 'forecourt, entrance path and sidewalk');
    assert(mesh && cells.length);
    const positions = mesh.geometry.attributes.position, uv = mesh.geometry.attributes.uv;
    assert(uv && uv.count === positions.count);
    const actual = [], expected = [];
    for (const cell of cells) for (const index of [0, 0, 1, 2, 2, 3]) {
      const [x, z] = cell.points[index], y = cell.surface ? cell.surface(x, z) : heightAt(x, z) + site.groundLift(x, z);
      expected.push(positionKey(x, y, z));
      if (cell.role === 'entry-apron') jiuzhouEntryVertexCount++;
    }
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i), u = uv.getX(i), v = uv.getY(i);
      actual.push(positionKey(x, y, z));
      assert([x, y, z, u, v].every(Number.isFinite));
      // Independent registered-model frame, not the UV helper under test.
      const dx = x - site.sourceAnchor[0], dz = z - site.sourceAnchor[1];
      const expectedU = (dx * cos - dz * sin) / (4.8 * units);
      const expectedV = (dx * sin + dz * cos) / (2.4 * units);
      maximumUvProjectionError = Math.max(maximumUvProjectionError, Math.abs(u - expectedU), Math.abs(v - expectedV));
      assert(Math.abs(u - expectedU) < 1e-4 && Math.abs(v - expectedV) < 1e-4, `${site.id}: continuous registered-frame UV`);
      const key = `${x},${z}`, earlier = commonUv.get(key);
      if (earlier) {
        assert(Math.abs(earlier[0] - u) < 1e-5 && Math.abs(earlier[1] - v) < 1e-5, `${site.id}: shared paving vertices retain identical UVs across materials`);
        sharedUvVertices++;
      } else commonUv.set(key, [u, v]);
    }
    assert.deepEqual(actual.sort(), expected.sort(), `${site.id}: appearance preserves every paving Float32 position and special cell surface`);
  }
}
assert(sharedUvVertices > 100);
assert.equal(jiuzhouEntryVertexCount, 48, 'Eight original Jiuzhou entry quads retain their exact special surface');
const entry = plan.sites.find(s => s.id === 'jiuzhou-s01').entryApron;
assert.equal(entry.method, 'source-cleared-step-join');
assert.deepEqual(entry.thresholdSource, [-13, .1801239127460832, 11.001]);
assert(Math.abs(entry.stepTopHeight - .07064871608936112) < 1e-12);
passed.push('All paving positions/surfaces are unchanged; shared UVs remain continuous, including all 48 emitted Jiuzhou apron vertices');

const matrix = new THREE.Matrix4(), vertex = new THREE.Vector3();
const safety = {};
const treeMeshes = ['street tree pits', 'street tree soil', 'street planted bed foliage', 'street tree trunks', 'street tree crowns'];
for (const site of plan.sites) {
  const group = street.group.getObjectByName(site.id);
  for (const name of treeMeshes) {
    const mesh = group.getObjectByName(name);
    assert(mesh?.isInstancedMesh && mesh.count === site.trees.length);
    const record = safety[name] ||= { instances: 0, vertices: 0, minimumInsetMetres: Infinity };
    for (let i = 0; i < mesh.count; i++) {
      const ring = site.trees[i].safetyFootprint;
      assert.equal(ring.length, 16, 'Use the actual conservative polygon, not its circumscribed circle');
      const signed = edges(ring).reduce((sum, [a, b]) => sum + a[0] * b[1] - b[0] * a[1], 0);
      const sign = Math.sign(signed);
      mesh.getMatrixAt(i, matrix);
      for (let p = 0; p < mesh.geometry.attributes.position.count; p++) {
        vertex.fromBufferAttribute(mesh.geometry.attributes.position, p).applyMatrix4(matrix).applyMatrix4(mesh.matrixWorld);
        for (const [a, b] of edges(ring)) {
          const inset = sign * ((b[0] - a[0]) * (vertex.z - a[1]) - (b[1] - a[1]) * (vertex.x - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]);
          assert(inset >= -2e-7, `${site.id} ${name} instance ${i}: actual vertex escapes the 16-sided safety footprint`);
          record.minimumInsetMetres = Math.min(record.minimumInsetMetres, inset / units);
        }
        record.vertices++;
      }
      record.instances++;
    }
  }
}
passed.push('Every transformed vertex of the enlarged beds, soil, low foliage, trunks and crowns stays inside its actual 16-sided safety polygon; convexity also contains every triangle interior');

const visible = object => {
  for (let p = object; p; p = p.parent) if (!p.visible) return false;
  return true;
};
const inView = { intersectsBox: () => true }, outOfView = { intersectsBox: () => false };
const update = (pixelsPerUnit, options = {}) => street.update({ pixelsPerUnit, frustum: inView, enabled: true, treesEnabled: true, ...options });
const landscapeStates = [], assertLandscape = expected => {
  for (const site of plan.sites) assert.equal(visible(street.group.getObjectByName(site.id).getObjectByName('street tree crowns')), expected);
};
update(2); assert.equal(street.getStats().streetVisibleDrawCalls, 0);
for (const [pixelsPerUnit, expected] of [[15, false], [31, false], [32, true], [30, true], [31, true], [25.6, true], [25.4, false], [28, false], [31, false], [32, true]]) {
  update(pixelsPerUnit); assertLandscape(expected);
  assert.equal(update(pixelsPerUnit), false, 'Repeating an unchanged camera state does not trigger another visibility change');
  landscapeStates.push({ pixelsPerUnit, crownPixels: 4.7 * units * pixelsPerUnit, landscape: expected, draws: street.getStats().streetVisibleDrawCalls });
  for (const site of plan.sites) assert.equal(visible(street.group.getObjectByName(site.id).getObjectByName('street lamps')), false, 'Mid-scale planting does not bring near-only furniture forward');
}
update(60); assertLandscape(true);
for (const site of plan.sites) assert(visible(street.group.getObjectByName(site.id).getObjectByName('street lamps')));
const nearDayDraws = street.getStats().streetVisibleDrawCalls;
update(38);
for (const site of plan.sites) assert(visible(street.group.getObjectByName(site.id).getObjectByName('street lamps')), 'Furniture retains its original exit hysteresis');
update(33);
for (const site of plan.sites) assert.equal(visible(street.group.getObjectByName(site.id).getObjectByName('street lamps')), false);
assertLandscape(true); update(25.4); assertLandscape(false); update(2);
assert.equal(street.getStats().streetVisibleDrawCalls, 0);
passed.push('Far → planting → furniture → far preserves separate 3/2.4 crown-pixel and 9/6.5 road-pixel hysteresis, with stable repeated updates');

update(60, { treesEnabled: false });
for (const site of plan.sites) {
  const group = street.group.getObjectByName(site.id);
  for (const name of ['street planted bed foliage', 'street tree trunks', 'street tree crowns']) assert.equal(visible(group.getObjectByName(name)), false);
  for (const name of ['street tree pits', 'street tree soil', 'street lamps']) assert.equal(visible(group.getObjectByName(name)), true);
}
update(60, { enabled: false }); assert.equal(street.getStats().streetVisibleDrawCalls, 0);
update(60); assertLandscape(true); assert.equal(street.getStats().streetVisibleDrawCalls, nearDayDraws);
update(60, { frustum: outOfView }); assert.equal(street.getStats().streetVisibleDrawCalls, 0);
update(60); assertLandscape(true);
for (const record of themes) record.material.color.set(record.night);
street.setTheme(true);
assert.equal(resources.textures.size, 1); assert(mappedMeshes.every(mesh => mesh.material.map === texture));
const nearNightDraws = street.getStats().streetVisibleDrawCalls;
assert.equal(nearNightDraws, nearDayDraws + plan.sites.length);
street.setTheme(false); assert.equal(street.getStats().streetVisibleDrawCalls, nearDayDraws);
passed.push('Tree, street and frustum switches remain independent; day/night reuse the same opaque atlas and only add one light-pool draw per visible site');

const stats = street.getStats();
assert.equal(stats.streetMeshes, meshCount); assert.equal(stats.streetTriangles, triangleCount);
assert.equal(stats.streetGeometryBytes, geometryBytes); assert.equal(stats.streetTextureCount, resources.textures.size);
assert.equal(stats.streetTextureSourceBytes, texture.image.data.byteLength);
assert(meshCount <= 65 && triangleCount < 12000 && geometryBytes < 550000, 'Integrated five-site resource budget');
assert.equal(JSON.stringify({ data, models }), sourceSnapshot, 'Appearance/planning cannot mutate source coordinates, authored transforms or data');
let rgba8MipBytes = 0;
for (let side = texture.image.width; side >= 1; side /= 2) rgba8MipBytes += side * side * 4;
passed.push('Independently counted geometry/instance buffers match the published stats; source texture and theoretical RGBA8 mip storage are recorded separately');

// Execute the CURRENT factory's resource-traversal disposal block on these
// actual resources. This exercises map discovery and Set deduplication without
// recreating the browser factory or pretending to measure a WebGL renderer.
const citySource = fs.readFileSync(path.join(root, 'src/scene/createCityScene.js'), 'utf8');
const start = citySource.lastIndexOf('const geometries = new Set(), materials = new Set(), textures = new Set();');
const end = citySource.indexOf('renderer.dispose();', start);
assert(start > 0 && end > start, 'The scene disposal block must remain identifiable for this isolated check');
const disposalEvents = new Map();
for (const object of [...resources.geometries, ...resources.materials, ...resources.textures]) {
  disposalEvents.set(object, 0);
  object.addEventListener('dispose', () => disposalEvents.set(object, disposalEvents.get(object) + 1));
}
new Function('scene', citySource.slice(start, end))(street.group);
for (const count of disposalEvents.values()) assert.equal(count, 1, 'Shared resources are disposed once by the existing scene traversal');
assert.equal(disposalEvents.get(texture), 1);
passed.push('The existing scene cleanup discovers the new map and disposes the one shared texture, all materials and all geometries exactly once');

console.log(JSON.stringify({ scope: 'read-only geometry/material/visibility integration; no browser or GPU timing',
  sites: plan.sites.map(site => site.id), passed,
  resources: { meshCount, triangleCount, geometryBytes, textureCount: resources.textures.size,
    textureSourceBytes: texture.image.data.byteLength, theoreticalRgba8MipBytes: rgba8MipBytes,
    nearDayDraws, nearNightDraws, geometryDisposals: resources.geometries.size, materialDisposals: resources.materials.size, textureDisposals: resources.textures.size },
  uv: { sharedUvVertices, maximumUvProjectionError, jiuzhouEntryVertexCount, jiuzhouStepTopY: entry.stepTopHeight },
  safety, landscapeStates,
}, null, 2));
