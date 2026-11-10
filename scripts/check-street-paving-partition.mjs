import assert from 'node:assert/strict';
import { partitionStreetPaving } from '../src/scene/streetPavingPartition.js';

const cross = (a,b,p) => (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
const polygonArea = p => Math.abs(p.slice(1,-1).reduce((sum,q,i)=>sum+cross(p[0],q,p[i+2]),0))/2;
const sumArea = cells => cells.reduce((sum,c)=>sum+polygonArea(c.points),0);
const rect = (x0,z0,x1,z1,zone='forecourt') => ({points:[[x0,z0],[x1,z0],[x1,z1],[x0,z1]],zone,role:zone});
const close = (a,b,label,tolerance=1e-10) => assert(Math.abs(a-b)<=tolerance,`${label}: ${a} != ${b}`);
const inside = (point,ring,strict=false) => {
  const signs=ring.map((a,i)=>cross(a,ring[(i+1)%ring.length],point));
  return signs.every(v=>strict?v>1e-9:v>=-1e-9)||signs.every(v=>strict?v< -1e-9:v<=1e-9);
};
const validate = (source,result) => {
  for(const cell of result.cells){
    assert(cell.points.length>=3 && cell.points.every(p=>p.every(Number.isFinite)));
    assert.equal(cell.conforming,true);
    assert(polygonArea(cell.points)>1e-14);
    assert(cell.points.every(p=>inside(p,source[cell.sourcePavingIndex].points)),'Every output point remains within its original accepted safe cell');
    // The centre-to-boundary triangles partition the retained convex polygon.
    const center=cell.points.reduce((p,q)=>[p[0]+q[0]/cell.points.length,p[1]+q[1]/cell.points.length],[0,0]);
    const triangleArea=cell.points.reduce((sum,p,i)=>sum+Math.abs(cross(center,p,cell.points[(i+1)%cell.points.length]))/2,0);
    close(triangleArea,polygonArea(cell.points),'Centre fan covers its polygon');
  }
};

const surface=(x,z)=>.01*x*x+.04*z*z;
const source=[{...rect(0,0,8,4),surface,role:'accent'},rect(6,-2,10,6,'sidewalk'),rect(2,1,8,3,'connection')];
const snapshot=JSON.stringify(source),result=partitionStreetPaving(source);
validate(source,result);
assert.equal(JSON.stringify(source),snapshot,'Ownership cannot mutate source geometry or metadata');
assert(result.cells.filter(c=>c.sourcePavingIndex===0).every(c=>c.surface===surface && c.role==='accent'),'Accent appearance and custom surface survive clipping');
close(result.stats.sourceArea,76,'Source area');close(sumArea(result.cells),56,'Closed-form union area');
close(sumArea(result.cells.filter(c=>c.zone==='connection')),12,'Full-width connection owns its complete original area');
close(sumArea(result.cells.filter(c=>c.zone==='sidewalk')),28,'Sidewalk keeps its area except the continuous connection');
close(result.stats.removedOverlapArea,20,'Overlapping surface removed exactly once');

// Independent sample coverage catches duplicate ownership and missing holes.
for(let x=-.13;x<10;x+=.137)for(let z=-2.07;z<6;z+=.193){
  const expected=source.some(c=>inside([x,z],c.points,true));
  const owners=result.cells.filter(c=>inside([x,z],c.points,true));
  assert(owners.length<=1,'Positive-area overlap has only one owner');
  if(expected && !owners.length)assert(result.cells.some(c=>inside([x,z],c.points)),'The input union stays fully covered');
}

const detached=[...source,rect(20,0,22,2),rect(10,6,12,8)];
const connected=partitionStreetPaving(detached,{connectedToZone:'connection'});
validate(detached,connected);close(sumArea(connected.cells),56,'Disconnected and point-touching patches omitted');
close(connected.stats.disconnectedArea,8,'Discarded area is reported independently of overlap');
assert(!connected.cells.some(c=>c.sourcePavingIndex>=3));
assert.equal(partitionStreetPaving([rect(0,0,2,2)],{connectedToZone:'connection'}).cells.length,0,'Missing access seed cannot imply a connected street');

const reversed=source.map(c=>({...c,points:[...c.points].reverse()}));
const mirrored=partitionStreetPaving(reversed);validate(reversed,mirrored);close(sumArea(mirrored.cells),56,'Reversed winding is accepted');
const duplicate=partitionStreetPaving([rect(0,0,2,2),rect(0,0,2,2,'connection')]);
assert.equal(duplicate.cells.length,1);assert.equal(duplicate.cells[0].zone,'connection');
const touch=partitionStreetPaving([rect(0,0,1,1),rect(1,0,2,1)]);
assert.equal(touch.cells.length,2);close(touch.stats.removedOverlapArea,0,'Touching is not overlap');

// City-scale coordinates and source widths retain the same exact area.
const translated=source.map(c=>({...c,points:c.points.map(([x,z])=>[-31+x*.02,8+z*.02])}));
const small=partitionStreetPaving(translated);validate(translated,small);close(sumArea(small.cells),56*.0004,'Small polygons at translated city coordinates');

// Analytic area of this oblique diamond + square: 8 + 4 - 3 = 9.
const oblique=[{points:[[-2,0],[0,-2],[2,0],[0,2]],zone:'forecourt'},rect(0,-1,2,1,'sidewalk')];
const diagonal=partitionStreetPaving(oblique);validate(oblique,diagonal);close(sumArea(diagonal.cells),9,'Oblique overlap');

// Independent axis-aligned sweep gives a deterministic many-polygon union.
const rectangles=Array.from({length:24},(_,i)=>rect((i*7%13)/2,(i*11%17)/3,(i*7%13)/2+1+(i%4)/3,(i*11%17)/3+.6+(i%5)/4,i%3===0?'sidewalk':'forecourt'));
const xs=[...new Set(rectangles.flatMap(c=>c.points.map(p=>p[0])))].sort((a,b)=>a-b);
let sweepArea=0;
for(let i=1;i<xs.length;i++){
  const mid=(xs[i-1]+xs[i])/2;
  const intervals=rectangles.filter(c=>c.points[0][0]<mid && c.points[1][0]>mid).map(c=>[c.points[0][1],c.points[2][1]]).sort((a,b)=>a[0]-b[0]);
  let end=-Infinity,total=0;
  for(const [a,b]of intervals){total+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}
  sweepArea+=(xs[i]-xs[i-1])*total;
}
const many=partitionStreetPaving(rectangles);validate(rectangles,many);close(sumArea(many.cells),sweepArea,'Independent vertical sweep union');

// Every junction point on an edge is explicit in both adjacent rings. This
// permits the actual renderer to use identical sampled Y and UV coordinates.
let sharedJunctions=0;
for(const cell of result.cells)for(const p of result.cells.flatMap(c=>c.points))for(let i=0;i<cell.points.length;i++){
  const a=cell.points[i],b=cell.points[(i+1)%cell.points.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
  const onSegment=Math.abs(cross(a,b,p))/length<1e-9 && (p[0]-a[0])*(p[0]-b[0])+(p[1]-a[1])*(p[1]-b[1])< -1e-10;
  assert(!onSegment,'No other retained vertex can lie inside an unsplit boundary edge');
  if(Math.hypot(p[0]-a[0],p[1]-a[1])<1e-9)sharedJunctions++;
}
assert(sharedJunctions>0);
assert.throws(()=>partitionStreetPaving([{points:[[0,0],[2,0],[1,1],[2,2],[0,2]]}]),/convex/);
assert.throws(()=>partitionStreetPaving([{points:[[0,0],[NaN,1],[1,0]]}]),/finite/);
assert.deepEqual(partitionStreetPaving([]).cells,[]);
console.log(JSON.stringify({passed:true,checks:14,obliqueArea:sumArea(diagonal.cells),unionArea:sumArea(result.cells),fullConnectionArea:sumArea(result.cells.filter(c=>c.zone==='connection')),disconnectedArea:connected.stats.disconnectedArea,manyPolygonSweepArea:sweepArea,conformingBoundaryVertices:result.stats.boundaryVertices},null,2));
