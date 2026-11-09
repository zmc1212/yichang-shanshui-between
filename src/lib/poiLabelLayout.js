/**
 * Priority-aware screen labels. Geographic/model coordinates are read only.
 * Every eligible POI is represented once, as a name, compact point or named
 * business group. Landmarks and active search/selection never enter a group.
 */
export const POI_CLUSTER_DIMENSIONS = Object.freeze({
  desktop: Object.freeze({ width: 156, height: 40 }),
  compact: Object.freeze({ width: 168, height: 44 }),
});

const ANCHOR_GAP = 8;
const MAX_GROUP_METRES = 1400;
const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const squaredDistance = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
const intersects = (a, b, gap = 0) => a.left < b.right + gap && a.right + gap > b.left
  && a.top < b.bottom + gap && a.bottom + gap > b.top;
const overlapArea = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
const rankPoints = (a, b) => Number(b.selected) - Number(a.selected)
  || Number(b.protected) - Number(a.protected) || Number(b.isLandmark) - Number(a.isLandmark)
  || b.priority - a.priority || compareId(a.id, b.id);

function groupOf(points) {
  const sorted = [...points].sort((a, b) => compareId(a.id, b.id));
  const representative = [...sorted].sort(rankPoints)[0];
  const memberIds = sorted.map(point => point.id);
  return {
    points: sorted, memberIds, representative,
    key: memberIds.length === 1 ? 'poi:' + memberIds[0] : 'cluster:' + memberIds.map(encodeURIComponent).join('|'),
    x: sorted.reduce((sum, point) => sum + point.x, 0) / sorted.length,
    y: sorted.reduce((sum, point) => sum + point.y, 0) / sorted.length,
  };
}

function naturalRect(point) {
  return rect(point.x - point.width / 2, point.y - point.height - ANCHOR_GAP, point.width, point.height);
}

function geographicallyNear(a, b) {
  if (![a.lon, a.lat, b.lon, b.lat].every(Number.isFinite)) return true;
  // The registry's existing positions constrain a display grouping, not a
  // claim about surveyed centres, districts, or site boundaries.
  const radians = Math.PI / 180;
  const east = (a.lon - b.lon) * Math.cos((a.lat + b.lat) * radians / 2);
  const north = a.lat - b.lat;
  return Math.hypot(east, north) * 111320 <= MAX_GROUP_METRES;
}

function canGroup(a, b, compact, retained = false) {
  const radius = (compact ? 60 : 46) + (retained ? 12 : 0);
  const maxDiameter = (compact ? 150 : 138) + (retained ? 16 : 0);
  let touches = false;
  for (const pa of a.points) for (const pb of b.points) {
    const distance = squaredDistance(pa, pb);
    if (distance > maxDiameter ** 2 || !geographicallyNear(pa, pb)) return false;
    if (distance <= radius ** 2 || intersects(naturalRect(pa), naturalRect(pb), retained ? 12 : 3)) touches = true;
  }
  return touches;
}

function clusterNearby(points, compact, previousMarkers) {
  const byId = new Map(points.map(point => [point.id, point]));
  const consumed = new Set();
  let groups = [];
  // Small changes retain the previous membership until a slightly wider split
  // boundary is crossed. Selection/search extraction happens before this.
  for (const previous of [...previousMarkers].sort((a, b) => compareId(a.key, b.key))) {
    if (previous.memberIds?.length < 2) continue;
    const retained = [...new Set(previous.memberIds)].map(id => byId.get(id)).filter(point => point && !consumed.has(point.id));
    if (retained.length < 2) continue;
    let group = groupOf([retained[0]]);
    let valid = true;
    for (const point of retained.slice(1)) {
      const single = groupOf([point]);
      if (!canGroup(group, single, compact, true)) { valid = false; break; }
      group = groupOf([...group.points, point]);
    }
    if (!valid) continue;
    groups.push(group);
    for (const point of retained) consumed.add(point.id);
  }
  groups.push(...points.filter(point => !consumed.has(point.id)).map(point => groupOf([point])));
  groups.sort((a, b) => compareId(a.key, b.key));
  while (groups.length > 1) {
    let best = null;
    for (let i = 0; i < groups.length - 1; i++) for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i], b = groups[j];
      if (!canGroup(a, b, compact)) continue;
      const score = squaredDistance(a, b);
      const key = a.key + '\n' + b.key;
      if (!best || score < best.score || (score === best.score && compareId(key, best.key) < 0)) best = { i, j, score, key };
    }
    if (!best) break;
    const merged = groupOf([...groups[best.i].points, ...groups[best.j].points]);
    groups = groups.filter((_, index) => index !== best.i && index !== best.j);
    groups.push(merged);
    groups.sort((a, b) => compareId(a.key, b.key));
  }
  return groups;
}

function normalizedObstacles(obstacles, width, height) {
  return (obstacles || []).filter(item => item && [item.left, item.top, item.right, item.bottom].every(Number.isFinite))
    .map(item => ({
      left: clamp(item.left, 0, width), top: clamp(item.top, 0, height),
      right: clamp(item.right, 0, width), bottom: clamp(item.bottom, 0, height),
    })).filter(item => item.right > item.left && item.bottom > item.top);
}

function markerSize(group, viewport, kind) {
  const defaults = POI_CLUSTER_DIMENSIONS[viewport.compact ? 'compact' : 'desktop'];
  const point = group.representative;
  const dot = viewport.compact ? 36 : 28;
  const intended = kind === 'dot' ? { width: dot, height: dot }
    : kind === 'cluster' ? { width: point.clusterWidth || defaults.width, height: point.clusterHeight || defaults.height }
      : point;
  return {
    width: Math.min(intended.width, viewport.width - viewport.padding * 2),
    height: Math.min(intended.height, viewport.height - viewport.padding * 2),
  };
}

function findPlacement(group, size, blocked, viewport, kind, previous, maxShift, allowOverlap = false) {
  const minX = viewport.padding, maxX = viewport.width - viewport.padding - size.width;
  const minY = viewport.padding, maxY = viewport.height - viewport.padding - size.height;
  const wantedX = group.x - size.width / 2;
  const wantedY = kind === 'dot' ? group.y - size.height / 2 : group.y - size.height - ANCHOR_GAP;
  // A slightly larger clear margin is needed to promote a compact point back
  // into a name. This prevents name/icon flicker at a collision boundary.
  const gap = viewport.gap + (previous?.kind === 'dot' && kind === 'label' ? 4 : 0);
  const valid = candidate => !blocked.some(obstacle => intersects(candidate, obstacle, gap - 0.01));
  const inRange = candidate => (candidate.left - wantedX) ** 2 + (candidate.top - wantedY) ** 2 <= maxShift ** 2 + 0.01;
  if (!allowOverlap && previous?.kind === kind && Math.abs(previous.width - size.width) < 1 && Math.abs(previous.height - size.height) < 1) {
    const prior = rect(previous.left + group.x - previous.anchorX, previous.top + group.y - previous.anchorY, size.width, size.height);
    if (prior.left >= minX && prior.top >= minY && prior.right <= viewport.width - viewport.padding
      && prior.bottom <= viewport.height - viewport.padding && inRange(prior) && valid(prior)) return prior;
  }
  const xs = [clamp(wantedX, minX, maxX), clamp(group.x + ANCHOR_GAP, minX, maxX), clamp(group.x - size.width - ANCHOR_GAP, minX, maxX), minX, maxX];
  const ys = [clamp(wantedY, minY, maxY), clamp(group.y + ANCHOR_GAP, minY, maxY), clamp(group.y - size.height / 2, minY, maxY), minY, maxY];
  for (const obstacle of blocked) {
    xs.push(clamp(obstacle.left - size.width - gap, minX, maxX), clamp(obstacle.right + gap, minX, maxX));
    ys.push(clamp(obstacle.top - size.height - gap, minY, maxY), clamp(obstacle.bottom + gap, minY, maxY));
  }
  let best = null;
  for (const top of new Set(ys)) for (const left of new Set(xs)) {
    const candidate = rect(left, top, size.width, size.height);
    const distance = (left - wantedX) ** 2 + (top - wantedY) ** 2;
    if (!inRange(candidate) || (!allowOverlap && best && distance >= best.score)) continue;
    const collisions = blocked.filter(obstacle => intersects(candidate, obstacle, gap - 0.01));
    if (collisions.length && !allowOverlap) continue;
    const score = allowOverlap
      ? collisions.reduce((sum, obstacle) => sum + overlapArea(candidate, obstacle), 0) * (viewport.width ** 2 + viewport.height ** 2 + 1) + distance
      : distance;
    if (!best || score < best.score || (score === best.score && (top < best.top || (top === best.top && left < best.left)))) best = { ...candidate, score };
  }
  return best;
}

function makeMarker(group, placement, kind) {
  const point = group.representative;
  return {
    key: group.key, memberIds: group.memberIds, representativeId: point.id, kind,
    anchorX: group.x, anchorY: group.y,
    left: placement.left, top: placement.top, width: placement.width, height: placement.height,
    selected: group.points.length === 1 && point.selected,
    protected: group.points.length === 1 && point.protected,
  };
}

/**
 * Optional point metadata: priority, isLandmark, protected, lon/lat and the
 * measured clusterWidth/clusterHeight for a group named after that point.
 * previousMarkers may contain the preceding result to stabilize placement.
 * No temporal/global state is retained, and the input arrays are not mutated.
 */
export function layoutPoiLabels(points, {
  width, height, selectedId = null, compact = false, obstacles = [], previousMarkers = [],
} = {}) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { markers: [], representedIds: [], constrained: false };
  const viewport = { width, height, compact, padding: Math.min(10, width / 10, height / 10), gap: compact ? 6 : 6 };
  const unique = new Map();
  const eligible = (points || []).filter(point => point && typeof point.id === 'string' && point.id.length && point.visible !== false
    && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height)
    .map(point => ({
      id: point.id, x: point.x, y: point.y,
      width: positive(point.width, 96), height: positive(point.height, compact ? 44 : 32),
      clusterWidth: positive(point.clusterWidth, 0), clusterHeight: positive(point.clusterHeight, 0),
      priority: Number.isFinite(point.priority) ? point.priority : 0,
      selected: point.id === selectedId, protected: point.id === selectedId || Boolean(point.protected),
      isLandmark: Boolean(point.isLandmark), lon: point.lon, lat: point.lat,
    })).sort((a, b) => compareId(a.id, b.id) || rankPoints(a, b) || a.x - b.x || a.y - b.y || a.width - b.width || a.height - b.height);
  for (const point of eligible) if (!unique.has(point.id)) unique.set(point.id, point);
  const accepted = [...unique.values()];
  if (!accepted.length) return { markers: [], representedIds: [], constrained: false };
  const previous = Array.isArray(previousMarkers) ? previousMarkers.filter(marker => marker && typeof marker.key === 'string' && Array.isArray(marker.memberIds)) : [];
  const previousByKey = new Map(previous.map(marker => [marker.key, marker]));
  const independent = accepted.filter(point => point.isLandmark || point.protected);
  const business = accepted.filter(point => !point.isLandmark && !point.protected);
  const ordinaryLandmarks = independent.filter(point => point.isLandmark && !point.protected);
  const hadCompactLandmarks = previous.some(marker => marker.kind === 'dot'
    && marker.memberIds.some(id => unique.get(id)?.isLandmark));
  const crowdedRadius = hadCompactLandmarks ? 128 : 112;
  const crowdedLandmarks = ordinaryLandmarks.filter(point => ordinaryLandmarks.some(other => other !== point
    && squaredDistance(point, other) < crowdedRadius ** 2)).length;
  // Reserve room for named business groups in a phone overview. Zooming in
  // removes off-screen landmarks or separates them, naturally lifting this
  // budget. Selected/search targets are never counted against it.
  const landmarkNameBudget = compact && ordinaryLandmarks.length > 4 && crowdedLandmarks >= 4 ? 4 : Infinity;
  let landmarkNames = 0;
  const groups = [...independent.map(point => groupOf([point])), ...clusterNearby(business, compact, previous)]
    .sort((a, b) => rankPoints(a.representative, b.representative) || compareId(a.key, b.key));
  const blocked = normalizedObstacles(obstacles, width, height);
  const markers = [];
  const localShift = compact ? 78 : 106;
  const fullShift = Math.hypot(width, height) + 200;
  let constrained = false;
  const commit = (group, placement, kind) => {
    const marker = makeMarker(group, placement, kind);
    markers.push(marker);
    blocked.push(rect(marker.left, marker.top, marker.width, marker.height));
  };
  const placeSingle = (group, forceDot = false) => {
    const prior = previousByKey.get(group.key), point = group.representative;
    let kind = forceDot ? 'dot' : 'label';
    let size = markerSize(group, viewport, kind);
    let placement = findPlacement(group, size, blocked, viewport, kind, prior, point.protected ? fullShift : localShift);
    if (!placement && !point.protected) {
      kind = 'dot'; size = markerSize(group, viewport, kind);
      placement = findPlacement(group, size, blocked, viewport, kind, prior, localShift);
      if (!placement) placement = findPlacement(group, size, blocked, viewport, kind, prior, compact ? 150 : 190);
    }
    // Only a physically crowded/unavailable local area uses a wider icon
    // displacement. A leader keeps it tied to its unchanged screen anchor.
    if (!placement) placement = findPlacement(group, size, blocked, viewport, kind, prior, fullShift);
    if (!placement) {
      constrained = true;
      placement = findPlacement(group, size, blocked, viewport, kind, prior, fullShift, true);
    }
    commit(group, placement, kind);
  };
  for (const group of groups) {
    if (group.points.length === 1) {
      const ordinaryLandmark = group.representative.isLandmark && !group.representative.protected;
      placeSingle(group, ordinaryLandmark && landmarkNames >= landmarkNameBudget);
      if (ordinaryLandmark && markers.at(-1).kind === 'label') landmarkNames++;
      continue;
    }
    const size = markerSize(group, viewport, 'cluster');
    const placement = findPlacement(group, size, blocked, viewport, 'cluster', previousByKey.get(group.key), localShift);
    if (placement) { commit(group, placement, 'cluster'); continue; }
    // Never solve crowding by merging distant sites or swallowing landmarks.
    // If a long group name cannot fit near its anchor, preserve access as
    // separate compact points rather than an anonymous, city-wide bucket.
    for (const point of [...group.points].sort(rankPoints)) placeSingle(groupOf([point]), true);
  }
  return { markers, representedIds: markers.flatMap(marker => marker.memberIds).sort(compareId), constrained };
}
