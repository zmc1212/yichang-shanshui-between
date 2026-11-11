import fs from 'node:fs';
import assert from 'node:assert/strict';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {AUTHORED_MODELS,prepareAuthoredModel} from '../src/scene/authoredModels.js';
const alphaName='J_OBSERVED_front_arc_transparent_glass_ALPHA_REQUIRED';
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const results=[];
for(const order of [9,13,14,20])for(const tier of ['light','detail']){
 const spec=AUTHORED_MODELS.find(s=>s.order===order);
 const bytes=fs.readFileSync(new URL('../public'+spec.assets[tier].split('?')[0],import.meta.url));
 const object=(await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
 const materials=new Set();object.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);});
 if(order===9){
  const glass=[...materials].filter(m=>m.name===alphaName);assert.equal(glass.length,1);assert.equal(glass[0].transparent,true);assert.equal(glass[0].opacity,.25);
  prepareAuthoredModel(object,spec);
  assert.equal(glass[0].transparent,true);assert.equal(glass[0].opacity,.25);assert.equal(glass[0].depthWrite,false);
  object.traverse(o=>{if(o.isMesh&&o.material===glass[0])assert.equal(o.castShadow,false,'Transparent infill must not cast opaque slab shadows');});
  for(const m of materials)if(m.name!==alphaName){assert.equal(m.transparent,false);assert.equal(m.opacity,1);}
 }else{
  const added=[...materials].filter(m=>m.name.startsWith(order===14?'H_observed_':'I_'));assert(added.length>=([13,14].includes(order)?3:1),'Refinement materials survive both tiers');
  prepareAuthoredModel(object,spec);for(const m of materials){assert.equal(m.transparent,false);assert.equal(m.opacity,1);}
 }
 results.push({order,tier,materials:materials.size,reviewedAlpha:order===9?.25:null});
 object.traverse(o=>{o.geometry?.dispose();});materials.forEach(m=>m.dispose());
}
console.log(JSON.stringify({passed:true,scope:'Refined models and exact runtime alpha opt-in; no GPU/survey claim',results},null,2));
