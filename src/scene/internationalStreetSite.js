// A single, bounded display connection for the retained International Plaza
// compound. Its three thin source inlay rings are decorations, not a filled
// forecourt. Only the two exact, independently checked native-space zones
// below may enter the model envelope; every outer slab and furnishing keeps
// the ordinary complete-footprint, source-road, water and board exclusions.
const ID = 'yichang-international-s01';
const SOURCE_SHA = '4a27c65bc02a1de7f25e596c1961dea11f477dd69a0f78de0bf8a97a002fd090';
const ASSETS = {
  light: '/models/yichang-international-s01/light.glb?v=6531a8d0d900',
  detail: '/models/yichang-international-s01/detail.glb?v=b9ddf888b545',
};
const SOURCE_BOUNDS = {min:[-43.900001525878906,-.15000000596046448,-16.060869216918945],max:[45.79999923706055,100.06999969482422,29.799999237060547]};
const PASSAGE_FRONT = 23.00016418147591;
const PASSAGE_TOP = .10041078109802713;
const UNDERLAY_Y = -.13;
const RAMP_END = 25.35;
const OUTER_END = 30.1;
const RAMP_ZONE = [[32.9,PASSAGE_FRONT],[33.9,PASSAGE_FRONT],[33.9,RAMP_END],[32.9,RAMP_END]];
const UNDERLAY_ZONE = [[32.9,RAMP_END],[36.8,RAMP_END],[36.8,OUTER_END],[32.9,OUTER_END]];
const EPS = 1e-9;
const mix = (a,b,t) => a+(b-a)*t;
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const lerp = (a,b,t) => [mix(a[0],b[0],t),mix(a[1],b[1],t)];
const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
const edges = ring => ring.map((p,i)=>[p,ring[(i+1)%ring.length]]);
const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const box = ring => ({minX:Math.min(...ring.map(p=>p[0])),maxX:Math.max(...ring.map(p=>p[0])),minZ:Math.min(...ring.map(p=>p[1])),maxZ:Math.max(...ring.map(p=>p[1]))});
const near = (a,b,pad=0) => a.minX<=b.maxX+pad&&b.minX<=a.maxX+pad&&a.minZ<=b.maxZ+pad&&b.minZ<=a.maxZ+pad;
const add = (p,v,s) => [p[0]+v[0]*s,p[1]+v[1]*s];
function project(p,a,b){const dx=b[0]-a[0],dz=b[1]-a[1],d=dx*dx+dz*dz,t=d?clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dz)/d,0,1):0,point=lerp(a,b,t);return{point,t,distance:distance(p,point)};}
function inside(p,ring){let result=false;for(const[a,b]of edges(ring)){if(project(p,a,b).distance<EPS)return true;if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])result=!result;}return result;}
function edgeDistance(a,b,c,d){if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)return 0;return Math.min(project(a,c,d).distance,project(b,c,d).distance,project(c,a,b).distance,project(d,a,b).distance);}
function boundaryDistance(a,b){let n=Infinity;for(const[p,q]of edges(a))for(const[r,s]of edges(b))n=Math.min(n,edgeDistance(p,q,r,s));return n;}
function polygonDistance(a,b){return a.some(p=>inside(p,b))||b.some(p=>inside(p,a))?0:boundaryDistance(a,b);}
function area(ring){return ring.length<3?0:ring.slice(1,-1).reduce((sum,p,i)=>sum+cross(ring[0],p,ring[i+2]),0)/2;}
function overlapArea(subject,clip){const sign=Math.sign(area(clip));let output=subject;for(const[a,b]of edges(clip)){const input=output;output=[];for(const[p,q]of edges(input)){const dp=sign*cross(a,b,p),dq=sign*cross(a,b,q),pi=dp>=-1e-12,qi=dq>=-1e-12;if(pi)output.push(p);if(pi!==qi)output.push(lerp(p,q,dp/(dp-dq)));}}return Math.abs(area(output));}
function rectangle(center,tangent,normal,width,depth){return[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z])=>add(add(center,tangent,x*width/2),normal,z*depth/2));}
const circle = (p,r) => Array.from({length:16},(_,i)=>[p[0]+r*Math.cos(i*Math.PI/8),p[1]+r*Math.sin(i*Math.PI/8)]);
const atSourceGround = road => road.kind!=='bridge'&&(!road.bridge||['no','false','0'].includes(String(road.bridge)))&&(!road.tunnel||['no','false','0'].includes(String(road.tunnel)))&&Number(road.layer||0)===0;

/** This is an illustrative link from existing model paving, not a surveyed
 * entrance or an accessibility route. The two unchanged GLBs are the evidence
 * for its narrow 3D exception; their asset identity is deliberately fail-closed. */
export function planInternationalStreetSite({data,authoredModels,authoredGround,waterfrontPlan,inWater,heightAt,sites=[]}) {
  const empty=reason=>({sites:[],stats:{streetFrontageConnections:0,streetFrontageConnected:false},reserveTree:()=>false,reason});
  const model=authoredModels.find(m=>m.id===ID);
  if(!model)return empty('missing-international-model');
  if(model.sourceModelSha256!==SOURCE_SHA||Object.keys(ASSETS).some(k=>model.assets?.[k]!==ASSETS[k])||JSON.stringify(model.sourceBounds)!==JSON.stringify(SOURCE_BOUNDS))return empty('unreviewed-source-geometry');
  const units=Number(data.meta.unitsPerMeter)||.02,scale=model.uniformScale;
  if(!Number.isFinite(scale)||scale<=0||!Number.isFinite(model.yaw))return empty('invalid-source-frame');
  const c=Math.cos(model.yaw),s=Math.sin(model.yaw),cx=(SOURCE_BOUNDS.min[0]+SOURCE_BOUNDS.max[0])/2,cz=(SOURCE_BOUNDS.min[2]+SOURCE_BOUNDS.max[2])/2;
  const toWorld=([x,z])=>{const dx=(x-cx)*scale,dz=(z-cz)*scale;return[model.x+c*dx+s*dz,model.z-s*dx+c*dz];};
  const toNative=([x,z])=>{const dx=x-model.x,dz=z-model.z;return[(dx*c-dz*s)/scale+cx,(dx*s+dz*c)/scale+cz];};
  // This is the existing authored-model base; neither it nor the road lift is
  // modified. Their display-height difference is absorbed outside the model.
  const modelBase=heightAt(model.x,model.z)+.065;
  const sourceY=y=>modelBase+(y-SOURCE_BOUNDS.min[1])*scale;
  const underlayHeight=sourceY(UNDERLAY_Y),passageHeight=sourceY(PASSAGE_TOP);
  const road=data.roads.find(r=>r.osmId==='way/1543968654'&&r.name==='沿江大道');
  if(!road||!atSourceGround(road)||road.points.length<2)return empty('missing-ground-source-road');
  const roadA=road.points[0],roadB=road.points[1],nativeA=toNative(roadA),nativeB=toNative(roadB);
  // Only this long, nearly native-X segment was reviewed. A future bend or
  // shifted road must be rechecked instead of joining an arbitrary road edge.
  if(Math.min(nativeA[0],nativeB[0])>20||Math.max(nativeA[0],nativeB[0])<64||Math.abs((nativeB[1]-nativeA[1])/(nativeB[0]-nativeA[0]))>.025)return empty('unreviewed-road-segment');
  const roadLength=distance(roadA,roadB),direction=nativeB[0]>nativeA[0]?1:-1;
  const tangent=[direction*(roadB[0]-roadA[0])/roadLength,direction*(roadB[1]-roadA[1])/roadLength];
  let normal=[-tangent[1],tangent[0]];
  if((model.x-roadA[0])*normal[0]+(model.z-roadA[1])*normal[1]<0)normal=normal.map(v=>-v);
  const inner=road.width/2+.014,sidewalkWidth=3.6*units,outer=inner+sidewalkWidth;
  const outerA=toNative(add(roadA,normal,outer)),outerB=toNative(add(roadB,normal,outer));
  const outerPoint=x=>toWorld([x,outerA[1]+(outerB[1]-outerA[1])*(x-outerA[0])/(outerB[0]-outerA[0])]);
  if([22,62.4].some(x=>toNative(outerPoint(x))[1]<32.5||toNative(outerPoint(x))[1]>35))return empty('unreviewed-road-gap');
  const roadSurface=(x,z)=>heightAt(x,z)+.122;
  // Each cell has a continuous local surface, including just outside its
  // boundary where the renderer samples finite-difference normals. A global
  // XZ dispatcher would introduce artificial vertical normals at path edges.
  const departureSurface=(x,z)=>mix(passageHeight,underlayHeight,(toNative([x,z])[1]-PASSAGE_FRONT)/(RAMP_END-PASSAGE_FRONT));
  const underlaySurface=()=>underlayHeight;
  const outerRampSurface=(x,z)=>mix(underlayHeight,roadSurface(x,z),(toNative([x,z])[0]-36.8)/(60-36.8));
  // All furnishings and curbs are confined to the outer roadside sidewalk.
  const groundLift=()=>.122;
  const site={id:ID,kind:'street-frontage',roadName:road.name,roadSourceId:road.osmId,roadWidth:road.width,sourceAnchor:[model.x,model.z],units,
    paving:[],curbs:[],trees:[],lamps:[],benches:[],entranceRoute:[],frontageRoute:[],illustrative:true,groundLift};
  const siteBounds=box([[model.x-4,model.z-4],[model.x+4,model.z+4]]);
  const buildings=[...(data.buildings||[]).filter((_,i)=>!authoredGround.omittedBuildingIndices.has(i)&&!waterfrontPlan?.omittedBuildingIndices?.has(i)),...(authoredGround.retainedBuildings||[])]
    .map(b=>({rings:b.rings||[b.ring]})).filter(b=>b.rings[0]?.length>2);
  buildings.push(...authoredModels.map(m=>({rings:[m.footprint],modelId:m.id})));
  const obstacles=[...buildings,...(data.water||[]).map(w=>({rings:w.rings||[w.ring]}))].map(o=>({...o,bounds:box(o.rings[0])})).filter(o=>near(siteBounds,o.bounds));
  const roads=(data.roads||[]).flatMap(r=>r.points.slice(1).map((b,i)=>({a:r.points[i],b,width:r.width||.12,bounds:box([r.points[i],b])}))).filter(r=>near(siteBounds,r.bounds,r.width/2+.01));
  const existing=sites.flatMap(old=>[...old.paving.map(p=>p.points),...old.curbs.map(cur=>cur.footprint),...['trees','lamps','benches'].flatMap(k=>old[k].map(f=>f.safetyFootprint))]).map(ring=>({ring,bounds:box(ring)})).filter(o=>near(siteBounds,o.bounds));

  function certifiedCell(ring,zone,cellSurface){
    const allowed=zone==='source-ramp'?RAMP_ZONE:zone==='retained-inlay-underlay'?UNDERLAY_ZONE:null;
    if(!allowed)return false;
    for(const p of ring){
      const native=toNative(p);
      if(!inside(native,allowed))return false;
      const y=cellSurface(...p),expected=zone==='source-ramp'?mix(passageHeight,underlayHeight,clamp((native[1]-PASSAGE_FRONT)/(RAMP_END-PASSAGE_FRONT),0,1)):underlayHeight;
      if(!Number.isFinite(y)||Math.abs(y-expected)>1e-9)return false;
    }
    return true;
  }
  function safe(ring,clearance=.006,zone=null,cellSurface=roadSurface){
    if(zone&&!certifiedCell(ring,zone,cellSurface))return false;
    const b=box(ring);
    if(ring.some(p=>p.some(v=>!Number.isFinite(v))||Math.abs(p[0])>=data.meta.width/2||Math.abs(p[1])>=data.meta.depth/2||inWater(...p)))return false;
    for(const o of obstacles){
      if(!near(b,o.bounds,clearance))continue;
      // A precisely bounded 3D evidence corridor, never a whole model skip.
      if(zone&&o.modelId===ID)continue;
      if(o.rings.slice(1).some(h=>ring.every(p=>inside(p,h))&&boundaryDistance(ring,h)>clearance))continue;
      if(polygonDistance(ring,o.rings[0])<clearance)return false;
    }
    for(const r of roads)if(near(b,r.bounds,r.width/2+clearance)&&(inside(r.a,ring)||inside(r.b,ring)||edges(ring).some(([a,b])=>edgeDistance(a,b,r.a,r.b)<r.width/2+clearance)))return false;
    for(const o of existing)if(near(b,o.bounds)&&overlapArea(ring,o.ring)>1e-11)return false;
    const nx=Math.max(2,Math.ceil((b.maxX-b.minX)/units)),nz=Math.max(2,Math.ceil((b.maxZ-b.minZ)/units));
    for(let i=0;i<=nx;i++)for(let j=0;j<=nz;j++){
      const p=[mix(b.minX,b.maxX,i/nx),mix(b.minZ,b.maxZ,j/nz)];
      if(inside(p,ring)&&(inWater(...p)||!Number.isFinite(cellSurface(...p))||cellSurface(...p)<heightAt(...p)+.003))return false;
    }
    return true;
  }
  const addCell=(nativePoints,role='connection',zone=null,cellSurface=roadSurface)=>{
    const points=nativePoints.map(toWorld);
    if(!safe(points,.006,zone,cellSurface))return false;
    site.paving.push({points,role,surface:cellSurface,...(zone?{clearedModelId:ID,sourceClearanceZone:zone}:{}),sourcePoints:nativePoints.map(p=>[...p])});return true;
  };
  // Four shallow slabs leave the actual passage's front edge at its retained
  // height, between the inner and outer inlay rings. They reach the underlay
  // height before the first decorative ring is encountered.
  for(let i=0;i<4;i++){
    const z0=mix(PASSAGE_FRONT,RAMP_END,i/4),z1=mix(PASSAGE_FRONT,RAMP_END,(i+1)/4);
    if(!addCell([[32.9,z0],[33.9,z0],[33.9,z1],[32.9,z1]],'connection','source-ramp',departureSurface))return empty('source-ramp-conflict');
  }
  const underlaySections=[[[32.9,RAMP_END],[33.9,RAMP_END]],[[32.9,27.7],[36.8,27.7]],[[32.9,OUTER_END],[36.8,OUTER_END]]];
  for(let i=1;i<underlaySections.length;i++)if(!addCell([underlaySections[i-1][0],underlaySections[i-1][1],underlaySections[i][1],underlaySections[i][0]],'connection','retained-inlay-underlay',underlaySurface))return empty('inlay-underlay-conflict');
  // The remaining rise occurs outside the complete native source envelope.
  // A short perpendicular join would be steep because the existing road and
  // model use different display lifts, so this bounded path turns along it.
  if(!addCell([[32.9,OUTER_END],[36.8,OUTER_END],[36.8,31.5],[32.9,31.5]],'connection',null,underlaySurface))return empty('outer-landing-conflict');
  const rampSections=Array.from({length:13},(_,i)=>mix(36.8,60,i/12));
  for(let i=1;i<rampSections.length;i++)if(!addCell([[rampSections[i-1],OUTER_END],[rampSections[i],OUTER_END],[rampSections[i],31.5],[rampSections[i-1],31.5]],'connection',null,outerRampSurface))return empty('outer-ramp-conflict');
  if(!addCell([[60,OUTER_END],[61.4,OUTER_END],[61.4,31.5],[60,31.5]]))return empty('outer-turn-conflict');
  const endLeft=toNative(outerPoint(60)),endRight=toNative(outerPoint(61.4));
  if(!addCell([[60,31.5],[61.4,31.5],endRight,endLeft]))return empty('sidewalk-connection-conflict');
  const sidewalkBreaks=[...Array.from({length:20},(_,i)=>mix(22,60,i/19)),61.4,62.4];
  function addCurb(a,b,side){
    const length=distance(a,b),t=[(b[0]-a[0])/length,(b[1]-a[1])/length],n=[-t[1],t[0]],footprint=rectangle(lerp(a,b,.5),t,n,length,.004);
    if(safe(footprint,.004))site.curbs.push({a:[...a],b:[...b],footprint,side});
  }
  for(let i=1;i<sidewalkBreaks.length;i++){
    const a=outerPoint(sidewalkBreaks[i-1]),b=outerPoint(sidewalkBreaks[i]),ai=add(a,normal,-sidewalkWidth),bi=add(b,normal,-sidewalkWidth);
    const points=[ai,bi,b,a];
    if(!safe(points))return empty('sidewalk-conflict');
    site.paving.push({points,role:i%8===0?'accent':'sidewalk',surface:roadSurface});
    addCurb(ai,bi,'road');
    // The complete connection occupies this exact shared edge; leave it open.
    if(sidewalkBreaks[i-1]!==60)addCurb(a,b,'building');
  }
  const start=toWorld([33.4,PASSAGE_FRONT]),rampBottom=toWorld([33.4,RAMP_END]),inlayExit=toWorld([34.85,OUTER_END]),turnA=toWorld([35.8,30.8]),turnB=toWorld([60.7,30.8]),end=lerp(outerPoint(60),outerPoint(61.4),.5);
  site.frontageRoute=[start,rampBottom,inlayExit,turnA,turnB,end];
  const occupied=[];
  function place(kind,nativeX,offset,width,depth,radius=0){
    const p=add(outerPoint(nativeX),normal,-sidewalkWidth+offset),footprint=rectangle(p,tangent,normal,width,depth),safetyFootprint=radius?circle(p,radius):footprint;
    if(!safe(safetyFootprint,.009)||occupied.some(r=>polygonDistance(r,safetyFootprint)<.035))return;
    if(site.paving.filter(cell=>cell.role==='connection').some(cell=>polygonDistance(safetyFootprint,cell.points)<.015))return;
    occupied.push(safetyFootprint);site[kind].push({x:p[0],z:p[1],angle:Math.atan2(normal[0],normal[1]),footprint,safetyFootprint,width,depth,y:roadSurface(...p)});
  }
  for(const x of [27,48])place('lamps',x,sidewalkWidth*.42,.7*units,.7*units,1.3*units);
  for(const x of [39,54])place('benches',x,sidewalkWidth*.79,2.1*units,.75*units);
  site.bounds=box([...site.paving.flatMap(p=>p.points),...site.curbs.flatMap(cur=>cur.footprint),...occupied.flat()]);
  site.connectionEvidence={method:'retained-passage-edge-to-same-side-source-road',surveyed:false,accessibilityRoute:false,
    modelId:ID,sourceModelSha256:SOURCE_SHA,assets:{...ASSETS},sourceSegmentIndex:0,modelBase,existingModelLift:.065,existingRoadSurfaceLift:.1206,sidewalkSurfaceLift:.122,
    sourceFrame:{bounds:{min:[...SOURCE_BOUNDS.min],max:[...SOURCE_BOUNDS.max]},uniformScale:scale,yaw:model.yaw,originWorld:[model.x,modelBase,model.z]},
    // Independent area/coverage checks construct these complete design zones
    // directly, before comparing them with the emitted, subdivided cells.
    intendedRegions:[
      {name:'passage-departure-ramp',nativePolygon:RAMP_ZONE.map(p=>[...p]),heightRule:'source-z-linear',sourceStartY:PASSAGE_TOP,sourceEndY:UNDERLAY_Y},
      {name:'inlay-underlay-taper',nativePolygon:[[32.9,RAMP_END],[33.9,RAMP_END],[36.8,27.7],[32.9,27.7]],heightRule:'source-flat',sourceY:UNDERLAY_Y},
      {name:'inlay-underlay-exit',nativePolygon:[[32.9,27.7],[36.8,27.7],[36.8,OUTER_END],[32.9,OUTER_END]],heightRule:'source-flat',sourceY:UNDERLAY_Y},
      {name:'outer-low-turn',nativePolygon:[[32.9,OUTER_END],[36.8,OUTER_END],[36.8,31.5],[32.9,31.5]],heightRule:'source-flat',sourceY:UNDERLAY_Y},
      {name:'outer-rise',nativePolygon:[[36.8,OUTER_END],[60,OUTER_END],[60,31.5],[36.8,31.5]],heightRule:'source-x-linear-to-sidewalk',startSourceY:UNDERLAY_Y,endWorldLift:.122},
      {name:'outer-high-turn',nativePolygon:[[60,OUTER_END],[61.4,OUTER_END],[61.4,31.5],[60,31.5]],heightRule:'terrain-plus',worldLift:.122},
      {name:'sidewalk-approach',nativePolygon:[[60,31.5],[61.4,31.5],endRight,endLeft],heightRule:'terrain-plus',worldLift:.122},
      {name:'roadside-sidewalk',nativePolygon:[toNative(add(outerPoint(22),normal,-sidewalkWidth)),toNative(add(outerPoint(62.4),normal,-sidewalkWidth)),toNative(outerPoint(62.4)),toNative(outerPoint(22))],heightRule:'terrain-plus',worldLift:.122},
    ],
    passage:{node:'PODIUM east passage paving',material:'Light stone paving',topSourceY:PASSAGE_TOP,
      originalSourceRect:[[32.80037608530704,2.9999335153460898],[37.20000076293945,2.9999335153460898],[37.20000076293945,PASSAGE_FRONT],[32.80037608530704,PASSAGE_FRONT]],
      joinedSourceEdge:[[32.9,PASSAGE_TOP,PASSAGE_FRONT],[33.9,PASSAGE_TOP,PASSAGE_FRONT]],worldTopHeight:passageHeight},
    sourceRamp:{nativePolygon:RAMP_ZONE.map(p=>[...p]),startSourceY:PASSAGE_TOP,endSourceY:UNDERLAY_Y,grade:(PASSAGE_TOP-UNDERLAY_Y)/(RAMP_END-PASSAGE_FRONT)},
    retainedInlayUnderlay:{nativePolygon:UNDERLAY_ZONE.map(p=>[...p]),sourceY:UNDERLAY_Y,material:'Paving course accent',
      method:'new-lower-surface-under-retained-thin-decorative-rings',ringCenterSource:[39,23],ringRadialBands:[[4.63,4.70],[4.93,5.00],[6.73,6.80]],
      detailLowestSourceY:-.10555536251796079,lightLowestSourceY:-.10551009012808164,
      minimumSourceVerticalGap:-.10555536251796079-UNDERLAY_Y,minimumDisplayVerticalGapMetres:(-.10555536251796079-UNDERLAY_Y)*scale/units,
      retainedGeometryChanged:false,filledCircleAssumed:false},
    externalRamp:{nativeX:[36.8,60],nativeZ:[OUTER_END,31.5],lengthDisplayMetres:(60-36.8)*scale/units,
      grade:(roadSurface(...toWorld([60,30.8]))-underlayHeight)/((60-36.8)*scale)},
    sidewalk:{nativeX:[22,62.4],widthMetres:3.6,roadSourceId:road.osmId,roadWidth:road.width,joinedWorldEdge:[outerPoint(60),outerPoint(61.4)]},
    start:[...start],end:[...end],notes:'展示连接，保留原薄环；组团候选定位与相对布局待核，不代表现场入口、实测道路或无障碍通道。'};
  const viewCenter=toWorld([44,29.6]),viewNativeDirection=[.8,1.6,1.7];
  // Fit the long ground subject itself instead of a square around its anchor.
  // These points affect only inspection framing, never the accepted geometry.
  const framePoints=site.paving.flatMap(cell=>cell.points.map(([x,z])=>[x,cell.surface(x,z),z]));
  framePoints.push(...site.lamps.map(lamp=>[lamp.x,lamp.y+6*units,lamp.z]));
  const sourceFramePoint=(x,y,z)=>{const p=toWorld([x,z]);return[p[0],sourceY(y),p[1]];};
  for(const x of [32.80037608530704,37.20000076293945])for(const z of [17,PASSAGE_FRONT])framePoints.push(sourceFramePoint(x,PASSAGE_TOP,z));
  // The union of both retained LODs' decorative-ring bounds, at their actual
  // low heights, keeps all three original rings visible without framing towers.
  for(const x of [32.20024671515856,45.79999923706055])for(const y of [-.10555536251796079,-.08958575252055755])for(const z of [16.19949069868115,29.80038156096331])framePoints.push(sourceFramePoint(x,y,z));
  site.frontageView={center:[viewCenter[0],mix(underlayHeight,roadSurface(...viewCenter),.5),viewCenter[1]],span:1.45,
    direction:[c*viewNativeDirection[0]+s*viewNativeDirection[2],viewNativeDirection[1],-s*viewNativeDirection[0]+c*viewNativeDirection[2]],framePoints};
  return{sites:[site],stats:{streetFrontageConnections:1,streetFrontageConnected:true,streetFrontagePavingCells:site.paving.length,streetFrontageSourceRampGrade:site.connectionEvidence.sourceRamp.grade,streetFrontageExternalRampGrade:site.connectionEvidence.externalRamp.grade},reserveTree(x,z){
    const p=[x,z];if(!near({minX:x,maxX:x,minZ:z,maxZ:z},site.bounds,.15))return false;
    return site.paving.some(cell=>inside(p,cell.points)||edges(cell.points).some(([a,b])=>project(p,a,b).distance<.12))||occupied.some(ring=>inside(p,ring)||edges(ring).some(([a,b])=>project(p,a,b).distance<.12));
  }};
}
