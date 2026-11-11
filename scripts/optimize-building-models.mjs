/**
 * Produce web derivatives without changing native Blender or source GLB files.
 * Tool-only dependencies: @gltf-transform/{core,extensions,functions} 4.5.1,
 * meshoptimizer 1.3.0 and sharp. Install into a separate --tools directory.
 * Usage: node scripts/optimize-building-models.mjs --tools /path/to/tools
 *   --input /path/source.glb --output public/models/name --id building-id
 *   [--remove-node Exact_non_geographic_node_name] [--ratio 0.13] [--error 0.0008]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const option = key => args[args.indexOf(key) + 1];
for (const key of ['--tools','--input','--output','--id']) if (!args.includes(key)) throw new Error(`Missing ${key}`);
const require = createRequire(path.resolve(option('--tools'), 'package.json'));
const { NodeIO, Logger } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { dedup, flatten, join, weld, simplify, prune, textureCompress, meshopt, getBounds, normals } = require('@gltf-transform/functions');
const sharp = require('sharp');
const { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } = await import(pathToFileURL(require.resolve('meshoptimizer')).href);
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
});
const input = path.resolve(option('--input')), output = path.resolve(option('--output'));
const id = option('--id');
const lightRatio = args.includes('--ratio') ? Number(option('--ratio')) : .13;
const lightError = args.includes('--error') ? Number(option('--error')) : .0008;
if (!(lightRatio > 0 && lightRatio <= 1) || !(lightError >= 0 && lightError <= .003)) {
  throw new Error('Light simplification requires 0 < ratio <= 1 and 0 <= error <= 0.003.');
}
const removeNames = args.flatMap((v,i)=>v === '--remove-node' ? [args[i+1]] : []);
// Opt-in only for independently reviewed open-air glass infill, never all glazing.
const preserveAlphaNames = args.flatMap((v,i)=>v === '--preserve-alpha-material' ? [args[i+1]] : []);
const bytes = await fs.readFile(input);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const stats = document => {
  const root=document.getRoot();
  let triangles=0,vertices=0,primitives=0,indexedPrimitives=0;
  for(const mesh of root.listMeshes()) for(const prim of mesh.listPrimitives()) {
    primitives++;indexedPrimitives+=Number(!!prim.getIndices());vertices+=prim.getAttribute('POSITION')?.getCount()||0;
    triangles+=(prim.getIndices()?.getCount()||prim.getAttribute('POSITION')?.getCount()||0)/3;
  }
  const images=root.listTextures().map(t=>({name:t.getName(),size:t.getSize(),bytes:t.getImage()?.byteLength||0}));
  return {triangles,vertices,primitives,indexedPrimitives,materials:root.listMaterials().length,
    images, estimatedTextureBytesRGBA8WithMipmaps:Math.round(images.reduce((sum,t)=>sum+(t.size ? t.size[0]*t.size[1]*4*4/3 : 0),0)),
    bounds:getBounds(root.listScenes()[0])};
};
const manifest={id,sourceFilename:path.basename(input),sourceSha256:sha256(bytes),sourceBytes:bytes.byteLength,
  nativeChanged:false,removedPresentationNodes:removeNames,preserveAlphaMaterials:preserveAlphaNames,
  materialPolicy:'Original base colors retained; light drops baked normal maps and regenerates geometric face normals, detail retains source normals and normal maps. Textures are bounded to 512 px light / 1024 px detail WebP. Transmission, volume, and clearcoat removed; opaque material alpha and reduced metalness/increased roughness suit the miniature scene. Source files unchanged.',
  geometryPolicy:'Material-aware weld/join. Light simplifies within a bounded error; detail keeps source triangles after explicitly named presentation-node removal. One common source envelope drives both LOD transforms.',
  lightSimplification:{ratio:lightRatio,error:lightError,lockBorder:false},
  validationScope:'Binary readback and envelope checks; no claim of surveyed geometry, real-scene acceptance, browser/WebGL visual QA, or device performance measurement.',tiers:{}};
await fs.mkdir(output,{recursive:true});
for(const tier of ['light','detail']) {
  const document=await io.readBinary(bytes);document.setLogger(new Logger(Logger.Verbosity.WARN));
  for(const name of removeNames) {
    const nodes=document.getRoot().listNodes().filter(n=>n.getName()===name);
    if(!nodes.length)throw new Error(`Presentation node not found: ${name}`);
    for(const node of nodes)node.dispose();
  }
  await document.transform(prune());
  const before=stats(document);manifest.sourceBounds=before.bounds;manifest.sourceTriangles=before.triangles;
  for(const name of preserveAlphaNames) {
    const material=document.getRoot().listMaterials().find(m=>m.getName()===name);
    if(!material || material.getAlphaMode()!=='BLEND' || !(material.getBaseColorFactor()[3]>0 && material.getBaseColorFactor()[3]<1))throw new Error(`Reviewed alpha material missing or not translucent: ${name}`);
  }
  for(const material of document.getRoot().listMaterials()) {
    for(const extension of ['KHR_materials_transmission','KHR_materials_volume','KHR_materials_clearcoat']) {
      const value=material.getExtension(extension);if(value){material.setExtension(extension,null);value.dispose();}
    }
    const color=material.getBaseColorFactor();
    if(!preserveAlphaNames.includes(material.getName())) {
      material.setBaseColorFactor([color[0],color[1],color[2],1]);
      material.setAlphaMode('OPAQUE');
    }
    material.setRoughnessFactor(Math.max(material.getRoughnessFactor(), /glass|glaz/i.test(material.getName()) ? .48 : .62));
    material.setMetallicFactor(Math.min(material.getMetallicFactor(),.28));
  }
  if(tier==='light') {
    // Fine baked surface normals are invisible at city scale; keeping them
    // would lock every atlas seam and prevent simplification of tiny bevels.
    // Base-color textures and all architectural geometry remain the inputs.
    for(const material of document.getRoot().listMaterials()) material.setNormalTexture(null);
    for(const mesh of document.getRoot().listMeshes()) for(const primitive of mesh.listPrimitives()) {
      primitive.setAttribute('NORMAL',null);primitive.setAttribute('TANGENT',null);
      const m=primitive.getMaterial();
      const hasColorMap=m&&(m.getBaseColorTexture()||m.getMetallicRoughnessTexture()||m.getOcclusionTexture()||m.getEmissiveTexture());
      if(!hasColorMap) for(const name of primitive.listSemantics().filter(v=>v.startsWith('TEXCOORD')))primitive.setAttribute(name,null);
    }
  }
  await document.transform(dedup(),flatten(),join(),weld());
  if(tier==='light') await document.transform(simplify({simplifier:MeshoptSimplifier,ratio:lightRatio,error:lightError,lockBorder:false}),normals({overwrite:true}),weld());
  await document.transform(textureCompress({encoder:sharp,resize:[tier==='light'?512:1024,tier==='light'?512:1024],targetFormat:'webp',quality:tier==='light'?85:92}),prune(),
    meshopt({encoder:MeshoptEncoder,level:'medium',quantizePosition:16,quantizeNormal:12,quantizeTexcoord:16}));
  const result=await io.writeBinary(document);
  const readback=await io.readBinary(result);
  const info=stats(readback);
  // Compression may move boundaries slightly. Never silently accept a change
  // comparable to a storey or an omitted crown/wing.
  const height=before.bounds.max[1]-before.bounds.min[1];
  const envelopeError=Math.max(...['min','max'].flatMap(k=>info.bounds[k].map((v,i)=>Math.abs(v-before.bounds[k][i]))));
  if(envelopeError>height*.003)throw new Error(`${id}/${tier}: envelope changed by ${envelopeError}`);
  if(tier==='detail' && info.triangles!==before.triangles)throw new Error(`${id}/detail: source triangle count changed`);
  const gltf=JSON.parse(new TextDecoder().decode(result.slice(20,20+new DataView(result.buffer,result.byteOffset,result.byteLength).getUint32(12,true))));
  manifest.tiers[tier]={...info,bytes:result.byteLength,sha256:sha256(result),maxEnvelopeDelta:envelopeError,
    extensionsRequired:gltf.extensionsRequired||[],extensionsUsed:gltf.extensionsUsed||[]};
  await fs.writeFile(path.join(output,`${tier}.glb`),result);
  console.log(JSON.stringify({id,tier,bytes:result.byteLength,triangles:info.triangles,primitives:info.primitives,envelopeError}));
}
await fs.writeFile(path.join(output,'web-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
