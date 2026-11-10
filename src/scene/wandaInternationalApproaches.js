// Two independently bounded sidewalk extensions toward Wanda Road. The
// source junction remains open: these pieces do not connect the two sites or
// assert a pedestrian crossing, surveyed entrance or accessible route.
const SOURCE = {
  id: 'way/1543968654', width: .192,
  points: [[1.384,27.467],[-8.46,19.643],[-13.682,15.09],[-15.518,13.962],[-17.665,12.468]],
};
const JUNCTION = [
  { id: 'way/1070095025', width: .121, points: [[-5.709,16.348],[-5.843,16.386],[-8.596,19.81]] },
  { id: 'way/1070095026', width: .121, points: [[-8.479,19.906],[-5.709,16.348]] },
];
const ORIGINS = [
  { id: 'yichang-international-s01', extensionId: 'international-yanjiang-extension', segment: 0, direction: 1, station: 9.459454789113203 },
  { id: 'wanda-soho-s01', extensionId: 'wanda-yanjiang-extension', segment: 1, direction: -1, station: 14.524832039627172 },
];
const EPS = 1e-9, CURB_HALF_WIDTH = .002;
const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
const mix = (a,b,t) => a+(b-a)*t;
const interpolate = (a,b,t) => [mix(a[0],b[0],t),mix(a[1],b[1],t)];
const add = (p,n,s) => [p[0]+n[0]*s,p[1]+n[1]*s];
const edges = ring => ring.map((p,i)=>[p,ring[(i+1)%ring.length]]);
const cross = (a,b,p) => (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
const box = ring => ({minX:Math.min(...ring.map(p=>p[0])),maxX:Math.max(...ring.map(p=>p[0])),minZ:Math.min(...ring.map(p=>p[1])),maxZ:Math.max(...ring.map(p=>p[1]))});
const near = (a,b,pad=0) => a.minX<=b.maxX+pad&&b.minX<=a.maxX+pad&&a.minZ<=b.maxZ+pad&&b.minZ<=a.maxZ+pad;

function project(p,a,b) {
  const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
  const t=length?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(length*length))):0;
  const point=interpolate(a,b,t);
  return {point,t,distance:distance(p,point),length,tangent:length?[dx/length,dz/length]:[1,0]};
}
function inside(p,ring) {
  let result=false;
  for(const[a,b]of edges(ring)){
    if(project(p,a,b).distance<EPS)return true;
    if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])result=!result;
  }
  return result;
}
function edgeDistance(a,b,c,d) {
  if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)return 0;
  return Math.min(project(a,c,d).distance,project(b,c,d).distance,project(c,a,b).distance,project(d,a,b).distance);
}
function boundaryDistance(a,b) {
  let result=Infinity;for(const[p,q]of edges(a))for(const[r,s]of edges(b))result=Math.min(result,edgeDistance(p,q,r,s));return result;
}
function polygonDistance(a,b) {
  return a.some(p=>inside(p,b))||b.some(p=>inside(p,a))?0:boundaryDistance(a,b);
}
function area(ring) {
  if(ring.length<3)return 0;return ring.slice(1,-1).reduce((sum,p,i)=>sum+cross(ring[0],p,ring[i+2]),0)/2;
}
function overlapArea(subject,clip) {
  const sign=Math.sign(area(clip));let result=subject;
  for(const[a,b]of edges(clip)){
    const input=result;result=[];
    for(const[p,q]of edges(input)){
      const dp=sign*cross(a,b,p),dq=sign*cross(a,b,q),pi=dp>=-1e-12,qi=dq>=-1e-12;
      if(pi)result.push(p);
      if(pi!==qi)result.push(interpolate(p,q,dp/(dp-dq)));
    }
  }
  return Math.abs(area(result));
}
const atSourceGround = road => road.kind!=='bridge'&&(!road.bridge||['no','false','0'].includes(String(road.bridge)))&&(!road.tunnel||['no','false','0'].includes(String(road.tunnel)))&&Number(road.layer||0)===0;
const matchesSource = (road,source) => road&&atSourceGround(road)&&Math.abs(road.width-source.width)<1e-12&&road.points?.length===source.points.length&&road.points.every((p,i)=>p.length===2&&p.every((v,j)=>Number.isFinite(v)&&Math.abs(v-source.points[i][j])<1e-12));
function makePath(road) {
  let at=0;
  return road.points.slice(1).map((b,index)=>{
    const a=road.points[index],length=distance(a,b),tangent=[(b[0]-a[0])/length,(b[1]-a[1])/length];
    const segment={a,b,at,length,tangent,normal:[-tangent[1],tangent[0]],index};at+=length;return segment;
  });
}
function projectToPath(p,path) {
  let best=null;
  for(const segment of path){const hit=project(p,segment.a,segment.b);if(!best||hit.distance<best.distance)best={...hit,at:segment.at+hit.t*segment.length,segment};}
  return best;
}
function sidewalkSections(site,path,inner,outer) {
  const output=[];
  for(const cell of site.paving){
    if(!['sidewalk','accent'].includes(cell.role)||cell.points.length!==4)continue;
    for(const[a,b]of edges(cell.points)){
      const pa=projectToPath(a,path),pb=projectToPath(b,path);
      const offset=(p,hit)=>(p[0]-hit.point[0])*-hit.tangent[1]+(p[1]-hit.point[1])*hit.tangent[0];
      const da=offset(a,pa),db=offset(b,pb);
      if(Math.abs(pa.at-pb.at)>1e-7||pa.segment.index!==pb.segment.index)continue;
      if(Math.abs(da-inner)<1e-7&&Math.abs(db-outer)<1e-7)output.push({inner:[...a],outer:[...b],at:(pa.at+pb.at)/2,segment:pa.segment});
      if(Math.abs(db-inner)<1e-7&&Math.abs(da-outer)<1e-7)output.push({inner:[...b],outer:[...a],at:(pa.at+pb.at)/2,segment:pa.segment});
    }
  }
  return output;
}
function curb(a,b,side) {
  const length=distance(a,b),normal=[-(b[1]-a[1])/length,(b[0]-a[0])/length];
  return {a:[...a],b:[...b],side,footprint:[add(a,normal,-CURB_HALF_WIDTH),add(b,normal,-CURB_HALF_WIDTH),add(b,normal,CURB_HALF_WIDTH),add(a,normal,CURB_HALF_WIDTH)]};
}
function roadClearance(ring,segments) {
  let result=Infinity;
  for(const road of segments){
    const d=inside(road.a,ring)||inside(road.b,ring)?0:Math.min(...edges(ring).map(([a,b])=>edgeDistance(a,b,road.a,road.b)));
    result=Math.min(result,d-road.width/2);
  }
  return result;
}
const circle = (p,radius) => Array.from({length:24},(_,i)=>[p[0]+Math.cos(i/24*Math.PI*2)*radius,p[1]+Math.sin(i/24*Math.PI*2)*radius]);

export function planWandaInternationalApproaches({data,authoredModels,authoredGround,waterfrontPlan,inWater,heightAt,sites=[],links=[]}) {
  const empty=reason=>({sites:[],views:[],stats:{streetExtensions:0,streetExtensionLengthMetres:0,streetExtensionPavingCells:0,streetExtensionCurbSegments:0,streetExtensionLamps:0,streetViewSiteIds:[],streetRouteConnectedBetweenSites:false},reserveTree:()=>false,reason});
  const units=Number(data.meta.unitsPerMeter);
  if(!Number.isFinite(units)||units<=0)return empty('invalid-source-units');
  const road=data.roads.find(item=>item.osmId===SOURCE.id),branches=JUNCTION.map(source=>data.roads.find(item=>item.osmId===source.id));
  // This is an audited local intervention. Changes to the source junction or
  // its carriageway envelopes need another review, not a nearest-name guess.
  if(!matchesSource(road,SOURCE)||branches.some((branch,i)=>!matchesSource(branch,JUNCTION[i])))return empty('changed-source-road-or-junction');
  const path=makePath(road),inner=road.width/2+.014,outer=inner+3.6*units;
  const branchSegments=branches.flatMap(branch=>branch.points.slice(1).map((b,i)=>({a:branch.points[i],b,width:branch.width,sourceId:branch.osmId,segmentIndex:i})));
  const approaches=[];
  for(const origin of ORIGINS){
    const site=sites.find(item=>item.id===origin.id);
    if(!site||!authoredModels.some(model=>model.id===origin.id)||typeof site.groundLift!=='function'||!Array.isArray(site.paving)||!Array.isArray(site.curbs))return empty('missing-existing-site');
    if(site.roadSourceId!==road.osmId||Math.abs(site.roadWidth-road.width)>EPS)return empty('different-source-road');
    const anchor=projectToPath(site.sourceAnchor,path),side=(site.sourceAnchor[0]-anchor.point[0])*-anchor.tangent[1]+(site.sourceAnchor[1]-anchor.point[1])*anchor.tangent[0];
    if(side<=0)return empty('different-roadside');
    const sections=sidewalkSections(site,path,inner,outer);
    if(!sections.length)return empty('missing-full-width-sidewalk-end');
    const join=sections.reduce((a,b)=>origin.direction*(a.at-b.at)>0?a:b);
    if(join.segment.index!==origin.segment||Math.abs(join.at-origin.station)>1e-7)return empty('changed-existing-sidewalk-end');
    if(![join.inner,join.outer].every(p=>site.curbs.some(c=>distance(p,c.a)<1e-8||distance(p,c.b)<1e-8)))return empty('missing-longitudinal-curb-join');
    const segment=join.segment,normal=segment.normal;
    const sectionAt=at=>{
      const point=interpolate(segment.a,segment.b,(at-segment.at)/segment.length);
      return {inner:add(point,normal,inner),outer:add(point,normal,outer),at};
    };
    const envelopeAt=at=>{
      const end=sectionAt(at);
      return [add(join.inner,normal,-CURB_HALF_WIDTH),add(end.inner,normal,-CURB_HALF_WIDTH),add(end.outer,normal,CURB_HALF_WIDTH),add(join.outer,normal,CURB_HALF_WIDTH)];
    };
    const boundary=origin.direction>0?segment.at+segment.length:segment.at,targetClearance=2*units;
    if(roadClearance(envelopeAt(join.at),branchSegments)<targetClearance||roadClearance(envelopeAt(boundary),branchSegments)>=targetClearance)return empty('unconfirmed-junction-stop');
    // The complete expanding strip includes both longitudinal curb widths.
    // Its first encounter with either branch determines the safe stop.
    let safe=join.at,blocked=boundary;
    for(let i=0;i<60;i++){
      const at=(safe+blocked)/2;
      if(roadClearance(envelopeAt(at),branchSegments)>=targetClearance)safe=at;else blocked=at;
    }
    const quantum=.005*units,station=(origin.direction>0?Math.floor(safe/quantum):Math.ceil(safe/quantum))*quantum;
    const stop=sectionAt(station),length=Math.abs(station-join.at),envelope=envelopeAt(station);
    if(length<10*units||length>180*units||roadClearance(envelope,branchSegments)<targetClearance)return empty('unreviewed-extension-length');
    approaches.push({origin,site,join,stop,length,envelope,normal,segment});
  }
  const allBounds=box(approaches.flatMap(approach=>approach.envelope));
  const buildings=[...(data.buildings||[]).filter((_,i)=>!authoredGround.omittedBuildingIndices.has(i)&&!waterfrontPlan?.omittedBuildingIndices?.has(i)),...(authoredGround.retainedBuildings||[])]
    .map(building=>building.rings||[building.ring]).filter(rings=>rings[0]?.length>2);
  buildings.push(...authoredModels.map(model=>[model.footprint]));
  const obstacles=[...buildings,...(data.water||[]).map(water=>water.rings||[water.ring])].map(rings=>({rings,bounds:box(rings[0])})).filter(item=>near(allBounds,item.bounds,.006));
  const roadSegments=data.roads.flatMap(item=>item.points.slice(1).map((b,i)=>({a:item.points[i],b,width:item.width||.12,bounds:box([item.points[i],b])}))).filter(item=>near(allBounds,item.bounds,item.width/2+.006));
  const existing=[...sites,...links];
  const existingPaving=existing.flatMap(site=>site.paving.map(cell=>cell.points));
  const existingCurbs=existing.flatMap(site=>site.curbs.map(item=>item.footprint));
  const existingFurniture=existing.flatMap(site=>['trees','lamps','benches'].flatMap(kind=>site[kind].map(item=>item.safetyFootprint)));
  const occupied=[...existingPaving,...existingCurbs,...existingFurniture].map(ring=>({ring,bounds:box(ring)})).filter(item=>near(allBounds,item.bounds));
  function safeRing(ring,surface) {
    const candidate=box(ring);
    if(ring.some(p=>!p.every(Number.isFinite)||Math.abs(p[0])>=data.meta.width/2||Math.abs(p[1])>=data.meta.depth/2||inWater(...p)||!Number.isFinite(surface(...p))))return false;
    for(const obstacle of obstacles){
      if(!near(candidate,obstacle.bounds,.006))continue;
      if(obstacle.rings.slice(1).some(hole=>ring.every(p=>inside(p,hole))&&boundaryDistance(ring,hole)>.006))continue;
      if(polygonDistance(ring,obstacle.rings[0])<.006)return false;
    }
    for(const item of roadSegments)if(near(candidate,item.bounds,item.width/2+.006)&&roadClearance(ring,[item])<.006)return false;
    for(const item of occupied)if(near(candidate,item.bounds)&&overlapArea(ring,item.ring)>1e-11)return false;
    const nx=Math.max(2,Math.ceil((candidate.maxX-candidate.minX)/units)),nz=Math.max(2,Math.ceil((candidate.maxZ-candidate.minZ)/units));
    for(let i=0;i<=nx;i++)for(let j=0;j<=nz;j++){
      const p=[mix(candidate.minX,candidate.maxX,i/nx),mix(candidate.minZ,candidate.maxZ,j/nz)];
      if(inside(p,ring)&&(inWater(...p)||!Number.isFinite(surface(...p))))return false;
    }
    return true;
  }
  const output=[];
  for(const approach of approaches){
    const {origin,site,join,stop,length,envelope,normal,segment}=approach;
    // Reusing the existing lift function preserves the full old transverse
    // slope, including Wanda's unequal inner/outer elevations at the join.
    const groundLift=(x,z)=>site.groundLift(x,z),surface=(x,z)=>heightAt(x,z)+groundLift(x,z);
    const count=Math.ceil(length/(3*units)),paving=[],curbs=[],lamps=[];
    for(let i=0;i<count;i++){
      const a0=i?interpolate(join.inner,stop.inner,i/count):[...join.inner],a1=i+1===count?[...stop.inner]:interpolate(join.inner,stop.inner,(i+1)/count);
      const b0=i?interpolate(join.outer,stop.outer,i/count):[...join.outer],b1=i+1===count?[...stop.outer]:interpolate(join.outer,stop.outer,(i+1)/count);
      const cell={points:[a0,a1,b1,b0],role:'sidewalk'},innerCurb=curb(a0,a1,'road'),outerCurb=curb(b0,b1,'building');
      if(![cell.points,innerCurb.footprint,outerCurb.footprint].every(ring=>safeRing(ring,surface)))return empty('extension-obstacle-or-height-conflict');
      paving.push(cell);curbs.push(innerCurb,outerCurb);
    }
    // A few shared-style lights establish scale. Each complete lamp/pool
    // footprint fits inside the strip, away from the old furniture and the
    // open junction; a failed individual placement is simply omitted.
    const outline=[join.inner,stop.inner,stop.outer,join.outer];
    for(let run=28*units;run<=length-8*units;run+=28*units){
      const t=run/length,p=add(interpolate(join.inner,stop.inner,t),normal,3.6*units*.42);
      const safetyFootprint=circle(p,1.3*units),width=.7*units,depth=.7*units;
      const footprint=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>add(add(p,segment.tangent,u*width/2),normal,v*depth/2));
      if(!safetyFootprint.every(point=>inside(point,outline))||!safeRing(safetyFootprint,surface))continue;
      if(existingFurniture.some(ring=>polygonDistance(ring,safetyFootprint)<2*units))continue;
      if(lamps.some(lamp=>polygonDistance(lamp.safetyFootprint,safetyFootprint)<2*units))continue;
      lamps.push({x:p[0],y:surface(...p),z:p[1],angle:Math.atan2(normal[0],normal[1]),footprint,safetyFootprint,width,depth,
        sourceRoadStationMetres:mix(join.at,stop.at,t)/units,distanceFromJunctionStopMetres:(length-run)/units});
    }
    const originalFrameCell=site.paving.find(cell=>cell.role==='forecourt')||site.paving[0];
    const dx=originalFrameCell.points[1][0]-originalFrameCell.points[0][0],dz=originalFrameCell.points[1][1]-originalFrameCell.points[0][1],frameLength=Math.hypot(dx,dz)||1;
    const sourceJoin={siteId:site.id,sourceSegmentIndex:segment.index,sourceRoadStationMetres:join.at/units,inner:[...join.inner],outer:[...join.outer]};
    const fullWidthStopEvidence={sourceSegmentIndex:segment.index,sourceRoadStationMetres:stop.at/units,inner:[...stop.inner],outer:[...stop.outer],
      intendedPaving: outline.map(p=>[...p]),completeEnvelope:envelope.map(p=>[...p]),widthMetres:3.6,lengthMetres:length/units,
      junctionSourceIds:JUNCTION.map(item=>item.id),junctionClearanceMetres:roadClearance(envelope,branchSegments)/units,requiredJunctionClearanceMetres:2,
      stationRoundingMetres:.005,transverseEndCurb:false};
    output.push({id:origin.extensionId,kind:'street-extension',connectedSiteIds:[site.id],routeConnectedBetweenSites:false,
      roadName:road.name,roadSourceId:road.osmId,roadWidth:road.width,sourceAnchor:[...site.sourceAnchor],units,
      pavingFrame:{origin:[...site.sourceAnchor],tangent:[dx/frameLength,dz/frameLength],units:site.units},
      paving,curbs,trees:[],lamps,benches:[],entranceRoute:[],illustrative:true,groundLift,
      bounds:box([...paving.flatMap(cell=>cell.points),...curbs.flatMap(item=>item.footprint),...lamps.flatMap(item=>item.safetyFootprint)]),
      sourceJoin,fullWidthStopEvidence,
      extensionEvidence:{method:'existing-same-side-sidewalk-to-verified-junction-setback',surveyed:false,accessibilityRoute:false,routeConnectedBetweenSites:false,
        sourceJoin,fullWidthStopEvidence,notes:'展示性沿街延伸，分别止于万达路口前；保留车行开口，不表示两楼步行连通或现场人行横道。'}});
  }
  const framePoints=output.flatMap(site=>[
    ...site.paving.flatMap(cell=>cell.points.map(([x,z])=>[x,heightAt(x,z)+site.groundLift(x,z),z])),
    ...site.curbs.flatMap(item=>item.footprint.map(([x,z])=>[x,heightAt(x,z)+site.groundLift(x,z)+.0035,z])),
    ...site.lamps.map(lamp=>[lamp.x,lamp.y+6*units,lamp.z]),
  ]);
  // Include the actual road mouth between the two stops, not an invented
  // pedestrian connection. The view object is separate from all old sites.
  const mouth=[{at:approaches[0].stop.at,segment:path[0]},{at:path[0].at+path[0].length,segment:path[0]},{at:approaches[1].stop.at,segment:path[1]}];
  for(const {at,segment}of mouth){
    const p=interpolate(segment.a,segment.b,(at-segment.at)/segment.length);
    for(const offset of [-road.width/2-.02,outer+CURB_HALF_WIDTH]){
      const q=add(p,segment.normal,offset);framePoints.push([q[0],heightAt(...q)+.122,q[1]]);
    }
  }
  const frameBounds=box(framePoints.map(p=>[p[0],p[2]])),centerXZ=[(frameBounds.minX+frameBounds.maxX)/2,(frameBounds.minZ+frameBounds.maxZ)/2];
  const tangent=interpolate(path[0].tangent,path[1].tangent,.5),tangentLength=Math.hypot(...tangent),t=[tangent[0]/tangentLength,tangent[1]/tangentLength],n=[-t[1],t[0]];
  const siteIds=['wanda-soho-s01','yichang-international-s01'];
  const views=[{id:'wanda-international-street',siteIds,center:[centerXZ[0],heightAt(...centerXZ)+.122,centerXZ[1]],direction:[-n[0]+.22*t[0],1.8,-n[1]+.22*t[1]],framePoints}];
  const stats={streetExtensions:output.length,streetExtensionLengthMetres:approaches.reduce((sum,item)=>sum+item.length/units,0),
    streetExtensionPavingCells:output.reduce((sum,site)=>sum+site.paving.length,0),streetExtensionCurbSegments:output.reduce((sum,site)=>sum+site.curbs.length,0),streetExtensionLamps:output.reduce((sum,site)=>sum+site.lamps.length,0),
    streetJunctionOpenIntervalMetres:(approaches[1].stop.at-approaches[0].stop.at)/units,streetJunctionClearanceMetres:Math.min(...output.map(site=>site.fullWidthStopEvidence.junctionClearanceMetres)),
    streetViewSiteIds:siteIds,streetRouteConnectedBetweenSites:false};
  return {sites:output,views,stats,reserveTree(x,z){
    const p=[x,z];if(!near({minX:x,maxX:x,minZ:z,maxZ:z},allBounds,.15))return false;
    return output.some(site=>site.paving.some(cell=>inside(p,cell.points)||edges(cell.points).some(([a,b])=>project(p,a,b).distance<.12))||site.lamps.some(lamp=>inside(p,lamp.safetyFootprint)||edges(lamp.safetyFootprint).some(([a,b])=>project(p,a,b).distance<.12)));
  }};
}
