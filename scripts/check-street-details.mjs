import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { AUTHORED_MODELS } from '../src/scene/authoredModels.js';
import { resolveAuthoredPlacement, planAuthoredGround } from '../src/scene/authoredPlacement.js';
import { planStreetDetails, createStreetDetails, streetDetailTier } from '../src/scene/streetDetails.js';

// Geometric/data/lifecycle checks only. Actual browser pixels and real-device
// performance remain separate acceptance checks.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const data=JSON.parse(fs.readFileSync(path.join(root,'public/data/city.json'),'utf8'));
const models=AUTHORED_MODELS.map(spec=>resolveAuthoredPlacement(spec,data.meta)).filter(Boolean);
const ground=planAuthoredGround(models,data,3.8),snapshot=JSON.stringify({data,models});
const passed=[];
const pairs=ring=>ring.map((p,i)=>[p,ring[(i+1)%ring.length]]);
function pointDistance(p,a,b){const dx=b[0]-a[0],dz=b[1]-a[1],d=dx*dx+dz*dz;const t=d?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/d)):0;return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t);}
function winding(p,ring){let count=0;for(const[a,b]of pairs(ring)){if(pointDistance(p,a,b)<1e-10)return true;const sign=(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);if(a[1]<=p[1]&&b[1]>p[1]&&sign>0)count++;if(a[1]>p[1]&&b[1]<=p[1]&&sign<0)count--;}return count!==0;}
const orientation=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function edgeDistance(a,b,c,d){if(orientation(a,b,c)*orientation(a,b,d)<0&&orientation(c,d,a)*orientation(c,d,b)<0)return 0;return Math.min(pointDistance(a,c,d),pointDistance(b,c,d),pointDistance(c,a,b),pointDistance(d,a,b));}
function boundaryDistance(a,b){let result=Infinity;for(const[p,q]of pairs(a))for(const[r,s]of pairs(b))result=Math.min(result,edgeDistance(p,q,r,s));return result;}
function polygonDistance(a,b){if(a.some(p=>winding(p,b))||b.some(p=>winding(p,a)))return 0;return boundaryDistance(a,b);}
function convexIntersectionArea(subject,clip){
  const signed=pairs(clip).reduce((sum,[a,b])=>sum+a[0]*b[1]-b[0]*a[1],0),sign=Math.sign(signed);
  let result=subject.map(p=>[...p]);
  for(const[a,b]of pairs(clip)){
    const input=result;result=[];if(!input.length)break;
    for(let i=0;i<input.length;i++){
      const p=input[i],q=input[(i+1)%input.length],dp=sign*orientation(a,b,p),dq=sign*orientation(a,b,q),pi=dp>=-1e-12,qi=dq>=-1e-12;
      if(pi)result.push(p);
      if(pi!==qi){const t=dp/(dp-dq);result.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}
    }
  }
  return Math.abs(pairs(result).reduce((sum,[a,b])=>sum+a[0]*b[1]-b[0]*a[1],0))/2;
}
const inWater=(x,z)=>data.water.some(p=>winding([x,z],p.rings[0])&&!p.rings.slice(1).some(h=>winding([x,z],h)));
const heightAt=(x,z)=>0.001*Math.sin(x*.04)*Math.cos(z*.08);
const plan=planStreetDetails({data,authoredModels:models,authoredGround:ground,waterfrontPlan:{omittedBuildingIndices:new Set()},inWater,heightAt});
assert.equal(plan.sites.length,1);const site=plan.sites[0],shouxin=models.find(m=>m.id==='shouxin-wealth-s01');
assert.equal(site.id,shouxin.id);assert.deepEqual(site.sourceAnchor,[shouxin.x,shouxin.z]);assert.equal(site.frontBearingDeg,shouxin.registration.frontBearingDeg);
assert.equal(site.roadName,'沿江大道');assert(site.roadSourceId);assert.equal(site.roadWidth,.192);assert(site.illustrative);
assert(site.paving.length>50&&site.paving.length<200);assert(site.trees.length>=4&&site.trees.length<=10);assert(site.lamps.length>=2&&site.lamps.length<=5);assert.equal(site.benches.length,2);
assert.equal(plan.stats.streetMarkings,0);assert.equal(plan.stats.streetEntranceConnected,true);
passed.push('One bounded Shouxin sample derives its fixed anchor, front and road identity from the retained data');

const buildings=[...data.buildings.filter((_,i)=>!ground.omittedBuildingIndices.has(i)),...ground.retainedBuildings].map(b=>b.rings||[b.ring]);
const hardFootprints=[...buildings.map(rings=>rings[0]),...models.map(m=>m.footprint)];
const candidates=[...site.paving.map(p=>({ring:p.points,kind:'paving'})),...site.curbs.map(c=>({ring:c.footprint,kind:'curb'})),...['trees','lamps','benches'].flatMap(kind=>site[kind].map(item=>({ring:item.safetyFootprint,kind})))];
const roadSegments=data.roads.flatMap(road=>road.points.slice(1).map((b,i)=>({a:road.points[i],b,width:road.width})));
for(const candidate of candidates){
  const ring=candidate.ring;
  assert(ring.every(p=>p.every(Number.isFinite)),`${candidate.kind}: finite footprint`);
  assert(ring.every(p=>Math.abs(p[0])<data.meta.width/2&&Math.abs(p[1])<data.meta.depth/2),`${candidate.kind}: board boundary`);
  for(const obstacle of hardFootprints)assert(polygonDistance(ring,obstacle)>.0038,`${candidate.kind} overlaps a retained or authored building`);
  for(const water of data.water){const [outer,...holes]=water.rings;if(holes.some(h=>ring.every(p=>winding(p,h))))continue;assert(polygonDistance(ring,outer)>.0038,`${candidate.kind} enters mapped water`);}
  for(const road of roadSegments){
    let clearance=Infinity;for(const[a,b]of pairs(ring))clearance=Math.min(clearance,edgeDistance(a,b,road.a,road.b));
    assert(!winding(road.a,ring)&&!winding(road.b,ring)&&clearance>road.width/2+.0038,`${candidate.kind} occupies a carriageway, including a side-street opening`);
  }
}
passed.push(`${candidates.length} complete paving, curb and furnishing footprints clear every mapped road, retained building and water polygon`);
for(let i=0;i<site.paving.length;i++)for(let j=i+1;j<site.paving.length;j++)assert(convexIntersectionArea(site.paving[i].points,site.paving[j].points)<1e-9,`Coplanar paving cells ${i} and ${j} overlap`);
passed.push('Every pair of paving cells has zero overlapping area, including inset colors and entrance connections');

const connection=site.paving.filter(p=>p.role==='connection');assert(connection.length>=3);
assert(connection[0].points.some(p=>site.paving.filter(c=>c.role==='forecourt'||c.role==='accent').some(c=>pairs(c.points).some(([a,b])=>pointDistance(p,a,b)<1e-7))));
assert(connection.at(-1).points.some(p=>site.paving.filter(c=>c.role==='sidewalk'||c.role==='accent').some(c=>pairs(c.points).some(([a,b])=>pointDistance(p,a,b)<1e-6))));
for(let i=1;i<connection.length;i++)assert(boundaryDistance(connection[i-1].points,connection[i].points)<1e-9);
const a=site.entranceRoute[0],b=site.entranceRoute[1];
assert(site.groundLift(a[0],a[1])<site.groundLift(b[0],b[1]));
const nearModel=site.paving.flatMap(p=>p.points).sort((a,b)=>Math.min(...pairs(shouxin.footprint).map(([p,q])=>pointDistance(a,p,q)))-Math.min(...pairs(shouxin.footprint).map(([p,q])=>pointDistance(b,p,q))))[0];
assert(site.groundLift(...nearModel)<.06,'Forecourt at model threshold remains below the building base');
for(const item of [...site.trees,...site.lamps,...site.benches])assert(pointDistance([item.x,item.z],...site.entranceRoute)>.07,'Furniture keeps entrance path clear');
assert.equal(plan.reserveTree((a[0]+b[0])/2,(a[1]+b[1])/2),true);assert.equal(plan.reserveTree(0,0),false);
passed.push('The continuous entrance route meets both forecourt and sidewalk; ground lift stays below the doorway and rises towards the road');

assert.equal(JSON.stringify({data,models}),snapshot,'Street planning cannot mutate source coordinates, model scale, yaw, roads, or buildings');
passed.push('All source data and architectural transforms remain byte-for-byte unchanged in memory');

const materials=[];
const render=createStreetDetails(plan,{heightAt,makeMaterial:(day,night,options={})=>{const m=new THREE.MeshStandardMaterial({color:day,...options});materials.push(m);return m;}});
render.group.traverse(object=>{if(!object.isMesh)return;assert.equal(object.castShadow,false);for(const a of Object.values(object.geometry.attributes))assert([...a.array].every(Number.isFinite),'No NaN render geometry');if(object.isInstancedMesh)assert([...object.instanceMatrix.array].every(Number.isFinite),'Finite instance transforms');if(/forecourt|insets|sidewalk edges/.test(object.name)){const p=object.geometry.attributes.position,n=object.geometry.attributes.normal;for(let i=0;i<p.count;i+=3){const a=new THREE.Vector3().fromBufferAttribute(p,i),b=new THREE.Vector3().fromBufferAttribute(p,i+1),c=new THREE.Vector3().fromBufferAttribute(p,i+2);assert(b.sub(a).cross(c.sub(a)).y>0,'Paving triangles always face up');assert(n.getY(i)>0,'Paving normals always face up');}}});
const stats=render.getStats();assert(stats.streetMeshes<=16);assert(stats.streetTriangles<3000);assert(stats.streetGeometryBytes<70000);
assert.equal(render.group.getObjectByName('street tree crowns').count,site.trees.length);assert.equal(render.group.getObjectByName('street lamps').count,site.lamps.length);
assert.equal(render.group.getObjectByName('street bench seats').count,site.benches.length);
passed.push(`${stats.streetMeshes} meshes, ${stats.streetTriangles} triangles and ${stats.streetGeometryBytes} geometry/instance bytes; all repeated furnishings use instances`);
const pools=render.group.getObjectByName('street lamp pools');
assert(!pools.isInstancedMesh,'Slope-fitted light pools share one merged world-space mesh');
const poolPositions=pools.geometry.attributes.position,poolIndices=pools.geometry.index;
for(let i=0;i<poolPositions.count;i++){
  const x=poolPositions.getX(i),z=poolPositions.getZ(i),lift=poolPositions.getY(i)-heightAt(x,z)-site.groundLift(x,z);
  assert(Math.abs(lift-.0008)<1e-6,'Each pool vertex follows the pavement surface with the same small clearance');
}
for(let i=0;i<poolIndices.count;i+=3){
  const points=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(poolPositions,poolIndices.getX(i+j)));
  for(const weights of [[1/3,1/3,1/3],[.5,.5,0],[.5,0,.5],[0,.5,.5]]){
    const point=points.reduce((p,v,j)=>p.addScaledVector(v,weights[j]),new THREE.Vector3());
    const lift=point.y-heightAt(point.x,point.z)-site.groundLift(point.x,point.z);
    assert(lift>0&&lift<.0012,'Pool triangle interiors remain close above the curved paving without clipping or hovering');
  }
}
passed.push('One merged night-pool mesh follows the slope at every vertex; triangle centres and edge midpoints stay just above the paving');

assert.equal(streetDetailTier(2.1,0),0);assert.equal(streetDetailTier(2.2,0),1);assert.equal(streetDetailTier(1.6,1),1);assert.equal(streetDetailTier(1.4,1),0);
assert.equal(streetDetailTier(9,1),2);assert.equal(streetDetailTier(7,2),2);assert.equal(streetDetailTier(6.4,2),1);
const visibleFrustum={intersectsBox:()=>true},invisibleFrustum={intersectsBox:()=>false};
render.update({pixelsPerUnit:2,frustum:visibleFrustum});assert.equal(render.getStats().streetVisibleDrawCalls,0);
render.update({pixelsPerUnit:15,frustum:visibleFrustum});assert.equal(render.getStats().streetVisibleTier,1);assert.equal(render.getStats().streetVisibleDrawCalls,3);
render.update({pixelsPerUnit:60,frustum:visibleFrustum});assert.equal(render.getStats().streetVisibleTier,2);
render.update({pixelsPerUnit:38,frustum:visibleFrustum});assert.equal(render.getStats().streetVisibleTier,2);
render.update({pixelsPerUnit:60,frustum:visibleFrustum,enabled:false});assert.equal(render.getStats().streetVisibleDrawCalls,0);
render.update({pixelsPerUnit:60,frustum:invisibleFrustum});assert.equal(render.getStats().streetVisibleDrawCalls,0);
render.update({pixelsPerUnit:60,frustum:visibleFrustum,treesEnabled:false});assert.equal(render.group.getObjectByName('street tree crowns').parent.visible,false);
render.setTheme(true);assert.equal(render.group.getObjectByName('street lamp pools').parent.visible,true);assert(render.group.getObjectByName('street warm lamp heads').material.emissiveIntensity>0);
render.setTheme(false);assert.equal(render.group.getObjectByName('street lamp pools').parent.visible,false);
render.update({pixelsPerUnit:60,frustum:visibleFrustum});assert.equal(render.update({pixelsPerUnit:60,frustum:visibleFrustum}),false,'Stable scale does not ask for animation frames');
passed.push('Pixel-based LOD has hysteresis, off-screen/toggle suppression, tree-layer handling and day/night light state without a continuous loop');

const report={checkedAt:'2026-11-10',scope:'geometric-data-resource-lifecycle-only',street:site.id,sourceRoad:site.roadSourceId,sourceAnchor:site.sourceAnchor,stats:render.stats,passed};
console.log(JSON.stringify(report,null,2));
const geometries=new Set(),usedMaterials=new Set();render.group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)usedMaterials.add(o.material);});geometries.forEach(g=>g.dispose());usedMaterials.forEach(m=>m.dispose());
