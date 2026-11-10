// Names and centre lines come exclusively from the retained OSM road data.
// This is a label plan: grouping equal names never joins or edits road geometry.
const HIGHWAY_PRIORITY = Object.freeze({ primary: 44, trunk: 42, motorway: 40, secondary: 30 });
const EPSILON = 1e-8;
const finitePoint = point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function makePath(road, index) {
  const points = [];
  for (const point of road.points || []) {
    if (!finitePoint(point)) continue;
    if (!points.length || distance(points.at(-1), point) > EPSILON) points.push([...point]);
  }
  if (points.length < 2) return null;
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative.at(-1) + distance(points[i - 1], points[i]));
  if (cumulative.at(-1) < .4) return null;
  const width = Number(road.width);
  return {
    id: `${road.osmId || 'source-road'}:${index}`, sourceId: road.osmId || null,
    points, cumulative, length: cumulative.at(-1),
    width: Number.isFinite(width) && width > 0 ? width : .18,
  };
}

function sample(path, at) {
  const wanted = clamp(at, 0, path.length);
  let lo = 1, hi = path.cumulative.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (path.cumulative[mid] < wanted) lo = mid + 1; else hi = mid; }
  const i = lo, start = path.cumulative[i - 1];
  return mix(path.points[i - 1], path.points[i], (wanted - start) / (path.cumulative[i] - start));
}

function nearestPoint(path, point) {
  let result = { distance: Infinity, at: 0 };
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1], b = path.points[i], dx = b[0] - a[0], dz = b[1] - a[1];
    const t = clamp(((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / (dx * dx + dz * dz), 0, 1);
    const separation = distance(mix(a, b, t), point);
    if (separation < result.distance) result = { distance: separation, at: path.cumulative[i - 1] + t * (path.cumulative[i] - path.cumulative[i - 1]) };
  }
  return result;
}

function labelWindow(path, at, desiredSpan) {
  let span = Math.min(path.length, desiredSpan);
  for (let attempt = 0; attempt < 5 && span >= .35; attempt++, span *= .65) {
    const centerAt = clamp(at, span / 2, path.length - span / 2);
    const start = sample(path, centerAt - span / 2), end = sample(path, centerAt + span / 2), center = sample(path, centerAt);
    const chord = distance(start, end);
    // A label must describe a locally legible part of the road, not a chord
    // spanning an acute bend or a hairpin. All accepted points stay on source.
    if (chord / span < .95 || distance(center, mix(start, end, .5)) > chord * .1) continue;
    return { center, start, end, span };
  }
  return null;
}

/** At most eight fixed candidates per name, plus one view-local candidate.
 * The retained path table permits the local candidate to follow the actual
 * named road when a close-up no longer contains its city-wide midpoint.
 */
export function buildRoadLabelAnchors(roads, { maxNames = 128, maxAnchorsPerRoad = 8 } = {}) {
  const grouped = new Map();
  for (let index = 0; index < (roads || []).length; index++) {
    const source = roads[index], highway = String(source?.highway || source?.kind || '');
    const name = typeof source?.name === 'string' ? source.name.trim() : '';
    if (!name || name.length > 36 || !HIGHWAY_PRIORITY[highway]) continue;
    const path = makePath(source, index);
    if (!path) continue;
    if (!grouped.has(name)) grouped.set(name, { id: `road:${name}`, name, highway, priority: HIGHWAY_PRIORITY[highway], paths: [] });
    const road = grouped.get(name);
    if (HIGHWAY_PRIORITY[highway] > road.priority) { road.highway = highway; road.priority = HIGHWAY_PRIORITY[highway]; }
    road.paths.push(path);
  }
  const plan = [...grouped.values()].map(road => {
    road.paths.sort((a, b) => b.length - a.length || a.id.localeCompare(b.id));
    road.priority += Math.min(10, Math.log2(1 + road.paths[0].length));
    // An OSM primary-class frontage/slip road should not consume the few
    // orientation labels before the named city corridor beside it.
    if (/(辅路|跨线桥|高架桥)$/.test(road.name)) road.priority -= 12;
    const options = [];
    road.paths.forEach((path, pathIndex) => {
      for (const fraction of [.5, .2, .8]) {
        const at = path.length * fraction;
        options.push({ id: `${path.id}@${fraction}`, pathIndex, at, point: sample(path, at), quality: path.length });
      }
    });
    const anchors = [];
    while (options.length && anchors.length < maxAnchorsPerRoad) {
      options.sort((a, b) => {
        const score = option => anchors.length ? Math.min(...anchors.map(item => distance(option.point, item.point))) + Math.min(12, option.quality * .08) : option.quality;
        return score(b) - score(a) || a.id.localeCompare(b.id);
      });
      const candidate = options.shift();
      // Parallel carriageways need one name, not almost-coincident copies.
      if (anchors.some(anchor => distance(anchor.point, candidate.point) < 3)) continue;
      anchors.push(candidate);
    }
    return { ...road, anchors };
  }).sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name)).slice(0, maxNames);
  return {
    roads: plan,
    stats: {
      roadLabelNames: plan.length,
      roadLabelSourcePaths: plan.reduce((sum, road) => sum + road.paths.length, 0),
      roadLabelFixedAnchors: plan.reduce((sum, road) => sum + road.anchors.length, 0),
      roadLabelMaxCandidates: plan.reduce((sum, road) => sum + road.anchors.length + 1, 0),
    },
  };
}

/**
 * project([x,z]) => {x,y,depth,visible}; it should project the terrain/road
 * surface, using the scene's existing camera. No camera or geometry is owned.
 * focusPoint is the existing controls target [x,z], never a changed map anchor.
 */
export function projectRoadLabelAnchors(plan, { project, pixelsPerUnit, focusPoint } = {}) {
  if (typeof project !== 'function' || !Number.isFinite(pixelsPerUnit) || !(pixelsPerUnit > 0)) return [];
  const labels = [];
  for (const road of plan?.roads || []) {
    const candidates = [...road.anchors];
    if (finitePoint(focusPoint)) {
      let nearest = null;
      road.paths.forEach((path, pathIndex) => {
        const candidate = nearestPoint(path, focusPoint);
        if (!nearest || candidate.distance < nearest.distance) nearest = { ...candidate, pathIndex };
      });
      if (nearest) candidates.unshift({ id: `${road.id}:focus:${road.paths[nearest.pathIndex].id}`, ...nearest });
    }
    // Use world support proportional to a constant screen font. A nearby
    // building view gets a local road segment; a panorama needs a longer run.
    const span = clamp((Array.from(road.name).length * 12 + 38) / pixelsPerUnit * 1.8, .6, 84);
    for (const candidate of candidates) {
      const path = road.paths[candidate.pathIndex], roadPixels = path.width * pixelsPerUnit;
      if (roadPixels < .12 || roadPixels > 28) continue;
      const window = labelWindow(path, candidate.at, span);
      if (!window) continue;
      const center = project(window.center);
      if (!center || center.visible === false || !Number.isFinite(center.x) || !Number.isFinite(center.y)
        || (center.depth != null && (!Number.isFinite(center.depth) || center.depth < -1 || center.depth > 1))) continue;
      const start = project(window.start), end = project(window.end);
      if (![start?.x, start?.y, end?.x, end?.y].every(Number.isFinite)) continue;
      const spanPx = Math.hypot(end.x - start.x, end.y - start.y);
      if (spanPx < 22) continue;
      labels.push({
        id: `${road.id}|${candidate.id}`, roadId: road.id, name: road.name, highway: road.highway,
        x: center.x, y: center.y, angle: Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI,
        spanPx, roadPixels, priority: road.priority, sourceId: path.sourceId,
        world: [...window.center], visible: true,
      });
    }
  }
  return labels;
}
