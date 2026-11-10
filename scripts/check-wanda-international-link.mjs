import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { AUTHORED_MODELS } from '../src/scene/authoredModels.js';
import { resolveAuthoredPlacement, planAuthoredGround } from '../src/scene/authoredPlacement.js';
import { planStreetDetails, createStreetDetails } from '../src/scene/streetDetails.js';
import { planWandaInternationalApproaches } from '../src/scene/wandaInternationalApproaches.js';

// Independent evidence for two approaches ending BEFORE the two Wanda Road
// mouths. The historical filename does not assert a cross-junction connection.
// No source models, city coordinates, browser state or GPU timings are changed.
const json = file => JSON.parse(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'));
const data = json('public/data/city.json');
const baseline = json('docs/iterations/20261110-wanda-international-baseline.json');
const sourceAudit = json('docs/iterations/20261110-wanda-international-corridor-audit.json');
assert.equal(createHash('sha256').update(fs.readFileSync(new URL('../public/data/city.json', import.meta.url))).digest('hex'), sourceAudit.sourceCitySha256, 'The independent source audit applies to these exact unchanged city bytes');
const models = AUTHORED_MODELS.map(spec => resolveAuthoredPlacement(spec, data.meta)).filter(Boolean);
const ground = planAuthoredGround(models, data, 3.8), units = data.meta.unitsPerMeter;
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const sourceSnapshot = hash({ data, models });
const pairs = ring => ring.map((p, i) => [p, ring[(i + 1) % ring.length]]);
const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const add = (p, d, scale) => [p[0] + d[0] * scale, p[1] + d[1] * scale];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const signedArea = ring => pairs(ring).reduce((sum, [a, b]) => sum + a[0] * b[1] - b[0] * a[1], 0) / 2;
const area = ring => Math.abs(signedArea(ring));
function pointSegment(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], length = dx * dx + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / length)) : 0;
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
}
function inside(p, ring) {
  let winding = 0;
  for (const [a, b] of pairs(ring)) {
    if (pointSegment(p, a, b) < 1e-10) return true;
    const sign = cross(a, b, p);
    if (a[1] <= p[1] && b[1] > p[1] && sign > 0) winding++;
    if (a[1] > p[1] && b[1] <= p[1] && sign < 0) winding--;
  }
  return winding !== 0;
}
function segmentDistance(a, b, c, d) {
  if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return 0;
  return Math.min(pointSegment(a, c, d), pointSegment(b, c, d), pointSegment(c, a, b), pointSegment(d, a, b));
}
function boundaryDistance(a, b) { return Math.min(...pairs(a).flatMap(([p, q]) => pairs(b).map(([r, s]) => segmentDistance(p, q, r, s)))); }
function polygonDistance(a, b) { return a.some(p => inside(p, b)) || b.some(p => inside(p, a)) ? 0 : boundaryDistance(a, b); }
function polygonSegmentDistance(ring, a, b) {
  return inside(a, ring) || inside(b, ring) ? 0 : Math.min(...pairs(ring).map(([p, q]) => segmentDistance(p, q, a, b)));
}
function clipPolygon(subject, clip) {
  let output = subject.map(p => [...p]);
  const sign = Math.sign(signedArea(clip));
  for (const [a, b] of pairs(clip)) {
    const input = output; output = [];
    for (let i = 0; i < input.length; i++) {
      const p = input[i], q = input[(i + 1) % input.length], dp = sign * cross(a, b, p), dq = sign * cross(a, b, q);
      if (dp >= -1e-13) output.push(p);
      if ((dp >= -1e-13) !== (dq >= -1e-13)) output.push(add(p, [q[0] - p[0], q[1] - p[1]], dp / (dp - dq)));
    }
    if (!output.length) break;
  }
  return output;
}
const intersectionArea = (a, b) => area(clipPolygon(a, b));
const box = ring => ({ minX: Math.min(...ring.map(p => p[0])), maxX: Math.max(...ring.map(p => p[0])), minZ: Math.min(...ring.map(p => p[1])), maxZ: Math.max(...ring.map(p => p[1])) });
const nearby = (a, b, pad = 0) => a.minX <= b.maxX + pad && b.minX <= a.maxX + pad && a.minZ <= b.maxZ + pad && b.minZ <= a.maxZ + pad;
const inWater = (x, z) => data.water.some(w => inside([x, z], w.rings[0]) && !w.rings.slice(1).some(h => inside([x, z], h)));
function heightAt(x, z) {
  if (inWater(x, z)) return 0;
  const t = data.terrain;
  if (!t?.cols || !t?.rows) {
    const radius = Math.max(data.meta.width, data.meta.depth) * .065;
    return data.landmarks.filter(l => /磨基山|白马山|东山/.test(l.name || '')).reduce((sum, l) => sum + (/磨基山/.test(l.name) ? 4.8 : 2.4) * Math.exp(-((x - l.x) ** 2 + (z - l.z) ** 2) / (radius ** 2 * .55)), 0);
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fx = clamp((x / (t.width || data.meta.width) + .5) * (t.cols - 1), 0, t.cols - 1.001);
  const fz = clamp((z / (t.depth || data.meta.depth) + .5) * (t.rows - 1), 0, t.rows - 1.001);
  const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
  const a = Number(t.heights[iz * t.cols + ix]) || 0, b = Number(t.heights[iz * t.cols + ix + 1]) || 0;
  const c = Number(t.heights[(iz + 1) * t.cols + ix]) || 0, d = Number(t.heights[(iz + 1) * t.cols + ix + 1]) || 0;
  return clamp((a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz, 0, Math.max(data.meta.width, data.meta.depth) * .12);
}
const input = { data, authoredModels: models, authoredGround: ground, waterfrontPlan: { omittedBuildingIndices: new Set() }, inWater, heightAt };
const makeMaterial = (day, night, options = {}) => new THREE.MeshStandardMaterial({ color: day, ...options });
function geometryHash(group) {
  const meshes = [];
  group.traverse(o => { if (o.isMesh) meshes.push({ name: o.name, index: o.geometry.index ? Array.from(o.geometry.index.array) : null, attributes: Object.fromEntries(Object.entries(o.geometry.attributes).map(([key, a]) => [key, Array.from(a.array)])), instances: o.instanceMatrix ? Array.from(o.instanceMatrix.array) : null }); });
  return hash(meshes);
}
function dispose(group) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  group.traverse(o => {
    if (o.geometry) geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      materials.add(m); for (const value of Object.values(m)) if (value?.isTexture) textures.add(value);
    }
  });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
}
const baselineChecks = [];
for (const record of baseline.cases) {
  const options = record.name === 'flat' ? { ...input, inWater: () => false, heightAt: () => 0 } : input;
  const plan = planStreetDetails(options), rendered = createStreetDetails(plan, { heightAt: options.heightAt, makeMaterial });
  assert.equal(plan.sites.length, 7); assert.equal(plan.links.length, 1);
  for (const previous of record.groups) {
    const site = [...plan.sites, ...plan.links].find(s => s.id === previous.id);
    assert.equal(hash(previous.plan), previous.planSha256, 'The frozen complete plan and its recorded hash agree');
    assert.equal(hash(site), previous.planSha256, `${record.name} ${previous.id}: complete V56 plan remains unchanged`);
    assert.equal(geometryHash(rendered.group.getObjectByName(previous.id)), previous.renderedGeometrySha256, `${record.name} ${previous.id}: actual geometry/index/normal/UV/instance buffers remain unchanged`);
  }
  baselineChecks.push({ terrain: record.name, unchangedCompletePlanAndBufferGroups: record.groups.length });
  dispose(rendered.group);
}

const plan = planStreetDetails(input), extensions = plan.extensions || [];
assert.equal(extensions.length, 2, 'Two independent approaches are integrated');
assert.equal(plan.stats.streetSites, 7); assert.equal(plan.stats.streetLinks, 1); assert.equal(plan.stats.streetExtensions, 2);
assert.equal(plan.stats.streetMarkings, 0, 'No unverified crossing or lane markings are generated');
const original = [...plan.sites, ...plan.links], originalSnapshot = hash(original);
const source = data.roads.find(road => road.osmId === 'way/1543968654');
const branchIds = ['way/1070095025', 'way/1070095026'];
const branches = data.roads.filter(road => branchIds.includes(road.osmId));
assert.equal(branches.length, 2); assert.equal(source.name, '沿江大道');
assert.deepEqual(source.points.slice(0, 3), [[1.384, 27.467], [-8.46, 19.643], [-13.682, 15.09]]);
assert.equal(source.width, .192);
const sourceLengths = [0];
for (let i = 1; i < source.points.length; i++) sourceLengths.push(sourceLengths.at(-1) + distance(source.points[i - 1], source.points[i]));
const rules = [
  { siteId: 'yichang-international-s01', segment: 0, side: 'maximum', stopStation: 12.3285, independentBoundary: 12.32855225546067 },
  { siteId: 'wanda-soho-s01', segment: 1, side: 'minimum', stopStation: 12.6839, independentBoundary: 12.68381721523374 },
];
// Each oracle starts at the untouched old sidewalk's COMPLETE end section,
// and translates it in its original road segment frame to the independently
// audited junction station. It never derives intended area from accepted cells.
function intended(rule) {
  const site = plan.sites.find(s => s.id === rule.siteId), a = source.points[rule.segment], b = source.points[rule.segment + 1];
  const length = distance(a, b), direction = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  const station = p => sourceLengths[rule.segment] + dot([p[0] - a[0], p[1] - a[1]], direction);
  const normal = [-direction[1], direction[0]], inner = source.width / 2 + .014, outer = inner + 3.6 * units;
  // A terminal slab may use the existing accent material (Wanda does). Only
  // vertices on the two exact source-side offset boundaries are eligible.
  const points = site.paving.filter(cell => ['sidewalk', 'accent'].includes(cell.role)).flatMap(cell => cell.points).filter(p => {
    const offset = dot([p[0] - a[0], p[1] - a[1]], normal);
    return Math.abs(offset - inner) < 1e-10 || Math.abs(offset - outer) < 1e-10;
  });
  const joinStation = rule.side === 'maximum' ? Math.max(...points.map(station)) : Math.min(...points.map(station));
  const candidates = points.filter(p => Math.abs(station(p) - joinStation) < 1e-10);
  const unique = candidates.filter((p, i) => candidates.findIndex(q => distance(p, q) < 1e-10) === i);
  assert.equal(unique.length, 2, `${site.id}: the original sidewalk has one full-width terminal section`);
  const join = unique.sort((p, q) => pointSegment(p, a, b) - pointSegment(q, a, b));
  assert(Math.abs(distance(...join) - 3.6 * units) < 1e-11);
  const travel = rule.stopStation - joinStation, stop = join.map(p => add(p, direction, travel));
  const ring = [join[0], join[1], stop[1], stop[0]];
  const outward = [(join[1][0] - join[0][0]) / (3.6 * units), (join[1][1] - join[0][1]) / (3.6 * units)];
  const fullEnvelope = [add(join[0], outward, -.002), add(join[1], outward, .002), add(stop[1], outward, .002), add(stop[0], outward, -.002)];
  return { rule, parent: site, direction, station, joinStation, join, stop, ring, fullEnvelope, length: Math.abs(travel), outward };
}
const intendedByOrigin = new Map(rules.map(rule => [rule.siteId, intended(rule)]));
const footprints = [
  ...data.buildings.filter((_, i) => !ground.omittedBuildingIndices.has(i)).concat(ground.retainedBuildings).map((building, i) => ({ id: `source-building-${i}`, rings: building.rings || [building.ring] })),
  ...models.map(model => ({ id: model.id, rings: [model.footprint] })),
].map(item => ({ ...item, bounds: box(item.rings[0]) }));
const roadSegments = data.roads.flatMap(road => road.points.slice(1).map((b, i) => ({ id: road.osmId, index: i, a: road.points[i], b, width: road.width, bounds: box([road.points[i], b]) })));
const waters = data.water.map(w => ({ rings: w.rings, bounds: box(w.rings[0]) }));
function obstacleClearance(ring, label) {
  const bounds = box(ring); let minimumRoad = Infinity, minimumBuilding = Infinity, minimumWater = Infinity;
  for (const obstacle of footprints) {
    if (!nearby(bounds, obstacle.bounds, .02)) continue;
    if (obstacle.rings.slice(1).some(hole => ring.every(p => inside(p, hole)) && boundaryDistance(ring, hole) > .0038)) continue;
    const clearance = polygonDistance(ring, obstacle.rings[0]); minimumBuilding = Math.min(minimumBuilding, clearance);
    assert(clearance > .0038, `${label}: complete footprint clears ${obstacle.id}`);
  }
  for (const road of roadSegments) {
    if (!nearby(bounds, road.bounds, road.width / 2 + .1)) continue;
    const clearance = polygonSegmentDistance(ring, road.a, road.b) - road.width / 2; minimumRoad = Math.min(minimumRoad, clearance);
    assert(clearance > .0038, `${label}: complete footprint clears road capsule ${road.id}/${road.index}`);
  }
  for (const water of waters) {
    if (!nearby(bounds, water.bounds, .02)) continue;
    if (water.rings.slice(1).some(hole => ring.every(p => inside(p, hole)) && boundaryDistance(ring, hole) > .0038)) continue;
    const clearance = polygonDistance(ring, water.rings[0]); minimumWater = Math.min(minimumWater, clearance);
    assert(clearance > .0038, `${label}: complete footprint clears the water polygon`);
  }
  assert(ring.every(p => Math.abs(p[0]) < data.meta.width / 2 && Math.abs(p[1]) < data.meta.depth / 2));
  return { minimumRoad, minimumBuilding, minimumWater };
}

const coverage = [], endpointChecks = [], extensionResources = [];
for (const extension of extensions) {
  assert.equal(extension.kind, 'street-extension'); assert.equal(extension.illustrative, true);
  assert.equal(extension.routeConnectedBetweenSites, false);
  assert.equal(extension.connectedSiteIds.length, 1, 'Each approach has exactly one origin, not a cross-road connection');
  const oracle = intendedByOrigin.get(extension.connectedSiteIds[0]); assert(oracle);
  assert.equal(extension.roadSourceId, source.osmId); assert.equal(extension.roadWidth, source.width);
  assert.equal(extension.trees.length, 0); assert.equal(extension.benches.length, 0);
  const cells = extension.paving, envelopeArea = area(oracle.ring);
  const auditedArm = sourceAudit.auditedArms.find(arm => arm.existingSite === oracle.parent.id);
  assert(auditedArm); assert(Math.abs(auditedArm.lengthMetres - oracle.length / units) < 1e-10);
  // The source audit orders both arms by increasing road station. Our oracle
  // orders each from its retained site toward the junction, so Wanda reverses.
  const auditedJoin = [auditedArm.start, auditedArm.stop].find(end => Math.abs(end.station - oracle.joinStation) < 1e-10);
  const auditedStop = [auditedArm.start, auditedArm.stop].find(end => Math.abs(end.station - oracle.rule.stopStation) < 1e-10);
  assert(auditedJoin && auditedStop);
  assert(distance(auditedJoin.inner, oracle.join[0]) < 1e-10 && distance(auditedJoin.outer, oracle.join[1]) < 1e-10);
  assert(distance(auditedStop.inner, oracle.stop[0]) < 1e-10 && distance(auditedStop.outer, oracle.stop[1]) < 1e-10, 'The independently derived terminal section agrees with the separate source audit');
  let covered = 0;
  for (const [index, cell] of cells.entries()) {
    assert(cell.points.length >= 3 && cell.points.flat().every(Number.isFinite));
    const cellArea = area(cell.points); assert(cellArea > 1e-12);
    assert(Math.abs(intersectionArea(cell.points, oracle.ring) - cellArea) < 1e-10, `${extension.id}: every cell remains inside the independently reconstructed full band`);
    covered += cellArea;
    obstacleClearance(cell.points, `${extension.id} paving ${index}`);
    for (const other of cells.slice(index + 1)) assert(intersectionArea(cell.points, other.points) < 1e-11, `${extension.id}: paving cells do not overlap`);
    for (const old of original) for (const earlier of old.paving) {
      if (nearby(box(cell.points), box(earlier.points))) assert(intersectionArea(cell.points, earlier.points) < 1e-10, `${extension.id}: extension has no positive-area overlap with retained paving`);
    }
  }
  assert(Math.abs(covered - envelopeArea) < 1e-10, `${extension.id}: accepted cells cover the ENTIRE intended width and length`);
  for (const [index, curb] of extension.curbs.entries()) {
    obstacleClearance(curb.footprint, `${extension.id} curb ${index}`);
    assert(Math.abs(intersectionArea(curb.footprint, oracle.fullEnvelope) - area(curb.footprint)) < 1e-10, 'Longitudinal curbs stay within the audited complete envelope');
    const delta = [curb.b[0] - curb.a[0], curb.b[1] - curb.a[1]];
    assert(Math.abs(delta[0] * oracle.direction[1] - delta[1] * oracle.direction[0]) < 1e-10, 'No transverse curb closes an existing sidewalk or junction mouth');
    assert(intersectionArea(curb.footprint, oracle.ring) < .002 * distance(curb.a, curb.b) + 1e-10, 'A longitudinal curb cannot span the pedestrian width');
  }
  const clearances = branchIds.map(id => {
    const segments = roadSegments.filter(segment => segment.id === id);
    const clearance = Math.min(...segments.map(segment => polygonSegmentDistance(oracle.fullEnvelope, segment.a, segment.b) - segment.width / 2));
    assert(clearance >= 2 * units - 1e-10, `${extension.id}: the entire sidewalk and both outer curb edges leave at least 2 display metres before ${id}`);
    const audited = auditedArm.nearRoadSegments.filter(segment => segment.osmId === id);
    const auditedMinimum = Math.min(...audited.map(segment => segment.clearanceMetres));
    assert(Math.abs(clearance / units - auditedMinimum) < 1e-9, 'Independent road-capsule clearance agrees with the separate source audit');
    const branch = branches.find(road => road.osmId === id);
    const decorativeHalfExtension = Math.max(.018, Math.min(.052, branch.width * .18)) / 2;
    assert(clearance - decorativeHalfExtension >= 1.45 * units, 'The rendered decorative road border also leaves the junction approach open');
    return { road: id, minimumFullWidthClearanceDisplayMetres: clearance / units, clearanceIncludingDecorativeRoadEdgeDisplayMetres: (clearance - decorativeHalfExtension) / units };
  });
  for (const lamp of extension.lamps) {
    obstacleClearance(lamp.safetyFootprint, `${extension.id} lamp safety zone`);
    assert(Math.abs(intersectionArea(lamp.safetyFootprint, oracle.ring) - area(lamp.safetyFootprint)) < 1e-10, 'The complete light/furniture safety zone stays within its sidewalk');
    assert(Math.abs(oracle.station([lamp.x, lamp.z]) - oracle.rule.stopStation) >= 8 * units, 'Lamps leave the full junction approach end clear');
    for (const old of original) for (const kind of ['trees', 'lamps', 'benches']) for (const furnishing of old[kind]) assert(polygonDistance(lamp.safetyFootprint, furnishing.safetyFootprint) > .0038, 'New lamps do not conflict with retained furniture');
  }
  coverage.push({ id: extension.id, origin: oracle.rule.siteId, sourceSegment: oracle.rule.segment, lengthDisplayMetres: oracle.length / units, widthDisplayMetres: distance(...oracle.join) / units, intendedAreaDisplaySquareMetres: envelopeArea / units ** 2, actualAreaDisplaySquareMetres: covered / units ** 2, cells: cells.length, curbs: extension.curbs.length, lamps: extension.lamps.length, stopStation: oracle.rule.stopStation, independentUnroundedSafeBoundary: oracle.rule.independentBoundary, clearances });
}
assert.equal(extensions.reduce((sum, site) => sum + site.lamps.length, 0), 7, 'The two safe approaches use seven sparse lights');
assert.equal(hash(original), originalSnapshot, 'Planning extensions does not modify retained street plans');
const completeDomainSeparation = polygonDistance(...[...intendedByOrigin.values()].map(oracle => oracle.fullEnvelope)) / units;
assert(Math.abs(completeDomainSeparation - sourceAudit.openJunction.minimumFullDomainSeparationDisplayMetres) < 1e-9, 'The two independent full domains preserve the separately audited physical gap');

const rendered = createStreetDetails(plan, { heightAt, makeMaterial });
rendered.group.updateMatrixWorld(true);
const xyKey = (x, z) => `${Math.fround(x)},${Math.fround(z)}`;
const xyzKey = (x, y, z) => `${Math.fround(x)},${Math.fround(y)},${Math.fround(z)}`;
function verticesAt(mesh, point) {
  const p = mesh.geometry.attributes.position, uv = mesh.geometry.attributes.uv, result = [];
  for (let i = 0; i < p.count; i++) if (xyKey(p.getX(i), p.getZ(i)) === xyKey(...point)) result.push({ xyz: [p.getX(i), p.getY(i), p.getZ(i)], uv: uv ? [uv.getX(i), uv.getY(i)] : null });
  return result;
}
function triangles(mesh) {
  const p = mesh.geometry.attributes.position, n = mesh.geometry.attributes.normal, ix = mesh.geometry.index, output = [];
  for (let i = 0; i < (ix?.count || p.count); i += 3) {
    const ids = [0, 1, 2].map(j => ix ? ix.getX(i + j) : i + j);
    output.push({ ids, xyz: ids.map(j => [p.getX(j), p.getY(j), p.getZ(j)]), normals: n ? ids.map(j => [n.getX(j), n.getY(j), n.getZ(j)]) : null });
  }
  return output;
}
function matchingEdge(mesh, endpoints) {
  const keys = endpoints.map(p => xyKey(...p));
  return triangles(mesh).filter(triangle => pairs(triangle.xyz).some(([a, b]) => {
    const k = [xyKey(a[0], a[2]), xyKey(b[0], b[2])]; return k.includes(keys[0]) && k.includes(keys[1]);
  })).length;
}
function gaussianGroundUpperBound(ring) {
  // Every displayed fallback hill is positive. Its maximum over a triangle
  // occurs at the point nearest its centre; summing these separate maxima is
  // a conservative bound for the complete triangle, not a point sample.
  assert(!data.terrain, 'A GIS grid requires its own piecewise bilinear whole-triangle ground bound');
  const radius = Math.max(data.meta.width, data.meta.depth) * .065;
  return data.landmarks.filter(l => /磨基山|白马山|东山/.test(l.name || '')).reduce((sum, landmark) => {
    const point = [landmark.x, landmark.z];
    const nearest = inside(point, ring) ? 0 : Math.min(...pairs(ring).map(([a, b]) => pointSegment(point, a, b)));
    return sum + (/磨基山/.test(landmark.name) ? 4.8 : 2.4) * Math.exp(-(nearest ** 2) / (radius ** 2 * .55));
  }, 0);
}
let maxUvError = 0, actualTriangles = 0, minimumGroundClearance = Infinity, maximumFloat32AreaError = 0;
for (const extension of extensions) {
  const oracle = intendedByOrigin.get(extension.connectedSiteIds[0]);
  const group = rendered.group.getObjectByName(extension.id), oldGroup = rendered.group.getObjectByName(oracle.parent.id);
  const paving = group.getObjectByName('forecourt, entrance path and sidewalk');
  // Wanda's untouched terminal slab uses the accent batch; the new band
  // deliberately shares that batch's frame/edge without rewriting the slab.
  const oldPaving = [oldGroup.getObjectByName('forecourt, entrance path and sidewalk'), oldGroup.getObjectByName('street paving insets')].find(mesh => mesh && matchingEdge(mesh, oracle.join) === 1);
  const curb = group.getObjectByName('open-entry sidewalk kerbs'), oldCurb = oldGroup.getObjectByName('open-entry sidewalk kerbs');
  assert(paving && oldPaving && curb && oldCurb);
  let joinVertices = 0, joinedCurbCorners = 0;
  for (const point of oracle.join) {
    const before = verticesAt(oldPaving, point), after = verticesAt(paving, point);
    assert(before.length && after.length, 'Both complete old terminal corners occur in actual old/new paving');
    const oldXYZ = new Set(before.map(vertex => xyzKey(...vertex.xyz))), newXYZ = new Set(after.map(vertex => xyzKey(...vertex.xyz)));
    assert.equal(oldXYZ.size, 1); assert.deepEqual(newXYZ, oldXYZ, 'The full terminal section meets at identical Float32 XYZ coordinates');
    const oldUv = new Set(before.map(vertex => JSON.stringify(vertex.uv))), newUv = new Set(after.map(vertex => JSON.stringify(vertex.uv)));
    assert.equal(oldUv.size, 1); assert.deepEqual(newUv, oldUv, 'Texture coordinates are exactly continuous at the retained full-width end');
    joinVertices += after.length;
    // Compare both edges and both elevations of each longitudinal curb.
    for (const side of [-1, 1]) {
      const corner = add(point, oracle.outward, side * .002), previous = verticesAt(oldCurb, corner), current = verticesAt(curb, corner);
      assert(previous.length && current.length, 'Both old/new longitudinal curb corners are present at the join');
      const oldHeights = new Set(previous.map(vertex => xyzKey(...vertex.xyz))), newHeights = new Set(current.map(vertex => xyzKey(...vertex.xyz)));
      assert.deepEqual(newHeights, oldHeights, 'Curb base and top meet at identical actual Float32 XYZ coordinates');
      joinedCurbCorners++;
    }
  }
  assert.equal(matchingEdge(oldPaving, oracle.join), 1, 'The old mesh contains one complete terminal edge');
  assert.equal(matchingEdge(paving, oracle.join), 1, 'The new mesh contains the same complete terminal edge');
  const originalFrameCell = oracle.parent.paving.find(cell => cell.role === 'forecourt') || oracle.parent.paving[0];
  const frameEdge = [originalFrameCell.points[1][0] - originalFrameCell.points[0][0], originalFrameCell.points[1][1] - originalFrameCell.points[0][1]];
  const frameLength = Math.hypot(...frameEdge), frame = frameEdge.map(v => v / frameLength);
  const positions = paving.geometry.attributes.position, normals = paving.geometry.attributes.normal, uv = paving.geometry.attributes.uv;
  assert.equal(positions.count, uv.count); assert.equal(positions.count, normals.count);
  const shared = new Map();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i), u = uv.getX(i), v = uv.getY(i);
    assert([x, y, z, u, v, normals.getX(i), normals.getY(i), normals.getZ(i)].every(Number.isFinite));
    const dx = x - oracle.parent.sourceAnchor[0], dz = z - oracle.parent.sourceAnchor[1];
    const expected = [(dx * frame[0] + dz * frame[1]) / (4.8 * units), (-dx * frame[1] + dz * frame[0]) / (2.4 * units)];
    const error = Math.max(Math.abs(u - expected[0]), Math.abs(v - expected[1])); maxUvError = Math.max(maxUvError, error);
    assert(error < .0001, 'Every emitted UV uses the original site frame at Float32 precision');
    const key = xyKey(x, z);
    if (shared.has(key)) assert.deepEqual(shared.get(key), [y, u, v], 'Every repeated tessellation vertex has one exact height and texture coordinate');
    else shared.set(key, [y, u, v]);
  }
  let actualArea = 0;
  const emitted = triangles(paving), floatWorldTolerance = Math.max(...oracle.ring.flat().map(Math.abs)) * 2 ** -23;
  const floatAreaTolerance = floatWorldTolerance * pairs(oracle.ring).reduce((sum, [a, b]) => sum + distance(a, b), 0) * 2;
  for (const triangle of emitted) {
    const [a, b, c] = triangle.xyz.map(p => new THREE.Vector3(...p)), face = b.clone().sub(a).cross(c.clone().sub(a));
    assert(face.y > 0 && face.lengthSq() > 1e-22, 'Actual paving triangles remain nondegenerate and face up');
    for (const normal of triangle.normals) { assert(normal[1] > 0); assert(face.dot(new THREE.Vector3(...normal)) > 0); }
    const ring = triangle.xyz.map(p => [p[0], p[2]]), triangleArea = area(ring);
    actualArea += triangleArea; actualTriangles++;
    assert(triangleArea - intersectionArea(ring, oracle.ring) < floatAreaTolerance, 'Every complete rendered triangle stays inside the intended band within recorded Float32 precision');
    const lowerBound = Math.min(...triangle.xyz.map(p => p[1])) - gaussianGroundUpperBound(ring);
    minimumGroundClearance = Math.min(minimumGroundClearance, lowerBound);
    assert(lowerBound > .003, 'A conservative whole-triangle bound keeps every paving interior above the actual scene ground');
    obstacleClearance(ring, `${extension.id} actual paving triangle`);
  }
  const areaError = Math.abs(actualArea - area(oracle.ring)); maximumFloat32AreaError = Math.max(maximumFloat32AreaError, areaError);
  assert(areaError <= floatAreaTolerance, 'Actual rendered triangles cover the intended complete band within Float32 error');
  for (const triangle of triangles(curb)) {
    const ring = triangle.xyz.map(p => [p[0], p[2]]);
    if (area(ring) < 1e-12) continue;
    obstacleClearance(ring, `${extension.id} actual curb top`);
    for (const branch of roadSegments.filter(road => branchIds.includes(road.id))) assert(polygonSegmentDistance(ring, branch.a, branch.b) - branch.width / 2 >= 2 * units - 2 * floatWorldTolerance, 'Every actual Float32 curb top preserves the independently audited road-mouth setback');
  }
  // Check the actual 24-segment warm-light meshes, not only planner discs.
  const pools = group.getObjectByName('street lamp pools');
  assert(pools && pools.material.forceSinglePass === true && pools.material.depthWrite === false);
  assert.equal(triangles(pools).length, extension.lamps.length * 24);
  for (const triangle of triangles(pools)) {
    const ring = triangle.xyz.map(p => [p[0], p[2]]);
    obstacleClearance(ring, `${extension.id} actual warm light pool`);
    assert(Math.abs(intersectionArea(ring, oracle.ring) - area(ring)) < floatAreaTolerance, 'Actual light-pool triangles remain inside their sidewalk');
    for (const point of triangle.xyz) assert(Math.abs(point[1] - heightAt(point[0], point[2]) - extension.groundLift(point[0], point[2]) - .0008) < 1e-6, 'Light-pool vertices follow the same rendered sidewalk surface');
  }
  // Transform each emitted lamp triangle through the actual instance matrix.
  // Its entire projected convex hull must stay inside the approved safety zone.
  for (const name of ['street lamps', 'street warm lamp heads']) {
    const mesh = group.getObjectByName(name); assert(mesh?.isInstancedMesh); assert.equal(mesh.count, extension.lamps.length);
    for (let i = 0; i < mesh.count; i++) {
      const matrix = new THREE.Matrix4(); mesh.getMatrixAt(i, matrix);
      for (const triangle of triangles(mesh)) {
        const ring = triangle.xyz.map(point => new THREE.Vector3(...point).applyMatrix4(matrix)).map(point => [point.x, point.z]);
        assert(ring.every(point => inside(point, extension.lamps[i].safetyFootprint)), 'Every actual lamp body/head triangle lies inside its complete approved safety polygon');
        if (area(ring) > 1e-12) obstacleClearance(ring, `${extension.id} actual instanced lamp`);
      }
    }
  }
  endpointChecks.push({ id: extension.id, fullWidthJoinedDisplayMetres: distance(...oracle.join) / units, joinedActualPavingVertices: joinVertices, joinedCurbCornerColumns: joinedCurbCorners, identicalFloat32XYZAndUv: true, actualPavingTriangles: emitted.length, actualFloat32AreaErrorWorld: areaError, floatWorldTolerance, floatAreaTolerance });
}

function countResources(group) {
  const resources = { meshes: 0, triangles: 0, geometryBytes: 0, textures: new Set(), materials: new Set(), geometries: new Set() };
  group.traverse(mesh => {
    if (!mesh.isMesh) return;
    resources.meshes++; resources.geometries.add(mesh.geometry);
    resources.triangles += (mesh.geometry.index?.count || mesh.geometry.attributes.position.count) / 3 * (mesh.isInstancedMesh ? mesh.count : 1);
    resources.geometryBytes += Object.values(mesh.geometry.attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, 0) + (mesh.geometry.index?.array.byteLength || 0) + (mesh.instanceMatrix?.array.byteLength || 0) + (mesh.instanceColor?.array.byteLength || 0);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      resources.materials.add(material); for (const value of Object.values(material)) if (value?.isTexture) resources.textures.add(value);
    }
  });
  return resources;
}
const resources = countResources(rendered.group), resourceStats = rendered.getStats(), previousResources = baseline.cases.find(record => record.name === 'actual-terrain').resources;
assert.equal(resourceStats.streetMeshes, resources.meshes); assert.equal(resourceStats.streetTriangles, resources.triangles); assert.equal(resourceStats.streetGeometryBytes, resources.geometryBytes);
assert.equal(resources.textures.size, 1); assert.equal(resourceStats.streetTextureCount, 1); assert.equal(resourceStats.streetTextureSourceBytes, 256 * 256 * 4);
const [texture] = resources.textures;
assert.equal(texture.image.width, 256); assert.equal(texture.image.height, 256); assert.equal(texture.generateMipmaps, true);
rendered.group.traverse(mesh => { if (mesh.isMesh && /forecourt|paving insets/.test(mesh.name)) assert.equal(mesh.material.map, texture, 'Every old/new paved group reuses the exact same opaque atlas'); });
const resourceDelta = { meshes: resources.meshes - previousResources.streetMeshes, triangles: resources.triangles - previousResources.streetTriangles, geometryBytes: resources.geometryBytes - previousResources.streetGeometryBytes, textures: resources.textures.size - previousResources.streetTextureCount };
// Two plain-paving/curb batches plus two instanced lamp parts and one light
// pool per approach: ten meshes. Maximum 3 m tessellation gives 79 cells,
// 158 longitudinal curbs and seven lights; the whole added budget is explicit.
assert.equal(resourceDelta.meshes, 10); assert(resourceDelta.triangles <= 1800); assert(resourceDelta.geometryBytes <= 100000); assert.equal(resourceDelta.textures, 0);
for (const extension of extensions) {
  const r = countResources(rendered.group.getObjectByName(extension.id));
  extensionResources.push({ id: extension.id, meshes: r.meshes, triangles: r.triangles, geometryBytes: r.geometryBytes });
}
for (const [key, property] of [['streetPavingCells', 'paving'], ['streetCurbSegments', 'curbs'], ['streetTrees', 'trees'], ['streetLamps', 'lamps'], ['streetBenches', 'benches']]) assert.equal(resourceStats[key], [...original, ...extensions].reduce((sum, site) => sum + site[property].length, 0), `${key}: integrated published count equals all actual groups`);

const visible = { intersectsBox: () => true }, invisible = { intersectsBox: () => false }, lifecycle = [];
const dayCounts = new Map([[2, 0], [15, 24], [20, 27], [60, 85], [80, 89]]);
for (const [scale, expected] of dayCounts) {
  rendered.update({ pixelsPerUnit: scale, frustum: visible });
  const stats = rendered.getStats(); assert.equal(stats.streetVisibleDrawCalls, expected);
  assert.equal(stats.streetVisibleExtensions, scale === 2 ? 0 : 2);
  assert.equal(stats.streetVisibleSites, scale === 2 ? 0 : scale === 15 ? 6 : 7);
  assert.equal(stats.streetVisibleLinks, scale === 2 ? 0 : 1);
  assert.equal(rendered.update({ pixelsPerUnit: scale, frustum: visible }), false, 'Identical scale and view do not request another render');
  lifecycle.push({ pixelsPerUnit: scale, visibleSites: stats.streetVisibleSites, visibleLinks: stats.streetVisibleLinks, visibleExtensions: stats.streetVisibleExtensions, drawCalls: stats.streetVisibleDrawCalls });
}
rendered.setTheme(true); assert.equal(rendered.getStats().streetVisibleDrawCalls, 98); rendered.setTheme(false); assert.equal(rendered.getStats().streetVisibleDrawCalls, 89);
for (const update of [{ pixelsPerUnit: 80, frustum: visible, enabled: false }, { pixelsPerUnit: 80, frustum: invisible }, { pixelsPerUnit: 2, frustum: visible }]) {
  rendered.update(update); const stats = rendered.getStats(); assert.equal(stats.streetVisibleDrawCalls, 0); assert.equal(stats.streetVisibleExtensions, 0);
}
rendered.update({ pixelsPerUnit: 80, frustum: visible, treesEnabled: false });
assert.equal(rendered.getStats().streetVisibleExtensions, 2, 'The tree switch does not hide sidewalk approaches');
for (const extension of extensions) {
  const group = rendered.group.getObjectByName(extension.id); assert(group.visible);
  assert(group.getObjectByName('street lamps').parent.visible, 'The tree switch leaves near-view lamps available');
}

const failClosed = [], directInput = { ...input, sites: plan.sites, links: plan.links };
assert.equal(planWandaInternationalApproaches(directInput).sites.length, 2);
function rejects(name, override) {
  const result = planWandaInternationalApproaches({ ...directInput, ...override });
  assert.equal(result.sites.length, 0, `${name}: a failed source or complete band rejects both approaches, never a partial route`);
  assert.equal(result.views.length, 0); assert.equal(result.stats.streetExtensions, 0);
  assert.equal(result.reserveTree(-7, 20), false); failClosed.push({ name, reason: result.reason });
}
for (const id of [source.osmId, ...branchIds]) {
  rejects(`${id}: missing`, { data: { ...data, roads: data.roads.filter(road => road.osmId !== id) } });
  for (const [name, change] of [
    ['bridge', { bridge: 'yes' }], ['tunnel', { tunnel: 'yes' }], ['nonzero-layer', { layer: '1' }], ['unknown-layer', { layer: 'unknown' }], ['width', { width: .2 }],
  ]) rejects(`${id}: ${name}`, { data: { ...data, roads: data.roads.map(road => road.osmId === id ? { ...road, ...change } : road) } });
  rejects(`${id}: changed topology`, { data: { ...data, roads: data.roads.map(road => road.osmId === id ? { ...road, points: road.points.map((point, i) => i === 1 ? [point[0] + .0001, point[1]] : point) } : road) } });
}
for (const rule of rules) {
  rejects(`${rule.siteId}: missing original site`, { sites: plan.sites.filter(site => site.id !== rule.siteId) });
  rejects(`${rule.siteId}: missing authored model`, { authoredModels: models.filter(model => model.id !== rule.siteId) });
  rejects(`${rule.siteId}: missing full-width terminal section`, { sites: plan.sites.map(site => site.id === rule.siteId ? { ...site, paving: [] } : site) });
  rejects(`${rule.siteId}: missing original curb ends`, { sites: plan.sites.map(site => site.id === rule.siteId ? { ...site, curbs: [] } : site) });
  const oracle = intendedByOrigin.get(rule.siteId), t = .4132719;
  const centre = add(add(oracle.join[0], oracle.direction, (rule.stopStation - oracle.joinStation) * t), oracle.outward, 1.43 * units);
  // A tiny complete polygon wholly inside a slab catches a vertex-only or
  // centreline-only obstacle check: no original slab corner lies inside it.
  const ring = [[-.0002, -.0003], [.0003, -.0002], [.0002, .0003], [-.0003, .0002]].map(offset => add(centre, offset, 1));
  rejects(`${rule.siteId}: enclosed small building`, { data: { ...data, buildings: [...data.buildings, { ring, rings: [ring], height: .2 }] } });
  rejects(`${rule.siteId}: enclosed small water polygon`, { data: { ...data, water: [...data.water, { rings: [ring] }] } });
}
rejects('non-finite terrain', { heightAt: () => NaN });
rejects('water callback covers the approaches', { inWater: () => true });
assert.equal(hash({ data, models }), sourceSnapshot, 'All checks and extension planning leave original geographic data and authored transforms byte-for-byte unchanged');
assert.equal(hash(original), originalSnapshot, 'Failure cases do not mutate the original seven sites or retained link');

let disposalCount = 0;
for (const item of [...resources.geometries, ...resources.materials, ...resources.textures]) item.addEventListener('dispose', () => disposalCount++);
dispose(rendered.group);
assert.equal(disposalCount, resources.geometries.size + resources.materials.size + resources.textures.size, 'All actual shared resources dispose exactly once');
console.log(JSON.stringify({
  checkedAt: '2026-11-10', scope: 'independent source-envelope, whole-area coverage, actual Float32 geometry/UV/instance buffers and renderer lifecycle; no browser/GPU/phone timing',
  baseline: { version: baseline.base, commit: baseline.commit, cases: baselineChecks },
  claims: { independentApproaches: true, crossesWandaRoad: false, connectedBetweenSites: false, surveyedEntrance: false, accessibilityCertification: false, dimensions: 'display metres derived from existing coordinates' },
  coverage, sourceAudit: { file: 'docs/iterations/20261110-wanda-international-corridor-audit.json', sourceCitySha256: sourceAudit.sourceCitySha256, matchesIndependentGeometry: true }, junctionOpenSourceStationMetres: (rules[1].stopStation - rules[0].stopStation) / units, minimumCompleteDomainSeparationDisplayMetres: completeDomainSeparation, endpointChecks,
  emitted: { actualPavingTriangles: actualTriangles, maxUvError, maximumFloat32AreaErrorWorld: maximumFloat32AreaError, conservativeWholeTriangleGroundClearanceWorld: minimumGroundClearance },
  resources: { meshes: resources.meshes, triangles: resources.triangles, geometryBytes: resources.geometryBytes, textureCount: resources.textures.size, textureSourceBytes: resourceStats.streetTextureSourceBytes, resourceDelta, incrementalBudget: { meshes: 10, triangles: 1800, geometryBytes: 100000, newTextures: 0 }, perExtension: extensionResources, nearDayDrawCalls: 89, nearNightDrawCalls: 98 },
  lifecycle, failClosedCases: failClosed.length, failClosed,
}, null, 2));
