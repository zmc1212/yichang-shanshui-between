// A short, illustrative infill between two existing sidewalk ends. This is
// deliberately narrower than a general road-following pavement generator:
// both ends must already exist on the same side of one straight ground-level
// source-road segment. No road width, authored transform or prior site changes.
const PAIR = ['jiuzhou-s01', 'shouxin-wealth-s01'];
const EPS = 1e-9;
const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
const mix = (a,b,t) => a+(b-a)*t;
const interpolate = (a,b,t) => [mix(a[0],b[0],t),mix(a[1],b[1],t)];
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
function makePath(road) {
  const segments=[];let length=0;
  for(let i=1;i<road.points.length;i++){
    const a=road.points[i-1],b=road.points[i],span=distance(a,b);
    if(span>EPS){segments.push({a,b,at:length,length:span,index:i-1});length+=span;}
  }
  return {segments,length};
}
function projectToPath(p,path) {
  let best=null;
  for(const segment of path.segments){const hit=project(p,segment.a,segment.b);if(!best||hit.distance<best.distance)best={...hit,at:segment.at+hit.t*segment.length,segment};}
  return best;
}
function sidewalkSections(site,path,side,inner,outer) {
  const output=[];
  for(const cell of site.paving){
    if(!['sidewalk','accent'].includes(cell.role)||cell.points.length!==4)continue;
    for(const[a,b]of edges(cell.points)){
      const pa=projectToPath(a,path),pb=projectToPath(b,path);
      const offset=(p,hit)=>side*((p[0]-hit.point[0])*-hit.tangent[1]+(p[1]-hit.point[1])*hit.tangent[0]);
      const da=offset(a,pa),db=offset(b,pb);
      if(Math.abs(pa.at-pb.at)>1e-7)continue;
      if(Math.abs(da-inner)<1e-7&&Math.abs(db-outer)<1e-7)output.push({inner:[...a],outer:[...b],at:(pa.at+pb.at)/2,segment:pa.segment});
      if(Math.abs(db-inner)<1e-7&&Math.abs(da-outer)<1e-7)output.push({inner:[...b],outer:[...a],at:(pa.at+pb.at)/2,segment:pa.segment});
    }
  }
  return output;
}
function curb(a,b) {
  const length=distance(a,b),normal=[-(b[1]-a[1])/length,(b[0]-a[0])/length];
  return {a:[...a],b:[...b],footprint:[
    [a[0]-normal[0]*.002,a[1]-normal[1]*.002],
    [b[0]-normal[0]*.002,b[1]-normal[1]*.002],
    [b[0]+normal[0]*.002,b[1]+normal[1]*.002],
    [a[0]+normal[0]*.002,a[1]+normal[1]*.002],
  ]};
}
const atSourceGround = road => road.kind!=='bridge'&&(!road.bridge||['no','false','0'].includes(String(road.bridge)))&&(!road.tunnel||['no','false','0'].includes(String(road.tunnel)))&&Number(road.layer||0)===0;

export function planContinuousStreetSites({data,authoredModels,authoredGround,waterfrontPlan,inWater,heightAt,sites}) {
  const empty=reason=>({sites:[],stats:{streetLinks:0,streetLinkLengthMetres:0},reserveTree:()=>false,reason});
  const pair=PAIR.map(id=>sites.find(site=>site.id===id));
  if(pair.some(site=>!site))return empty('missing-existing-sidewalk');
  if(pair.some(site=>site.roadSourceId!==pair[0].roadSourceId||site.roadWidth!==pair[0].roadWidth))return empty('different-source-road');
  const road=data.roads.find(item=>item.osmId===pair[0].roadSourceId);
  if(!road||!atSourceGround(road))return empty('ineligible-source-road');
  const units=Number(data.meta.unitsPerMeter)||.02,path=makePath(road);
  if(!path.segments.length)return empty('empty-source-road');
  const inner=road.width/2+.014,outer=inner+3.6*units;
  const ends=pair.map(site=>{
    const p=site.entranceRoute.at(-1)||site.sourceAnchor,hit=projectToPath(p,path);
    const side=Math.sign((p[0]-hit.point[0])*-hit.tangent[1]+(p[1]-hit.point[1])*hit.tangent[0]);
    return {site,side,at:hit.at,sections:sidewalkSections(site,path,side,inner,outer)};
  }).sort((a,b)=>a.at-b.at);
  if(!ends[0].side||ends[0].side!==ends[1].side||ends.some(end=>!end.sections.length))return empty('no-matching-same-side-ends');
  const start=ends[0].sections.reduce((a,b)=>a.at>b.at?a:b),end=ends[1].sections.reduce((a,b)=>a.at<b.at?a:b);
  const length=end.at-start.at;
  // This known gap is about 31 m and lies within one straight source segment.
  // A future source change to a corner or a longer/missing link needs review.
  if(length<1*units||length>60*units||start.segment.index!==end.segment.index)return empty('unreviewed-gap-or-road-bend');
  for(const [site,section]of [[ends[0].site,start],[ends[1].site,end]]){
    if(![section.inner,section.outer].every(p=>site.curbs.some(c=>distance(p,c.a)<1e-8||distance(p,c.b)<1e-8)))return empty('missing-curb-join');
  }
  const from=interpolate(start.inner,start.outer,.5),to=interpolate(end.inner,end.outer,.5);
  const vector=[to[0]-from[0],to[1]-from[1]],lengthSq=vector[0]**2+vector[1]**2;
  const groundLift=(x,z)=>{
    const t=Math.max(0,Math.min(1,((x-from[0])*vector[0]+(z-from[1])*vector[1])/lengthSq)),smooth=t*t*(3-2*t);
    return mix(ends[0].site.groundLift(x,z),ends[1].site.groundLift(x,z),smooth);
  };
  const count=Math.ceil(length/(3*units)),paving=[],curbs=[];
  for(let i=0;i<count;i++){
    const a0=i?interpolate(start.inner,end.inner,i/count):[...start.inner],a1=i+1===count?[...end.inner]:interpolate(start.inner,end.inner,(i+1)/count);
    const b0=i?interpolate(start.outer,end.outer,i/count):[...start.outer],b1=i+1===count?[...end.outer]:interpolate(start.outer,end.outer,(i+1)/count);
    paving.push({points:[a0,a1,b1,b0],role:'sidewalk'});
    curbs.push(curb(a0,a1),curb(b0,b1));
  }
  const allRings=[...paving.map(p=>p.points),...curbs.map(c=>c.footprint)],bounds=box(allRings.flat());
  const buildings=[...(data.buildings||[]).filter((_,i)=>!authoredGround.omittedBuildingIndices.has(i)&&!waterfrontPlan?.omittedBuildingIndices?.has(i)),...(authoredGround.retainedBuildings||[])]
    .map(b=>b.rings||[b.ring]).filter(r=>r[0]?.length>2);
  buildings.push(...authoredModels.map(model=>[model.footprint]));
  const obstacles=[...buildings,...(data.water||[]).map(w=>w.rings||[w.ring])].map(rings=>({rings,bounds:box(rings[0])})).filter(item=>near(bounds,item.bounds,.006));
  const roadSegments=data.roads.flatMap(r=>r.points.slice(1).map((b,i)=>({a:r.points[i],b,width:r.width||.12,bounds:box([r.points[i],b])}))).filter(r=>near(bounds,r.bounds,r.width/2+.006));
  const existingPaving=sites.flatMap(site=>site.paving.map(cell=>cell.points)).map(ring=>({ring,bounds:box(ring)})).filter(o=>near(bounds,o.bounds));
  const existingCurbs=sites.flatMap(site=>site.curbs.map(c=>c.footprint)).map(ring=>({ring,bounds:box(ring)})).filter(o=>near(bounds,o.bounds));
  const furniture=sites.flatMap(site=>['trees','lamps','benches'].flatMap(kind=>site[kind].map(item=>item.safetyFootprint))).map(ring=>({ring,bounds:box(ring)})).filter(o=>near(bounds,o.bounds));
  for(const ring of allRings){
    const candidateBounds=box(ring);
    if(ring.some(p=>Math.abs(p[0])>=data.meta.width/2||Math.abs(p[1])>=data.meta.depth/2||inWater(p[0],p[1])))return empty('board-or-water-conflict');
    for(const obstacle of obstacles){
      if(!near(candidateBounds,obstacle.bounds,.006))continue;
      if(obstacle.rings.slice(1).some(h=>ring.every(p=>inside(p,h))&&boundaryDistance(ring,h)>.006))continue;
      if(polygonDistance(ring,obstacle.rings[0])<.006)return empty('building-or-water-conflict');
    }
    for(const r of roadSegments){
      if(!near(candidateBounds,r.bounds,r.width/2+.006))continue;
      if(inside(r.a,ring)||inside(r.b,ring)||edges(ring).some(([a,b])=>edgeDistance(a,b,r.a,r.b)<r.width/2+.006))return empty('road-conflict');
    }
    for(const o of [...existingPaving,...existingCurbs,...furniture])if(near(candidateBounds,o.bounds)&&overlapArea(ring,o.ring)>1e-11)return empty('existing-surface-or-furniture-conflict');
    // Independent water predicates may contain detail absent from polygons.
    const nx=Math.max(2,Math.ceil((candidateBounds.maxX-candidateBounds.minX)/units)),nz=Math.max(2,Math.ceil((candidateBounds.maxZ-candidateBounds.minZ)/units));
    for(let i=0;i<=nx;i++)for(let j=0;j<=nz;j++){
      const p=[mix(candidateBounds.minX,candidateBounds.maxX,i/nx),mix(candidateBounds.minZ,candidateBounds.maxZ,j/nz)];
      if(inside(p,ring)&&(inWater(p[0],p[1])||!Number.isFinite(heightAt(...p)+groundLift(...p))))return empty('interior-water-or-invalid-height');
    }
  }
  const site={id:'jiuzhou-shouxin-walk',kind:'street-link',connectedSiteIds:ends.map(end=>end.site.id),roadName:road.name,roadSourceId:road.osmId,roadWidth:road.width,
    sourceAnchor:interpolate(from,to,.5),units,paving,curbs,trees:[],lamps:[],benches:[],entranceRoute:[],illustrative:true,bounds,groundLift,
    connectionEvidence:{method:'existing-same-side-sidewalk-end-infill',sourceSegmentIndex:start.segment.index,lengthMetres:length/units,widthMetres:3.6,
      start:{siteId:ends[0].site.id,inner:[...start.inner],outer:[...start.outer],sourceRoadStationMetres:start.at/units},
      end:{siteId:ends[1].site.id,inner:[...end.inner],outer:[...end.outer],sourceRoadStationMetres:end.at/units},surveyed:false}};
  return {sites:[site],stats:{streetLinks:1,streetLinkLengthMetres:length/units},reserveTree(x,z){
    const p=[x,z];if(!near({minX:x,maxX:x,minZ:z,maxZ:z},bounds,.15))return false;
    return paving.some(cell=>inside(p,cell.points)||edges(cell.points).some(([a,b])=>project(p,a,b).distance<.12));
  }};
}
