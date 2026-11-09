import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Box3, Group, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AUTHORED_MODELS, prepareAuthoredModel } from '../src/scene/authoredModels.js';
import { resolveAuthoredPlacement, authoredWorldBounds, planAuthoredGround } from '../src/scene/authoredPlacement.js';

// This is a geometric registration regression check, not a WebGL, imagery,
// survey, or device-performance acceptance test. All inputs are in this repo.
// Run from any directory: node /path/to/scripts/check-authored-registration.mjs
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const evidenceRoot = 'docs/models/shouxin-location-evidence/';
const feature = readJson(`${evidenceRoot}shouxin-candidate-source-feature.geojson`);
const evidence = readJson(`${evidenceRoot}registration-analysis.json`);
const markers = readJson(`${evidenceRoot}wasee-map-markers.json`);
const city = readJson('public/data/city.json');
const rawSpec = AUTHORED_MODELS.find(item => item.id === 'shouxin-wealth-s01');
assert(rawSpec, 'Shouxin must remain in the authored model catalog');
const spec = resolveAuthoredPlacement(rawSpec, city.meta);
assert(spec, 'Shouxin must resolve as a city model');
const registration = spec.registration, units = city.meta.unitsPerMeter;
const passed = [];
const near = (actual, expected, tolerance, message) => assert(
  Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
  `${message}: ${actual} vs ${expected}, tolerance ${tolerance}`,
);
const cleanRing = ring => ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring;
const edges = ring => ring.map((point, index) => [point, ring[(index + 1) % ring.length]]);
const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
function pointSegmentDistance(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], lengthSq = dx * dx + dz * dz;
  const t = lengthSq ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / lengthSq)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}
function pointInRing(p, ring) {
  let winding = 0;
  for (const [a, b] of edges(ring)) {
    if (pointSegmentDistance(p, a, b) < 1e-10) return true;
    if (a[1] <= p[1] && b[1] > p[1] && cross(a, b, p) > 0) winding++;
    if (a[1] > p[1] && b[1] <= p[1] && cross(a, b, p) < 0) winding--;
  }
  return winding !== 0;
}
function segmentsIntersect(a, b, c, d) {
  if (Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b)) < 1e-10) return true;
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
}
function segmentDistance(a, b, c, d) {
  return segmentsIntersect(a, b, c, d) ? 0 : Math.min(pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}
function ringBoundaryDistance(a, b) {
  let distance = Infinity;
  for (const [p, q] of edges(a)) for (const [r, s] of edges(b)) distance = Math.min(distance, segmentDistance(p, q, r, s));
  return distance;
}
function ringDistance(a, b) {
  if (a.some(p => pointInRing(p, b)) || b.some(p => pointInRing(p, a))) return 0;
  return ringBoundaryDistance(a, b);
}
function lineDistance(ring, line) {
  if (line.some(p => pointInRing(p, ring))) return 0;
  let distance = Infinity;
  for (const [a, b] of edges(ring)) for (let i = 1; i < line.length; i++) {
    distance = Math.min(distance, segmentDistance(a, b, line[i - 1], line[i]));
  }
  return distance;
}
function polygonDistance(ring, rings) {
  const [outer, ...holes] = rings.map(cleanRing);
  if (ring.some(p => pointInRing(p, outer) && !holes.some(hole => pointInRing(p, hole))) || outer.some(p => pointInRing(p, ring))) return 0;
  return Math.min(...[outer, ...holes].map(boundary => ringBoundaryDistance(ring, boundary)));
}
function vertexSetDistance(a, b) {
  return Math.max(...a.map(p => Math.min(...b.map(q => Math.hypot(p[0] - q[0], p[1] - q[1])))),
    ...b.map(p => Math.min(...a.map(q => Math.hypot(p[0] - q[0], p[1] - q[1])))));
}
// Independent projection oracle: east is +X, south is +Z, the source is WGS84.
function project([lon, lat]) {
  const [originLon, originLat] = city.meta.center, radians = Math.PI / 180;
  return [(lon - originLon) * radians * 6378137 * Math.cos(originLat * radians) * units,
    (originLat - lat) * radians * 6378137 * units];
}
function centroid(ring) {
  // Translate before the shoelace sum to avoid cancellation with degree values.
  const origin = ring[0], points = ring.map(p => [p[0] - origin[0], p[1] - origin[1]]);
  let areaTwice = 0, x = 0, z = 0;
  for (const [a, b] of edges(points)) {
    const product = a[0] * b[1] - b[0] * a[1];
    areaTwice += product; x += (a[0] + b[0]) * product; z += (a[1] + b[1]) * product;
  }
  assert(Math.abs(areaTwice) > 1e-15, 'Source footprint must have positive area');
  return [origin[0] + x / (3 * areaTwice), origin[1] + z / (3 * areaTwice)];
}
const sourceLonLat = cleanRing(feature.geometry.coordinates[0]);
const sourceRing = sourceLonLat.map(project);
const sourceCenter = centroid(sourceLonLat), center = project(sourceCenter);
assert.equal(feature.id, registration.sourceFeatureId);
assert.equal(registration.sourceSnapshotCommit, evidence.source_snapshot_commit);
assert(evidence.source_file.endsWith(registration.sourceFile));
assert.equal(feature.geometry.type, 'Polygon');
assert.equal(feature.geometry.coordinates.length, 1, 'This registered parcel has no hole');
assert.equal(feature.properties.sourceDataset, 'osm');
assert.equal(feature.properties.heightSource, 'tag');
assert.equal(feature.properties.heightMeters, registration.sourceHeightMeters);
assert.equal(registration.sourceHeightMethod, 'map-tag-not-survey');
assert.equal(registration.coordinateSystem, 'WGS84');
assert.equal(registration.sourceMarker.coordinateSystem, 'GCJ-02');
const marker = markers.markers.find(p => String(p.obj_id) === registration.sourceMarker.sceneId);
assert(marker, 'The registration must retain the actual source tour marker');
assert.deepEqual([marker.longitude, marker.latitude], registration.sourceMarker.lonLat);
assert(vertexSetDistance(sourceLonLat, registration.footprintLonLat) < 1e-12, 'Registered footprint must equal the retained source feature');
sourceCenter.forEach((v, i) => near(registration.anchorLonLat[i], v, 1e-11, 'Anchor is the source polygon centroid'));
center.forEach((v, i) => near([spec.x, spec.z][i], v, 1e-8, 'World anchor uses the city projection'));
assert(Math.hypot(spec.x - project(registration.sourceMarker.lonLat)[0], spec.z - project(registration.sourceMarker.lonLat)[1]) / units > 400,
  'A raw GCJ-02 marker must not accidentally be used as a WGS84 tower anchor');
assert(Math.abs(spec.x) < city.meta.width / 2 && Math.abs(spec.z) < city.meta.depth / 2, 'Anchor must lie on the city board');
passed.push('Source feature identity, CRS, retained marker, centroid, and independent city projection');

// city.json rounds vertices to 0.001 world units and may reverse ring order.
const roundingTolerance = Math.SQRT2 * 0.0005 + 1e-9;
const matches = city.buildings.flatMap((building, index) => cleanRing(building.ring).length === sourceRing.length &&
  vertexSetDistance(cleanRing(building.ring), sourceRing) <= roundingTolerance ? [index] : []);
assert.equal(matches.length, 1, 'Exactly one city building must match the evidence footprint');
const matchedIndex = matches[0];
near(city.buildings[matchedIndex].height / units, feature.properties.heightMeters, 1e-8, 'Matched source height');
const expectedFit = evidence.fitting.find(fit => fit.clearance_m === registration.footprintInsetMeters);
assert(expectedFit, 'The geometric inset must have a retained fitting result');
// The historical fit used the earlier board projection centre. Reproject the
// unchanged evidence geometry into the current board before deriving the same
// conservative axis clearances; never relax the assertion to absorb that change.
const sourceYaw = (180 - registration.frontBearingDeg) * Math.PI / 180;
const sourceCos = Math.cos(sourceYaw), sourceSin = Math.sin(sourceYaw);
const sourceLocal = sourceRing.map(([px, pz]) => [(px - center[0]) * sourceCos - (pz - center[1]) * sourceSin,
  (px - center[0]) * sourceSin + (pz - center[1]) * sourceCos]);
const sourceHalfClearances = [0, 1].map(axis => Math.min(
  ...sourceLocal.filter(point => point[axis] > 0).map(point => point[axis]),
  ...sourceLocal.filter(point => point[axis] < 0).map(point => -point[axis]),
) - registration.footprintInsetMeters * units);
const authoredSourceSize = rawSpec.sourceBounds.max.map((value, axis) => value - rawSpec.sourceBounds.min[axis]);
const expectedCurrentScale = Math.min(sourceHalfClearances[0] * 2 / authoredSourceSize[0], sourceHalfClearances[1] * 2 / authoredSourceSize[2]);
near(spec.uniformScale, expectedCurrentScale, 1e-10, 'Uniform scale must match independent current-projection fitting evidence');
near(spec.displayHeight, authoredSourceSize[1] * expectedCurrentScale, 1e-8, 'Fitted height must preserve the aspect ratio in the current projection');
assert.equal(spec.scalePolicy, 'uniform-mapped-footprint-fit-not-survey');
const forward = new Vector3(0, 0, 1).applyAxisAngle(new Vector3(0, 1, 0), spec.yaw);
const bearing = (Math.atan2(forward.x, -forward.z) * 180 / Math.PI + 360) % 360;
near(bearing, registration.frontBearingDeg, 1e-8, 'Positive-Z authored front bearing');
near(bearing, evidence.river_facing_front_candidate_deg, 1e-6, 'Front faces the retained river-side candidate');
assert(Math.abs(bearing - evidence.river_nearest_bearing_deg) < 10, 'Front candidate must point toward the nearby river');
let minCornerClearance = Infinity;
for (const corner of spec.footprint) {
  assert(pointInRing(corner, sourceRing), 'Every fitted bounding-box corner must lie inside the source footprint');
  minCornerClearance = Math.min(minCornerClearance, ...edges(sourceRing).map(([a, b]) => pointSegmentDistance(corner, a, b)));
}
assert(minCornerClearance / units >= registration.footprintInsetMeters - 1e-6, 'Corner clearance must retain the recorded inset');
passed.push('Mapped footprint match, one uniform fit, river-facing +Z orientation, and all bounding-box corners inside the inset');

const plan = planAuthoredGround([spec], city, 3.8);
const independentOverlaps = city.buildings.flatMap((building, index) => ringDistance(spec.footprint, cleanRing(building.ring)) === 0 ? [index] : []);
assert.deepEqual(independentOverlaps, [matchedIndex], 'The full model envelope must overlap only its mapped replacement building');
assert.deepEqual([...plan.omittedBuildingIndices], [matchedIndex], 'The ground plan must replace exactly that source building');
const otherBuildings = city.buildings.flatMap((building, index) => index === matchedIndex ? [] : [{ index, gap: ringDistance(spec.footprint, cleanRing(building.ring)) }]);
const nearestBuilding = otherBuildings.reduce((a, b) => a.gap < b.gap ? a : b);
assert(nearestBuilding.gap > 0, 'The fitted model must not touch a neighboring source building');
const roadGaps = city.roads.filter(road => road.points.length > 1).map(road => {
  const major = /motorway|trunk|primary|secondary/.test(road.kind || '');
  const footway = /foot|path|cycle|step|pedestrian/.test(road.kind || '');
  const width = Math.max(0.035, Math.min(0.7, Number(road.width) || (major ? 0.23 : footway ? 0.065 : 0.13)));
  const centerlineGap = lineDistance(spec.footprint, road.points);
  return { name: road.name, kind: road.kind, width, centerlineGap, edgeGap: centerlineGap - width / 2 };
}).sort((a, b) => a.edgeGap - b.edgeGap);
const waterGaps = city.water.map((water, index) => ({ index, name: water.name, gap: polygonDistance(spec.footprint, water.rings || [water.ring]) })).sort((a, b) => a.gap - b.gap);
assert(roadGaps[0].edgeGap / units > 1, 'The envelope must have positive modeled road-width clearance');
assert(waterGaps[0].gap / units > 1, 'The envelope must be on dry land with positive water clearance');
passed.push('Independent collision check: one replaced footprint, positive neighbor, modeled road-edge, and water clearances');

const loader = new GLTFLoader(), tiers = [];
for (const tier of ['light', 'detail']) {
  const relative = rawSpec.assets[tier].split('?')[0].replace(/^\//, '');
  const bytes = fs.readFileSync(path.join(root, 'public', relative));
  const raw = (await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
  raw.updateMatrixWorld(true);
  const sourceBounds = new Box3().setFromObject(raw), sourceSize = sourceBounds.getSize(new Vector3());
  for (const end of ['min', 'max']) sourceBounds[end].toArray().forEach((value, axis) =>
    near(value, rawSpec.sourceBounds[end][axis], 1e-5, `${tier} actual GLB source ${end}[${axis}]`));
  const prepared = prepareAuthoredModel(raw, spec);
  for (const axis of ['x', 'y', 'z']) near(prepared.scale[axis], spec.uniformScale, 1e-10, `${tier} uniform ${axis} scale`);
  const localBounds = new Box3().setFromObject(prepared), localSize = localBounds.getSize(new Vector3());
  near(localSize.x / localSize.y, sourceSize.x / sourceSize.y, 1e-9, `${tier} original facade aspect`);
  near(localSize.z / localSize.y, sourceSize.z / sourceSize.y, 1e-9, `${tier} original depth aspect`);
  // Base elevation is deliberately nonzero to exercise the same position/yaw
  // hierarchy used by the scene. Terrain elevation itself is not a surveyed datum.
  const base = 0.065, anchor = new Group();
  anchor.position.set(spec.x, base, spec.z); anchor.rotation.y = spec.yaw; anchor.add(prepared); anchor.updateMatrixWorld(true);
  const conservativeBounds = authoredWorldBounds(spec, base), exactBounds = new Box3();
  let vertices = 0, meshes = 0, minVertexClearance = Infinity;
  const point = new Vector3();
  anchor.traverse(mesh => {
    if (!mesh.isMesh) return;
    meshes++;
    assert.equal(mesh.userData.landmarkId, spec.id, 'Every picking mesh must use the catalog/label ID');
    const positions = mesh.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld); vertices++; exactBounds.expandByPoint(point);
      const projected = [point.x, point.z];
      assert(pointInRing(projected, sourceRing), `${tier} actual GLB vertex ${i} of ${mesh.name} leaves the footprint`);
      const gap = Math.min(...edges(sourceRing).map(([a, b]) => pointSegmentDistance(projected, a, b)));
      minVertexClearance = Math.min(minVertexClearance, gap);
      for (const axis of ['x', 'y', 'z']) assert(point[axis] >= conservativeBounds.min[axis] - 1e-7 && point[axis] <= conservativeBounds.max[axis] + 1e-7,
        `${tier} exact vertex must fit the bounds used by the camera and labels`);
    }
  });
  assert(vertices > 0 && meshes > 0);
  assert(minVertexClearance / units >= registration.footprintInsetMeters - 1e-6, 'Actual geometry retains the horizontal inset');
  near(exactBounds.min.y, base, 1e-8, `${tier} floor is at the scene anchor`);
  near(exactBounds.max.y, base + spec.displayHeight, 1e-8, `${tier} roof is below the shared label anchor`);
  const cameraCenter = conservativeBounds.getCenter(new Vector3());
  near(cameraCenter.x, spec.x, 1e-10, `${tier} camera bounds center X`);
  near(cameraCenter.z, spec.z, 1e-10, `${tier} camera bounds center Z`);
  tiers.push({ tier, meshes, vertices, scale: prepared.scale.toArray(), bounds: { min: exactBounds.min.toArray(), max: exactBounds.max.toArray() }, minVertexClearanceMeters: minVertexClearance / units });
  const geometries = new Set(), materials = new Set();
  anchor.traverse(child => {
    if (child.geometry) geometries.add(child.geometry);
    for (const material of Array.isArray(child.material) ? child.material : child.material ? [child.material] : []) materials.add(material);
  });
  geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
}
for (const end of ['min', 'max']) tiers[0].bounds[end].forEach((value, i) => near(value, tiers[1].bounds[end][i], 1e-7, `LOD world ${end}[${i}]`));
passed.push('Both actual GLBs: every transformed vertex fits, axes share one scale, source proportions and picking ID survive, and both LOD world bounds agree');

const policy = registration.contextHeight, farFactor = 3.8;
assert.equal(policy.innerMeters, 120); assert.equal(policy.outerMeters, 300); assert.equal(policy.nearFactor, 1);
const factorAt = distance => plan.heightFactor(spec.x + distance * units, spec.z);
for (const distance of [0, 20, 119.999, 120]) near(factorAt(distance), 1, 1e-10, 'Inner-neighborhood factor');
for (const distance of [300, 301, 1000]) near(factorAt(distance), farFactor, 1e-10, 'Outside-neighborhood factor');
let previous = 1;
for (let meters = 0; meters <= 350; meters += 0.5) {
  const factor = factorAt(meters);
  assert(factor >= previous - 1e-10 && factor >= 1 - 1e-10 && factor <= farFactor + 1e-10, 'Height transition must be monotone and bounded');
  for (const angle of [Math.PI / 2, Math.PI, Math.PI * 1.5]) near(plan.heightFactor(spec.x + Math.cos(angle) * meters * units, spec.z + Math.sin(angle) * meters * units), factor, 1e-10, 'The same spatial neighborhood applies in all directions');
  previous = factor;
}
assert(Math.abs(factorAt(120.01) - factorAt(119.99)) < 1e-6, 'Inner boundary must be continuous');
assert(Math.abs(factorAt(300.01) - factorAt(299.99)) < 1e-6, 'Outer boundary must be continuous');
near(factorAt(210), 2.4, 1e-10, 'Middle of the smooth height transition');
assert(spec.footprint.every(([x, z]) => plan.reserveTree(x, z)), 'Every model corner must be reserved against tree planting');
assert(plan.reserveTree(spec.x, spec.z));
assert(!plan.reserveTree(spec.x + 350 * units, spec.z), 'Tree exclusion must stay local');
const unchanged = planAuthoredGround([], city, farFactor);
assert.equal(unchanged.omittedBuildingIndices.size, 0);
assert.equal(unchanged.heightFactor(spec.x, spec.z), farFactor);
assert.equal(unchanged.reserveTree(spec.x, spec.z), false);
const neighborhood = { inner: 0, transition: 0, outside: 0 };
for (const building of city.buildings) {
  const ring = cleanRing(building.ring), x = (Math.min(...ring.map(p => p[0])) + Math.max(...ring.map(p => p[0]))) / 2,
    z = (Math.min(...ring.map(p => p[1])) + Math.max(...ring.map(p => p[1]))) / 2;
  const meters = Math.hypot(x - spec.x, z - spec.z) / units;
  neighborhood[meters <= policy.innerMeters ? 'inner' : meters < policy.outerMeters ? 'transition' : 'outside']++;
}
passed.push('120 m / 300 m height-policy boundaries, continuity, monotonicity, radial consistency, local tree reservation, and empty-plan compatibility');

console.log(JSON.stringify({
  ok: true, passed,
  sourceFeatureId: feature.id, matchedCityBuildingIndex: matchedIndex,
  anchorWgs84: registration.anchorLonLat, anchorWorldXZ: [spec.x, spec.z],
  frontBearingDeg: bearing, yawRadians: spec.yaw, uniformScale: spec.uniformScale,
  fittedDimensionsMetersNotSurveyed: spec.localSize.toArray().map(value => value / units),
  minEnvelopeInsetMeters: minCornerClearance / units,
  replacedBuildingIndices: [...plan.omittedBuildingIndices],
  nearestRemainingBuilding: { index: nearestBuilding.index, gapMeters: nearestBuilding.gap / units },
  minimumRoadEdgeGapMeters: roadGaps[0].edgeGap / units,
  nearestYanjiangRoadEdgeGapMeters: roadGaps.find(road => road.name === '沿江大道')?.edgeGap / units,
  minimumWaterGapMeters: waterGaps[0].gap / units,
  heightNeighborhoodCounts: neighborhood, nearTreeScaleRelativeToCity: policy.nearFactor / farFactor,
  tiers, webglVerified: false, surveyVerified: false, devicePerformanceVerified: false,
}, null, 2));
