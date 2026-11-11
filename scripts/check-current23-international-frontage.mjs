import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { AUTHORED_MODELS, prepareAuthoredModel } from '../src/scene/authoredModels.js';
import { resolveAuthoredPlacement, planAuthoredGround } from '../src/scene/authoredPlacement.js';
import { planStreetDetails, createStreetDetails } from '../src/scene/streetDetails.js';

// Independent renderer-buffer, source-triangle, endpoint and obstacle checks.
// This script does not modify source models or claim browser/GPU/device timing.
const json = file => JSON.parse(fs.readFileSync(new URL('../'+file, import.meta.url), 'utf8'));
const data = json('public/data/city.json');

const models = AUTHORED_MODELS.map(spec=>resolveAuthoredPlacement(spec,data.meta)).filter(Boolean);
const model = models.find(spec=>spec.id==='yichang-international-s01');
const ground = planAuthoredGround(models,data,3.8);
const units = data.meta.unitsPerMeter;
const pairs = ring=>ring.map((p,i)=>[p,ring[(i+1)%ring.length]]);
const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
function pointSegment(p,a,b){const dx=b[0]-a[0],dz=b[1]-a[1],l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/l)):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz);}
function inside(p,ring){let count=0;for(const[a,b]of pairs(ring)){if(pointSegment(p,a,b)<1e-10)return true;const side=cross(a,b,p);if(a[1]<=p[1]&&b[1]>p[1]&&side>0)count++;if(a[1]>p[1]&&b[1]<=p[1]&&side<0)count--;}return count!==0;}
const inWater=(x,z)=>data.water.some(w=>inside([x,z],w.rings[0])&&!w.rings.slice(1).some(h=>inside([x,z],h)));
function heightAt(x,z){
  if(inWater(x,z))return 0;
  const terrain=data.terrain;
  if(!terrain?.cols||!terrain?.rows){const radius=Math.max(data.meta.width,data.meta.depth)*.065;return data.landmarks.filter(l=>/磨基山|白马山|东山/.test(l.name||'')).reduce((sum,l)=>sum+(/磨基山/.test(l.name)?4.8:2.4)*Math.exp(-((x-l.x)**2+(z-l.z)**2)/(radius**2*.55)),0);}
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const fx=clamp((x/(terrain.width||data.meta.width)+.5)*(terrain.cols-1),0,terrain.cols-1.001),fz=clamp((z/(terrain.depth||data.meta.depth)+.5)*(terrain.rows-1),0,terrain.rows-1.001);
  const ix=Math.floor(fx),iz=Math.floor(fz),tx=fx-ix,tz=fz-iz;
  const a=Number(terrain.heights[iz*terrain.cols+ix])||0,b=Number(terrain.heights[iz*terrain.cols+ix+1])||0,c=Number(terrain.heights[(iz+1)*terrain.cols+ix])||0,d=Number(terrain.heights[(iz+1)*terrain.cols+ix+1])||0;
  return clamp((a+(b-a)*tx)*(1-tz)+(c+(d-c)*tx)*tz,0,Math.max(data.meta.width,data.meta.depth)*.12);
}
const input={data,authoredModels:models,authoredGround:ground,waterfrontPlan:{omittedBuildingIndices:new Set()},inWater,heightAt};
const makeMaterial=(day,night,options={})=>new THREE.MeshStandardMaterial({color:day,...options});
function geometryHash(group){const meshes=[];group.traverse(o=>{if(!o.isMesh)return;meshes.push({name:o.name,index:o.geometry.index?Array.from(o.geometry.index.array):null,attributes:Object.fromEntries(Object.entries(o.geometry.attributes).map(([key,a])=>[key,Array.from(a.array)])),instances:o.instanceMatrix?Array.from(o.instanceMatrix.array):null});});return hash(meshes);}
function dispose(group){const gs=new Set(),ms=new Set(),ts=new Set();group.traverse(o=>{if(o.geometry)gs.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){ms.add(m);for(const v of Object.values(m))if(v?.isTexture)ts.add(v);}});gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());ts.forEach(t=>t.dispose());}
function geometryOnlyBytes(bytes){
  assert.equal(bytes.toString('ascii',0,4),'glTF');assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length);
  const length=bytes.readUInt32LE(12),document=JSON.parse(bytes.subarray(20,20+length));
  const strip=o=>{if(!o||typeof o!=='object')return;for(const key of Object.keys(o)){if(/Texture$/.test(key))delete o[key];else strip(o[key]);}};
  (document.materials||[]).forEach(strip);
  const encoded=Buffer.from(JSON.stringify(document)),padded=Buffer.alloc(Math.ceil(encoded.length/4)*4,0x20);encoded.copy(padded);
  const tail=bytes.subarray(20+length),out=Buffer.alloc(20+padded.length+tail.length);out.write('glTF',0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(padded.length,12);out.writeUInt32LE(0x4E4F534A,16);padded.copy(out,20);tail.copy(out,20+padded.length);
  return out.buffer.slice(out.byteOffset,out.byteOffset+out.byteLength);
}
function clip3(points,planes){let polygon=points;for(const side of planes){const output=[];for(let i=0;i<polygon.length;i++){const p=polygon[i],q=polygon[(i+1)%polygon.length],a=side(p),b=side(q);if(a>=0)output.push(p);if((a>=0)!==(b>=0))output.push(p.clone().lerp(q,a/(a-b)));}polygon=output;if(!polygon.length)break;}return polygon;}
function area3(points){let total=0;for(let i=1;i<points.length-1;i++)total+=points[i].clone().sub(points[0]).cross(points[i+1].clone().sub(points[0])).length()/2;return total;}
function signedArea(ring){return ring.slice(1,-1).reduce((sum,p,i)=>sum+cross(ring[0],p,ring[i+2]),0)/2;}
function prismPlanes(ring,yMin=-Infinity,yMax=Infinity){const sign=Math.sign(signedArea(ring));return [...pairs(ring).map(([a,b])=>p=>sign*cross(a,b,[p.x,p.z])),p=>p.y-yMin,p=>yMax-p.y];}
function convexArea(a,b){const points=clip3(a.map(([x,z])=>new THREE.Vector3(x,0,z)),prismPlanes(b));return area3(points);}
const modelBase=heightAt(model.x,model.z)+.065;
const sourceOrigin=new THREE.Vector3((model.sourceBounds.min[0]+model.sourceBounds.max[0])/2,model.sourceBounds.min[1],(model.sourceBounds.min[2]+model.sourceBounds.max[2])/2);
const toNative=p=>new THREE.Vector3(...p).sub(new THREE.Vector3(model.x,modelBase,model.z)).applyAxisAngle(new THREE.Vector3(0,1,0),-model.yaw).divideScalar(model.uniformScale).add(sourceOrigin);
const toWorld=p=>new THREE.Vector3(...p).sub(sourceOrigin).multiplyScalar(model.uniformScale).applyAxisAngle(new THREE.Vector3(0,1,0),model.yaw).add(new THREE.Vector3(model.x,modelBase,model.z));
async function readAsset(tier,maximumY){
  const file=new URL(`../public${model.assets[tier].split("?")[0]}`,import.meta.url),bytes=fs.readFileSync(file);
  const raw=(await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(geometryOnlyBytes(bytes),'' )).scene;
  raw.updateMatrixWorld(true);
  const sourceBounds=new THREE.Box3().setFromObject(raw),triangles=[];let triangleCount=0;
  raw.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const positions=mesh.geometry.attributes.position,indices=mesh.geometry.index,count=indices?.count||positions.count;
    for(let i=0;i<count;i+=3){
      const points=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(positions,indices?indices.getX(i+j):i+j).applyMatrix4(mesh.matrixWorld));
      triangleCount++;
      if(points.every(p=>p.y>maximumY))continue;
      triangles.push({points,material:mesh.material.name,node:mesh.name,index:i/3,bounds:{minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minZ:Math.min(...points.map(p=>p.z)),maxZ:Math.max(...points.map(p=>p.z))}});
    }
  });
  // Independently verify the frozen origin and one uniform scalar used by the
  // actual model preparation; no alternate footprint-centre normalization.
  const prepared=prepareAuthoredModel(raw,model);prepared.rotation.y=model.yaw;prepared.position.set(model.x,modelBase,model.z);prepared.updateMatrixWorld(true);
  const worldBounds=new THREE.Box3().setFromObject(prepared);
  assert(Math.abs(worldBounds.min.y-(modelBase+(sourceBounds.min.y-model.sourceBounds.min[1])*model.uniformScale))<1e-7);
  dispose(prepared);
  return {tier,sha256:hash(bytes),sourceBounds:{min:sourceBounds.min.toArray(),max:sourceBounds.max.toArray()},triangleCount,triangles};
}

const floatWorldTolerance=2e-6; // One Float32 ULP near this site's world Z, rounded up.
const floatNativeTolerance=floatWorldTolerance/model.uniformScale;
function triangleBounds(points){return {minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minZ:Math.min(...points.map(p=>p.z)),maxZ:Math.max(...points.map(p=>p.z))};}
function boundsOverlap(a,b,pad=0){return a.minX<=b.maxX+pad&&b.minX<=a.maxX+pad&&a.minZ<=b.maxZ+pad&&b.minZ<=a.maxZ+pad;}
function inConvex(point,ring,tolerance=0){const sign=Math.sign(signedArea(ring));return pairs(ring).every(([a,b])=>sign*cross(a,b,point)>=-tolerance*Math.hypot(b[0]-a[0],b[1]-a[1]));}
function emittedPaving(site,group){
  const triangles=[],covered=site.paving.map(()=>0),normals=[];
  const sharedHeights=new Map();
  group.updateMatrixWorld(true);
  for(const name of ['forecourt, entrance path and sidewalk','street paving insets']){
    const mesh=group.getObjectByName(name);if(!mesh)continue;
    const position=mesh.geometry.attributes.position,normal=mesh.geometry.attributes.normal,index=mesh.geometry.index;
    assert.equal(position.count,normal.count);
    const vertex=i=>new THREE.Vector3().fromBufferAttribute(position,index?index.getX(i):i).applyMatrix4(mesh.matrixWorld);
    for(let i=0;i<(index?.count||position.count);i+=3){
      const world=[0,1,2].map(j=>vertex(i+j)),ring=world.map(p=>[p.x,p.z]);
      const center=ring.reduce((p,q)=>[p[0]+q[0]/3,p[1]+q[1]/3],[0,0]);
      const area=-signedArea(ring);assert(area>1e-13,'Every actual new paving triangle has positive upward XZ area');
      const owner=site.paving.findIndex(cell=>(cell.role==='accent')===(name==='street paving insets')&&inConvex(center,cell.points,2e-7)&&ring.every(p=>inConvex(p,cell.points,floatWorldTolerance)));
      assert(owner>=0,'A rendered triangle must fit entirely within one accepted polygon');
      const cell=site.paving[owner];covered[owner]+=area;
      for(const p of world){
        const expected=cell.surface?cell.surface(p.x,p.z):heightAt(p.x,p.z)+site.groundLift(p.x,p.z);
        assert(Math.abs(p.y-expected)<floatWorldTolerance,'Actual triangle vertices follow their recorded surface');
        const key=`${p.x},${p.z}`;
        if(sharedHeights.has(key))assert.equal(sharedHeights.get(key),p.y,'All actual shared-edge vertices have exactly equal Float32 heights');
        else sharedHeights.set(key,p.y);
      }
      const worldNormal=world[1].clone().sub(world[0]).cross(world[2].clone().sub(world[0])).normalize();
      for(let j=0;j<3;j++){
        const declared=new THREE.Vector3().fromBufferAttribute(normal,index?index.getX(i+j):i+j).transformDirection(mesh.matrixWorld);
        assert(declared.dot(worldNormal)>.995,'Declared normals agree with actual paving planes, including all route-boundary vertices');
      }
      const points=world.map(p=>toNative(p.toArray())),face=points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
      assert(face.y>0);normals.push(face.normalize());
      triangles.push({points,world,ring,cellIndex:owner,bounds:triangleBounds(points)});
    }
  }
  let maximumAreaError=0;
  for(let i=0;i<site.paving.length;i++){
    const cell=site.paving[i],area=Math.abs(signedArea(cell.points)),perimeter=pairs(cell.points).reduce((sum,[a,b])=>sum+Math.hypot(b[0]-a[0],b[1]-a[1]),0);
    const error=Math.abs(covered[i]-area);assert(covered[i]>0,'Every accepted paving polygon is actually rendered');
    assert(error<perimeter*floatWorldTolerance+1e-10,'No accepted paving area is lost or duplicated in triangulation');maximumAreaError=Math.max(maximumAreaError,error);
  }
  return {triangles,maximumAreaError,maximumRenderedSlope:Math.max(...normals.map(n=>Math.hypot(n.x,n.z)/n.y))};
}

// The source triangle is clipped to a *vertical 3D prism*. In particular a
// vertical side wall has nonzero 3D area here, even though its XZ area is zero.
// A plane is affine, so extrema over the complete clipped domain occur at its
// vertices. Testing those vertices proves the full triangle-domain clearance.
function clippedPlaneDistances(surface,source){
  const ring=surface.points.map(p=>[p.x,p.z]);
  const polygon=clip3(source.points,prismPlanes(ring));
  if(!polygon.length)return null;
  const normal=surface.points[1].clone().sub(surface.points[0]).cross(surface.points[2].clone().sub(surface.points[0]));
  const vertical=polygon.map(p=>normal.dot(p.clone().sub(surface.points[0]))/normal.y);
  const normalLength=normal.length();
  return {polygon,area:area3(polygon),verticalMin:Math.min(...vertical),verticalMax:Math.max(...vertical),planeMin:Math.min(...vertical)*normal.y/normalLength};
}

// A vertical wall has zero XZ area: the oracle must still report its crossing.
const oracleSurface={points:[[0,0,0],[0,0,2],[2,0,0]].map(p=>new THREE.Vector3(...p))};
const oracleWall={points:[[.5,-1,.5],[.5,1,.5],[1.5,1,.5]].map(p=>new THREE.Vector3(...p))};
const wallHit=clippedPlaneDistances(oracleSurface,oracleWall);
assert(wallHit.area>0&&wallHit.verticalMin<0&&wallHit.verticalMax>0);
const plan=planStreetDetails(input),site=plan.sites.find(s=>s.id===model.id);
assert(site,'Current23 International frontage is restored');
assert.equal(site.connectionEvidence.method,'current23-existing-apron-edge-to-same-side-source-road');
assert.equal(site.entranceRoute.length,0,'Do not invent a surveyed entrance');
const render=createStreetDetails(plan,{heightAt,makeMaterial});
const emitted=emittedPaving(site,render.group.getObjectByName(model.id));
const reports=[];
for(const tier of ['light','detail']){
 const asset=await readAsset(tier,1.5);
 assert.equal(asset.sha256,json('src/data/current23-models.json')['1649145'].webBudget[tier].sha256);
 let intersections=0,minGap=Infinity,checked=0;
 for(const surface of emitted.triangles)for(const source of asset.triangles){
   if(!boundsOverlap(surface.bounds,source.bounds))continue;
   const hit=clippedPlaneDistances(surface,source);
   if(!hit||hit.area<1e-8)continue;
   // Trim the departure shared edge: exact edge contact is intended, not an interior overlap.
   const interior=clip3(hit.polygon,prismPlanes(surface.points.map(p=>[p.x,p.z])));
   if(!interior.length)continue;
   checked++;
   if(source.material==='Light stone paving')assert(hit.polygon.every(p=>p.z<=site.connectionEvidence.passage.joinedSourceEdge[0][2]+floatNativeTolerance),'Existing solid apron may touch only the departure seam, never the new path interior');
   else assert(hit.verticalMin>floatNativeTolerance,'Any retained decoration must remain strictly above the added paving, not buried below it');
   if(hit.verticalMin < -floatNativeTolerance && hit.verticalMax > floatNativeTolerance)intersections++;
   if(hit.verticalMin>=-floatNativeTolerance)minGap=Math.min(minGap,hit.verticalMin);
 }
 assert.equal(intersections,0,`${tier}: no source triangles cross rendered paving interiors`);
 const front=site.connectionEvidence.passage.joinedSourceEdge[0][2],top=site.connectionEvidence.passage.topSourceY;
 const strip=[[32.9,front-.05],[33.9,front-.05],[33.9,front],[32.9,front]];
 let covered=0;
 for(const source of asset.triangles){
  if(source.material!=='Light stone paving'||!source.points.every(p=>Math.abs(p.y-top)<1e-8))continue;
  covered+=area3(clip3(source.points,prismPlanes(strip)));
 }
 assert(Math.abs(covered-.05)<1e-7,`${tier}: complete 1-unit-wide departure edge has existing solid top support`);
 const first=site.paving.find(p=>p.sourceClearanceZone==='source-ramp');
 for(const x of [32.9,33.4,33.9]){
  const world=toWorld([x,top,front]);
  assert(Math.abs(first.surface(world.x,world.z)-world.y)<1e-10,'actual source-normalized and terrain-lifted edge joins continuously');
 }
 reports.push({tier,sha256:asset.sha256,triangles:asset.triangleCount,checked,intersections,minimumNonnegativeGap:minGap,departureSupportArea:covered});
}
// Changed identity must not silently reuse this geometry exception.
const changed={...input,authoredModels:models.map(m=>m.id===model.id?{...m,sourceModelSha256:'unreviewed'}:m)};
assert(!planStreetDetails(changed).sites.some(s=>s.id===model.id));
for(const change of [{assets:{...model.assets,light:'/unreviewed.glb'}},{sourceBounds:{...model.sourceBounds,min:[-999,...model.sourceBounds.min.slice(1)]}}]){
 const mutated={...input,authoredModels:models.map(m=>m.id===model.id?{...m,...change}:m)};
 assert(!planStreetDetails(mutated).sites.some(s=>s.id===model.id),'Changed asset identity or source frame fails closed');
}
dispose(render.group);
console.log(JSON.stringify({scope:'Actual decoded current23 LODs + emitted Float32 renderer geometry; no GPU/field/accessibility certification',pavingCells:site.paving.length,renderedTriangles:emitted.triangles.length,maximumRenderedSlope:emitted.maximumRenderedSlope,reports},null,2));
