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
const baseline = json('docs/iterations/20261110-international-baseline.json');
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
const flatInput={...input,inWater:()=>false,heightAt:()=>0},flatPlan=planStreetDetails(flatInput),flatRender=createStreetDetails(flatPlan,{heightAt:flatInput.heightAt,makeMaterial});
for(const record of baseline.groups){const site=[...flatPlan.sites,...flatPlan.links].find(s=>s.id===record.id);assert(site);assert.equal(hash(site),record.planSha256,`${record.id}: complete V53 plan unchanged`);assert.equal(geometryHash(flatRender.group.getObjectByName(record.id)),record.renderedGeometrySha256,`${record.id}: actual V53 geometry/UV/instance buffers unchanged`);}
dispose(flatRender.group);

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
  const file=new URL(`../public/models/yichang-international-s01/${tier}.glb`,import.meta.url),bytes=fs.readFileSync(file);
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
if(process.argv.includes('--inspect-source')){
  const report=[];
  for(const tier of ['light','detail']){
    const asset=await readAsset(tier,1.01);
    const top=asset.triangles.filter(t=>t.material==='Light stone paving'&&t.points[1].clone().sub(t.points[0]).cross(t.points[2].clone().sub(t.points[0])).normalize().y>.99);
    report.push({tier,sha256:asset.sha256,triangleCount:asset.triangleCount,lowTriangles:asset.triangles.length,lightStoneTopTriangles:top.map(t=>t.points.map(p=>p.toArray()))});
  }
  console.log(JSON.stringify(report,null,2));process.exit(0);
}

const sourceAudit=json('docs/iterations/20261110-international-ground-audit.json');
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
// A vertical wall has zero projected area, but must still be detected if it
// crosses a path. This guards the dimensionality of the independent oracle.
const oracleSurface={points:[[0,0,0],[0,0,2],[2,0,0]].map(p=>new THREE.Vector3(...p))};
const oracleWall={points:[[.5,-1,.5],[.5,1,.5],[1.5,1,.5]].map(p=>new THREE.Vector3(...p))};
const oracleWallResult=clippedPlaneDistances(oracleSurface,oracleWall);
assert(oracleWallResult.area>0&&oracleWallResult.verticalMin<0&&oracleWallResult.verticalMax>0);
const oracleAbove=clippedPlaneDistances(oracleSurface,{points:oracleSurface.points.map(p=>p.clone().add(new THREE.Vector3(0,.1,0)))});
assert(Math.abs(oracleAbove.verticalMin-.1)<1e-12&&Math.abs(oracleAbove.verticalMax-.1)<1e-12);

async function validateSourceTriangles(emitted){
  const results=[];
  const maximumY=Math.max(1.01,...emitted.triangles.flatMap(t=>t.points.map(p=>p.y)))+.001;
  for(const tier of ['light','detail']){
    const asset=await readAsset(tier,maximumY),evidence=sourceAudit.tiers[tier];
    assert.equal(asset.sha256,evidence.sha256,'A source asset change invalidates frozen triangle evidence');
    const annuli=evidence.frontDecorativeAnnuli,ringIndices=new Set(annuli.triangleIndices);
    const sourceRings=asset.triangles.filter(t=>t.material===annuli.material&&ringIndices.has(t.index));
    assert.equal(sourceRings.length,annuli.triangles,'Frozen ring indices refer to the exact decoded material primitive');
    assert(sourceRings.every(t=>t.points.every(p=>p.y<0&&p.y>=annuli.lowestY-1e-9&&p.y<=annuli.highestY+1e-9)),'The exception describes only the preserved low decorative annuli');
    const expectedPassage=evidence.passageGround.exactEastPassageTopCornersXYZ;
    const passageTriangles=asset.triangles.filter(t=>t.material===evidence.passageGround.material&&evidence.passageGround.topTriangleIndices.includes(t.index));
    assert.equal(passageTriangles.length,2);
    const expectedCorners=new Set(expectedPassage.map(p=>p.map(v=>v.toFixed(8)).join(',')));
    assert(passageTriangles.flatMap(t=>t.points).every(p=>expectedCorners.has(p.toArray().map(v=>v.toFixed(8)).join(','))),'Independent GLTFLoader reproduces the exact original passage rectangle');
    const passageFront=expectedPassage[2][2],passageTop=expectedPassage[2][1];
    const ringHits=new Set(),boundaryHits=new Set();let minimumVertical=Infinity,minimumPlane=Infinity,minimumRingSourceY=Infinity,clipPairs=0,maxBoundaryRoundoff=0;
    for(const surface of emitted.triangles){
      for(const source of asset.triangles){
        if(!boundsOverlap(surface.bounds,source.bounds))continue;
        const clipped=clippedPlaneDistances(surface,source);if(!clipped||clipped.area<1e-13)continue;
        clipPairs++;
        const {polygon}=clipped;
        // Shared source-threshold edge only. Float32 world rounding can move
        // that edge by up to one local ULP; this is not a corridor exemption.
        const thresholdContact=source.material===evidence.passageGround.material&&[1,2,4,5].includes(source.index)&&polygon.every(p=>Math.abs(p.z-passageFront)<=floatNativeTolerance&&p.x>=32.9-floatNativeTolerance&&p.x<=33.9+floatNativeTolerance);
        if(thresholdContact){
          assert(surface.points.every(p=>p.z>=passageFront-floatNativeTolerance));
          assert(clipped.verticalMax<=floatNativeTolerance,'The original threshold may meet the new edge, never protrude through an extended ramp');
          maxBoundaryRoundoff=Math.max(maxBoundaryRoundoff,...polygon.map(p=>Math.abs(p.z-passageFront)));
          boundaryHits.add(source.index);continue;
        }
        assert.equal(source.material,annuli.material,`${tier}: new paving intersects non-decorative source geometry ${source.material} / ${source.index}`);
        assert(ringIndices.has(source.index),`${tier}: material grouping alone cannot grant a native-geometry exception`);
        assert(polygon.every(p=>p.x>=32.9-floatNativeTolerance&&p.x<=36.8+floatNativeTolerance&&p.z>=25.35-floatNativeTolerance&&p.z<=30.1+floatNativeTolerance),'Only the independently certified narrow underlay rectangle can overlap retained rings');
        assert(clipped.verticalMin>.02,'Every point of a retained ring must clear the actual underlay by a positive geometric margin');
        ringHits.add(source.index);minimumVertical=Math.min(minimumVertical,clipped.verticalMin);minimumPlane=Math.min(minimumPlane,clipped.planeMin);minimumRingSourceY=Math.min(minimumRingSourceY,...polygon.map(p=>p.y));
      }
    }
    assert(ringHits.size>0,'The check must exercise the actual ring-underlay layering');
    const start=toWorld([32.9,passageTop,passageFront]),end=toWorld([33.9,passageTop,passageFront]);
    const joinVertices=emitted.triangles.flatMap(t=>t.world).filter(p=>pointSegment([p.x,p.z],[start.x,start.z],[end.x,end.z])<=floatWorldTolerance);
    assert(joinVertices.length>=2,'The rendered ramp contains both source threshold endpoints');
    let thresholdHeightError=0,thresholdHorizontalError=0,thresholdEndpointError=0;
    for(const p of joinVertices){thresholdHeightError=Math.max(thresholdHeightError,Math.abs(p.y-start.y));assert(Math.abs(p.y-start.y)<floatWorldTolerance);}
    for(const p of joinVertices)thresholdHorizontalError=Math.max(thresholdHorizontalError,pointSegment([p.x,p.z],[start.x,start.z],[end.x,end.z]));
    for(const endpoint of [start,end]){const error=Math.min(...joinVertices.map(p=>p.distanceTo(endpoint)));assert(error<floatWorldTolerance*1.5,'The complete source-edge width reaches the emitted ramp, including both ends');thresholdEndpointError=Math.max(thresholdEndpointError,error);}
    results.push({tier,sha256:asset.sha256,totalSourceTriangles:asset.triangleCount,checkedSourceTriangles:asset.triangles.length,checkedSourceMaximumY:maximumY,actualNewTriangles:emitted.triangles.length,clippedPairs:clipPairs,retainedRingTriangles:sourceRings.length,underlayRingTriangles:ringHits.size,boundaryContactTriangles:[...boundaryHits].sort((a,b)=>a-b),minimumRingSourceY,minimumVerticalClearanceSource:minimumVertical,minimumPlaneClearanceDisplayMetres:minimumPlane*model.uniformScale/units,minimumVerticalClearanceDisplayMetres:minimumVertical*model.uniformScale/units,thresholdHeightErrorWorld:thresholdHeightError,thresholdHorizontalErrorWorld:thresholdHorizontalError,thresholdEndpointErrorWorld:thresholdEndpointError,maximumThresholdBoundaryRoundoffWorld:maxBoundaryRoundoff*model.uniformScale,nonRingInteriorConflicts:0});
  }
  return results;
}

function lineCoverage(a,b,polygons,label){
  const intervals=[];
  for(const ring of polygons){
    const sign=Math.sign(signedArea(ring));let lo=0,hi=1;
    for(const [p,q] of pairs(ring)){
      const first=sign*cross(p,q,a),last=sign*cross(p,q,b),delta=last-first;
      if(Math.abs(delta)<1e-14){if(first<-1e-11){lo=1;hi=0;break;}continue;}
      if(delta>0)lo=Math.max(lo,-first/delta);else hi=Math.min(hi,-first/delta);
    }
    if(hi>=lo-1e-9)intervals.push([Math.max(0,lo),Math.min(1,hi)]);
  }
  intervals.sort((p,q)=>p[0]-q[0]);let end=0;
  for(const [lo,hi]of intervals){if(hi<0||lo>1)continue;assert(lo<=end+1e-7,`${label}: shared width has an uncovered interval`);end=Math.max(end,hi);}
  assert(end>=1-1e-7,`${label}: the complete intended join width is covered`);
}

const snapshot=JSON.stringify({data,models});
const plan=planStreetDetails(input),site=plan.sites.find(s=>s.id===model.id);
assert(site,'The original Site includes the new bounded international frontage');
assert.equal(plan.sites.length,7);assert.equal(plan.links.length,1);
assert.equal(plan.stats.streetEntrancesConnected,6);assert.equal(plan.stats.streetFrontageConnections,1);
assert.equal(site.kind,'street-frontage');assert.deepEqual(site.entranceRoute,[]);
assert(site.frontageRoute.length>2);assert.equal(site.illustrative,true);
const evidence=site.connectionEvidence;
assert.equal(evidence.method,'retained-passage-edge-to-same-side-source-road');
assert.equal(evidence.surveyed,false);assert.equal(evidence.accessibilityRoute,false);
assert.equal(evidence.retainedInlayUnderlay.retainedGeometryChanged,false);
assert.equal(evidence.retainedInlayUnderlay.filledCircleAssumed,false);
assert.equal(evidence.retainedInlayUnderlay.sourceY,-.13);
assert.equal(site.trees.length,0,'The sample does not invent extra trees within native geometry');
assert.equal(site.lamps.length,2);assert.equal(site.benches.length,2);
const summary=plan.stats.streetSiteSummaries.find(s=>s.id===site.id);
assert.equal(summary.entranceConnected,false);assert.equal(summary.frontageConnected,true);
assert.deepEqual(evidence.sourceFrame.bounds,model.sourceBounds);
assert.equal(evidence.sourceFrame.uniformScale,model.uniformScale);assert.equal(evidence.sourceFrame.yaw,model.yaw);
assert.deepEqual(evidence.sourceFrame.originWorld,[model.x,modelBase,model.z]);

// Reconstruct the full design footprint from the fixed native exit and the
// actual source-road line. Accepted cells are deliberately not the oracle.
const road=data.roads.find(r=>r.osmId==='way/1543968654');
assert.equal(site.roadSourceId,road.osmId);assert.equal(site.roadWidth,.192);
assert(!road.bridge||road.bridge==='no');assert(!road.tunnel||road.tunnel==='no');assert.equal(Number(road.layer||0),0);
const direction=new THREE.Vector2(road.points[1][0]-road.points[0][0],road.points[1][1]-road.points[0][1]).normalize();
let roadNormal=new THREE.Vector2(-direction.y,direction.x);
if(roadNormal.dot(new THREE.Vector2(model.x-road.points[0][0],model.z-road.points[0][1]))<0)roadNormal.negate();
const outerOffset=road.width/2+.014+3.6*units;
const outer=road.points.slice(0,2).map(p=>toNative([p[0]+roadNormal.x*outerOffset,modelBase,p[1]+roadNormal.y*outerOffset]));
const nativeOuter=x=>[x,outer[0].z+(outer[1].z-outer[0].z)*(x-outer[0].x)/(outer[1].x-outer[0].x)];
const worldXZ=p=>{const w=toWorld([p[0],0,p[1]]);return [w.x,w.z];};
const nativeInner=x=>{const p=worldXZ(nativeOuter(x));const n=toNative([p[0]-roadNormal.x*3.6*units,modelBase,p[1]-roadNormal.y*3.6*units]);return [n.x,n.z];};
const passageFront=sourceAudit.tiers.detail.passageGround.exactEastPassageTopCornersXYZ[2][2];
const intended=[
  {name:'passage-departure-ramp',ring:[[32.9,passageFront],[33.9,passageFront],[33.9,25.35],[32.9,25.35]]},
  {name:'inlay-underlay-taper',ring:[[32.9,25.35],[33.9,25.35],[36.8,27.7],[32.9,27.7]]},
  {name:'inlay-underlay-exit',ring:[[32.9,27.7],[36.8,27.7],[36.8,30.1],[32.9,30.1]]},
  {name:'outer-low-turn',ring:[[32.9,30.1],[36.8,30.1],[36.8,31.5],[32.9,31.5]]},
  {name:'outer-rise',ring:[[36.8,30.1],[60,30.1],[60,31.5],[36.8,31.5]]},
  {name:'outer-high-turn',ring:[[60,30.1],[61.4,30.1],[61.4,31.5],[60,31.5]]},
  {name:'sidewalk-approach',ring:[[60,31.5],[61.4,31.5],nativeOuter(61.4),nativeOuter(60)]},
  {name:'roadside-sidewalk',ring:[nativeInner(22),nativeInner(62.4),nativeOuter(62.4),nativeOuter(22)]},
].map(region=>({...region,world:region.ring.map(worldXZ)}));
assert.equal(evidence.intendedRegions.length,intended.length);
const coverage=[];
for(const region of intended){
  const recorded=evidence.intendedRegions.find(r=>r.name===region.name);
  assert(recorded);assert.equal(recorded.nativePolygon.length,region.ring.length);
  for(let i=0;i<region.ring.length;i++)assert(Math.hypot(...region.ring[i].map((v,j)=>v-recorded.nativePolygon[i][j]))<1e-9,'Recorded design regions match the independently reconstructed source/road frame');
  const area=Math.abs(signedArea(region.world));
  const covered=site.paving.reduce((sum,cell)=>sum+convexArea(cell.points,region.world),0);
  assert(Math.abs(area-covered)<1e-10,`${region.name}: full design area survives obstacle checking with no silent clipping hole`);
  coverage.push({region:region.name,displayAreaSquareMetres:area/units**2,acceptedAreaErrorWorld:Math.abs(area-covered)});
}
for(const cell of site.paving){
  const area=Math.abs(signedArea(cell.points)),covered=intended.reduce((sum,r)=>sum+convexArea(cell.points,r.world),0);
  assert(Math.abs(area-covered)<1e-10,'No paving extends beyond the complete reviewed design');
  if(cell.clearedModelId){
    assert.equal(cell.clearedModelId,model.id);assert.equal(cell.role,'connection');
    const zone=cell.sourceClearanceZone==='source-ramp'?intended[0].ring:cell.sourceClearanceZone==='retained-inlay-underlay'?evidence.retainedInlayUnderlay.nativePolygon:null;
    assert(zone,'Only two named source-space clearance zones exist');
    assert(cell.points.every(p=>{const n=toNative([p[0],modelBase,p[1]]);return inConvex([n.x,n.z],zone,1e-9);}),'A source exception must remain entirely inside its exact certified zone');
  }
}
const joins=[
  [0,1,[[32.9,25.35],[33.9,25.35]]],
  [1,2,[[32.9,27.7],[36.8,27.7]]],
  [2,3,[[32.9,30.1],[36.8,30.1]]],
  [3,4,[[36.8,30.1],[36.8,31.5]]],
  [4,5,[[60,30.1],[60,31.5]]],
  [5,6,[[60,31.5],[61.4,31.5]]],
  [6,7,[nativeOuter(60),nativeOuter(61.4)]],
];
for(const [from,to,edge]of joins){
  const world=edge.map(worldXZ);
  for(const index of [from,to])lineCoverage(...world,site.paving.filter(cell=>convexArea(cell.points,intended[index].world)>1e-12).map(cell=>cell.points),`${intended[index].name} join`);
}
for(let i=1;i<site.frontageRoute.length;i++)lineCoverage(site.frontageRoute[i-1],site.frontageRoute[i],site.paving.map(c=>c.points),'Complete frontage-route centreline');
const rendered=createStreetDetails(plan,{heightAt,makeMaterial}),group=rendered.group.getObjectByName(site.id);
const emitted=emittedPaving(site,group);
assert(emitted.maximumRenderedSlope<.101,'No short steep discontinuity is hidden in the emitted display paving');
for(const [from,to,edge]of joins){
  const sides=[from,to].map(index=>emitted.triangles.filter(t=>convexArea(site.paving[t.cellIndex].points,intended[index].world)>1e-12).flatMap(t=>t.world));
  for(const endpoint of edge.map(worldXZ)){
    const candidates=sides.map(side=>side.filter(p=>Math.hypot(p.x-endpoint[0],p.z-endpoint[1])<floatWorldTolerance));
    assert(candidates.every(list=>list.length),'Both adjoining regions actually emit each end of the complete shared edge');
    assert(candidates[0].some(a=>candidates[1].some(b=>a.equals(b))),'Every new route join shares the exact same Float32 XYZ edge endpoints');
  }
}
const sourceChecks=await validateSourceTriangles(emitted);

// Fail closed on a source change, elevated source road, a new building in the
// corridor, or mapped water. A missing section may not leave a nominally joined
// site behind. The unrelated six building samples retain their own rules.
const withoutNew=options=>!planStreetDetails(options).sites.some(s=>s.id===model.id);
assert(withoutNew({...input,authoredModels:models.map(m=>m.id===model.id?{...m,sourceModelSha256:'unreviewed'}:m)}));
assert(withoutNew({...input,authoredModels:models.filter(m=>m.id!==model.id)}));
for(const change of [{bridge:'yes'},{tunnel:'yes'},{layer:'1'}])assert(withoutNew({...input,data:{...data,roads:data.roads.map(r=>r.osmId===road.osmId?{...r,...change}:r)}}));
const blocker=[[33.1,24.2],[33.7,24.2],[33.7,24.7],[33.1,24.7]].map(worldXZ);
assert(withoutNew({...input,data:{...data,buildings:[...data.buildings,{rings:[blocker],height:10}]}}),'A new retained building rejects the entire source corridor');
assert(withoutNew({...input,inWater:(x,z)=>inside([x,z],blocker)||inWater(x,z)}),'A water conflict rejects the entire source corridor');
assert.equal(JSON.stringify({data,models}),snapshot,'Audit, planning and rendering do not mutate source inputs');

const allVisible={intersectsBox:()=>true},visibleCounts=[];
for(const scale of [2,15,20,60,80]){
  rendered.update({pixelsPerUnit:scale,frustum:allVisible});
  const stats=rendered.getStats();let newDraws=0;if(group.visible)group.traverseVisible(o=>{if(o.isMesh)newDraws++;});
  if(scale===2)assert.equal(stats.streetVisibleDrawCalls,0,'The new sample adds no overview draw calls');
  visibleCounts.push({pixelsPerUnit:scale,totalDraws:stats.streetVisibleDrawCalls,newFrontageDraws:newDraws});
}
assert.equal(visibleCounts.at(-1).newFrontageDraws,7);
rendered.setTheme(true);const nightStats=rendered.getStats();assert.equal(nightStats.streetVisibleDrawCalls,visibleCounts.at(-1).totalDraws+7);
rendered.setTheme(false);assert.equal(rendered.getStats().streetVisibleDrawCalls,visibleCounts.at(-1).totalDraws);
for(const update of [{pixelsPerUnit:80,frustum:allVisible,enabled:false},{pixelsPerUnit:80,frustum:{intersectsBox:()=>false}},{pixelsPerUnit:2,frustum:allVisible}]){rendered.update(update);assert.equal(rendered.getStats().streetVisibleDrawCalls,0);}
const resources=rendered.stats;
const resourceKeys=['streetSites','streetPavingCells','streetCurbSegments','streetTrees','streetLamps','streetBenches','streetMeshes','streetTriangles','streetGeometryBytes','streetTextureCount','streetTextureSourceBytes'];
const resourceDelta=Object.fromEntries(resourceKeys.map(key=>[key,resources[key]-baseline.resources[key]]));
assert(resourceDelta.streetMeshes<=8&&resourceDelta.streetTriangles<700&&resourceDelta.streetGeometryBytes<45000,'The bounded sample has an explicit incremental geometry budget');
assert.equal(resourceDelta.streetTextureCount,0);assert.equal(resourceDelta.streetTextureSourceBytes,0);
assert.equal(resourceDelta.streetTrees,0);assert.equal(resourceDelta.streetLamps,2);assert.equal(resourceDelta.streetBenches,2);
const report={checkedAt:'2026-11-10',scope:'independent Three GLTFLoader / exact native triangle evidence / actual Float32 geometry; no browser, GPU or phone timing',baseline:{version:baseline.base,commit:baseline.commit,unchangedCompletePlansAndBuffers:baseline.groups.map(g=>g.id)},site:site.id,claims:{illustrative:true,surveyedEntrance:false,accessibilityCertification:false,displayDimensionsOnly:true},sourceChecks,coverage,joins:{fullWidthJoins:joins.length,sourceJoinWidthDisplayMetres:model.uniformScale/units,maximumRenderedSlope:emitted.maximumRenderedSlope,sourceDepartureSlope:evidence.sourceRamp.grade,outerSlope:evidence.externalRamp.grade,outerRunDisplayMetres:evidence.externalRamp.lengthDisplayMetres,floatWorldTolerance,maximumTriangulationAreaErrorWorld:emitted.maximumAreaError},resources,resourceDelta,visibleCounts,nearNightDraws:nightStats.streetVisibleDrawCalls,failClosedCases:7};
console.log(JSON.stringify(report,null,2));
dispose(rendered.group);
