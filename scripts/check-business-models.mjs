import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Box3, Group, Object3D, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BUSINESS_BUILDINGS, AUTHORED_MODELS } from '../src/scene/buildingCatalog.js';
import { prepareAuthoredModel } from '../src/scene/authoredModels.js';
import { resolveAuthoredPlacement, planAuthoredGround } from '../src/scene/authoredPlacement.js';

// An independent source-data and geometry check. No renderer is created and no
// assertion here is a browser, WebGL, field-survey, or device-performance test.
// Texture references are removed only from the in-memory geometry test copy;
// the real GLB bytes, hashes, positions, transforms, normals and indices remain
// the inputs. Files on disk are never modified by this check.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const evidencePath = 'docs/models/business-buildings-evidence/';
const evidence = json(`${evidencePath}business-models-integration-records.json`);
const sourceFeatures = json(`${evidencePath}priority-registration-source-footprints.geojson`);
const mallEvidence = json(`${evidencePath}wanda-shared-mall-remainder.json`);
const markers = json('docs/models/shouxin-location-evidence/wasee-map-markers.json').markers;
const city = json('public/data/city.json');
const units = city.meta.unitsPerMeter;
// Diagnostic mode lets asset/origin tests run while another task is rebuilding
// GIS rings. It never reports a complete integration pass; the default command
// remains the required strict check.
const assetsOnly = process.argv.includes('--assets-only');
const passed = [], tiers = [];
const near = (a, b, tolerance, reason) => assert(Number.isFinite(a) && Math.abs(a - b) <= tolerance,
  `${reason}: ${a} vs ${b} (tolerance ${tolerance})`);
const pairNear = (a, b, tolerance, reason) => a.forEach((value, i) => near(value, b[i], tolerance, `${reason}[${i}]`));
const stable = value => JSON.stringify(value);
const byScene = new Map(BUSINESS_BUILDINGS.map(row => [String(row.sourceSceneId), row]));
const geoById = new Map(sourceFeatures.features.map(feature => [feature.id, feature]));
const sorted = list => [...list].sort();
const noClosingPoint = ring => ring.length > 1 && stable(ring[0]) === stable(ring.at(-1)) ? ring.slice(0, -1) : ring;

// Projection oracle uses the *current* board centre independently of the
// runtime helpers. East is X, south is Z; no saved old world coordinates.
function project([lon, lat]) {
  const radians = Math.PI / 180, radius = 6378137;
  return [(lon - city.meta.center[0]) * radians * radius * Math.cos(city.meta.center[1] * radians) * units,
    (city.meta.center[1] - lat) * radians * radius * units];
}
function gcjToWgs([lon, lat]) {
  const pi = Math.PI, a = 6378245, ee = 0.006693421622965943;
  function forward(xlon, xlat) {
    const x = xlon - 105, y = xlat - 35;
    let dlat = -100 + 2*x + 3*y + .2*y*y + .1*x*y + .2*Math.sqrt(Math.abs(x));
    dlat += (20*Math.sin(6*x*pi) + 20*Math.sin(2*x*pi))*2/3;
    dlat += (20*Math.sin(y*pi) + 40*Math.sin(y*pi/3))*2/3;
    dlat += (160*Math.sin(y*pi/12) + 320*Math.sin(y*pi/30))*2/3;
    let dlon = 300 + x + 2*y + .1*x*x + .1*x*y + .1*Math.sqrt(Math.abs(x));
    dlon += (20*Math.sin(6*x*pi) + 20*Math.sin(2*x*pi))*2/3;
    dlon += (20*Math.sin(x*pi) + 40*Math.sin(x*pi/3))*2/3;
    dlon += (150*Math.sin(x*pi/12) + 300*Math.sin(x*pi/30))*2/3;
    const rad = xlat*pi/180, magic = 1-ee*Math.sin(rad)**2, sq = Math.sqrt(magic);
    return [xlon + dlon*180/(a/sq*Math.cos(rad)*pi), xlat + dlat*180/(a*(1-ee)/(magic*sq)*pi)];
  }
  let x = lon, y = lat;
  for (let i=0; i<8; i++) { const p = forward(x,y); x -= p[0]-lon; y -= p[1]-lat; }
  return [x,y];
}
function insideBoard([x,z], reason) {
  assert(Math.abs(x) <= city.meta.width/2 + 1e-8 && Math.abs(z) <= city.meta.depth/2 + 1e-8, `${reason} must be on the expanded board`);
}
function ringDistance(a, b) {
  return Math.max(...a.map(p => Math.min(...b.map(q => Math.hypot(p[0]-q[0],p[1]-q[1])))),
    ...b.map(p => Math.min(...a.map(q => Math.hypot(p[0]-q[0],p[1]-q[1])))));
}
function area(ring) {
  const q = noClosingPoint(ring), o = q[0];
  return Math.abs(q.reduce((sum, p, i) => { const n=q[(i+1)%q.length]; return sum+(p[0]-o[0])*(n[1]-o[1])-(n[0]-o[0])*(p[1]-o[1]); },0))/2;
}

assert.equal(markers.length, 23, 'Retained tour evidence has 23 project markers');
assert.equal(BUSINESS_BUILDINGS.length, 23, 'Catalog must retain all 23 projects');
assert.equal(new Set(BUSINESS_BUILDINGS.map(row => row.id)).size, 23, 'Catalog IDs must not duplicate a project');
assert.equal(byScene.size, 23, 'Scene IDs must not duplicate Jinjiang aliases or compound towers');
assert.deepEqual(sorted(byScene.keys()), sorted(markers.map(marker => String(marker.obj_id))));
const availableModels = BUSINESS_BUILDINGS.filter(row => row.assets?.light && row.assets?.detail);
assert.equal(availableModels.length, 8, 'Seven recovered models plus existing Shouxin remain available');
assert.equal(AUTHORED_MODELS.length, 7, 'Only seven geographically placed models may be city residents');
assert.equal(BUSINESS_BUILDINGS.filter(row => row.modelStatus === 'registration-pending').length, 1);
assert.equal(BUSINESS_BUILDINGS.filter(row => row.modelStatus === 'recovery-pending').length, 15);
const meilian = byScene.get('1649135');
assert.equal(meilian.modelStatus, 'registration-pending');
assert.equal(meilian.placement, 'poi');
assert(meilian.assets.light && meilian.assets.detail, 'Pending registration must not discard the real model');
assert.equal(resolveAuthoredPlacement(meilian, city.meta), null, 'Unresolved Meilian may not silently become a map model');
assert(byScene.get('1649132').aliases.includes('锦江银座') && byScene.get('1649132').aliases.includes('金江银座'));
for (const row of BUSINESS_BUILDINGS) {
  const marker = markers.find(marker => String(marker.obj_id) === row.sourceSceneId);
  pairNear(row.sourceMarker.lonLat, [marker.longitude, marker.latitude], 1e-12, `${row.name} source marker`);
  assert.equal(row.sourceMarker.coordinateSystem, 'GCJ-02');
  pairNear([row.lon,row.lat], gcjToWgs(row.sourceMarker.lonLat), 1e-9, `${row.name} approximate CRS conversion`);
  insideBoard(project([row.lon,row.lat]), `${row.name} tour point`);
}
passed.push('23 source-bound unique projects; 8 restored models, 7 city residents, 1 registration pending, 15 recovery pending; GCJ-02 conversion and expanded-board coverage');

const resolved = AUTHORED_MODELS.map(raw => resolveAuthoredPlacement(raw,city.meta));
const resolvedByScene = new Map(resolved.map(spec => [spec.sourceSceneId,spec]));
for (const record of evidence.records.filter(record => record.mayPlaceModelOnMap)) {
  const raw = byScene.get(record.sceneId), spec = resolvedByScene.get(record.sceneId), reg = raw.registration;
  assert(spec && reg, `${record.name} needs a runtime registration`);
  assert.equal(reg.coordinateSystem,'WGS84');
  pairNear(reg.modelOriginLonLat,record.originWgs84,1e-12,`${record.name} original GLTF origin`);
  near(reg.scaleMetersPerSourceUnit,record.uniformMetersPerModelUnit,1e-12,`${record.name} recorded uniform metre scale`);
  near(reg.yawRadians,record.yawRadians,1e-12,`${record.name} recorded orientation`);
  assert.deepEqual(sorted(reg.replaceSourceFeatureIds),sorted(record.replaceSourceFeatureIds));
  assert.equal(reg.sourceFootprintRecords.length,record.footprintsLonLat.length);
  assert.equal(reg.footprintsLonLat.length,record.footprintsLonLat.length);
  for (const [i,f] of reg.sourceFootprintRecords.entries()) {
    const source = geoById.get(f.sourceFeatureId);
    assert(source,`Unknown replacement source UUID ${f.sourceFeatureId}`);
    assert.deepEqual(f.geometry,source.geometry,`${record.name} original footprint geometry`);
    assert.deepEqual(reg.footprintsLonLat[i],source.geometry.coordinates[0],`${record.name} runtime ring must come from its named UUID`);
    const target = city.buildings.filter(b => b.sourceFeatureId === f.sourceFeatureId);
    assert.equal(target.length,1,`${record.name} requires one exact background source binding for ${f.sourceFeatureId}`);
    if(!assetsOnly)assert(ringDistance(noClosingPoint(target[0].ring),noClosingPoint(source.geometry.coordinates[0].map(project))) < Math.SQRT2*.0005+1e-8,
      `${record.name} city polygon must equal source coordinates within city vertex rounding`);
    source.geometry.coordinates[0].forEach(p=>insideBoard(project(p),`${record.name} source footprint`));
  }
  const origin = project(record.originWgs84), scale = record.uniformMetersPerModelUnit*units, yaw = record.yawRadians;
  const c = Math.cos(yaw),s = Math.sin(yaw), center = raw.sourceBounds.min.map((v,i)=>(v+raw.sourceBounds.max[i])/2);
  // The controller is placed at the rotated AABB centre while prepare() shifts
  // the geometry by the same source frame. Their offsets must cancel exactly.
  pairNear(spec.worldModelOrigin,origin,1e-10,`${record.name} original world origin`);
  near(spec.x,origin[0]+(center[0]*c+center[2]*s)*scale,1e-10,`${record.name} controller centre X compensation`);
  near(spec.z,origin[1]+(-center[0]*s+center[2]*c)*scale,1e-10,`${record.name} controller centre Z compensation`);
  near(spec.uniformScale,scale,1e-12,`${record.name} single runtime scalar`);
  near(spec.displayHeight,(raw.sourceBounds.max[1]-raw.sourceBounds.min[1])*scale,1e-10,`${record.name} proportional height`);
  insideBoard([spec.x,spec.z],`${record.name} controller centre`);
  spec.footprint.forEach(p=>insideBoard(p,`${record.name} conservative model envelope`));
}
assert(byScene.get('1649145').registration.label.includes('候选') && /相对布局/.test(byScene.get('1649145').caveat));
assert(/后侧|后部/.test(byScene.get('1649129').caveat), 'Fujiang unknown back depth must remain visible in the description');
assert(Math.cos(byScene.get('1649149').registration.yawRadians) < .1,
  'Zhongnan street-corner facing may not be replaced by a generic river-facing yaw');
passed.push(assetsOnly ? 'Independent current projection, source UUID binding, evidence scales/yaws and original-origin compensation; rebuilt city ring match explicitly deferred' : 'Independent current projection, exact source UUID/ring binding, evidence scales/yaws, original-origin compensation and candidate caveats');

const plan = planAuthoredGround(resolved,city,3.8);
const replacedIDs = new Set(resolved.flatMap(spec=>spec.registration.replaceSourceFeatureIds||[spec.registration.sourceFeatureId]));
assert.equal(replacedIDs.size,16,'The six new mapped projects plus Shouxin bind exactly 16 original source features');
const expectedIndices = city.buildings.flatMap((b,i)=>replacedIDs.has(b.sourceFeatureId)?[i]:[]);
assert.deepEqual([...plan.omittedBuildingIndices].sort((a,b)=>a-b),expectedIndices,
  'Background removal must use exact registered source IDs, not nearby AABBs or distance circles');
assert.equal(expectedIndices.length,replacedIDs.size,'Every registered source ID must have exactly one original background');
const retained = plan.retainedBuildings.filter(b=>b.retainedFromSourceFeatureId===mallEvidence.sourceFeatureId);
assert.equal(retained.length,1,'The uncovered original Wanda mall must remain as one GIS polygon');
const mall = retained[0], sourceMall = geoById.get(mallEvidence.sourceFeatureId);
near(mall.height,12*units,1e-12,'Wanda retained mall preserves source default height without an invented mass');
assert.equal(mall.rings.length,1,'Recorded remainder is a single polygon without holes');
assert(mall.ring.length>4,'The remainder must preserve its actual cut outline, not be replaced by a rectangle');
assert.equal(mall.ring.length,mallEvidence.retainedGeometryWgs84.coordinates[0].length);
mall.ring.forEach((p,i)=>pairNear(p,project(mallEvidence.retainedGeometryWgs84.coordinates[0][i]),1e-10,'Retained mall original polygon difference'));
const retainedAreaRatio=area(mall.ring)/area(sourceMall.geometry.coordinates[0].map(project));
near(retainedAreaRatio,mallEvidence.retainedAreaMeters2/mallEvidence.sourceAreaMeters2,1e-8,'Retained mall area ratio is projection-independent');
assert(retainedAreaRatio>.60 && retainedAreaRatio<.61,'About 61% of the original shared mall remains');
const meilianSource='d8498ab6-a277-40e8-84db-ca8b2660ed9c';
const meilianIndex=city.buildings.findIndex(b=>b.sourceFeatureId===meilianSource);
assert(meilianIndex>=0&&!plan.omittedBuildingIndices.has(meilianIndex),'Unregistered Meilian must not remove its background tower');
passed.push('Exactly the 16 registered original backgrounds are replaced; Wanda retains the original uncovered mall geometry and height; pending Meilian clears nothing');

await MeshoptDecoder.ready;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
function geometryOnlyBytes(bytes) {
  assert.equal(bytes.toString('ascii',0,4),'glTF');
  assert.equal(bytes.readUInt32LE(4),2);
  assert.equal(bytes.readUInt32LE(8),bytes.length);
  const jsonLength=bytes.readUInt32LE(12), document=JSON.parse(bytes.subarray(20,20+jsonLength).toString('utf8'));
  const strip = value => {
    if(!value||typeof value!=='object')return;
    for(const key of Object.keys(value)) { if(/Texture$/.test(key))delete value[key];else strip(value[key]); }
  };
  (document.materials||[]).forEach(strip);
  const encoded=Buffer.from(JSON.stringify(document)), padded=Buffer.alloc(Math.ceil(encoded.length/4)*4,0x20);
  encoded.copy(padded);
  const tail=bytes.subarray(20+jsonLength), result=Buffer.alloc(20+padded.length+tail.length);
  result.write('glTF',0);result.writeUInt32LE(2,4);result.writeUInt32LE(result.length,8);
  result.writeUInt32LE(padded.length,12);result.writeUInt32LE(0x4E4F534A,16);padded.copy(result,20);tail.copy(result,20+padded.length);
  return result.buffer.slice(result.byteOffset,result.byteOffset+result.byteLength);
}
function dispose(group) {
  const geometries=new Set(),materials=new Set();
  group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])materials.add(m);});
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());group.clear();
}
for(const rawSpec of availableModels) {
  const isCity=rawSpec.placement==='city', spec=isCity?resolvedByScene.get(rawSpec.sourceSceneId):rawSpec;
  const expected=evidence.records.find(record=>record.sceneId===rawSpec.sourceSceneId);
  for(const tier of ['light','detail']) {
    const relative=rawSpec.assets[tier].split('?')[0].replace(/^\//,''), filename=path.join(root,'public',relative),bytes=fs.readFileSync(filename);
    const manifestPath=path.join(path.dirname(filename),'web-manifest.json'), manifest=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath,'utf8')):null;
    if(manifest) {
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),manifest.tiers[tier].sha256,`${rawSpec.name} ${tier} exact recovered asset bytes`);
      assert.deepEqual(rawSpec.sourceBounds,manifest.sourceBounds,`${rawSpec.name} both LODs share original source frame`);
      assert.equal(manifest.nativeChanged,false);
    }
    const raw=(await loader.parseAsync(geometryOnlyBytes(bytes),'')).scene;raw.updateMatrixWorld(true);
    const sourceBox=new Box3().setFromObject(raw), sourceSamples=[];
    raw.traverse(mesh=>{
      if(!mesh.isMesh)return;
      const p=mesh.geometry.getAttribute('position');
      for(const index of new Set([0,Math.floor(p.count/2),p.count-1]))if(index>=0)sourceSamples.push({mesh,index,p:new Vector3().fromBufferAttribute(p,index).applyMatrix4(mesh.matrixWorld)});
    });
    assert(sourceSamples.length>0,`${rawSpec.name} ${tier} real model geometry is required`);
    const originMarker=new Object3D();originMarker.name='TEST: original GLTF origin';raw.add(originMarker);
    const prepared=prepareAuthoredModel(raw,spec), base=.137,anchor=new Group();
    anchor.position.set(isCity?spec.x:0,base,isCity?spec.z:0);anchor.rotation.y=isCity?spec.yaw:0;anchor.add(prepared);anchor.updateMatrixWorld(true);
    const scalar=isCity?spec.uniformScale:rawSpec.displayHeight/(rawSpec.sourceBounds.max[1]-rawSpec.sourceBounds.min[1]);
    near(prepared.scale.x,scalar,1e-12,'Uniform X');near(prepared.scale.y,scalar,1e-12,'Uniform Y');near(prepared.scale.z,scalar,1e-12,'Uniform Z');
    const sourceCenter=rawSpec.sourceBounds.min.map((v,i)=>(v+rawSpec.sourceBounds.max[i])/2),sourceFloor=rawSpec.sourceBounds.min[1];
    const originalOrigin = expected?.mayPlaceModelOnMap ? project(expected.originWgs84) : isCity ? [spec.x,spec.z] : [0,0];
    const yaw = expected?.mayPlaceModelOnMap ? expected.yawRadians : isCity ? (180-spec.registration.frontBearingDeg)*Math.PI/180 : 0;
    const c=Math.cos(yaw),s=Math.sin(yaw);
    function oracle(p) {
      // Existing Shouxin and independent previews intentionally use an AABB
      // centre anchor. New registrations instead map the original source origin.
      const x=expected?.mayPlaceModelOnMap?p.x:p.x-sourceCenter[0],z=expected?.mayPlaceModelOnMap?p.z:p.z-sourceCenter[2];
      return new Vector3(originalOrigin[0]+(x*c+z*s)*scalar,base+(p.y-sourceFloor)*scalar,originalOrigin[1]+(-x*s+z*c)*scalar);
    }
    pairNear(originMarker.getWorldPosition(new Vector3()).toArray(),oracle(new Vector3()).toArray(),1e-8,`${rawSpec.name} ${tier} original origin survives centre compensation`);
    let maxTransformError=0;
    for(const sample of sourceSamples) {
      const actual=new Vector3().fromBufferAttribute(sample.mesh.geometry.getAttribute('position'),sample.index).applyMatrix4(sample.mesh.matrixWorld);
      const expectedVertex=oracle(sample.p),error=actual.distanceTo(expectedVertex);maxTransformError=Math.max(maxTransformError,error);
      assert(error<1e-7,`${rawSpec.name} ${tier} source vertex is displaced by ${error}`);
      assert.equal(sample.mesh.userData.landmarkId,rawSpec.id,'Picking ID survives each real mesh transform');
    }
    if(isCity)insideBoard([originMarker.getWorldPosition(new Vector3()).x,originMarker.getWorldPosition(new Vector3()).z],`${rawSpec.name} ${tier} original model origin`);
    tiers.push({id:rawSpec.id,sceneId:rawSpec.sourceSceneId,tier,bytes:bytes.length,vertexSamples:sourceSamples.length,maxTransformError,scale:[prepared.scale.x,prepared.scale.y,prepared.scale.z],sourceBounds:{min:sourceBox.min.toArray(),max:sourceBox.max.toArray()}});
    dispose(anchor);
  }
}
passed.push('All 16 actual light/detail GLBs parse with Meshopt; independent original-vertex and original-origin transforms agree after controller recentering; uniform proportions and picking IDs survive');

console.log(JSON.stringify({ok:true,completeIntegrationCheck:!assetsOnly,deferredChecks:assetsOnly?['current city ring versus independently projected source geometry']:[],passed,counts:{projects:BUSINESS_BUILDINGS.length,availableModels:availableModels.length,mapModels:resolved.length,registrationPending:1,recoveryPending:15,replacedSourceBuildings:expectedIndices.length,retainedBackgroundPolygons:plan.retainedBuildings.length},boardCenter:city.meta.center,boardBounds:city.meta.bounds,retainedMallAreaRatio:retainedAreaRatio,tiers,webglVerified:false,surveyVerified:false,devicePerformanceVerified:false},null,2));
