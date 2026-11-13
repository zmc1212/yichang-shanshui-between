// Read-only inventory of the exported GLBs and their actual scene placements.
// Run from the project root: node scripts/audit-export-models.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Box3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BUSINESS_BUILDINGS } from '../src/scene/buildingCatalog.js';
import { resolveAuthoredPlacement } from '../src/scene/authoredPlacement.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const rel = p => path.relative(root, p).replaceAll('\\', '/');
const sha = b => createHash('sha256').update(b).digest('hex');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : e.isFile() ? [p] : [];
});
const modelFiles = walk(path.join(root, 'public/models')).filter(p => /\.(glb|gltf|obj|fbx)$/i.test(p)).sort();
const city = readJson('public/data/city.json');
const registrations = BUSINESS_BUILDINGS.map(spec => {
  const p = resolveAuthoredPlacement(spec, city.meta);
  return {
    name: p.name, id: p.id, sourceSceneId: p.sourceSceneId,
    assets: p.assets, coordinateSystem: p.registration.coordinateSystem,
    approximate: Boolean(p.registration.approximate), anchorLonLat: p.registration.anchorLonLat,
    modelOriginLonLat: p.registration.modelOriginLonLat ?? null,
    worldModelOriginXZ: p.worldModelOrigin ?? null, positionXZ: [p.x, p.z], yawRadians: p.yaw,
    uniformScale: p.uniformScale, sourceBounds: p.sourceBounds,
    placementMethod: p.registration.scaleMethod, orientationMethod: p.registration.orientationMethod,
    sourceModelSha256: p.sourceModelSha256 ?? null, sourceSelectionFile: p.sourceSelectionFile ?? null,
    sourceRecovery: p.sourceRecovery ?? null,
  };
});
const issues = [];
const models = [];
await MeshoptDecoder.ready;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

function textureRefs(value, prefix = '', found = []) {
  if (!value || typeof value !== 'object') return found;
  for (const [key, child] of Object.entries(value)) {
    const loc = prefix ? `${prefix}.${key}` : key;
    if (/Texture$/.test(key) && child && Number.isInteger(child.index)) found.push({ property: loc, index: child.index });
    else textureRefs(child, loc, found);
  }
  return found;
}
function geometryOnly(bytes, document, jsonLength) {
  // Node has no browser image decoder. Retain all geometry, but omit texture
  // references when exercising GLTFLoader. Texture indices and embedded image
  // bytes are checked separately; browser rendering still needs a visual check.
  const clone = structuredClone(document);
  const strip = v => {
    if (!v || typeof v !== 'object') return;
    for (const k of Object.keys(v)) if (/Texture$/.test(k)) delete v[k]; else strip(v[k]);
  };
  (clone.materials || []).forEach(strip);
  const json = Buffer.from(JSON.stringify(clone));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
  json.copy(padded);
  const tail = bytes.subarray(20 + jsonLength);
  const out = Buffer.alloc(20 + padded.length + tail.length);
  out.write('glTF'); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(padded.length, 12); out.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(out, 20); tail.copy(out, 20 + padded.length);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}
function imageType(b) {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return 'unknown';
}
for (const file of modelFiles) {
  const name = rel(file);
  if (!name.toLowerCase().endsWith('.glb')) { issues.push(`${name}: non-GLB file needs manual review`); continue; }
  try {
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
    assert.equal(bytes.readUInt32LE(4), 2);
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    const jsonLength = bytes.readUInt32LE(12);
    assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
    const doc = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
    const binHeader = 20 + jsonLength;
    const binLength = bytes.readUInt32LE(binHeader);
    assert.equal(bytes.readUInt32LE(binHeader + 4), 0x004e4942);
    assert.equal(binHeader + 8 + binLength, bytes.length);
    const bin = bytes.subarray(binHeader + 8);
    const refs = [];
    for (const [i, b] of (doc.buffers || []).entries()) {
      if (b.uri && !b.uri.startsWith('data:')) refs.push({ type: 'buffer', index: i, uri: b.uri });
      // EXT_meshopt_compression may declare a virtual fallback buffer holding
      // the decoded size. Its actual bytes are the compressed bufferViews.
      if (!b.uri && !b.extensions?.EXT_meshopt_compression?.fallback) {
        assert.equal(i, 0, `unexpected implicit buffer ${i}`);
        assert(b.byteLength <= bin.length, `buffer ${i} exceeds BIN chunk`);
      }
    }
    for (const [i, view] of (doc.bufferViews || []).entries()) {
      assert(doc.buffers?.[view.buffer], `bufferView ${i} missing buffer`);
      assert((view.byteOffset || 0) + view.byteLength <= doc.buffers[view.buffer].byteLength, `bufferView ${i} exceeds buffer`);
      const compressed = view.extensions?.EXT_meshopt_compression;
      if (compressed) {
        assert(doc.buffers?.[compressed.buffer], `compressed bufferView ${i} missing buffer`);
        assert((compressed.byteOffset || 0) + compressed.byteLength <= doc.buffers[compressed.buffer].byteLength, `compressed bufferView ${i} exceeds buffer`);
      }
    }
    const images = (doc.images || []).map((im, i) => {
      if (im.uri && !im.uri.startsWith('data:')) { refs.push({ type: 'image', index: i, uri: im.uri }); return { index: i, uri: im.uri }; }
      if (im.uri) return { index: i, embeddedDataUri: true, mimeType: im.mimeType ?? null };
      const view = doc.bufferViews?.[im.bufferView];
      assert(view && view.buffer === 0, `image ${i} missing embedded bufferView`);
      const payload = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
      const detected = imageType(payload);
      assert.notEqual(detected, 'unknown', `image ${i} has unrecognised bytes`);
      assert(!im.mimeType || detected === im.mimeType, `image ${i} MIME mismatch`);
      return { index: i, name: im.name ?? null, mimeType: detected, bytes: payload.length, sha256: sha(payload) };
    });
    for (const ref of refs) {
      const target = path.resolve(path.dirname(file), decodeURIComponent(ref.uri.split('?')[0]));
      ref.exists = fs.existsSync(target);
      if (!ref.exists) issues.push(`${name}: missing ${ref.type} ${ref.uri}`);
    }
    const materials = (doc.materials || []).map((m, i) => {
      const textures = textureRefs(m);
      for (const t of textures) assert(doc.textures?.[t.index], `material ${i} missing texture ${t.index}`);
      return { index: i, name: m.name ?? null, textures };
    });
    const textures = (doc.textures || []).map((t, i) => {
      const source = t.extensions?.EXT_texture_webp?.source ?? t.extensions?.KHR_texture_basisu?.source ?? t.source;
      assert(Number.isInteger(source) && doc.images?.[source], `texture ${i} missing image source`);
      return { index: i, source, sampler: t.sampler ?? null };
    });
    const sceneRoots = (doc.scenes || []).map(s => s.nodes || []);
    const transforms = (doc.nodes || []).flatMap((n, i) => {
      if (!n.translation && !n.rotation && !n.scale && !n.matrix && !sceneRoots.some(ids => ids.includes(i))) return [];
      return [{ index: i, name: n.name ?? null, mesh: n.mesh ?? null,
        translation: n.translation ?? [0,0,0], rotationQuaternion: n.rotation ?? [0,0,0,1],
        scale: n.scale ?? [1,1,1], matrix: n.matrix ?? null }];
    });
    const scene = (await loader.parseAsync(geometryOnly(bytes, doc, jsonLength), '')).scene;
    scene.updateMatrixWorld(true);
    let meshCount = 0, vertexCount = 0;
    scene.traverse(obj => {
      if (!obj.isMesh) return;
      meshCount++;
      const positions = obj.geometry.getAttribute('position');
      assert(positions && positions.count > 0, 'mesh has no positions');
      vertexCount += positions.count;
      for (const n of positions.array) assert(Number.isFinite(n), 'non-finite vertex');
      const index = obj.geometry.getIndex();
      if (index) for (const n of index.array) assert(n >= 0 && n < positions.count, 'invalid vertex index');
    });
    assert(meshCount > 0, 'no decoded meshes');
    const bounds = new Box3().setFromObject(scene);
    assert(!bounds.isEmpty(), 'empty decoded bounds');
    const geometries = new Set(), parsedMaterials = new Set();
    scene.traverse(obj => { if (obj.geometry) geometries.add(obj.geometry); for (const m of Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : []) parsedMaterials.add(m); });
    geometries.forEach(g => g.dispose()); parsedMaterials.forEach(m => m.dispose());
    models.push({ path: name, bytes: bytes.length, sha256: sha(bytes),
      extensionsUsed: doc.extensionsUsed || [], sceneRoots, nodeCount: (doc.nodes || []).length,
      transforms, decodedMeshCount: meshCount, decodedVertexCount: vertexCount,
      decodedBounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
      materials, textures, images, externalReferences: refs });
  } catch (error) { issues.push(`${name}: ${error.message}`); }
}
const duplicateMap = new Map();
for (const m of models) duplicateMap.set(m.sha256, [...(duplicateMap.get(m.sha256) || []), m.path]);
const duplicates = [...duplicateMap].filter(([, paths]) => paths.length > 1).map(([sha256, paths]) => ({ sha256, paths }));
const staticSourceFiles = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'public/data'))]
  .filter(p => /\.(js|jsx|json)$/.test(p));
const referencedModels = new Set();
for (const file of staticSourceFiles) {
  const content = fs.readFileSync(file, 'utf8');
  for (const match of content.matchAll(/\/models\/[A-Za-z0-9_./-]+\.(?:glb|gltf|obj|fbx)/gi)) referencedModels.add(match[0]);
}
const missingModelReferences = [...referencedModels].filter(url => !fs.existsSync(path.join(root, 'public', url)));
for (const url of missingModelReferences) issues.push(`Missing referenced model ${url}`);
const report = {
  scope: 'Sites version 78 repository checkout; image payload signatures checked, not browser texture decoding or survey accuracy',
  sourceCommit: 'bb919a6ade05f03f7f3150aae703b45c48cd5bd4',
  modelFiles: modelFiles.length, parsedModels: models.length,
  totalModelBytes: models.reduce((s, m) => s + m.bytes, 0),
  embeddedImages: models.reduce((s, m) => s + m.images.length, 0),
  distinctReferencedModelUrls: referencedModels.size, missingModelReferences,
  duplicates, issues, coordinateSystem: city.meta.coordinateSystem,
  cityCenterLonLat: city.meta.center, unitsPerMeter: city.meta.unitsPerMeter,
  landmarkPlacements: city.landmarks,
  authoredPlacements: registrations, models,
};
const destination = path.join(root, 'docs/export-model-inventory.json');
fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ modelFiles: report.modelFiles, parsedModels: report.parsedModels, bytes: report.totalModelBytes,
  embeddedImages: report.embeddedImages, referencedModelUrls: report.distinctReferencedModelUrls,
  duplicateGroups: duplicates.length, issues, report: rel(destination) }, null, 2));
if (issues.length) process.exitCode = 1;
