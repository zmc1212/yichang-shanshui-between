import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { resolveBuildingInspection } from '../src/scene/buildingInspection.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { AUTHORED_MODELS, prepareAuthoredModel } from '../src/scene/authoredModels.js';
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
const input={data,authoredModels:models,authoredGround:ground,waterfrontPlan:{omittedBuildingIndices:new Set()},inWater,heightAt};
const plan=planStreetDetails(input);
const expectedIds=['shouxin-wealth-s01','wanda-soho-s01','jiuzhou-s01','jinjiang-s03','fujiang-s01','zhongnan-s09'];
assert.deepEqual(plan.sites.map(s=>s.id),expectedIds);
assert.equal(plan.stats.streetSites,6);assert.equal(plan.stats.streetMarkings,0);assert.equal(plan.stats.streetEntranceConnected,true);assert.equal(plan.stats.streetEntrancesConnected,6);
assert.equal(plan.stats.streetLinks,1);assert.deepEqual(plan.links.map(link=>link.id),['jiuzhou-shouxin-walk']);
const allStreetGroups=[...plan.sites,...plan.links];
const shouxin=plan.sites[0];
const flatPlan=planStreetDetails({...input,inWater:()=>false,heightAt:()=>0});
// Captured independently from V51 before the street-corner work. Preserve
// complete prior cells, curbs, furniture and source metadata, not only counts.
// Shouxin's hash is unchanged since the original frozen V40 geometry.
const previousPlans = new Map([
  ['shouxin-wealth-s01','142350a232df3b5a0fce57c111045a24821cdf88ec6e15df1f16856297c34fea'],
  ['wanda-soho-s01','2a6d6f1a12ac79a5ec4bf51f76514efbb3f0d92daaf4fed7e2de0589a7a24d18'],
  ['jiuzhou-s01','2f0e91ce7f1d417479427a9aa84058a3b8b9640dd0e90b7841a646ac77aef688'],
  ['jinjiang-s03','ea7bb79483eb06a23c4a9bfca86bdb40d2f0c3a40f3fe5994552ef7c4d5e2a08'],
  ['fujiang-s01','8bb1bd0ec18d5a49d2fa14ad1963e6b3f003de46b9cde2cf8664f273669f340b'],
]);
for(const [id,hash] of previousPlans){
  const site=flatPlan.sites.find(candidate=>candidate.id===id);assert(site,`${id}: retained street site exists`);
  assert.equal(createHash('sha256').update(JSON.stringify(site)).digest('hex'),hash,`${id}: complete V51 plan remains unchanged`);
}
passed.push('All five prior street plans match their independently captured V51 SHA-256 snapshots, including the unchanged V40 Shouxin geometry');

const box=ring=>({x0:Math.min(...ring.map(p=>p[0])),x1:Math.max(...ring.map(p=>p[0])),z0:Math.min(...ring.map(p=>p[1])),z1:Math.max(...ring.map(p=>p[1]))});
const near=(a,b,pad=0)=>a.x0<=b.x1+pad&&b.x0<=a.x1+pad&&a.z0<=b.z1+pad&&b.z0<=a.z1+pad;
const buildings=[...data.buildings.filter((_,i)=>!ground.omittedBuildingIndices.has(i)),...ground.retainedBuildings].map(b=>b.rings||[b.ring]);
const hardFootprints=[...buildings.map(rings=>({ring:rings[0]})),...models.map(m=>({ring:m.footprint,modelId:m.id}))].map(item=>({...item,box:box(item.ring)}));
const candidates=allStreetGroups.flatMap(site=>[
  ...site.paving.map(p=>({ring:p.points,kind:'paving',role:p.role,clearedModelId:p.clearedModelId,site:site.id})),
  ...site.curbs.map(c=>({ring:c.footprint,kind:'curb',site:site.id})),
  ...['trees','lamps','benches'].flatMap(kind=>site[kind].map(item=>({ring:item.safetyFootprint,kind,site:site.id})))
]).map(c=>({...c,box:box(c.ring)}));
const roadSegments=data.roads.flatMap(road=>road.points.slice(1).map((b,i)=>({a:road.points[i],b,width:road.width,box:box([road.points[i],b])})));
const waters=data.water.map(w=>({...w,box:box(w.rings[0])}));
for(const candidate of candidates){
  const ring=candidate.ring;
  assert(ring.length>=3&&ring.every(p=>p.every(Number.isFinite)),`${candidate.site} ${candidate.kind}: finite polygon footprint`);
  if(candidate.kind==='paving'){
    const turns=ring.map((a,i)=>orientation(a,ring[(i+1)%ring.length],ring[(i+2)%ring.length]));
    assert(turns.every(t=>t>=-1e-10)||turns.every(t=>t<=1e-10),`${candidate.site}: paving remains convex after clipping and edge splitting`);
    assert(convexIntersectionArea(ring,ring)>1e-12,`${candidate.site}: no zero-area paving fragments`);
  }
  assert(ring.every(p=>Math.abs(p[0])<data.meta.width/2&&Math.abs(p[1])<data.meta.depth/2),`${candidate.kind}: board boundary`);
  for(const obstacle of hardFootprints){
    if(!near(candidate.box,obstacle.box,.0038))continue;
    if(candidate.role==='entry-apron'&&obstacle.modelId===candidate.clearedModelId){
      assert.equal(candidate.site,'jiuzhou-s01','Only the explicit Jiuzhou apron receives a certified source-corridor exception');
      assert.equal(candidate.clearedModelId,candidate.site);continue;
    }
    assert(polygonDistance(ring,obstacle.ring)>.0038,`${candidate.site} ${candidate.kind} overlaps a retained or authored building`);
  }
  for(const water of waters){if(!near(candidate.box,water.box,.0038))continue;const [outer,...holes]=water.rings;if(holes.some(h=>ring.every(p=>winding(p,h))))continue;assert(polygonDistance(ring,outer)>.0038,`${candidate.site} ${candidate.kind} enters mapped water`);}
  for(const road of roadSegments){
    if(!near(candidate.box,road.box,road.width/2+.0038))continue;
    let clearance=Infinity;for(const[a,b]of pairs(ring))clearance=Math.min(clearance,edgeDistance(a,b,road.a,road.b));
    assert(!winding(road.a,ring)&&!winding(road.b,ring)&&clearance>road.width/2+.0038,`${candidate.site} ${candidate.kind} occupies a carriageway, including a side-street opening`);
  }
}
const apronCandidates=candidates.filter(c=>c.role==='entry-apron');
assert.equal(apronCandidates.length,8);
passed.push(`${candidates.length-apronCandidates.length} complete paving, curb and furnishing footprints clear all mapped obstacles in XZ; ${apronCandidates.length} narrow Jiuzhou apron cells also clear every other building, retained source polygon, road and water, with only their own model envelope replaced by an exact source-cleared entry-corridor check`);
const paving=candidates.filter(c=>c.kind==='paving');
for(let i=0;i<paving.length;i++)for(let j=i+1;j<paving.length;j++){
  if(!near(paving[i].box,paving[j].box))continue;
  assert(convexIntersectionArea(paving[i].ring,paving[j].ring)<1e-9,`Coplanar paving cells ${i} and ${j} overlap`);
}
for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++){
  const a=candidates[i],b=candidates[j];
  if(a.site===b.site||!near(a.box,b.box,.0038))continue;
  const linkJoin=(a.site==='jiuzhou-shouxin-walk'&&['shouxin-wealth-s01','jiuzhou-s01'].includes(b.site))||(b.site==='jiuzhou-shouxin-walk'&&['shouxin-wealth-s01','jiuzhou-s01'].includes(a.site));
  if(linkJoin&&['paving','curb'].includes(a.kind)&&['paving','curb'].includes(b.kind)){
    assert(convexIntersectionArea(a.ring,b.ring)<1e-9,'An explicit street link may share its endpoint edge, never duplicate paved or curb area');continue;
  }
  assert(polygonDistance(a.ring,b.ring)>.0038,'Independent street sites cannot overlap one another');
}
const furniture=candidates.filter(c=>!['paving','curb'].includes(c.kind));
for(let i=0;i<furniture.length;i++)for(let j=i+1;j<furniture.length;j++)assert(polygonDistance(furniture[i].ring,furniture[j].ring)>.0349,'Full furniture safety footprints remain separated');
passed.push('All paving cells have zero overlapping area; independent street sites and furniture safety footprints remain separated');

for(const site of plan.sites){
  const model=models.find(m=>m.id===site.id),road=data.roads.find(r=>r.osmId===site.roadSourceId);
  assert.deepEqual(site.sourceAnchor,[model.x,model.z]);assert.equal(site.frontBearingDeg,model.registration.frontBearingDeg);
  const corner=site.id==='zhongnan-s09';
  assert.equal(site.roadName,corner?'夷陵大道':'沿江大道');assert.equal(site.roadWidth,corner ? .128 : .192);assert(site.illustrative);
  if(corner)assert.equal(site.roadSourceId,'way/397144798','The street corner uses its verified same-level Yiling Avenue segment');
  assert(!road.bridge||road.bridge==='no');assert(!road.tunnel||road.tunnel==='no');assert.equal(Number(road.layer||0),0);
  assert(site.paving.length>40&&site.paving.length<250);
  if(corner){assert.equal(site.trees.length,2);assert.equal(site.lamps.length,2);assert.equal(site.benches.length,1);}
  else{assert(site.trees.length>=3&&site.trees.length<=10);assert(site.lamps.length>=2&&site.lamps.length<=4);assert.equal(site.benches.length,2);}
  assert.equal(site.entranceRoute.length,2);
  const connection=site.paving.filter(p=>p.role==='connection');assert(connection.length>=3);
  assert(connection[0].points.some(p=>site.paving.filter(c=>c.role==='forecourt'||c.role==='accent').some(c=>pairs(c.points).some(([a,b])=>pointDistance(p,a,b)<1e-7))),`${site.id}: route touches court`);
  assert(connection.at(-1).points.some(p=>site.paving.filter(c=>c.role==='sidewalk'||c.role==='accent').some(c=>pairs(c.points).some(([a,b])=>pointDistance(p,a,b)<1e-6))),`${site.id}: route touches sidewalk`);
  for(let i=1;i<connection.length;i++)assert(boundaryDistance(connection[i-1].points,connection[i].points)<1e-9);
  const [a,b]=site.entranceRoute;assert(site.groundLift(...a)<site.groundLift(...b));
  const nearModel=site.paving.filter(p=>p.role!=='entry-apron').flatMap(p=>p.points).sort((a,b)=>Math.min(...pairs(model.footprint).map(([p,q])=>pointDistance(a,p,q)))-Math.min(...pairs(model.footprint).map(([p,q])=>pointDistance(b,p,q))))[0];
  assert(site.groundLift(...nearModel)<.06,`${site.id}: forecourt at threshold stays below the 0.065 model base`);
  for(const item of [...site.trees,...site.lamps,...site.benches])assert(pointDistance([item.x,item.z],...site.entranceRoute)>.07,`${site.id}: furniture keeps entrance path clear`);
  assert.equal(plan.reserveTree((a[0]+b[0])/2,(a[1]+b[1])/2),true);
  if(site.id!=='shouxin-wealth-s01'){
    const entrance=resolveBuildingInspection(model,0,'entrance'),tangent=[Math.cos(model.yaw),-Math.sin(model.yaw)];
    const projected=(site.entranceRoute[0][0]-entrance.center.x)*tangent[0]+(site.entranceRoute[0][1]-entrance.center.z)*tangent[1];
    assert(Math.abs(projected)<1e-10,'New connection follows the lateral position of the visible authored entry');
    assert.equal(site.entranceReference.surveyed,false);
  }
}
assert.equal(plan.reserveTree(0,0),false);
passed.push('All six continuous paths join the complete model footprint front, narrow court and same-side sidewalk; new paths align laterally with the authored visible entry while remaining illustrative');

// An independent interval oracle checks the whole entry width, not only a
// vertex touching another cell. Reconstruct the intended strip from immutable
// model/road directions; clipped fragments may not silently narrow access.
function assertLineCovered(a,b,cells,label){
  const intervals=[];
  for(const cell of cells){
    const signed=pairs(cell.points).reduce((sum,[p,q])=>sum+p[0]*q[1]-q[0]*p[1],0),sign=Math.sign(signed);
    let lo=0,hi=1;
    for(const[p,q]of pairs(cell.points)){
      const da=sign*orientation(p,q,a),db=sign*orientation(p,q,b),delta=db-da;
      if(Math.abs(delta)<1e-14){if(da<-1e-11){lo=1;hi=0;break;}continue;}
      const at=-da/delta;
      if(delta>0)lo=Math.max(lo,at);else hi=Math.min(hi,at);
    }
    if(hi>=lo-1e-9)intervals.push([Math.max(0,lo),Math.min(1,hi)]);
  }
  intervals.sort((a,b)=>a[0]-b[0]);let end=0;
  for(const[lo,hi]of intervals){if(hi<0||lo>1)continue;assert(lo<=end+1e-7,`${label}: full-width join contains a gap`);end=Math.max(end,hi);}
  assert(end>=1-1e-7,`${label}: complete 4.6 m join must be covered`);
}
const corner=plan.sites.find(site=>site.id==='zhongnan-s09'),cornerModel=models.find(model=>model.id===corner.id);
const cornerRoad=data.roads.find(road=>road.osmId===corner.roadSourceId),cornerStart=corner.entranceRoute[0],cornerEnd=corner.entranceRoute[1];
const cornerTangent=[Math.cos(cornerModel.yaw),-Math.sin(cornerModel.yaw)],halfWidth=2.3*data.meta.unitsPerMeter;
const nearestEdge=cornerRoad.points.slice(1).map((b,i)=>({a:cornerRoad.points[i],b,d:pointDistance(cornerEnd,cornerRoad.points[i],b)})).sort((a,b)=>a.d-b.d)[0];
let roadTangent=[nearestEdge.b[0]-nearestEdge.a[0],nearestEdge.b[1]-nearestEdge.a[1]];const edgeLength=Math.hypot(...roadTangent);roadTangent=roadTangent.map(v=>v/edgeLength);
if(roadTangent[0]*cornerTangent[0]+roadTangent[1]*cornerTangent[1]<0)roadTangent=roadTangent.map(v=>-v);
const offset=(p,n,s)=>[p[0]+n[0]*s,p[1]+n[1]*s];
const fullRoute=[offset(cornerStart,cornerTangent,-halfWidth),offset(cornerEnd,roadTangent,-halfWidth),offset(cornerEnd,roadTangent,halfWidth),offset(cornerStart,cornerTangent,halfWidth)];
const connectionCoverage=corner.paving.filter(cell=>cell.role==='connection').reduce((sum,cell)=>sum+convexIntersectionArea(fullRoute,cell.points),0),fullRouteArea=convexIntersectionArea(fullRoute,fullRoute);
assert(Math.abs(connectionCoverage-fullRouteArea)<1e-10,'Polygon ownership preserves the complete intended entry strip, with zero lost or duplicated area');
assertLineCovered(fullRoute[0],fullRoute[3],corner.paving.filter(cell=>cell.zone==='forecourt'),'Corner court ↔ connection');
assertLineCovered(fullRoute[1],fullRoute[2],corner.paving.filter(cell=>cell.zone==='sidewalk'),'Corner connection ↔ sidewalk');
assert(corner.paving.every(cell=>cell.conforming&&Number.isInteger(cell.sourcePavingIndex)),'The corner uses the explicit conforming partition; old sites remain untouched');
assert(corner.paving.every(cell=>!cell.clearedModelId),'The new corner cannot gain an uncertified internal-model exception');
passed.push('The clipped Zhongnan corner retains the complete 4.6 m entry strip and full-width court/sidewalk joins; no clipping gap, narrowing or new model-envelope exception is accepted');

// Actual scene ground and decoded light/detail GLBs verify the apron
// exception in three dimensions. Source models and render transforms are read
// through the same retained, immutable asset frame; no GPU is being simulated.
function sourceHeightAt(x,z){
  if(inWater(x,z))return 0;
  const t=data.terrain;
  if(!t?.cols||!t?.rows){
    const extent=Math.max(data.meta.width,data.meta.depth),radius=extent*.065;
    return data.landmarks.filter(l=>/磨基山|白马山|东山/.test(l.name||'')).reduce((sum,l)=>sum+(/磨基山/.test(l.name)?4.8:2.4)*Math.exp(-((x-l.x)**2+(z-l.z)**2)/(radius**2*.55)),0);
  }
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const fx=clamp((x/(t.width||data.meta.width)+.5)*(t.cols-1),0,t.cols-1.001),fz=clamp((z/(t.depth||data.meta.depth)+.5)*(t.rows-1),0,t.rows-1.001);
  const ix=Math.floor(fx),iz=Math.floor(fz),tx=fx-ix,tz=fz-iz;
  const a=Number(t.heights[iz*t.cols+ix])||0,b=Number(t.heights[iz*t.cols+ix+1])||0,c=Number(t.heights[(iz+1)*t.cols+ix])||0,d=Number(t.heights[(iz+1)*t.cols+ix+1])||0;
  return clamp((a+(b-a)*tx)*(1-tz)+(c+(d-c)*tx)*tz,0,Math.max(data.meta.width,data.meta.depth)*.12);
}
const terrainPlan=planStreetDetails({...input,heightAt:sourceHeightAt}),entrySite=terrainPlan.sites.find(s=>s.id==='jiuzhou-s01'),entryModel=models.find(m=>m.id===entrySite.id),entry=entrySite.entryApron;
assert(entry&&entry.method==='source-cleared-step-join');assert.equal(entry.illustrative,true);
assert(Math.abs(entry.width/data.meta.unitsPerMeter-4.6)<1e-10);assert(entry.length/data.meta.unitsPerMeter>18&&entry.length/data.meta.unitsPerMeter<20);
const entryCells=entrySite.paving.filter(p=>p.role==='entry-apron');
const nativeEvidence=JSON.parse(fs.readFileSync(path.join(root,entry.thresholdEvidence),'utf8'));
const doorRecord=nativeEvidence.nativeObjects.find(object=>object.name===entry.thresholdObject),doorEvidence=doorRecord.gltfBounds;
assert.equal(entry.thresholdEvidenceStatus,doorRecord.evidenceStatus);assert.equal(entry.thresholdEvidenceStatus,'PATTERN_INFERRED');
assert.equal(entry.thresholdObject,'Entry_curved_vestibule_closed_frames');
assert(Math.abs(entry.thresholdSource[0]-(doorEvidence.min[0]+doorEvidence.max[0])/2)<1e-8,'The strip starts at the curved vestibule, not the canopy inspection target');
assert(entry.thresholdSource[2]>entry.stepFrontSource&&entry.thresholdSource[2]-entry.stepFrontSource<.002,'The starting edge sits immediately outside the original step face');
const nativeCenter=new THREE.Vector3((entryModel.sourceBounds.min[0]+entryModel.sourceBounds.max[0])/2,entryModel.sourceBounds.min[1],(entryModel.sourceBounds.min[2]+entryModel.sourceBounds.max[2])/2);
const threshold=new THREE.Vector3(...entry.thresholdSource).sub(nativeCenter).multiplyScalar(entryModel.uniformScale).applyAxisAngle(new THREE.Vector3(0,1,0),entryModel.yaw).add(new THREE.Vector3(entryModel.x,entry.modelBase,entryModel.z));
assert.deepEqual(entry.start,[threshold.x,threshold.z]);
for(const [cell,indices,endpoint] of [[entryCells[0],[0,3],entry.start],[entryCells.at(-1),[1,2],entry.end]])
  for(let axis=0;axis<2;axis++)assert(Math.abs((cell.points[indices[0]][axis]+cell.points[indices[1]][axis])/2-endpoint[axis])<1e-10,'Apron end edges centre exactly on the entry and exterior court');
for(let i=1;i<entryCells.length;i++)assert(boundaryDistance(entryCells[i-1].points,entryCells[i].points)<1e-9);
assert(entryCells.at(-1).points.some(p=>entrySite.paving.filter(c=>c.role==='forecourt'||c.role==='accent').some(c=>pairs(c.points).some(([a,b])=>pointDistance(p,a,b)<1e-7))));
// End-line coordinates also belong to the exterior court: meet it without
// changing any existing court surface or introducing a step.
for(const index of [1,2]){const p=entryCells.at(-1).points[index];assert(Math.abs(entryCells.at(-1).surface(...p)-sourceHeightAt(...p)-entrySite.groundLift(...p))<1e-10);}
const raisedTerrain=(x,z)=>Math.hypot(x-entry.start[0],z-entry.start[1])<.08?.2:0;
assert(!planStreetDetails({...input,heightAt:raisedTerrain}).sites.find(s=>s.id===entrySite.id).entryApron,'Reject an apron that cannot stay above ground while remaining at or below its certified step top');
const middle=[(entry.start[0]+entry.end[0])/2,(entry.start[1]+entry.end[1])/2];
const blocker={ring:[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z])=>[middle[0]+x*.01,middle[1]+z*.01])};
const blockedGround={...ground,retainedBuildings:[...ground.retainedBuildings,blocker]};
assert(!planStreetDetails({...input,authoredGround:blockedGround}).sites.find(s=>s.id===entrySite.id).entryApron,'A retained source building still blocks the entire new apron');
const apronRender=createStreetDetails({sites:[entrySite],stats:{}},{heightAt:sourceHeightAt,makeMaterial:(day,night,options={})=>new THREE.MeshStandardMaterial({color:day,...options})});
const apronMesh=apronRender.group.getObjectByName('forecourt, entrance path and sidewalk'),position=apronMesh.geometry.attributes.position;
const apronIndices=entrySite.paving.filter(c=>c.role!=='accent').flatMap((c,i)=>c.role==='entry-apron'?Array.from({length:6},(_,j)=>i*6+j):[]);
const loader=new GLTFLoader();loader.setMeshoptDecoder(MeshoptDecoder);
const actualAssetBounds=[];
const sourceEnd=new THREE.Vector3(entry.end[0]-entryModel.x,0,entry.end[1]-entryModel.z).applyAxisAngle(new THREE.Vector3(0,1,0),-entryModel.yaw).divideScalar(entryModel.uniformScale).add(nativeCenter);
const sourceHalfWidth=entry.width/entryModel.uniformScale/2;
const certifiedRing=entry.clearedSourceCorridor,certifiedSign=Math.sign(pairs(certifiedRing).reduce((sum,[a,b])=>sum+a[0]*b[1]-b[0]*a[1],0));
const clipPlanes=pairs(certifiedRing).map(([a,b])=>p=>certifiedSign*((b[0]-a[0])*(p.z-a[1])-(b[1]-a[1])*(p.x-a[0]))).concat([p=>1-p.y]);
const stepPlanes=[p=>p.z-10.9,p=>11.001-p.z,p=>p.x+13+sourceHalfWidth,p=>-13+sourceHalfWidth-p.x,p=>1-p.y];
function clipTriangle(points,planes=clipPlanes){
  let result=points;
  for(const side of planes){const next=[];for(let i=0;i<result.length;i++){const a=result[i],b=result[(i+1)%result.length],da=side(a),db=side(b);if(da>=0)next.push(a);if((da>=0)!==(db>=0))next.push(a.clone().lerp(b,da/(da-db)));}result=next;if(!result.length)break;}
  if(result.length<3)return [];
  let area=0;for(let i=1;i<result.length-1;i++)area+=result[i].clone().sub(result[0]).cross(result[i+1].clone().sub(result[0])).length();
  return area>1e-9?result:[];
}
const thresholdStepEvidence=[];
for(const tier of ['light','detail']){
  const file=path.join(root,'public/models/jiuzhou-s01',`${tier}.glb`),bytes=fs.readFileSync(file);
  const raw=(await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
  raw.updateMatrixWorld(true);const sourceBounds=new THREE.Box3().setFromObject(raw);
  assert(Math.abs(sourceBounds.min.y-entryModel.sourceBounds.min[1])<1e-8,'The decoded GLB minimum Y matches the shared normalization frame');
  let corridorTriangles=0,stepTriangles=0;const stepBounds=new THREE.Box3();
  raw.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const positions=mesh.geometry.attributes.position,indices=mesh.geometry.index,count=indices?.count||positions.count;
    for(let i=0;i<count;i+=3){
      const points=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(positions,indices?indices.getX(i+j):i+j).applyMatrix4(mesh.matrixWorld));
      if(points.every(p=>p.y>1)||points.every(p=>p.z<10.9)||points.every(p=>p.z>25.402))continue;
      if(clipTriangle(points).length)corridorTriangles++;
      const step=clipTriangle(points,stepPlanes);if(!step.length)continue;
      assert.equal(mesh.material.name,'Dark_grey_stone_original_PBR','The retained join surface is the original stone doorstep');
      step.forEach(p=>stepBounds.expandByPoint(p));stepTriangles++;
    }
  });
  assert.equal(corridorTriangles,0,'Exact clipping proves the entire certified approach, including Float32 margin, contains zero low model triangles');
  assert.equal(stepTriangles,6,'The untouched original doorstep is identified independently just behind the approach');
  assert(Math.abs(stepBounds.max.y-entry.thresholdSource[1])<1e-10,'The apron inner edge uses the actual decoded stone step top');
  assert(Math.abs(stepBounds.max.z-entry.stepFrontSource)<1e-10,'The apron is immediately in front of the actual step face');
  thresholdStepEvidence.push({tier,corridorTriangles,stepTriangles,sourceBounds:{min:stepBounds.min.toArray(),max:stepBounds.max.toArray()},endpointGapMetres:(entry.thresholdSource[2]-stepBounds.max.z)*entryModel.uniformScale/data.meta.unitsPerMeter});
  const prepared=prepareAuthoredModel(raw,entryModel);prepared.rotation.y=entryModel.yaw;prepared.position.set(entryModel.x,entry.modelBase,entryModel.z);prepared.updateMatrixWorld(true);
  const actualBounds=new THREE.Box3().setFromObject(prepared);assert(Math.abs(actualBounds.min.y-entry.modelBase)<1e-8);
  actualAssetBounds.push({tier,sourceMinimumY:sourceBounds.min.y,normalizedWorldMinimumY:actualBounds.min.y});
  prepared.traverse(o=>{o.geometry?.dispose();for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])m.dispose();});
}
let highestPavingY=-Infinity,minimumGroundGap=Infinity;
const localise=v=>v.clone().sub(new THREE.Vector3(entryModel.x,entry.modelBase,entryModel.z)).applyAxisAngle(new THREE.Vector3(0,1,0),-entryModel.yaw).divideScalar(entryModel.uniformScale).add(nativeCenter);
for(let i=0;i<apronIndices.length;i+=3){
  const vertices=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(position,apronIndices[i+j]));
  for(const weights of [[1,0,0],[0,1,0],[0,0,1],[.5,.5,0],[.5,0,.5],[0,.5,.5],[1/3,1/3,1/3]]){
    const p=vertices.reduce((sum,v,j)=>sum.addScaledVector(v,weights[j]),new THREE.Vector3()),native=localise(p);
    highestPavingY=Math.max(highestPavingY,p.y);minimumGroundGap=Math.min(minimumGroundGap,p.y-sourceHeightAt(p.x,p.z));
    assert(winding([native.x,native.z],certifiedRing),'Every Float32 vertex/interior remains in the source-cleared corridor');
    assert(p.y<=entry.stepTopHeight+1e-8,'The gently sloping approach never rises above the original step top');
    assert(p.y-sourceHeightAt(p.x,p.z)>.003,'The actual apron remains above the scene ground');
    if(Math.abs(native.z-entry.thresholdSource[2])<.0001)assert(Math.abs(p.y-entry.stepTopHeight)<1e-8,'The rendered inner edge joins the actual doorstep top without a vertical gap');
  }
}
let previousHeight=Infinity;
for(let i=0;i<=32;i++){
  const t=i/32,p=[entry.start[0]+(entry.end[0]-entry.start[0])*t,entry.start[1]+(entry.end[1]-entry.start[1])*t],y=entryCells[0].surface(...p);
  assert(y<=previousHeight+1e-10,'The approach descends gently and monotonically from the step to the existing court');previousHeight=y;
}
const entryApronEvidence={role:'entry-apron',policy:'Only a certified source-cleared corridor may enter this model envelope; inner edge joins the original stone step top',thresholdObject:entry.thresholdObject,thresholdSource:entry.thresholdSource,thresholdEvidenceStatus:entry.thresholdEvidenceStatus,doorSourceBounds:doorEvidence,certifiedSourceCorridor:certifiedRing,widthMetres:entry.width/data.meta.unitsPerMeter,lengthMetres:entry.length/data.meta.unitsPerMeter,cells:entryCells.length,triangles:apronIndices.length/3,groundMethod:data.terrain?'source-grid':'scene-fallback-hills-no-GIS-grid',modelBase:entry.modelBase,stepTopY:entry.stepTopHeight,highestPavingY,maximumStepOvershoot:highestPavingY-entry.stepTopHeight,minimumGroundGap,actualAssetBounds,thresholdStepEvidence};
passed.push('Eight diagonal Jiuzhou apron cells now join the decoded stone step top just 1.84 mm outside its front; exact clipping of both GLBs proves zero low model triangles throughout the certified approach');
passed.push('Every emitted Float32 apron triangle lies inside that explicit source-cleared corridor, stays above scene ground, and descends from the unchanged doorstep to the unchanged exterior court without a vertical join gap');
apronRender.group.traverse(o=>{o.geometry?.dispose();for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])m.dispose();});

const eligibleRoadNames=new Set(plan.sites.map(site=>site.roadName));
const inaccessible={...data,roads:data.roads.map(road=>eligibleRoadNames.has(road.name)?{...road,bridge:'yes',layer:'1'}:road)};
assert.equal(planStreetDetails({...input,data:inaccessible}).sites.length,0,'An elevated road is never converted to ground-level pedestrian access');
assert.equal(planStreetDetails({...input,authoredModels:[]}).sites.length,0,'No invented site is generated without its authored model');
assert.equal(JSON.stringify({data,models}),snapshot,'Street planning cannot mutate source coordinates, scale, yaw, roads, or buildings');
passed.push('Bridge/tunnel/layer eligibility is conservative, unavailable models create no streets, and all input data remains byte-for-byte unchanged');

const render=createStreetDetails(plan,{heightAt,makeMaterial:(day,night,options={})=>new THREE.MeshStandardMaterial({color:day,...options})});
render.group.traverse(object=>{
  if(!object.isMesh)return;
  assert.equal(object.castShadow,false);
  for(const a of Object.values(object.geometry.attributes))assert([...a.array].every(Number.isFinite),'No NaN render geometry');
  if(object.isInstancedMesh)assert([...object.instanceMatrix.array].every(Number.isFinite),'Finite instance transforms');
  if(/forecourt|insets|sidewalk edges/.test(object.name)){
    const p=object.geometry.attributes.position,n=object.geometry.attributes.normal;
    for(let i=0;i<p.count;i+=3){const a=new THREE.Vector3().fromBufferAttribute(p,i),b=new THREE.Vector3().fromBufferAttribute(p,i+1),c=new THREE.Vector3().fromBufferAttribute(p,i+2);assert(b.sub(a).cross(c.sub(a)).y>0,'Paving triangles always face up');assert(n.getY(i)>0,'Paving normals always face up');}
  }
});
const stats=render.getStats();assert(stats.streetMeshes<=80);assert(stats.streetTriangles<15000);assert(stats.streetGeometryBytes<700000);
assert.equal(stats.streetTextureCount,1);assert.equal(stats.streetTextureSourceBytes,256*256*4);
for(const site of plan.sites){
  const group=render.group.getObjectByName(site.id);
  for(const [name,key]of [['street tree crowns','trees'],['street lamps','lamps'],['street bench seats','benches']])assert.equal(group.getObjectByName(name).count,site[key].length);
  const pools=group.getObjectByName('street lamp pools');
  assert(!pools.isInstancedMesh,'Slope-fitted pools share one merged world-space mesh per site');assert.equal(pools.material.forceSinglePass,true);
  const positions=pools.geometry.attributes.position,indices=pools.geometry.index;
  for(let i=0;i<positions.count;i++){
    const x=positions.getX(i),z=positions.getZ(i),lift=positions.getY(i)-heightAt(x,z)-site.groundLift(x,z);
    assert(Math.abs(lift-.0008)<1e-6,`${site.id}: every pool vertex follows the pavement surface`);
  }
  for(let i=0;i<indices.count;i+=3){
    const points=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(positions,indices.getX(i+j)));
    for(const weights of [[1/3,1/3,1/3],[.5,.5,0],[.5,0,.5],[0,.5,.5]]){
      const point=points.reduce((p,v,j)=>p.addScaledVector(v,weights[j]),new THREE.Vector3());
      const lift=point.y-heightAt(point.x,point.z)-site.groundLift(point.x,point.z);
      assert(lift>0&&lift<.0012,`${site.id}: light-pool interiors stay close above the curved paving`);
    }
  }
}
passed.push(`${stats.streetMeshes} total meshes, ${stats.streetTriangles} triangles and ${stats.streetGeometryBytes} geometry/instance bytes; furnishings are instanced and single-pass light pools follow each surface`);

assert.equal(streetDetailTier(2.1,0),0);assert.equal(streetDetailTier(2.2,0),1);assert.equal(streetDetailTier(1.6,1),1);assert.equal(streetDetailTier(1.4,1),0);
assert.equal(streetDetailTier(9,1),2);assert.equal(streetDetailTier(7,2),2);assert.equal(streetDetailTier(6.4,2),1);
const visibleFrustum={intersectsBox:()=>true},invisibleFrustum={intersectsBox:()=>false};
render.update({pixelsPerUnit:2,frustum:visibleFrustum});assert.equal(render.getStats().streetVisibleDrawCalls,0);
render.update({pixelsPerUnit:15,frustum:visibleFrustum});assert.equal(render.getStats().streetVisibleTier,1);assert.equal(render.getStats().streetVisibleDrawCalls,17);
assert.deepEqual(render.getStats().streetVisibleIds,[...expectedIds.slice(0,5),'jiuzhou-shouxin-walk'],'The narrower Yiling road reaches its own pixel threshold later');
assert.equal(render.getStats().streetVisibleSites,5);assert.equal(render.getStats().streetVisibleLinks,1,'A street link is counted separately from the building samples');
render.update({pixelsPerUnit:20,frustum:visibleFrustum});assert.equal(render.getStats().streetVisibleDrawCalls,20);
render.update({pixelsPerUnit:60,frustum:visibleFrustum});assert.equal(render.getStats().streetVisibleTier,2);assert.equal(render.getStats().streetVisibleDrawCalls,70);
const cornerLamp=render.group.getObjectByName('zhongnan-s09').getObjectByName('street lamps');
assert.equal(cornerLamp.parent.visible,false,'A 7.68-pixel Yiling road has not entered the 9-pixel furnishing tier');
render.update({pixelsPerUnit:80,frustum:visibleFrustum});assert.equal(render.getStats().streetVisibleDrawCalls,74);assert.equal(cornerLamp.parent.visible,true);
render.update({pixelsPerUnit:55,frustum:visibleFrustum});assert.equal(cornerLamp.parent.visible,true,'7.04 road pixels retain furnishings already revealed');
render.update({pixelsPerUnit:50,frustum:visibleFrustum});assert.equal(cornerLamp.parent.visible,false,'6.4 road pixels exit the furnishing tier');
render.update({pixelsPerUnit:38,frustum:visibleFrustum});assert.equal(render.getStats().streetVisibleTier,2);
render.update({pixelsPerUnit:80,frustum:{intersectsBox:box=>box.max.x<0}});assert.deepEqual(render.getStats().streetVisibleIds,['wanda-soho-s01','jinjiang-s03','zhongnan-s09']);assert.equal(render.getStats().streetVisibleDrawCalls,36);
render.update({pixelsPerUnit:80,frustum:visibleFrustum,enabled:false});assert.equal(render.getStats().streetVisibleDrawCalls,0);
render.update({pixelsPerUnit:80,frustum:invisibleFrustum});assert.equal(render.getStats().streetVisibleDrawCalls,0);
render.update({pixelsPerUnit:80,frustum:visibleFrustum,treesEnabled:false});
for(const site of plan.sites)assert.equal(render.group.getObjectByName(site.id).getObjectByName('street tree crowns').parent.visible,false);
render.setTheme(true);for(const site of plan.sites){const group=render.group.getObjectByName(site.id);assert.equal(group.getObjectByName('street lamp pools').parent.visible,true);assert(group.getObjectByName('street warm lamp heads').material.emissiveIntensity>0);}
render.setTheme(false);for(const site of plan.sites)assert.equal(render.group.getObjectByName(site.id).getObjectByName('street lamp pools').parent.visible,false);
render.update({pixelsPerUnit:80,frustum:visibleFrustum});assert.equal(render.update({pixelsPerUnit:80,frustum:visibleFrustum}),false,'Stable scale does not ask for animation frames');
render.update({pixelsPerUnit:2,frustum:visibleFrustum});assert.equal(render.getStats().streetVisibleDrawCalls,0,'All street detail disappears again at overview scale');
passed.push('Every site obeys pixel-scale hysteresis, independent frustum visibility, street/tree toggles, theme changes and zero overview draw calls without a continuous loop');

const report={checkedAt:'2026-11-10',scope:'geometric-data-resource-lifecycle-only',baseline:'V40 e87fde278f678ae76668766f27c3ad5e46144c56',stats:render.stats,sites:plan.sites.map(site=>({id:site.id,sourceRoad:site.roadSourceId,sourceAnchor:site.sourceAnchor,entranceReference:site.entranceReference||null,illustrative:site.illustrative})),entryApronEvidence,passed};
console.log(JSON.stringify(report,null,2));
const geometries=new Set(),usedMaterials=new Set();render.group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)usedMaterials.add(o.material);});geometries.forEach(g=>g.dispose());usedMaterials.forEach(m=>m.dispose());
