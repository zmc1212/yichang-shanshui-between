import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {AUTHORED_MODELS} from '../src/scene/authoredModels.js';
import {resolveAuthoredPlacement,planAuthoredGround} from '../src/scene/authoredPlacement.js';
import {planStreetDetails,createStreetDetails} from '../src/scene/streetDetails.js';
import {planContinuousStreetSites} from '../src/scene/continuousStreetSites.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const data=JSON.parse(fs.readFileSync(path.join(root,'public/data/city.json'),'utf8'));
const models=AUTHORED_MODELS.map(m=>resolveAuthoredPlacement(m,data.meta)).filter(Boolean);
const ground=planAuthoredGround(models,data,3.8),units=data.meta.unitsPerMeter;
const pairs=r=>r.map((p,i)=>[p,r[(i+1)%r.length]]);
function pointDistance(p,a,b){const dx=b[0]-a[0],dz=b[1]-a[1],d=dx*dx+dz*dz,t=d?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/d)):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz);}
const turn=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function winding(p,ring){let n=0;for(const[a,b]of pairs(ring)){if(pointDistance(p,a,b)<1e-11)return true;const c=turn(a,b,p);if(a[1]<=p[1]&&b[1]>p[1]&&c>0)n++;if(a[1]>p[1]&&b[1]<=p[1]&&c<0)n--;}return n!==0;}
function edgeDistance(a,b,c,d){if(turn(a,b,c)*turn(a,b,d)<0&&turn(c,d,a)*turn(c,d,b)<0)return 0;return Math.min(pointDistance(a,c,d),pointDistance(b,c,d),pointDistance(c,a,b),pointDistance(d,a,b));}
function polygonDistance(a,b){if(a.some(p=>winding(p,b))||b.some(p=>winding(p,a)))return 0;let d=Infinity;for(const[p,q]of pairs(a))for(const[r,s]of pairs(b))d=Math.min(d,edgeDistance(p,q,r,s));return d;}
function intersectionArea(subject,clip){
  const signed=pairs(clip).reduce((n,[a,b])=>n+a[0]*b[1]-b[0]*a[1],0),sign=Math.sign(signed);let output=subject;
  for(const[a,b]of pairs(clip)){const input=output;output=[];for(const[p,q]of pairs(input)){const x=sign*turn(a,b,p),y=sign*turn(a,b,q),xp=x>=-1e-12,yp=y>=-1e-12;if(xp)output.push(p);if(xp!==yp){const t=x/(x-y);output.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}}}
  return Math.abs(pairs(output).reduce((n,[a,b])=>n+a[0]*b[1]-b[0]*a[1],0))/2;
}
const box=r=>({x0:Math.min(...r.map(p=>p[0])),x1:Math.max(...r.map(p=>p[0])),z0:Math.min(...r.map(p=>p[1])),z1:Math.max(...r.map(p=>p[1]))});
const near=(a,b,p=0)=>a.x0<=b.x1+p&&b.x0<=a.x1+p&&a.z0<=b.z1+p&&b.z0<=a.z1+p;
const inWater=(x,z)=>data.water.some(w=>winding([x,z],w.rings[0])&&!w.rings.slice(1).some(h=>winding([x,z],h)));
const heightAt=(x,z)=>.001*Math.sin(x*.04)*Math.cos(z*.08);
const input={data,authoredModels:models,authoredGround:ground,waterfrontPlan:{omittedBuildingIndices:new Set()},inWater,heightAt};
const baseline=planStreetDetails(input),sites=baseline.sites.filter(s=>s.kind!=='street-link');
const sourceSnapshot=JSON.stringify({data,models,sites});
const linkPlan=planContinuousStreetSites({...input,sites});
assert.equal(linkPlan.sites.length,1,linkPlan.reason);
const link=linkPlan.sites[0],evidence=link.connectionEvidence;
assert.equal(JSON.stringify({data,models,sites}),sourceSnapshot,'All source data and existing site plans stay unchanged');
assert.equal(link.kind,'street-link');assert.deepEqual(link.connectedSiteIds,['jiuzhou-s01','shouxin-wealth-s01']);
assert.equal(link.roadSourceId,'way/39725551');assert.equal(evidence.sourceSegmentIndex,9);
assert(Math.abs(evidence.lengthMetres-31.149130312317652)<1e-8);assert.equal(evidence.widthMetres,3.6);
assert.equal(link.paving.length,11);assert.equal(link.curbs.length,22);assert.equal(link.entranceRoute.length,0);
assert.equal(link.trees.length+link.lamps.length+link.benches.length,0);
const allRings=[...link.paving.map(p=>p.points),...link.curbs.map(c=>c.footprint)];
const obstacles=[...data.buildings.filter((_,i)=>!ground.omittedBuildingIndices.has(i)),...ground.retainedBuildings].map(b=>({ring:(b.rings||[b.ring])[0],kind:'source-building'}));
obstacles.push(...models.map(m=>({ring:m.footprint,kind:'authored-model'})),...data.water.map(w=>({ring:w.rings[0],kind:'water'})));
obstacles.forEach(o=>o.box=box(o.ring));
const roadSegments=data.roads.flatMap(r=>r.points.slice(1).map((b,i)=>({a:r.points[i],b,width:r.width,box:box([r.points[i],b])})));
let minRoadClearance=Infinity,minBuildingClearance=Infinity,minWaterClearance=Infinity;
for(const ring of allRings){
 const b=box(ring);assert(ring.every(p=>p.every(Number.isFinite)&&Math.abs(p[0])<data.meta.width/2&&Math.abs(p[1])<data.meta.depth/2));
 for(const o of obstacles){if(!near(b,o.box,2))continue;const d=polygonDistance(ring,o.ring);assert(d>.0038,`${o.kind} conflict`);if(o.kind==='water')minWaterClearance=Math.min(minWaterClearance,d);else minBuildingClearance=Math.min(minBuildingClearance,d);}
 for(const r of roadSegments){if(!near(b,r.box,r.width/2+.1))continue;let d=Infinity;for(const[a,c]of pairs(ring))d=Math.min(d,edgeDistance(a,c,r.a,r.b));assert(!winding(r.a,ring)&&!winding(r.b,ring));assert(d>r.width/2+.0038);minRoadClearance=Math.min(minRoadClearance,d-r.width/2);}
 for(const site of sites)for(const old of [...site.paving.map(p=>p.points),...site.curbs.map(c=>c.footprint),...['trees','lamps','benches'].flatMap(k=>site[k].map(f=>f.safetyFootprint))])if(near(b,box(old)))assert(intersectionArea(ring,old)<1e-9,'No duplicate surfaces, transverse curb, or furniture overlap');
}
for(let i=0;i<link.paving.length;i++)for(let j=i+1;j<link.paving.length;j++)assert(intersectionArea(link.paving[i].points,link.paving[j].points)<1e-9);
for(let i=1;i<link.paving.length;i++)assert.deepEqual([link.paving[i-1].points[1],link.paving[i-1].points[2]],[link.paving[i].points[0],link.paving[i].points[3]],'Each adjoining slab shares exact endpoints');
let maxHeightDifference=0,curbFloat32Joins=0;
for(const endpoint of [evidence.start,evidence.end]){
 const old=sites.find(s=>s.id===endpoint.siteId);
 for(const p of [endpoint.inner,endpoint.outer]){
   assert(old.paving.some(c=>c.points.some(q=>q[0]===p[0]&&q[1]===p[1])),'Original endpoint doubles reused');
   assert(link.paving.some(c=>c.points.some(q=>q[0]===p[0]&&q[1]===p[1])));
 }
 for(let i=0;i<=20;i++){
   const t=i/20,p=[endpoint.inner[0]+(endpoint.outer[0]-endpoint.inner[0])*t,endpoint.inner[1]+(endpoint.outer[1]-endpoint.inner[1])*t];
   const before=heightAt(...p)+old.groundLift(...p),after=heightAt(...p)+link.groundLift(...p);
   maxHeightDifference=Math.max(maxHeightDifference,Math.abs(after-before));assert(Math.abs(after-before)<1e-12);assert.equal(Math.fround(before),Math.fround(after));
 }
 for(const p of [endpoint.inner,endpoint.outer]){
   const oldCurbs=old.curbs.filter(c=>[c.a,c.b].some(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<1e-8));
   const newCurbs=link.curbs.filter(c=>[c.a,c.b].some(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<1e-8));
   for(const oc of oldCurbs)for(const nc of newCurbs)for(const op of oc.footprint)for(const np of nc.footprint){
     const a=op.map(Math.fround),b=np.map(Math.fround);if(a[0]!==b[0]||a[1]!==b[1])continue;
     assert.equal(Math.fround(heightAt(...a)+old.groundLift(...a)+.0035),Math.fround(heightAt(...b)+link.groundLift(...b)+.0035));curbFloat32Joins++;
   }
 }
}
assert.equal(curbFloat32Joins,8,'Both edges of all four curb ends join after Float32 conversion');
const mid=link.paving[5].points.reduce((a,p)=>[a[0]+p[0]/4,a[1]+p[1]/4],[0,0]);assert(linkPlan.reserveTree(...mid));
const reject=(change,message)=>assert.equal(planContinuousStreetSites({...input,sites,...change}).sites.length,0,message);
reject({sites:sites.filter(s=>s.id!=='jiuzhou-s01')},'Missing old sidewalk fails closed');
reject({sites:sites.map(s=>s.id==='shouxin-wealth-s01'?{...s,roadSourceId:'different'}:s)},'Different source-road ends fail closed');
for(const flags of [{bridge:'yes'},{layer:'1'},{tunnel:'yes'}])reject({data:{...data,roads:data.roads.map(r=>r.osmId===link.roadSourceId?{...r,...flags}:r)}},'Elevated or tunnel roads cannot become pedestrian infill');
reject({sites:sites.map(s=>s.id==='jiuzhou-s01'?{...s,curbs:[]}:s)},'No assumed curb connection');
reject({inWater:(x,z)=>inWater(x,z)||Math.hypot(x-mid[0],z-mid[1])<.03},'Interior water predicate blocks the complete link');
reject({authoredGround:{...ground,retainedBuildings:[...ground.retainedBuildings,{ring:link.paving[5].points}]}},'New source obstacle blocks whole link');
reject({data:{...data,roads:[...data.roads,{osmId:'synthetic-side-street',points:[[mid[0]-.1,mid[1]],[mid[0]+.1,mid[1]]],width:.06,kind:'residential'}]}},'A new side street blocks the whole link');
reject({data:{...data,roads:data.roads.map(r=>r.osmId===link.roadSourceId?{...r,points:r.points.flatMap((p,i)=>i===10?[[mid[0]-.12,mid[1]+.08],p]:[p])}:r)}},'A changed road bend cannot be silently bridged by a straight infill');
const detail=createStreetDetails({sites:[link],stats:linkPlan.stats},{heightAt,makeMaterial:(color,night,extra={})=>new THREE.MeshStandardMaterial({color,...extra})});
const pavingMesh=detail.group.children[0].children[0].children.find(o=>o.name==='forecourt, entrance path and sidewalk');
const positions=pavingMesh.geometry.attributes.position;
const renderedTriangles=[];
for(let i=0;i<positions.count;i+=3)renderedTriangles.push([0,1,2].map(j=>[positions.getX(i+j),positions.getZ(i+j)]));
for(let i=0;i<renderedTriangles.length;i++)for(let j=i+1;j<renderedTriangles.length;j++)assert(intersectionArea(renderedTriangles[i],renderedTriangles[j])<1e-9,'Actual Float32 pavement triangles have zero overlapping area');
let float32EndpointVertices=0;
for(const endpoint of [evidence.start,evidence.end])for(const point of [endpoint.inner,endpoint.outer]){
 const old=sites.find(s=>s.id===endpoint.siteId),expected=[Math.fround(point[0]),Math.fround(heightAt(...point)+old.groundLift(...point)),Math.fround(point[1])];
 for(let i=0;i<positions.count;i++)if(positions.getX(i)===expected[0]&&positions.getY(i)===expected[1]&&positions.getZ(i)===expected[2])float32EndpointVertices++;
}
assert.equal(float32EndpointVertices,6,'Both ends emit exactly the old X/Y/Z boundary coordinates after Float32 conversion');
detail.update({pixelsPerUnit:2,frustum:null});assert.equal(detail.getStats().streetVisibleDrawCalls,0);
detail.update({pixelsPerUnit:60,frustum:null});assert.equal(detail.getStats().streetVisibleDrawCalls,2);assert.equal(detail.update({pixelsPerUnit:60,frustum:null}),false);
detail.update({pixelsPerUnit:60,frustum:null,enabled:false});assert.equal(detail.getStats().streetVisibleDrawCalls,0);
const stats=detail.stats;const geometries=new Set(),materials=new Set(),textures=new Set();detail.group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of(Array.isArray(o.material)?o.material:o.material?[o.material]:[])){materials.add(m);for(const value of Object.values(m))if(value?.isTexture)textures.add(value);}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
console.log(JSON.stringify({passed:true,sourceCommit:'2c2c35ab161ac95ba66662b723e959c2edf491b4',method:'Local geometry, source-state, Float32 join, failure-mode and render-resource checks; not a browser or physical-device benchmark',evidence,geometry:{pavingCells:link.paving.length,curbSegments:link.curbs.length,completeCheckedFootprints:allRings.length,minimumRoadEdgeClearanceMetres:minRoadClearance/units,minimumNearbyBuildingClearanceMetres:minBuildingClearance/units,minimumNearbyWaterClearanceMetres:Number.isFinite(minWaterClearance)?minWaterClearance/units:null,maxEndpointHeightDifference:maxHeightDifference,curbFloat32JoinedCorners:curbFloat32Joins,pavingFloat32EndpointVertices:float32EndpointVertices,renderedPavingTriangles:renderedTriangles.length,renderedPavingSelfOverlapPairs:0},resources:stats,existingSitesUnchanged:true,existingSiteHashes:Object.fromEntries(sites.map(s=>[s.id,createHash('sha256').update(JSON.stringify(s)).digest('hex')])),failureCases:10},null,2));
