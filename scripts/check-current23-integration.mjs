import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Box3,Group,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {BUSINESS_BUILDINGS,AUTHORED_MODELS} from '../src/scene/buildingCatalog.js';
import {resolveAuthoredPlacement,planAuthoredGround,SHOUXIN_REGISTRATION} from '../src/scene/authoredPlacement.js';
import {prepareAuthoredModel} from '../src/scene/authoredModels.js';

// Static source/geometry integration audit, not browser or survey acceptance.
// Optional source inputs permit independently re-hashing the original deliveries:
// --source-root /path/Yichang_Current23_IntegratedAssets_20261111
// --xingfa-source /path/XingfaPlaza_I_ForecourtStairs.glb
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const option=k=>process.argv.includes(k)?process.argv[process.argv.indexOf(k)+1]:null;
const sourceRoot=option('--source-root'),xingfaSource=option('--xingfa-source');
const registry=read('src/data/business-registry.json');
const previous=read('src/data/business-registrations.json');
const selected=read('src/data/current23-models.json');
const city=read('public/data/city.json');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const results=[];
assert.equal(BUSINESS_BUILDINGS.length,23);
assert.equal(AUTHORED_MODELS.length,23);
assert.equal(new Set(BUSINESS_BUILDINGS.map(x=>x.id)).size,23);
assert.deepEqual(BUSINESS_BUILDINGS.map(x=>x.sourceSceneId),registry.rows.map(x=>x.sourceSceneId));
const resolved=BUSINESS_BUILDINGS.map(x=>resolveAuthoredPlacement(x,city.meta));
const approx=resolved.filter(x=>x.registration.approximate);
const established=resolved.filter(x=>!x.registration.approximate);
assert.equal(approx.length,16);assert.equal(established.length,7);
for(const spec of established){
  const expected=spec.sourceSceneId==='1649136'?SHOUXIN_REGISTRATION:previous[spec.sourceSceneId];
  assert(expected,`Unexpected existing registration ${spec.sourceSceneId}`);
  assert.deepEqual(spec.registration,expected,`${spec.name} existing registration preserved`);
}
const newPlan=planAuthoredGround(resolved,city,2),oldPlan=planAuthoredGround(established,city,2);
assert.deepEqual([...newPlan.omittedBuildingIndices].sort(),[...oldPlan.omittedBuildingIndices].sort(), 'Approximate models may not delete extra GIS buildings');
assert.deepEqual(newPlan.retainedBuildings,oldPlan.retainedBuildings);
assert.equal(planAuthoredGround(approx,city,2).omittedBuildingIndices.size,0);
// Synthetic overlap proves protection even if today's marker falls off a polygon.
const synthetic={buildings:[{ring:[[0,0],[2,0],[2,2],[0,2]]}]};
const unsafe={registration:{},footprint:[[.5,.5],[1.5,.5],[1.5,1.5],[.5,1.5]]};
assert.equal(planAuthoredGround([unsafe],synthetic,2).omittedBuildingIndices.size,1);
assert.equal(planAuthoredGround([{...unsafe,registration:{suppressBackgroundReplacement:true}}],synthetic,2).omittedBuildingIndices.size,0);
const seenAssets=new Set();
await MeshoptDecoder.ready;
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
function geometryOnlyBytes(bytes){
  assert.equal(bytes.toString('ascii',0,4),'glTF');assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length);
  const len=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+len).toString());
  assert(!(doc.buffers||[]).some(x=>x.uri),'No external buffers');
  assert(!(doc.images||[]).some(x=>x.uri&&!x.uri.startsWith('data:')),'No external images');
  const strip=v=>{if(!v||typeof v!=='object')return;for(const k of Object.keys(v)){if(/Texture$/.test(k))delete v[k];else strip(v[k]);}};
  (doc.materials||[]).forEach(strip);
  const encoded=Buffer.from(JSON.stringify(doc)),padding=Buffer.alloc(Math.ceil(encoded.length/4)*4,0x20);encoded.copy(padding);
  const tail=bytes.subarray(20+len),out=Buffer.alloc(20+padding.length+tail.length);
  out.write('glTF');out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(padding.length,12);out.writeUInt32LE(0x4e4f534a,16);padding.copy(out,20);tail.copy(out,20+padding.length);
  return out.buffer.slice(out.byteOffset,out.byteOffset+out.byteLength);
}
function dispose(object){const g=new Set(),m=new Set();object.traverse(x=>{if(x.geometry)g.add(x.geometry);for(const v of Array.isArray(x.material)?x.material:x.material?[x.material]:[])m.add(v)});g.forEach(x=>x.dispose());m.forEach(x=>x.dispose());object.clear();}
for(const spec of resolved){
  assert.equal(spec.kind,'authored');assert.equal(spec.placement,'city');assert.equal(spec.previewOnly,false);
  assert(spec.assets.light&&spec.assets.detail);assert(spec.uniformScale>0&&Number.isFinite(spec.uniformScale));
  assert([spec.x,spec.z,spec.yaw,spec.displayHeight].every(Number.isFinite));
  assert(spec.caveat&&spec.coverage.missing);
  if(spec.registration.approximate){
    assert(spec.registration.suppressBackgroundReplacement);
    assert.equal(spec.registration.yawRadians,0);
    assert.match(spec.registration.orientationMethod,/illustrative/);
    assert.match(spec.registration.scaleMethod,/not-survey/);
    const row=registry.rows.find(x=>x.sourceSceneId===spec.sourceSceneId);
    assert.deepEqual(spec.registration.modelOriginLonLat,row.convertedMarkerWgs84);
    assert(spec.displayHeight<=100*city.meta.unitsPerMeter+1e-8);
  }
  const map=selected[spec.sourceSceneId];
  assert.equal(spec.sourceModelSha256,map.sourceModelSha256);
  let sourceVerified=false;
  const sourceFile=spec.order===9?xingfaSource:sourceRoot&&path.join(sourceRoot,map.sourceSelectionFile);
  if(sourceFile){assert.equal(sha(fs.readFileSync(sourceFile)),map.sourceModelSha256,`${spec.name} original selected source hash`);sourceVerified=true;}
  const sourceCenter=spec.sourceBounds.min.map((v,i)=>(v+spec.sourceBounds.max[i])/2);
  const commonReference=JSON.stringify(spec.sourceBounds);
  const perTier=[];
  for(const tier of ['light','detail']){
    const asset=spec.assets[tier].split('?')[0];assert(!seenAssets.has(asset));seenAssets.add(asset);
    assert.match(asset,new RegExp(`^/models/current23/${String(spec.order).padStart(2,'0')}/${tier}\\.glb$`));
    const file=path.join(root,'public',asset),bytes=fs.readFileSync(file);
    assert.equal(sha(bytes),map.webBudget[tier].sha256,`${spec.name} ${tier} web asset hash`);
    const manifestFile=path.join(path.dirname(file),'web-manifest.json');
    if(fs.existsSync(manifestFile)){
      const manifest=JSON.parse(fs.readFileSync(manifestFile));
      assert.deepEqual(manifest.sourceBounds,spec.sourceBounds,`${spec.name} common source frame`);
      assert.equal(manifest.tiers[tier].sha256,sha(bytes));
      if(spec.order===7)assert.match(manifest.sourcePolicy,/source native unchanged/);
      else assert.equal(manifest.nativeChanged,false);
    }
    const object=(await loader.parseAsync(geometryOnlyBytes(bytes),'')).scene;object.updateMatrixWorld(true);
    const samples=[];let meshes=0;
    object.traverse(mesh=>{
      if(!mesh.isMesh)return;meshes++;
      const p=mesh.geometry.getAttribute('position');assert(p&&p.count>0);
      for(const n of p.array)assert(Number.isFinite(n));
      const index=mesh.geometry.getIndex();if(index)for(const n of index.array)assert(n>=0&&n<p.count);
      for(const i of new Set([0,Math.floor(p.count/2),p.count-1]))samples.push({mesh,i,world:new Vector3().fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld)});
    });assert(meshes>0);
    const rawBounds=new Box3().setFromObject(object);assert(!rawBounds.isEmpty());
    const prepared=prepareAuthoredModel(object,spec),base=.137,anchor=new Group();
    anchor.position.set(spec.x,base,spec.z);anchor.rotation.y=spec.yaw;anchor.add(prepared);anchor.updateMatrixWorld(true);
    assert.equal(JSON.stringify(spec.sourceBounds),commonReference,'Preparation must not alter common frame');
    assert.deepEqual(prepared.scale.toArray(),[spec.uniformScale,spec.uniformScale,spec.uniformScale]);
    let maxError=0;
    for(const sample of samples){
      const p=sample.world,c=Math.cos(spec.yaw),s=Math.sin(spec.yaw),x=(p.x-sourceCenter[0])*spec.uniformScale,z=(p.z-sourceCenter[2])*spec.uniformScale;
      const expected=new Vector3(spec.x+x*c+z*s,base+(p.y-spec.sourceBounds.min[1])*spec.uniformScale,spec.z-x*s+z*c);
      const actual=new Vector3().fromBufferAttribute(sample.mesh.geometry.getAttribute('position'),sample.i).applyMatrix4(sample.mesh.matrixWorld);
      const error=actual.distanceTo(expected);assert(error<1e-7);maxError=Math.max(maxError,error);
      assert.equal(sample.mesh.userData.landmarkId,spec.id);
    }
    const worldBounds=new Box3().setFromObject(anchor);assert([...worldBounds.min,...worldBounds.max].every(Number.isFinite));
    perTier.push({tier,bytes:bytes.length,meshes,samples:samples.length,maxTransformError:maxError});dispose(anchor);
  }
  results.push({order:spec.order,id:spec.id,sourceVerified,approximate:Boolean(spec.registration.approximate),tiers:perTier});
}
assert.equal(seenAssets.size,46);
const result={passed:true,projects:23,webAssets:46,establishedRegistrations:7,approximateRegistrations:16,
  sourceBytesVerified:results.every(x=>x.sourceVerified),webAssetHashesVerified:true,allGeometryDecoded:true,backgroundRemovalUnchanged:true,
  alternativesPlaced:false,webglVerified:false,surveyVerified:false,devicePerformanceVerified:false,results};
console.log(JSON.stringify(result,null,2));
