import { getRoadGrade, getRoadHighway, getRoadWidth } from './roadNetwork.js';

const VEHICULAR = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'service']);
const valid = point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const bounds = points => ({ minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])), minZ: Math.min(...points.map(p => p[1])), maxZ: Math.max(...points.map(p => p[1])) });
function project(point, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], lengthSq = dx * dx + dz * dz;
  const t = lengthSq ? clamp(((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / lengthSq, 0, 1) : 0;
  const closest = [a[0] + dx * t, a[1] + dz * t];
  return { point: closest, t, distance: Math.hypot(point[0] - closest[0], point[1] - closest[1]) };
}
function inside(point, ring) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function nearestFootprintSegment(footprint, a, b) {
  if (inside(a, footprint) || inside(b, footprint)) return null;
  let best = null;
  const choose = (distance, modelPoint, roadPoint, t) => { if (!best || distance < best.distance) best = { distance, modelPoint, roadPoint, t }; };
  for (let i = 0; i < footprint.length; i++) {
    const c = footprint[i], d = footprint[(i + 1) % footprint.length];
    if (cross(a, b, c) * cross(a, b, d) < -1e-12 && cross(c, d, a) * cross(c, d, b) < -1e-12) return null;
    const q = project(c, a, b); choose(q.distance, c, q.point, q.t);
    for (const [endpoint, t] of [[a, 0], [b, 1]]) { const p = project(endpoint, c, d); choose(p.distance, p.point, endpoint, t); }
  }
  return best;
}

/**
 * Bounded camera observations only. Source roads, retained plaza guards and
 * all model transforms remain immutable. This does not infer an entrance,
 * walkway connection, legal pedestrian access or a first-person route.
 */
export function planStreetObservations({ models = [], roads = [], heightAt = () => 0, inWater = () => false, unitsPerMeter = .02 } = {}) {
  const units = Number.isFinite(unitsPerMeter) && unitsPerMeter > 0 ? unitsPerMeter : .02;
  const segments = [];
  roads.forEach((road, sourceRoadIndex) => {
    const grade = getRoadGrade(road), highway = getRoadHighway(road);
    if (grade.bridge || grade.tunnel || (grade.layer !== null && grade.layer !== 0) || !VEHICULAR.has(highway)) return;
    const width = getRoadWidth(road);
    for (let index = 1; index < (road.points || []).length; index++) {
      const a = road.points[index - 1], b = road.points[index];
      if (!valid(a) || !valid(b)) continue;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 6 * units) continue;
      segments.push({ a, b, length, width, bounds: bounds([a, b]), sourceRoadIndex, sourceSegmentIndex: index - 1,
        roadName: String(road.name || ''), highway, osmId: road.osmId || null });
    }
  });
  const views = [], unavailableIds = [];
  for (const model of models) {
    const footprint = model.footprint;
    if (!model.id || model.kind !== 'authored' || !Number.isFinite(model.x) || !Number.isFinite(model.z)
      || !Array.isArray(footprint) || footprint.length < 3 || !footprint.every(valid)
      || !Number.isFinite(model.localSize?.y) || !(model.localSize.y > 0)) { if (model.id) unavailableIds.push(model.id); continue; }
    const box = bounds(footprint);
    const maxDistance = Math.max(35 * units, Math.min(110 * units, Math.hypot(box.maxX - box.minX, box.maxZ - box.minZ) * .7 + 20 * units));
    let best = null;
    for (const segment of segments) {
      const radius = maxDistance + segment.width / 2, sb = segment.bounds;
      if (sb.maxX < box.minX - radius || sb.minX > box.maxX + radius || sb.maxZ < box.minZ - radius || sb.minZ > box.maxZ + radius) continue;
      const nearest = nearestFootprintSegment(footprint, segment.a, segment.b);
      if (!nearest || nearest.distance <= segment.width / 2 + .4 * units || nearest.distance - segment.width / 2 > maxDistance) continue;
      const gap = nearest.distance - segment.width / 2;
      if (best && gap >= best.gap) continue;
      const tangent = [(segment.b[0] - segment.a[0]) / segment.length, (segment.b[1] - segment.a[1]) / segment.length];
      const normal = [-tangent[1], tangent[0]];
      const projections = footprint.map(p => p[0] * tangent[0] + p[1] * tangent[1]);
      const span = Math.min(segment.length, Math.max(18 * units, Math.min(90 * units, (Math.max(...projections) - Math.min(...projections)) * 1.4)));
      const start = clamp(nearest.t * segment.length - span / 2, 0, segment.length - span);
      const ends = [start, start + span].map(at => [segment.a[0] + tangent[0] * at, segment.a[1] + tangent[1] * at]);
      let water = false;
      for (let step = 0; step <= 8 && !water; step++) for (const side of [-1, 0, 1]) {
        const t = step / 8;
        const x = ends[0][0] + (ends[1][0] - ends[0][0]) * t + normal[0] * segment.width / 2 * side;
        const z = ends[0][1] + (ends[1][1] - ends[0][1]) * t + normal[1] * segment.width / 2 * side;
        if (inWater(x, z)) water = true;
      }
      if (!water) best = { ...segment, ...nearest, tangent, normal, ends, gap };
    }
    if (!best) { unavailableIds.push(model.id); continue; }
    const base = Math.max(0, Number(heightAt(model.x, model.z)) || 0) + .065;
    const framePoints = footprint.flatMap(([x, z]) => [[x, base, z], [x, base + model.localSize.y, z]]);
    const streetPoints = [];
    for (const endpoint of best.ends) for (const side of [-1, 0, 1]) {
      // A framing margin includes nearby ground without creating a pavement
      // surface or claiming that an unmodelled sidewalk exists.
      const offset = (best.width / 2 + 2 * units) * side;
      const x = endpoint[0] + best.normal[0] * offset, z = endpoint[1] + best.normal[1] * offset;
      if (!inWater(x, z)) streetPoints.push([x, Math.max(0, Number(heightAt(x, z)) || 0) + .13, z]);
    }
    framePoints.push(...streetPoints);
    const min = [0, 1, 2].map(axis => Math.min(...framePoints.map(p => p[axis]))), max = [0, 1, 2].map(axis => Math.max(...framePoints.map(p => p[axis])));
    const outward = [(best.roadPoint[0] - best.modelPoint[0]) / best.distance, (best.roadPoint[1] - best.modelPoint[1]) / best.distance];
    const direction = [outward[0] + best.tangent[0] * .24, .72, outward[1] + best.tangent[1] * .24];
    const norm = Math.hypot(...direction);
    views.push({ id: model.id, center: min.map((value, axis) => (value + max[axis]) / 2), span: Math.hypot(...min.map((value, axis) => max[axis] - value)),
      direction: direction.map(value => value / norm), framePoints, streetPoints,
      roadName: best.roadName, highway: best.highway, gapMeters: best.gap / units,
      sourceRoadIndex: best.sourceRoadIndex, sourceSegmentIndex: best.sourceSegmentIndex, osmId: best.osmId,
      sourceEndpoints: [best.a.slice(), best.b.slice()], observedEndpoints: best.ends,
      policy: 'elevated-camera-observation; source-road-segment; no-new-paving; no-pedestrian-connectivity-claim' });
  }
  return { views, stats: { availableIds: views.map(view => view.id), unavailableIds, sourceSegments: segments.length } };
}
