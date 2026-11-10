import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { resolveBuildingInspection } from './buildingInspection.js';

// These are bounded presentation areas derived from the registered model's
// complete bounds, including its existing stairs/canopies. They do not claim
// a surveyed entrance or extend the model's source parcel.
const STREET_SITES = [
  { id: 'shouxin-wealth-s01', roadName: '沿江大道', courtDepth: 9, halfRun: 55,
    treeSpan: 48, treeStep: 12, lampOffsets: [-42,-18,18,42], benchOffsets: [-31,31] },
  { id: 'wanda-soho-s01', roadName: '沿江大道', courtDepth: 6, halfRun: 118, followModelEntrance: true,
    treeSpan: 96, treeStep: 24, lampOffsets: [-87,-43,43,87], benchOffsets: [-65,65] },
  { id: 'jiuzhou-s01', roadName: '沿江大道', courtDepth: 7, halfRun: 50, followModelEntrance: true,
    treeSpan: 42, treeStep: 14, lampOffsets: [-35,35], benchOffsets: [-22,22] },
];
const EPS = 1e-9;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a + (b - a) * t;
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const add = (p, n, amount) => [p[0] + n[0] * amount, p[1] + n[1] * amount];
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const edges = ring => ring.map((p, i) => [p, ring[(i + 1) % ring.length]]);

function project(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], lengthSq = dx * dx + dz * dz;
  const t = lengthSq ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / lengthSq, 0, 1) : 0;
  const point = [a[0] + t * dx, a[1] + t * dz];
  return { point, t, distance: distance(p, point) };
}
function inside(p, ring) {
  let hit = false;
  for (const [a, b] of edges(ring)) {
    if (project(p, a, b).distance < EPS) return true;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}
function segmentDistance(a, b, c, d) {
  if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return 0;
  return Math.min(project(a, c, d).distance, project(b, c, d).distance, project(c, a, b).distance, project(d, a, b).distance);
}
function boundaryDistance(a, b) {
  let nearest = Infinity;
  for (const [p, q] of edges(a)) for (const [r, s] of edges(b)) nearest = Math.min(nearest, segmentDistance(p, q, r, s));
  return nearest;
}
function ringDistance(a, b) {
  if (a.some(p => inside(p, b)) || b.some(p => inside(p, a))) return 0;
  return boundaryDistance(a,b);
}
function bounds(points) {
  return { minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])), minZ: Math.min(...points.map(p => p[1])), maxZ: Math.max(...points.map(p => p[1])) };
}
const boxesNear = (a, b, pad = 0) => a.maxX + pad >= b.minX && b.maxX + pad >= a.minX && a.maxZ + pad >= b.minZ && b.maxZ + pad >= a.minZ;
function rectangle(center, tangent, normal, width, depth) {
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([u, v]) => add(add(center, tangent, u * width / 2), normal, v * depth / 2));
}
function circle(center, radius, count = 16) {
  return Array.from({ length: count }, (_, i) => [center[0] + Math.cos(i / count * Math.PI * 2) * radius, center[1] + Math.sin(i / count * Math.PI * 2) * radius]);
}
function pointOnPath(path, at) {
  const bounded = clamp(at, 0, path.length);
  let i = 1; while (i < path.points.length - 1 && path.lengths[i] < bounded) i++;
  const a = path.points[i - 1], b = path.points[i], length = distance(a, b);
  const t = length ? clamp((bounded - path.lengths[i - 1]) / length, 0, 1) : 0;
  return { point: [mix(a[0], b[0], t), mix(a[1], b[1], t)], tangent: length ? [(b[0] - a[0]) / length, (b[1] - a[1]) / length] : [1, 0] };
}
function makePath(road) {
  const points = (road.points || []).filter((p, i, all) => p?.length === 2 && p.every(Number.isFinite) && (!i || distance(p, all[i - 1]) > EPS));
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths.at(-1) + distance(points[i - 1], points[i]));
  return { road, points, lengths, length: lengths.at(-1), width: Number(road.width) || 0.12 };
}

function planStreetSite({ data, authoredModels, authoredGround, waterfrontPlan, inWater, heightAt, allPaths, model, settings }) {
  const units = Number(data.meta.unitsPerMeter) || 0.02;
  const empty = { sites: [], stats: { streetSites: 0 }, reserveTree: () => false };
  if (!model) return empty;
  const center = [model.x, model.z], front = [Math.sin(model.yaw), Math.cos(model.yaw)], tangent = [Math.cos(model.yaw), -Math.sin(model.yaw)];
  const frontCenter = add(center, front, model.localSize.z / 2);
  // The existing inspection subject locates the visible entry in the authored
  // frame. Project only its lateral position onto the complete model bounds:
  // neither the new path nor its court may replace existing steps/canopies.
  const entrySubject = settings.followModelEntrance ? resolveBuildingInspection(model, 0, 'entrance') : null;
  const entryLateral = entrySubject ? (entrySubject.center.x-model.x)*tangent[0] + (entrySubject.center.z-model.z)*tangent[1] : 0;
  const entryFront = add(frontCenter, tangent, entryLateral);
  let nearest = null;
  for (const path of allPaths) {
    // A nearby bridge or tunnel is never assumed to be an accessible sidewalk.
    if (path.road.name !== settings.roadName || path.road.kind === 'bridge' || (path.road.bridge != null && !['no','false','0',''].includes(String(path.road.bridge))) || (path.road.tunnel && path.road.tunnel !== 'no') || Number(path.road.layer || 0) !== 0) continue;
    for (let i = 1; i < path.points.length; i++) {
      const p = project(entryFront, path.points[i - 1], path.points[i]);
      if (!nearest || p.distance < nearest.distance) nearest = { ...p, path, at: path.lengths[i - 1] + p.t * distance(path.points[i - 1], path.points[i]) };
    }
  }
  if (!nearest || nearest.distance > 80 * units) return empty;

  const siteBounds = { minX: model.x - 4, maxX: model.x + 4, minZ: model.z - 4, maxZ: model.z + 4 };
  const buildings = [...(data.buildings || []).filter((_, i) => !authoredGround.omittedBuildingIndices.has(i) && !waterfrontPlan?.omittedBuildingIndices?.has(i)), ...(authoredGround.retainedBuildings || [])]
    .filter(b => b.ring?.length > 2).map(b => ({ rings: b.rings || [b.ring], bounds: bounds(b.ring) })).filter(b => boxesNear(siteBounds, b.bounds));
  // Model bounds include stairs/canopies and are stricter than a source parcel.
  for (const spec of authoredModels) if (boxesNear(siteBounds, bounds(spec.footprint))) buildings.push({ rings: [spec.footprint], bounds: bounds(spec.footprint), authored: true });
  const water = (data.water || []).map(p => ({ rings: p.rings || [p.ring], bounds: bounds((p.rings || [p.ring])[0]) })).filter(p => boxesNear(siteBounds, p.bounds));
  const roadSegments = [];
  for (const path of allPaths) for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1], b = path.points[i], box = bounds([a, b]);
    if (boxesNear(siteBounds, box, path.width)) roadSegments.push({ a, b, width: path.width, bounds: box, road: path.road });
  }
  function polygonSafe(ring, clearance = 0.006) {
    const box = bounds(ring);
    if (ring.some(p => Math.abs(p[0]) >= data.meta.width / 2 || Math.abs(p[1]) >= data.meta.depth / 2 || inWater(p[0], p[1]))) return false;
    for (const b of buildings) {
      if (!boxesNear(box, b.bounds, clearance)) continue;
      // Source holes are respected when an entire candidate is in one hole.
      if (b.rings.slice(1).some(hole => ring.every(p => inside(p, hole)) && boundaryDistance(ring, hole) > clearance)) continue;
      if (ringDistance(ring, b.rings[0]) < clearance) return false;
    }
    for (const polygon of water) {
      if (!boxesNear(box, polygon.bounds)) continue;
      if (polygon.rings.slice(1).some(hole => ring.every(p => inside(p, hole)) && boundaryDistance(ring, hole) > clearance)) continue;
      if (ringDistance(ring, polygon.rings[0]) < clearance) return false;
    }
    for (const road of roadSegments) {
      if (!boxesNear(box, road.bounds, road.width / 2 + clearance)) continue;
      if (inside(road.a, ring) || inside(road.b, ring)) return false;
      for (const [a, b] of edges(ring)) if (segmentDistance(a, b, road.a, road.b) < road.width / 2 + clearance) return false;
    }
    // Sample interiors as well, guarding holes/very small water pieces supplied
    // through inWater even when no polygon object was made available.
    const stepsX = Math.max(2, Math.ceil((box.maxX - box.minX) / (1.5 * units))), stepsZ = Math.max(2, Math.ceil((box.maxZ - box.minZ) / (1.5 * units)));
    for (let i = 0; i <= stepsX; i++) for (let j = 0; j <= stepsZ; j++) {
      const p = [mix(box.minX, box.maxX, i / stepsX), mix(box.minZ, box.maxZ, j / stepsZ)];
      if (inside(p, ring) && inWater(p[0], p[1])) return false;
    }
    return true;
  }
  function groundLift(x, z) {
    const p = [x, z], buildingDistance = Math.min(...edges(model.footprint).map(([a, b]) => project(p, a, b).distance));
    const roadDistance = Math.max(0, Math.min(...roadSegments.map(r => project(p, r.a, r.b).distance - r.width / 2)));
    const t = buildingDistance / Math.max(EPS, buildingDistance + roadDistance);
    // Existing road surfaces and building bases use different display lifts.
    // This continuous shallow ramp joins them, instead of a raised platform.
    return 0.055 + 0.067 * t * t * (3 - 2 * t);
  }
  const site = { id: model.id, roadName: nearest.path.road.name, roadSourceId: nearest.path.road.osmId || null, roadWidth: nearest.path.width, sourceAnchor: [...center], frontBearingDeg: model.registration.frontBearingDeg,
    paving: [], curbs: [], trees: [], lamps: [], benches: [], entranceRoute: [], illustrative: true, groundLift };
  if (entrySubject) site.entranceReference = { method: 'authored-visible-subject-lateral-projection',
    sourceCenter: entrySubject.sourceCenter.toArray(), lateralOffset: entryLateral, surveyed: false };
  const pavingKeys = new Set();
  function addPaving(points, role) {
    if (!polygonSafe(points)) return false;
    const key = points.map(p => p.map(v => v.toFixed(5)).join(',')).sort().join(';');
    if (pavingKeys.has(key)) return true;
    pavingKeys.add(key); site.paving.push({ points, role }); return true;
  }

  // A narrow forecourt along the documented front, split into restrained slabs.
  // The model's complete bounds, including entrance stairs, remain untouched.
  const courtWidth = model.localSize.x + 3 * units, courtDepth = settings.courtDepth * units, slab = 3 * units;
  const nx = Math.ceil(courtWidth / slab), nz = Math.ceil(courtDepth / slab);
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const u0 = -courtWidth / 2 + courtWidth * i / nx, u1 = -courtWidth / 2 + courtWidth * (i + 1) / nx;
    const v0 = 0.009 + courtDepth * j / nz, v1 = 0.009 + courtDepth * (j + 1) / nz;
    addPaving([[u0,v0],[u1,v0],[u1,v1],[u0,v1]].map(([u,v]) => add(add(frontCenter, tangent, u), front, v)), (i + j) % 7 === 0 ? 'accent' : 'forecourt');
  }

  const roadSample = pointOnPath(nearest.path, nearest.at);
  const baseNormal = [-roadSample.tangent[1], roadSample.tangent[0]];
  const side = (center[0] - nearest.point[0]) * baseNormal[0] + (center[1] - nearest.point[1]) * baseNormal[1] >= 0 ? 1 : -1;
  const normalAt = sample => [-sample.tangent[1] * side, sample.tangent[0] * side];
  const sidewalkInner = nearest.path.width / 2 + 0.014, sidewalkWidth = 3.6 * units, halfRun = settings.halfRun * units;
  const startAt = Math.max(0, nearest.at - halfRun), endAt = Math.min(nearest.path.length, nearest.at + halfRun);
  const runSteps = Math.ceil((endAt - startAt) / (3 * units));
  const acceptedSidewalk = [];
  for (let i = 0; i < runSteps; i++) {
    const a = pointOnPath(nearest.path, mix(startAt, endAt, i / runSteps)), b = pointOnPath(nearest.path, mix(startAt, endAt, (i + 1) / runSteps));
    const an = normalAt(a), bn = normalAt(b);
    const points = [add(a.point, an, sidewalkInner), add(b.point, bn, sidewalkInner), add(b.point, bn, sidewalkInner + sidewalkWidth), add(a.point, an, sidewalkInner + sidewalkWidth)];
    if (!addPaving(points, i % 8 === 0 ? 'accent' : 'sidewalk')) continue;
    acceptedSidewalk.push({ a, b, at: mix(startAt, endAt, (i + .5) / runSteps) });
    for (const offset of [sidewalkInner, sidewalkInner + sidewalkWidth]) {
      const p = add(a.point, an, offset), q = add(b.point, bn, offset), mid = [mix(p[0],q[0],.5),mix(p[1],q[1],.5)];
      const t = [(q[0]-p[0])/distance(p,q), (q[1]-p[1])/distance(p,q)], n = [-t[1],t[0]];
      const footprint = rectangle(mid, t, n, distance(p,q), .004);
      if (polygonSafe(footprint, .004)) site.curbs.push({ a:p, b:q, footprint });
    }
  }

  // The pedestrian connection ends at the building-side sidewalk edge. It
  // never crosses a carriageway, including the mapped residential junction.
  const routeStart = add(entryFront, front, courtDepth + .009), routeEnd = add(roadSample.point, normalAt(roadSample), sidewalkInner + sidewalkWidth);
  const routeVector = [routeEnd[0] - routeStart[0], routeEnd[1] - routeStart[1]], routeLength = Math.hypot(...routeVector);
  const routeWidth = 4.6 * units;
  const endDirection = roadSample.tangent[0] * tangent[0] + roadSample.tangent[1] * tangent[1] < 0 ? roadSample.tangent.map(v => -v) : roadSample.tangent;
  const leftStart = add(routeStart, tangent, -routeWidth / 2), rightStart = add(routeStart, tangent, routeWidth / 2);
  const leftEnd = add(routeEnd, endDirection, -routeWidth / 2), rightEnd = add(routeEnd, endDirection, routeWidth / 2);
  const routeCount = Math.ceil(routeLength / (2.5 * units));
  const routeCells = [];
  for (let i = 0; i < routeCount; i++) {
    const interpolate = (a,b,t) => [mix(a[0],b[0],t),mix(a[1],b[1],t)];
    const points = [interpolate(leftStart,leftEnd,i/routeCount),interpolate(leftStart,leftEnd,(i+1)/routeCount),interpolate(rightStart,rightEnd,(i+1)/routeCount),interpolate(rightStart,rightEnd,i/routeCount)];
    routeCells.push(points);
  }
  // A partially clipped route would imply access where none exists: retain a
  // route only when every cell is clear. Forecourt and sidewalk remain valid.
  if (routeCells.every(points => polygonSafe(points))) {
    routeCells.forEach(points => addPaving(points, 'connection'));
    site.entranceRoute = [[...routeStart],[...routeEnd]];
  }

  const occupied = [];
  function place(kind, at, offset, width, depth, reserveRadius = 0) {
    const sample = pointOnPath(nearest.path, at), normal = normalAt(sample), p = add(sample.point, normal, offset);
    const footprint = rectangle(p, sample.tangent, normal, width, depth);
    const safetyFootprint = reserveRadius ? circle(p, reserveRadius) : footprint;
    if (!polygonSafe(safetyFootprint, 0.009) || occupied.some(item => ringDistance(safetyFootprint, item) < .035)) return;
    // Keep the entire entrance path and its waiting area free of furniture.
    if (site.entranceRoute.length && project(p, ...site.entranceRoute).distance < routeWidth * .8 + Math.max(width,depth)/2) return;
    if (!site.paving.some(cell => cell.role === 'sidewalk' || cell.role === 'accent' ? ringDistance(safetyFootprint, cell.points) < .15 : false)) return;
    occupied.push(safetyFootprint);
    site[kind].push({ x:p[0], z:p[1], angle:Math.atan2(normal[0],normal[1]), footprint, safetyFootprint, width, depth, y:heightAt(p[0],p[1])+groundLift(p[0],p[1]) });
  }
  // Even spacing, limited counts, and genuine metre sizes (0.02 unit/m here).
  for (let at = nearest.at - settings.treeSpan * units; at <= nearest.at + settings.treeSpan * units; at += settings.treeStep * units) place('trees', at, sidewalkInner + sidewalkWidth + 2.8 * units, 2.3 * units, 2.3 * units, 2.8 * units);
  for (const metres of settings.lampOffsets) place('lamps', nearest.at + metres * units, sidewalkInner + sidewalkWidth * .42, .7 * units, .7 * units, 1.3 * units);
  for (const metres of settings.benchOffsets) place('benches', nearest.at + metres * units, sidewalkInner + sidewalkWidth * .8, 2.1 * units, .75 * units);
  site.bounds = bounds([...site.paving.flatMap(p => p.points), ...occupied.flat()]);
  site.units = units;
  const stats = { streetSites: 1, streetPavingCells: site.paving.length, streetCurbSegments: site.curbs.length, streetTrees: site.trees.length, streetLamps: site.lamps.length, streetBenches: site.benches.length, streetEntranceConnected: site.entranceRoute.length === 2, streetIllustrative: true, streetMarkings: 0 };
  return { sites:[site], stats, reserveTree(x,z) {
    const p=[x,z];
    if (!boxesNear({minX:x,maxX:x,minZ:z,maxZ:z},site.bounds,.15)) return false;
    return site.paving.some(cell => inside(p,cell.points) || edges(cell.points).some(([a,b])=>project(p,a,b).distance<.12)) || occupied.some(ring=>inside(p,ring)||edges(ring).some(([a,b])=>project(p,a,b).distance<.12));
  } };
}

/** Reusable bounded streets, with fixed geographic transforms and conservative
 * same-ground road access. Every surface is illustrative, never a survey. */
export function planStreetDetails(options) {
  const allPaths = (options.data.roads || []).map(makePath).filter(path => path.points.length > 1);
  const plans = STREET_SITES.map(settings => planStreetSite({ ...options, allPaths, settings,
    model: options.authoredModels.find(item => item.id === settings.id) }));
  const sites = plans.flatMap(plan => plan.sites);
  const sum = key => sites.reduce((total, site) => total + site[key].length, 0);
  const connected = sites.filter(site => site.entranceRoute.length === 2).length;
  return { sites, stats: {
    streetSites: sites.length, streetPavingCells: sum('paving'), streetCurbSegments: sum('curbs'),
    streetTrees: sum('trees'), streetLamps: sum('lamps'), streetBenches: sum('benches'),
    streetEntranceConnected: sites.length > 0 && connected === sites.length,
    streetEntrancesConnected: connected, streetIllustrative: true, streetMarkings: 0,
    streetSiteIds: sites.map(site => site.id),
    streetSiteSummaries: sites.map(site => ({ id: site.id, roadName: site.roadName, sourceRoad: site.roadSourceId,
      pavingCells: site.paving.length, curbSegments: site.curbs.length, trees: site.trees.length,
      lamps: site.lamps.length, benches: site.benches.length, entranceConnected: site.entranceRoute.length === 2,
      illustrative: site.illustrative })),
  }, reserveTree: (x,z) => plans.some(plan => plan.reserveTree(x,z)) };
}

function quadsGeometry(cells, surface) {
  const positions=[],normals=[],step=.002;
  for(const cell of cells){
    const signedArea=edges(cell.points).reduce((sum,[a,b])=>sum+a[0]*b[1]-b[0]*a[1],0);
    // Consistent upward winding plus normals from the same height function
    // avoids alternating face lighting along slab and path boundaries.
    for(const index of signedArea>0?[0,2,1,0,3,2]:[0,1,2,0,2,3]){
      const p=cell.points[index];positions.push(p[0],surface(p[0],p[1]),p[1]);
      const dx=(surface(p[0]+step,p[1])-surface(p[0]-step,p[1]))/(2*step),dz=(surface(p[0],p[1]+step)-surface(p[0],p[1]-step))/(2*step),length=Math.hypot(dx,1,dz);
      normals.push(-dx/length,1/length,-dz/length);
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));return geometry;
}
function combine(parts) {
  const expanded=parts.map(g=>{const p=g.index?g.toNonIndexed():g;if(p!==g)g.dispose();p.deleteAttribute('uv');p.clearGroups();return p;});
  const geometry=mergeGeometries(expanded,false);expanded.forEach(g=>g.dispose());return geometry;
}
function box(w,h,d,x=0,y=0,z=0){const g=new THREE.BoxGeometry(w,h,d);g.translate(x,y,z);return g;}
function instances(name,geometry,material,items,parent,transform) {
  if(!items.length){geometry.dispose();return null;}
  const mesh=new THREE.InstancedMesh(geometry,material,items.length),dummy=new THREE.Object3D();mesh.name=name;mesh.castShadow=false;mesh.receiveShadow=true;
  items.forEach((item,i)=>{dummy.position.set(item.x,item.y,item.z);dummy.rotation.set(0,item.angle||0,0);dummy.scale.set(1,1,1);transform?.(dummy,item,i);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);});
  mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();parent.add(mesh);return mesh;
}

/** Pixel-scale LOD with separate enter/exit thresholds; no animation loop. */
export function streetDetailTier(roadPixels, previous = 0) {
  if (previous === 2 && roadPixels >= 6.5) return 2;
  if (roadPixels >= 9) return 2;
  if (previous >= 1 && roadPixels >= 1.5) return 1;
  return roadPixels >= 2.2 ? 1 : 0;
}

export function createStreetDetails(plan,{heightAt,makeMaterial}) {
  const group=new THREE.Group();group.name='Building forecourts and illustrative streets';
  const material={
    paving:makeMaterial('#ddd5c4','#61776e',{side:THREE.DoubleSide}),accent:makeMaterial('#c7bfae','#526c63',{side:THREE.DoubleSide}),
    stone:makeMaterial('#bdbba9','#627a6d'),metal:makeMaterial('#536f63','#7c9180'),wood:makeMaterial('#ad895f','#9b805c'),
    soil:makeMaterial('#94866a','#485e4d'),leaves:makeMaterial('#81a16c','#486b50',{flatShading:true}),light:makeMaterial('#f5e1ac','#ffdda5')
  };
  // A flat transparent pool needs one pass; the default double-sided material
  // would draw front and back separately without changing this ground decal.
  const glowMaterial=new THREE.MeshBasicMaterial({color:'#f8d694',transparent:true,opacity:.19,depthWrite:false,toneMapped:false,side:THREE.DoubleSide,forceSinglePass:true});
  const entries=[];let night=false;
  for(const site of plan.sites){
    const unit=site.units,surface=(x,z)=>heightAt(x,z)+site.groundLift(x,z);
    const siteGroup=new THREE.Group(),pavingGroup=new THREE.Group(),detailGroup=new THREE.Group(),treeGroup=new THREE.Group(),nightGroup=new THREE.Group();
    siteGroup.name=site.id;siteGroup.add(pavingGroup,detailGroup);detailGroup.add(treeGroup,nightGroup);group.add(siteGroup);
    for(const accent of [false,true]){
      const cells=site.paving.filter(p=>(p.role==='accent')===accent);if(!cells.length)continue;
      const mesh=new THREE.Mesh(quadsGeometry(cells,surface),accent?material.accent:material.paving);mesh.name=accent?'street paving insets':'forecourt, entrance path and sidewalk';mesh.receiveShadow=true;pavingGroup.add(mesh);
    }
    const curbCells=site.curbs.map(c=>({points:c.footprint}));
    if(curbCells.length){const mesh=new THREE.Mesh(quadsGeometry(curbCells,(x,z)=>surface(x,z)+.0035),material.stone);mesh.name='junction-trimmed sidewalk edges';mesh.receiveShadow=true;pavingGroup.add(mesh);}
    // Every repeated object is instanced. This fixed geometry never casts
    // cached shadows that could survive after its LOD becomes invisible.
    const pitSize=2.3*unit,pitDepth=.12*unit,rim=.18*unit;
    const pitGeometry=combine([box(pitSize,pitDepth,rim,0,pitDepth/2,-(pitSize-rim)/2),box(pitSize,pitDepth,rim,0,pitDepth/2,(pitSize-rim)/2),box(rim,pitDepth,pitSize-rim*2,-(pitSize-rim)/2,pitDepth/2),box(rim,pitDepth,pitSize-rim*2,(pitSize-rim)/2,pitDepth/2)]);
    instances('street tree pits',pitGeometry,material.stone,site.trees,detailGroup);
    instances('street tree soil',box(pitSize-rim*2,.001,pitSize-rim*2,0,.0005),material.soil,site.trees,detailGroup);
    const trunk=new THREE.CylinderGeometry(.16*unit,.22*unit,3.3*unit,6);trunk.translate(0,1.65*unit,0);
    instances('street tree trunks',trunk,material.wood,site.trees,treeGroup);
    const crown=new THREE.IcosahedronGeometry(1,1);crown.scale(2.35*unit,2.7*unit,2.35*unit);crown.translate(0,5.1*unit,0);
    instances('street tree crowns',crown,material.leaves,site.trees,treeGroup,(dummy,_,i)=>dummy.rotation.y=i*1.37);
    const pole=new THREE.CylinderGeometry(.07*unit,.1*unit,6*unit,6);pole.translate(0,3*unit,0);
    const lampBody=combine([pole,box(.65*unit,.18*unit,.85*unit,0,6*unit,0),box(.5*unit,.18*unit,.5*unit,0,.09*unit,0)]);
    instances('street lamps',lampBody,material.metal,site.lamps,detailGroup);
    instances('street warm lamp heads',box(.5*unit,.09*unit,.68*unit,0,5.88*unit,0),material.light,site.lamps,detailGroup);
    if(site.lamps.length){
      // The pavement ramps from the doorway to the existing road height.
      // Fit every light-pool vertex to that same surface, rather than placing
      // a horizontal disc at the lamp centre. All pools still share one draw.
      const positions=[],indices=[],segments=24,radius=1.25*unit;
      for(const lamp of site.lamps){
        const first=positions.length/3;
        positions.push(lamp.x,surface(lamp.x,lamp.z)+.0008,lamp.z);
        for(let i=0;i<segments;i++){
          const angle=i/segments*Math.PI*2,x=lamp.x+Math.cos(angle)*radius,z=lamp.z+Math.sin(angle)*radius;
          positions.push(x,surface(x,z)+.0008,z);
          indices.push(first,first+1+(i+1)%segments,first+1+i);
        }
      }
      const glowGeo=new THREE.BufferGeometry();glowGeo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));glowGeo.setIndex(indices);
      const pools=new THREE.Mesh(glowGeo,glowMaterial);pools.name='street lamp pools';nightGroup.add(pools);
    }
    const benchWood=combine([box(2.1*unit,.1*unit,.65*unit,0,.48*unit,0),box(2.1*unit,.4*unit,.08*unit,0,.75*unit,-.32*unit)]);
    instances('street bench seats',benchWood,material.wood,site.benches,detailGroup);
    const benchMetal=combine([box(.12*unit,.45*unit,.58*unit,-.7*unit,.225*unit),box(.12*unit,.45*unit,.58*unit,.7*unit,.225*unit)]);
    instances('street bench legs',benchMetal,material.metal,site.benches,detailGroup);
    const b=site.bounds,y=surface((b.minX+b.maxX)/2,(b.minZ+b.maxZ)/2);
    entries.push({site,group:siteGroup,pavingGroup,detailGroup,treeGroup,nightGroup,tier:0,bounds:new THREE.Box3(new THREE.Vector3(b.minX,y-.2,b.minZ),new THREE.Vector3(b.maxX,y+12*unit,b.maxZ))});
    siteGroup.visible=false;nightGroup.visible=false;
  }
  let meshes=0,triangles=0,geometryBytes=0;
  group.traverse(object=>{if(!object.isMesh)return;meshes++;const g=object.geometry;triangles+=(g.index?g.index.count:g.attributes.position.count)/3*(object.isInstancedMesh?object.count:1);for(const a of Object.values(g.attributes))geometryBytes+=a.array.byteLength;if(g.index)geometryBytes+=g.index.array.byteLength;if(object.instanceMatrix)geometryBytes+=object.instanceMatrix.array.byteLength;});
  const resourceStats={...plan.stats,streetMeshes:meshes,streetTriangles:triangles,streetGeometryBytes:geometryBytes};
  const getStats=()=>({...resourceStats,streetVisibleSites:entries.filter(e=>e.group.visible).length,streetVisibleIds:entries.filter(e=>e.group.visible).map(e=>e.site.id),streetVisibleTier:Math.max(0,...entries.filter(e=>e.group.visible).map(e=>e.tier)),streetVisibleDrawCalls:entries.reduce((n,e)=>{if(!e.group.visible)return n;let count=0;e.group.traverseVisible(o=>{if(o.isMesh)count++;});return n+count;},0)});
  return {group,stats:resourceStats,getStats,
    update({pixelsPerUnit,frustum,enabled=true,treesEnabled=true}) {
      let changed=false;
      for(const entry of entries){const previous=entry.tier;entry.tier=streetDetailTier(entry.site.roadWidth*pixelsPerUnit,entry.tier);const visible=Boolean(enabled&&entry.tier>0&&(!frustum||frustum.intersectsBox(entry.bounds)));
        changed ||= previous!==entry.tier||entry.group.visible!==visible||entry.treeGroup.visible!==Boolean(treesEnabled);
        entry.group.visible=visible;entry.detailGroup.visible=entry.tier===2;entry.treeGroup.visible=Boolean(treesEnabled);entry.nightGroup.visible=night;
      }
      return changed;
    },
    setTheme(value){night=Boolean(value);material.light.emissive.set(night?'#ffd595':'#000000');material.light.emissiveIntensity=night?.7:0;for(const entry of entries)entry.nightGroup.visible=night;},
  };
}
