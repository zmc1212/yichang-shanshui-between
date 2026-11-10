import * as THREE from 'three';

// Source centrelines and their exported widths are immutable inputs. These
// colours describe visual hierarchy, not lane counts or surveyed road surfaces.
export const ROAD_STYLES = Object.freeze({
  major: Object.freeze({ day: '#bec5b9', night: '#929f92', rank: 3, edgeDay: '#e4deca', edgeNight: '#627467' }),
  secondary: Object.freeze({ day: '#d0d0c1', night: '#839488', rank: 2, edgeDay: '#e8e1ce', edgeNight: '#596f61' }),
  local: Object.freeze({ day: '#dfdacb', night: '#74877b', rank: 1, edgeDay: '#d2cdbb', edgeNight: '#516859' }),
  pedestrian: Object.freeze({ day: '#eee3ce', night: '#9c9d83', rank: 0, edgeDay: '#d2c9b1', edgeNight: '#617361' }),
});

const EPSILON = 1e-7;
const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const validPoint = point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]);
const distanceSquared = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
const coordinateKey = point => `${point[0].toFixed(6)},${point[1].toFixed(6)}`;

function structurePresent(value) {
  if (value == null || value === false || value === 0) return false;
  return !['', 'no', 'false', '0'].includes(String(value).toLowerCase());
}

export function isBridgeRoad(road) {
  return road.bridge != null ? structurePresent(road.bridge) : road.kind === 'bridge';
}

export function getRoadHighway(road) {
  return String(road.highway || (road.kind === 'bridge' ? '' : road.kind) || '').replace(/_link$/, '');
}

export function getRoadClass(road) {
  const highway = getRoadHighway(road);
  if (['motorway', 'trunk', 'primary'].includes(highway)) return 'major';
  if (['secondary', 'tertiary'].includes(highway)) return 'secondary';
  if (['footway', 'path', 'cycleway', 'steps', 'pedestrian', 'bridleway'].includes(highway)) return 'pedestrian';
  return 'local';
}

export function getRoadWidth(road) {
  // In particular, do not clamp an explicit width to a prettier screen width.
  const width = Number(road.width);
  if (Number.isFinite(width) && width > 0) return width;
  const role = getRoadClass(road);
  return role === 'major' ? 0.23 : role === 'secondary' ? 0.18 : role === 'pedestrian' ? 0.065 : 0.13;
}

export function getRoadGrade(road) {
  const bridge = isBridgeRoad(road), tunnel = structurePresent(road.tunnel);
  const rawLayer = road.layer == null || road.layer === '' ? null : Number(road.layer);
  const layer = Number.isFinite(rawLayer) ? rawLayer : null;
  // Missing bridge layers must not be converted into invented junctions or
  // bridge heights. Unstructured surface ways use OSM's default ground layer.
  const joinable = layer !== null || (!bridge && !tunnel);
  const structure = bridge ? 'bridge' : tunnel ? 'tunnel' : 'surface';
  return {
    bridge, tunnel, layer, joinable,
    key: joinable ? `${structure}:${layer ?? 0}` : null,
    evidence: layer !== null ? 'source-layer' : joinable ? 'surface-default' : 'structure-layer-unknown',
  };
}

function cleanPoints(input) {
  const points = [];
  for (const point of input || []) {
    if (!validPoint(point)) continue;
    if (!points.length || distanceSquared(point, points.at(-1)) > EPSILON ** 2) points.push([point[0], point[1]]);
  }
  const closed = points.length > 2 && distanceSquared(points[0], points.at(-1)) <= EPSILON ** 2;
  if (closed) points.pop();
  return { points, closed };
}

function direction(a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
  return length > EPSILON ? [dx / length, dz / length] : null;
}

/** Only exact shared source vertices are candidates. An unshared X crossing
 * does not become a junction, even when two lines overlap in a top-down view. */
export function buildRoadTopology(roads) {
  const records = [], nodes = new Map();
  let invalidRoads = 0, unknownBridgeLayers = 0, unknownBridgeClasses = 0;
  for (let index = 0; index < (roads || []).length; index++) {
    const source = roads[index], { points, closed } = cleanPoints(source.points);
    if (points.length < 2) { invalidRoads++; continue; }
    const grade = getRoadGrade(source), role = getRoadClass(source), width = getRoadWidth(source);
    const record = { source, index, points, closed, grade, role, width };
    records.push(record);
    if (grade.bridge && grade.layer === null) unknownBridgeLayers++;
    if (grade.bridge && !getRoadHighway(source)) unknownBridgeClasses++;
    if (!grade.joinable) continue;
    points.forEach((point, pointIndex) => {
      const key = `${coordinateKey(point)}|${grade.key}`;
      if (!nodes.has(key)) nodes.set(key, { key, point: [...point], grade: grade.key, records: new Set(), arms: [] });
      const node = nodes.get(key);
      node.records.add(record);
      for (const adjacentIndex of [pointIndex - 1, pointIndex + 1]) {
        if (!closed && (adjacentIndex < 0 || adjacentIndex >= points.length)) continue;
        const adjacent = points[(adjacentIndex + points.length) % points.length];
        const tangent = direction(point, adjacent);
        if (tangent && !node.arms.some(arm => arm[0] * tangent[0] + arm[1] * tangent[1] > 1 - 1e-8)) node.arms.push(tangent);
      }
    });
  }
  const junctions = [];
  for (const node of nodes.values()) {
    if (node.records.size < 2 || node.arms.length < 3) continue;
    const participants = [...node.records];
    const dominant = participants.reduce((best, item) => {
      const priority = ROAD_STYLES[item.role].rank - ROAD_STYLES[best.role].rank;
      return priority > 0 || (priority === 0 && item.width > best.width) ? item : best;
    });
    junctions.push({ ...node, records: participants, role: dominant.role, radius: Math.max(...participants.map(record => record.width)) / 2 });
  }
  return { records, nodes, junctions, invalidRoads, unknownBridgeLayers, unknownBridgeClasses };
}

function newBucket() { return { positions: [], indices: [], triangles: 0 }; }

function addVertex(bucket, point, height) {
  const index = bucket.positions.length / 3;
  bucket.positions.push(point[0], height(point[0], point[1]), point[1]);
  return index;
}

function addTriangle(bucket, a, b, c) {
  const p = bucket.positions;
  const area = (p[b * 3] - p[a * 3]) * (p[c * 3 + 2] - p[a * 3 + 2]) - (p[b * 3 + 2] - p[a * 3 + 2]) * (p[c * 3] - p[a * 3]);
  if (Math.abs(area) <= 1e-14) return;
  if (area > 0) bucket.indices.push(a, c, b); else bucket.indices.push(a, b, c);
  bucket.triangles++;
}

function appendArc(bucket, point, radius, angle, sweep, height) {
  // Eight sides for a full round keep this city-wide geometry inexpensive;
  // the local street sample carries the closer-view furnishing detail.
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 4)));
  const center = addVertex(bucket, point, height);
  let previous = addVertex(bucket, [point[0] + Math.cos(angle) * radius, point[1] + Math.sin(angle) * radius], height);
  for (let i = 1; i <= count; i++) {
    const nextAngle = angle + sweep * i / count;
    const next = addVertex(bucket, [point[0] + Math.cos(nextAngle) * radius, point[1] + Math.sin(nextAngle) * radius], height);
    addTriangle(bucket, center, previous, next); previous = next;
  }
}

// A swept ribbon is the union of perpendicular segment rectangles, bounded
// circular outside joins and semicircular end caps. Unlike an unbounded miter,
// a hairpin can never send a vertex many road-widths into a neighbouring plot.
function appendStroke(bucket, points, closed, width, height) {
  const radius = width / 2, segments = [];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i], b = points[(i + 1) % points.length], tangent = direction(a, b);
    if (!tangent) continue;
    const normal = [-tangent[1], tangent[0]];
    const aLeft = addVertex(bucket, [a[0] + normal[0] * radius, a[1] + normal[1] * radius], height);
    const aRight = addVertex(bucket, [a[0] - normal[0] * radius, a[1] - normal[1] * radius], height);
    const bLeft = addVertex(bucket, [b[0] + normal[0] * radius, b[1] + normal[1] * radius], height);
    const bRight = addVertex(bucket, [b[0] - normal[0] * radius, b[1] - normal[1] * radius], height);
    addTriangle(bucket, aLeft, bLeft, aRight); addTriangle(bucket, aRight, bLeft, bRight);
    segments.push({ tangent, normal });
  }
  const firstJoint = closed ? 0 : 1, lastJoint = closed ? points.length : points.length - 1;
  for (let i = firstJoint; i < lastJoint; i++) {
    const previous = segments[(i - 1 + segments.length) % segments.length], next = segments[i % segments.length];
    if (!previous || !next) continue;
    const cross = previous.tangent[0] * next.tangent[1] - previous.tangent[1] * next.tangent[0];
    const dot = clamp(previous.tangent[0] * next.tangent[0] + previous.tangent[1] * next.tangent[1], -1, 1);
    const turn = Math.atan2(cross, dot);
    if (Math.abs(turn) < 1e-7) continue;
    const side = turn >= 0 ? -1 : 1;
    appendArc(bucket, points[i], radius, Math.atan2(previous.normal[1] * side, previous.normal[0] * side), turn, height);
  }
  if (!closed && segments.length) {
    const first = segments[0], last = segments.at(-1);
    appendArc(bucket, points[0], radius, Math.atan2(first.normal[1], first.normal[0]), Math.PI, height);
    appendArc(bucket, points.at(-1), radius, Math.atan2(-last.normal[1], -last.normal[0]), Math.PI, height);
  }
}

function geometryFromBucket(bucket) {
  if (!bucket.indices.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3));
  geometry.setIndex(bucket.indices);
  // Upward normals keep coplanar pieces of the same swept surface consistent
  // through overlaps, rather than exposing artificial shading seams at joins.
  const normals = new Float32Array(bucket.positions.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

function roadHeight(heightAt, inWater, lift, waterLift) {
  return (x, z) => Math.max((Number(heightAt(x, z)) || 0) + lift, inWater(x, z) ? waterLift : lift);
}

/** Testable standalone ribbon builder. Heights are sampled at both edges. */
export function buildRoadStrokeGeometry(inputPoints, width, {
  heightAt = () => 0, inWater = () => false, lift = 0.12, waterLift = 0.29,
} = {}) {
  const { points, closed } = cleanPoints(inputPoints);
  if (points.length < 2 || !Number.isFinite(width) || width <= 0) return null;
  const bucket = newBucket();
  appendStroke(bucket, points, closed, width, roadHeight(heightAt, inWater, lift, waterLift));
  return geometryFromBucket(bucket);
}

/** Builds at most six static meshes, regardless of source road count. */
export function createRoadNetwork({ roads = [], heightAt = () => 0, inWater = () => false, makeMaterial }) {
  if (typeof makeMaterial !== 'function') throw new Error('createRoadNetwork requires the scene material factory');
  const topology = buildRoadTopology(roads), group = new THREE.Group();
  group.name = 'graded source road network';
  const buckets = Object.fromEntries(Object.keys(ROAD_STYLES).map(role => [role, { surface: newBucket(), edge: newBucket() }]));
  const heights = Object.fromEntries(Object.entries(ROAD_STYLES).map(([role, style]) => [role, {
    // Tiny scene offsets establish colour precedence at coplanar
    // crossings. They are rendering offsets, never a layer-derived bridge deck.
    surface: roadHeight(heightAt, inWater, 0.12 + style.rank * 0.0002, 0.29 + style.rank * 0.0002),
    edge: roadHeight(heightAt, inWater, 0.092 + style.rank * 0.0001, 0.262 + style.rank * 0.0001),
  }]));
  const classCounts = Object.fromEntries(Object.keys(ROAD_STYLES).map(role => [role, 0]));
  for (const record of topology.records) {
    const { points, closed, width, role } = record;
    classCounts[role]++;
    appendStroke(buckets[role].surface, points, closed, width, heights[role].surface);
    // Give the city skeleton a continuous margin. Applying a second full
    // ribbon to every service alley would add far more geometry than visible
    // information at city scale; local paving belongs to the street sample.
    if (role === 'major' || role === 'secondary') {
      const edgeWidth = clamp(width * 0.18, 0.018, 0.052);
      appendStroke(buckets[role].edge, points, closed, width + edgeWidth, heights[role].edge);
    }
  }
  // All surface bands sit above all edge bands. A shared junction therefore
  // opens through each verge; it does not retain an end-cap stripe across it.
  for (const junction of topology.junctions) {
    appendArc(buckets[junction.role].surface, junction.point, junction.radius, 0, TAU, heights[junction.role].surface);
  }
  let vertices = 0, triangles = 0;
  for (const part of ['edge', 'surface']) for (const [role, style] of Object.entries(ROAD_STYLES)) {
    const bucket = buckets[role][part], geometry = geometryFromBucket(bucket);
    if (!geometry) continue;
    const material = part === 'surface'
      ? makeMaterial(style.day, style.night, { roughness: 0.98 })
      : makeMaterial(style.edgeDay, style.edgeNight, { roughness: 1 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `roads ${role} ${part}`; mesh.castShadow = false; mesh.receiveShadow = true;
    // Resolve quantised depth ties in the same order as the existing class
    // heights. Keep depth testing: this is colour precedence, not elevation.
    mesh.renderOrder = part === 'edge' ? 0 : 1 + style.rank;
    group.add(mesh); vertices += geometry.getAttribute('position').count; triangles += bucket.triangles;
  }
  const stats = {
    sourceRoads: roads.length,
    renderedRoads: topology.records.length,
    classCounts,
    sharedVertexJunctions: topology.junctions.length,
    junctionPolicy: 'shared-source-vertices-and-compatible-structure-layer-only',
    unknownBridgeLayers: topology.unknownBridgeLayers,
    unknownBridgeClasses: topology.unknownBridgeClasses,
    invalidRoads: topology.invalidRoads,
    sourceWidthsPreserved: true,
    meshes: group.children.length,
    vertices,
    triangles,
  };
  group.userData.roadStats = stats;
  return { group, stats };
}
