/** Expanded map coverage and old-city preservation checks; no WebGL required. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { AUTHORED_MODELS } from '../src/scene/buildingCatalog.js';

const read = path => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const data = read('../public/data/city.json');
const markers = read('../docs/models/shouxin-location-evidence/wasee-map-markers.json');
const alignments = read('./landmark-alignments.json');
const { meta } = data;
const oldCenter = [111.29, 30.7], oldBounds = [111.225, 30.645, 111.355, 30.755];
const metresPerDegree = Math.PI / 180 * 6378137;
const xFactor = metresPerDegree * Math.cos(meta.center[1] * Math.PI / 180) * meta.unitsPerMeter;
const zFactor = metresPerDegree * meta.unitsPerMeter;
const oldXFactor = metresPerDegree * Math.cos(oldCenter[1] * Math.PI / 180) * .02;
const project = ([lon, lat]) => [(lon - meta.center[0]) * xFactor, (meta.center[1] - lat) * zFactor];
const unproject = ([x, z]) => [meta.center[0] + x / xFactor, meta.center[1] - z / zFactor];
const close = (a, b, epsilon, message) => assert.ok(Math.abs(a - b) <= epsilon, `${message}: ${a} vs ${b}`);
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const mm = value => Math.round(value * 1000);
const oldPoint = point => {
  const [lon, lat] = unproject(point);
  return [mm((lon - oldCenter[0]) * oldXFactor), mm((oldCenter[1] - lat) * metresPerDegree * .02)];
};

assert.deepEqual(meta.bounds, [111.225, 30.625, 111.39, 30.755]);
assert.deepEqual(meta.center, [111.3075, 30.69]);
assert.equal(meta.unitsPerMeter, .02);
close(meta.width, (meta.bounds[2] - meta.bounds[0]) * xFactor, .00051, 'board width');
close(meta.depth, (meta.bounds[3] - meta.bounds[1]) * zFactor, .00051, 'board depth');
assert.equal(data.buildings.length, 16000);
assert.equal(data.roads.length, 3600);
assert.equal(meta.coverageExpansion.retainedBuildings, 13800);
assert.equal(meta.coverageExpansion.retainedRoads, 2950);

// This explicit, reviewed exception consists only of the source UUIDs replaced
// by the seven registered authored projects. Meilian's candidate is excluded.
const exactSourceIds = [
  '07a71726-720b-4fd4-a814-fb14bda5bd7e', '200bff33-082f-43da-99e0-51f8fe4f2607',
  '31be43a4-9179-4d08-8a8c-3d840b3d31da', '4b2539b2-ca4f-489a-96e3-9df54396e0ae',
  '5490a156-bcdc-4091-8769-12566bbe415a', '6e6462fd-0796-4d9f-b232-02eddcd5cce4',
  '809fc574-f994-4778-9992-3c3435682f32', '81af0591-a194-46a2-ac7a-edcbbb974357',
  '82fffa3c-3b89-4b72-a3de-3c6cd02a1c2e', '8dd77dbf-8907-4a23-941e-13f3664c1576',
  'a282237a-14a0-4246-bd2b-8386a86a1502', 'ae815edb-2941-40aa-89d4-1a21d8172eae',
  'afa5302e-bdfe-425a-890a-5d60693f32e4', 'bb15e7cf-9138-4cad-bb0c-a6c219e81197',
  'd6d52628-7bcb-4a1a-89be-f0a610dd73c1', 'ff7985c2-8e75-4589-8a23-816772be6a0d',
];
const exactSourceSet = new Set(exactSourceIds);
assert.deepEqual([...new Set(AUTHORED_MODELS.flatMap(model => model.registration.replaceSourceFeatureIds || [model.registration.sourceFeatureId]))].sort(), exactSourceIds, 'precision exceptions must equal the registered replacement UUIDs');
assert.deepEqual(meta.coverageExpansion.registeredFootprintProjection.sourceFeatureIds, exactSourceIds);
assert.equal(meta.coverageExpansion.registeredFootprintProjection.count, 16);
const sourceFeatures = [
  ...read('../docs/models/business-buildings-evidence/priority-registration-source-footprints.geojson').features,
  read('../docs/models/shouxin-location-evidence/shouxin-candidate-source-feature.geojson'),
];
const bySourceId = new Map(sourceFeatures.map(feature => [feature.id, feature]));
function directSourceRing(feature) {
  assert.equal(feature.geometry.type, 'Polygon', 'registered source is one original polygon');
  const sourceRing = feature.geometry.coordinates[0];
  let points = sourceRing.slice(0, -1).map(project);
  assert.deepEqual(sourceRing[0], sourceRing.at(-1), 'native WGS84 ring closes');
  const area = points.reduce((sum, p, i) => { const q = points[(i+1)%points.length]; return sum + p[0]*q[1] - q[0]*p[1]; }, 0);
  if (area < 0) points = [points[0], ...points.slice(1).reverse()];
  const rounded = [];
  for (const point of points) {
    const next = point.map(value => mm(value)/1000);
    if (!rounded.length || JSON.stringify(next) !== JSON.stringify(rounded.at(-1))) rounded.push(next);
  }
  if (JSON.stringify(rounded[0]) === JSON.stringify(rounded.at(-1))) rounded.pop();
  return rounded;
}
let maximumRegisteredRoundingError = 0;
for (const id of exactSourceIds) {
  const feature = bySourceId.get(id);
  assert.ok(feature, `original WGS84 evidence for ${id}`);
  const matches = data.buildings.filter(building => building.sourceFeatureId === id);
  assert.equal(matches.length, 1, `one selected part for registered UUID ${id}`);
  assert.deepEqual(matches[0].ring, directSourceRing(feature), `registered ${id} must equal one source projection and one round3, without simplification`);
  for (const point of feature.geometry.coordinates[0].slice(0, -1).map(project)) {
    const error = Math.min(...matches[0].ring.map(q => Math.hypot(point[0]-q[0], point[1]-q[1])));
    assert.ok(error <= Math.SQRT2*.0005 + 1e-12, `registered ${id} exceeds the single-round coordinate bound`);
    maximumRegisteredRoundingError = Math.max(maximumRegisteredRoundingError, error);
  }
}

// Independently captured from the published V18 file, not from the revised
// generator output: preserve all 13,784 other old shapes and every old height/
// base. The 16 exception positions remain fixed in the original selection.
const oldSelection = data.buildings.slice(0, 13800);
assert.deepEqual(oldSelection.flatMap((b,i) => exactSourceSet.has(b.sourceFeatureId) ? [i] : []), [5,57,321,780,884,959,1052,1069,1090,1116,1345,1744,2359,2385,4620,4677]);
const recoveredBuildings = oldSelection.filter(b => !exactSourceSet.has(b.sourceFeatureId)).map(b => [b.ring.map(oldPoint), mm(b.height), mm(b.base)]);
const recoveredRoads = data.roads.slice(0, 2950).map(r => [r.points.map(oldPoint), mm(r.width), r.kind, r.name ?? null]);
assert.equal(recoveredBuildings.length, 13784);
assert.equal(sha(recoveredBuildings), '666775f4cdeb070f9e5241efff61db003e129e12ab2bc395b157baab5e115599', 'every non-exception old footprint, height and base must survive');
assert.equal(sha(oldSelection.map(b => [mm(b.height), mm(b.base)])), '44bf236f813aa39159fba0b1a11a4830962f71115fac1793754720a428dbb721', 'all 13,800 old heights and bases remain unchanged');
assert.equal(sha(recoveredRoads), '61133bb10b5f5c1721a288313b9cf22eeb91962963fa671b173871088455d7fc', 'every old selected road, width, class and name must survive');
assert.ok(data.buildings.every(b => typeof b.sourceFeatureId === 'string' && b.sourceFeatureId.length > 0), 'stable source ID on every building part');
assert.equal(data.buildings.filter(b => b.sourceFeatureId === '809fc574-f994-4778-9992-3c3435682f32').length, 1, 'Shouxin source identity survives recentering');

let checkedVertices = 0;
function checkPoint(point) {
  assert.ok(point.every(Number.isFinite));
  assert.ok(Math.abs(point[0]) <= meta.width / 2 + .00051, 'geometry within east/west board edges');
  assert.ok(Math.abs(point[1]) <= meta.depth / 2 + .00051, 'geometry within north/south board edges');
  checkedVertices++;
}
for (const b of data.buildings) b.ring.forEach(checkPoint);
for (const r of data.roads) r.points.forEach(checkPoint);
for (const p of [...data.water, ...data.parks]) p.rings.forEach(r => r.forEach(checkPoint));
const outsideOldInterior = point => {
  const [lon, lat] = unproject(point), tolerance = 8e-7;
  return lon <= oldBounds[0] + tolerance || lon >= oldBounds[2] - tolerance || lat <= oldBounds[1] + tolerance || lat >= oldBounds[3] - tolerance;
};
for (const b of data.buildings.slice(13800)) assert.ok(b.ring.every(outsideOldInterior), 'new building budget must only serve expanded geography');
for (const r of data.roads.slice(2950)) assert.ok(r.points.every(outsideOldInterior), 'new road budget must only serve expanded geography');

const expectedPoints = {
  'zhenjiang-pavilion': [111.2708465, 30.7034514],
  'gezhouba-dam': [111.2691355, 30.739963],
  'zhixi-bridge': [111.2653116, 30.7157271],
  'yiling-bridge': [111.29084, 30.68558],
  'mojishan-park': [111.2833374, 30.6820522],
  'tianran-pagoda': [111.32162, 30.6647],
  'xiba-island': [111.2747, 30.7289],
};
assert.deepEqual(data.landmarks.map(l => l.id).sort(), Object.keys(expectedPoints).sort());
for (const landmark of data.landmarks) {
  const setting = alignments.landmarks.find(a => a.id === landmark.id);
  close(landmark.lon, expectedPoints[landmark.id][0], 1e-10, 'unchanged geographic longitude');
  close(landmark.lat, expectedPoints[landmark.id][1], 1e-10, 'unchanged geographic latitude');
  const expected = project(expectedPoints[landmark.id]);
  close(landmark.x, expected[0], .00051, 'recentered landmark x');
  close(landmark.z, expected[1], .00051, 'recentered landmark z');
  for (const key of ['axisHeadingDeg', 'frontHeadingDeg', 'modelScale']) if (setting[key] !== undefined && !setting.endpointsLonLat) assert.equal(landmark[key], setting[key], `preserved ${key}`);
  if (setting.endpointsLonLat) {
    const projected = setting.endpointsLonLat.map(project);
    projected.forEach((p, i) => p.forEach((v, k) => close(landmark.endpoints[i][k], v, .00000051, 'same geographic dam endpoints')));
    const a = projected[0], b = projected[1];
    const heading = (Math.atan2(b[0] - a[0], a[1] - b[1]) * 180 / Math.PI + 360) % 360;
    close(landmark.axisHeadingDeg, heading, .00001, 'dam orientation follows unchanged WGS84 endpoints');
  }
}

// Approximate conventional GCJ-02 inverse, used only to confirm that all the
// already verified guide markers fit on the board, not as measured accuracy.
function wgsToGcj([lon, lat]) {
  const x = lon - 105, y = lat - 35, pi = Math.PI;
  let dLat = -100 + 2*x + 3*y + .2*y*y + .1*x*y + .2*Math.sqrt(Math.abs(x));
  dLat += (20*Math.sin(6*x*pi)+20*Math.sin(2*x*pi))*2/3;
  dLat += (20*Math.sin(y*pi)+40*Math.sin(y*pi/3))*2/3;
  dLat += (160*Math.sin(y*pi/12)+320*Math.sin(y*pi/30))*2/3;
  let dLon = 300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x));
  dLon += (20*Math.sin(6*x*pi)+20*Math.sin(2*x*pi))*2/3;
  dLon += (20*Math.sin(x*pi)+40*Math.sin(x*pi/3))*2/3;
  dLon += (150*Math.sin(x*pi/12)+300*Math.sin(x*pi/30))*2/3;
  const rad = lat*pi/180, magic = 1-.00669342162296594323*Math.sin(rad)**2, sqrt = Math.sqrt(magic);
  return [lon+dLon*180/(6378245/sqrt*Math.cos(rad)*pi), lat+dLat*180/((6378245*(1-.00669342162296594323))/(magic*sqrt)*pi)];
}
function gcjToWgs(point) {
  let estimate = [...point];
  for (let i=0;i<8;i++) {
    const forward = wgsToGcj(estimate);
    estimate = estimate.map((v,k) => v-(forward[k]-point[k]));
  }
  return estimate;
}
assert.equal(markers.markers.length, 23);
const guideCoverage = markers.markers.map(marker => {
  const coordinate = gcjToWgs([marker.longitude, marker.latitude]);
  const point = project(coordinate); checkPoint(point);
  const edgeMarginMeters = Math.min(meta.width/2-Math.abs(point[0]), meta.depth/2-Math.abs(point[1]))/meta.unitsPerMeter;
  assert.ok(edgeMarginMeters > 0, 'guide marker must lie inside board');
  return { sceneId: marker.obj_id, wgs84Approx: coordinate, edgeMarginMeters };
});

console.log(JSON.stringify({ passed:true, bounds:meta.bounds, center:meta.center, buildings:data.buildings.length, roads:data.roads.length, retainedBuildings:13800, unchangedLegacyFootprints:13784, registeredFootprintsProjectedOnce:16, maximumRegisteredRoundingErrorMeters:maximumRegisteredRoundingError/meta.unitsPerMeter, retainedRoads:2950, uniqueSourceFeatures:new Set(data.buildings.map(b=>b.sourceFeatureId)).size, checkedVertices, landmarkGeographicPositionsPreserved:7, guideMarkersCovered:guideCoverage.length, minimumGuideEdgeMarginMeters:Math.min(...guideCoverage.map(p=>p.edgeMarginMeters)), webglVerified:false, surveyVerified:false, checks:['inverse-projected V18 geometry hashes for all 13,784 non-exception footprints and 2,950 roads','all 13,800 old heights, bases and 16 replacement positions preserved','16 registered UUIDs equal original WGS84 exteriors projected and rounded once','stable source identities','all geometry within board and new budget outside old region','same seven WGS84 landmarks and registered dam endpoints','all 23 converted GCJ-02 guide markers covered'] }, null, 2));
