import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Matrix4, Quaternion, Vector3 } from 'three';

// This repacks the supplied web derivative only. It never opens or modifies
// the original Blender file. Missing NORMAL is intentional: glTF requires
// flat shading in that case, preserving the source's architectural hard edges.
// Usage: node scripts/prepare-shouxin-web.mjs /absolute/shouxin_s01_web.glb
const sourcePath = process.argv[2];
if (!sourcePath) throw new Error('Supply the original shouxin_s01_web.glb path.');
const destination = path.resolve('public/models/shouxin-s01');
const reportPath = path.resolve('docs/models/shouxin-asset-report.json');
const expectedSourceSha = 'ab55eb23cd85d5dfd7fe69cfa6d628fe299aa69221bfa134fb478a3fe9f5df63';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const bytes = fs.readFileSync(sourcePath);
if (sha256(bytes) !== expectedSourceSha) throw new Error('Unexpected source version: inspect its handoff before updating this script.');
if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) throw new Error('Expected glTF 2.0 GLB.');
let document, binary;
for (let offset = 12; offset < bytes.length;) {
  const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
  const chunk = bytes.subarray(offset + 8, offset + 8 + length);
  if (type === 0x4e4f534a) document = JSON.parse(chunk.toString('utf8'));
  if (type === 0x004e4942) binary = chunk;
  offset += 8 + length;
}
if (!document || !binary) throw new Error('Missing JSON or BIN chunk.');
if (document.extensionsRequired?.length) throw new Error('Unexpected required glTF extension.');

function accessor(index) {
  const a = document.accessors[index], view = document.bufferViews[a.bufferView];
  if (a.sparse || a.normalized || view.buffer !== 0) throw new Error('Unsupported sparse, normalized, or external source accessor.');
  const channels = { SCALAR: 1, VEC3: 3 }[a.type];
  const stride = { 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
  if (!channels || !stride) throw new Error('Unexpected source accessor format.');
  const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const start = (view.byteOffset || 0) + (a.byteOffset || 0);
  const values = [];
  for (let i = 0; i < a.count; i++) for (let c = 0; c < channels; c++) {
    const offset = start + i * (view.byteStride || channels * stride) + c * stride;
    values.push(a.componentType === 5126 ? data.getFloat32(offset, true) : a.componentType === 5125 ? data.getUint32(offset, true) : data.getUint16(offset, true));
  }
  return values;
}

const primitives = [];
function visit(nodeIndex, parentMatrix) {
  const node = document.nodes[nodeIndex];
  const matrix = node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(new Vector3().fromArray(node.translation || [0, 0, 0]), new Quaternion().fromArray(node.rotation || [0, 0, 0, 1]), new Vector3().fromArray(node.scale || [1, 1, 1]));
  matrix.premultiply(parentMatrix);
  for (const primitive of document.meshes[node.mesh]?.primitives || []) {
    if ((primitive.mode ?? 4) !== 4 || Object.keys(primitive.attributes).join() !== 'POSITION') throw new Error('Unexpected source geometry; review before repacking.');
    const positions = accessor(primitive.attributes.POSITION);
    const point = new Vector3();
    for (let i = 0; i < positions.length; i += 3) {
      point.fromArray(positions, i).applyMatrix4(matrix);
      positions[i] = Math.fround(point.x); positions[i + 1] = Math.fround(point.y); positions[i + 2] = Math.fround(point.z);
    }
    const indices = accessor(primitive.indices);
    if (matrix.determinant() < 0) for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
    primitives.push({ name: node.name || `source_node_${nodeIndex}`, material: primitive.material, positions, indices });
  }
  for (const child of node.children || []) visit(child, matrix);
}
for (const node of document.scenes[document.scene || 0].nodes) visit(node, new Matrix4());

function bounds(parts) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) for (let i = 0; i < part.positions.length; i++) { const axis = i % 3; min[axis] = Math.min(min[axis], part.positions[i]); max[axis] = Math.max(max[axis], part.positions[i]); }
  return { min, max, size: min.map((value, i) => max[i] - value) };
}
function mergeByMaterial(parts) {
  const buckets = new Map();
  for (const part of parts) {
    if (!buckets.has(part.material)) buckets.set(part.material, { material: part.material, names: new Set(), positions: [], indices: [], vertexMap: new Map() });
    const bucket = buckets.get(part.material), remap = [];
    bucket.names.add(part.name);
    // Exact float32-position deduplication is safe because there are no UVs,
    // normals, skins, morphs or vertex colors; the runtime shades faces flat.
    for (let i = 0; i < part.positions.length; i += 3) {
      const xyz = part.positions.slice(i, i + 3), key = xyz.join(',');
      if (!bucket.vertexMap.has(key)) { bucket.vertexMap.set(key, bucket.positions.length / 3); bucket.positions.push(...xyz); }
      remap.push(bucket.vertexMap.get(key));
    }
    for (const index of part.indices) bucket.indices.push(remap[index]);
  }
  return [...buckets.values()].sort((a, b) => a.material - b.material);
}
function packageGlb(parts, tier) {
  const merged = mergeByMaterial(parts);
  const gltf = {
    asset: { version: '2.0', generator: '宜昌Online / prepare-shouxin-web.mjs; exact static material merge' },
    scene: 0, scenes: [{ name: `Shouxin_S01_${tier}_candidate`, nodes: [] }],
    nodes: [], meshes: [], materials: document.materials, buffers: [], bufferViews: [], accessors: [],
    extras: { modelId: 'shouxin-wealth', sourceSha256: expectedSourceSha, nativeSha256: 'b30f44bac8c91641803dcee3062267a3a681f74a0bf5a3c5be7a17fa6b71139d', stage: 'S01', status: 'appearance-candidate', tier, coordinateUnits: 'normalized-not-metres', front: '+Z', up: '+Y', geometricScaleApplied: 1, flatShadingRequired: true, independentDisplayOnly: true, registrationStatus: 'location-absolute-scale-true-north-unverified', omittedDetails: tier === 'light' ? ['Stone_shadow_joint_candidate overlay lines', 'Podium_fine_mullions secondary subdivision only'] : [] },
  };
  const chunks = [];
  let binaryLength = 0;
  function append(array, target) {
    const data = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    const view = gltf.bufferViews.length;
    gltf.bufferViews.push({ buffer: 0, byteOffset: binaryLength, byteLength: data.length, target });
    chunks.push(data); binaryLength += data.length;
    const padding = (4 - binaryLength % 4) % 4;
    if (padding) { chunks.push(Buffer.alloc(padding)); binaryLength += padding; }
    return view;
  }
  for (const part of merged) {
    const position = gltf.accessors.length, b = bounds([part]);
    gltf.accessors.push({ bufferView: append(new Float32Array(part.positions), 34962), componentType: 5126, count: part.positions.length / 3, type: 'VEC3', min: b.min, max: b.max });
    const indices = gltf.accessors.length;
    const shortIndices = part.positions.length / 3 < 65536;
    gltf.accessors.push({ bufferView: append(shortIndices ? new Uint16Array(part.indices) : new Uint32Array(part.indices), 34963), componentType: shortIndices ? 5123 : 5125, count: part.indices.length, type: 'SCALAR' });
    const mesh = gltf.meshes.length, name = document.materials[part.material].name;
    gltf.meshes.push({ name, primitives: [{ attributes: { POSITION: position }, indices, material: part.material, mode: 4 }], extras: { sourceNodes: [...part.names], flatShadingRequired: true } });
    gltf.nodes.push({ mesh, name, extras: { sourceNodes: [...part.names], flatShadingRequired: true } });
    gltf.scenes[0].nodes.push(mesh);
  }
  gltf.buffers.push({ byteLength: binaryLength });
  const json = Buffer.from(JSON.stringify(gltf)), jsonPadded = Buffer.alloc(json.length + (4 - json.length % 4) % 4, 0x20); json.copy(jsonPadded);
  const bin = Buffer.concat(chunks), length = 12 + 8 + jsonPadded.length + 8 + bin.length;
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(length, 8);
  const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(jsonPadded.length); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(bin.length); binHeader.writeUInt32LE(0x004e4942, 4);
  const output = Buffer.concat([header, jsonHeader, jsonPadded, binHeader, bin]);
  return { output, summary: { file: `${tier}.glb`, bytes: output.length, sha256: sha256(output), triangles: merged.reduce((n, p) => n + p.indices.length / 3, 0), vertices: merged.reduce((n, p) => n + p.positions.length / 3, 0), drawCalls: merged.length, bounds: bounds(merged), flatShadingRequired: true, externalDependencies: [], omittedSourceParts: primitives.filter(p => !parts.includes(p)).map(p => ({ node: p.name, material: document.materials[p.material].name, triangles: p.indices.length / 3 })) } };
}

const lightParts = primitives.filter(p => document.materials[p.material].name !== 'Stone_shadow_joint_candidate' && p.name !== 'Podium_fine_mullions');
fs.mkdirSync(destination, { recursive: true }); fs.mkdirSync(path.dirname(reportPath), { recursive: true });
const report = {
  modelId: 'shouxin-wealth', stage: 'S01', source: { file: path.basename(sourcePath), bytes: bytes.length, sha256: expectedSourceSha, nativeSha256: 'b30f44bac8c91641803dcee3062267a3a681f74a0bf5a3c5be7a17fa6b71139d', originalMeshes: document.meshes.length, originalRenderPrimitives: primitives.length, triangles: primitives.reduce((n, p) => n + p.indices.length / 3, 0), bounds: bounds(primitives) },
  policy: { preserveOriginalBlender: true, preserveOriginalWebSource: true, absoluteDimensionsKnown: false, trueNorthKnown: false, locationVerified: false, unverifiedClosure: ['inland back', 'roof'], opticalBackingIsInterior: false, signagePeriod: '2022 reference; does not establish current occupants', transform: 'Baked existing node transforms, no added rotation or stretch. Runtime must use one uniform scale for all axes.', detail: 'All original triangles retained; exact float32 position deduplication and static material merge only.', light: 'Omit only fine shadow-joint overlays and podium secondary mullions; retain main curtain wall grid, primary stone ribs, glass panes, crown, openings and all signage.' },
  tiers: {},
};
for (const [tier, parts] of [['light', lightParts], ['detail', primitives]]) {
  const result = packageGlb(parts, tier);
  fs.writeFileSync(path.join(destination, `${tier}.glb`), result.output); report.tiers[tier] = result.summary;
}
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
for (const filename of ['README.txt', 'FONT_LICENSE_SIL-1.1.txt', 'FONT_SOURCE_AND_LICENSE.json']) fs.copyFileSync(path.join(path.dirname(sourcePath), filename), path.join(destination, filename));
fs.writeFileSync(path.join(destination, 'OPTIMIZATION.txt'), '首信财富 S01 网页衍生资产\n\n原生 Blender 与原始网页交接包均未修改。detail.glb 保留全部原三角与材质，只按材质合并静态网格。light.glb 仅省略石材细缝叠线和裙房次级细分格；主面幕墙分格、石材竖肋、玻璃、顶部冠架及全部字牌保留。\n\n两档包围盒与锚点一致，不以竖向拉伸匹配城市普通楼高度。GLB 无 NORMAL 属性，加载时须使用 flatShading；不要计算全楼平滑法线。无贴图、无外部解码器。绝对尺寸、真北朝向和地图配准均待核准，先独立展台展示。背面及屋顶 CLOSURE_HOLD 为候选封口，不是实景确认部分。\n\n来源与字形许可见同目录 README.txt、FONT_SOURCE_AND_LICENSE.json、FONT_LICENSE_SIL-1.1.txt。详细数值与哈希见站点源码 docs/models/shouxin-asset-report.json。\n');
console.log(JSON.stringify({ source: report.source, tiers: report.tiers }, null, 2));
