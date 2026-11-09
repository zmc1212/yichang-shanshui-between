/**
 * Screen-space label clustering. This module never changes a POI's world or
 * geographic coordinates. Every eligible screen point remains represented by
 * exactly one solo label or a cluster whose memberIds can be opened as a list.
 */
export const POI_CLUSTER_DIMENSIONS = Object.freeze({
  desktop: Object.freeze({ width: 96, height: 40 }),
  compact: Object.freeze({ width: 104, height: 44 }),
});

const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const ANCHOR_GAP = 8;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const squaredDistance = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const intersects = (a, b, gap = 0) => a.left < b.right + gap && a.right + gap > b.left
  && a.top < b.bottom + gap && a.bottom + gap > b.top;
const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
const overlapArea = (a, b, gap = 0) => Math.max(0, Math.min(a.right + gap, b.right + gap) - Math.max(a.left - gap, b.left - gap))
  * Math.max(0, Math.min(a.bottom + gap, b.bottom + gap) - Math.max(a.top - gap, b.top - gap));

function groupOf(points) {
  const sorted = [...points].sort((a, b) => compareId(a.id, b.id));
  const memberIds = sorted.map(point => point.id);
  return {
    points: sorted,
    memberIds,
    key: memberIds.length === 1 ? `poi:${memberIds[0]}` : `cluster:${memberIds.map(encodeURIComponent).join('|')}`,
    x: sorted.reduce((sum, point) => sum + point.x, 0) / sorted.length,
    y: sorted.reduce((sum, point) => sum + point.y, 0) / sorted.length,
  };
}

function naturalRect(point) {
  return rect(point.x - point.width / 2, point.y - point.height - ANCHOR_GAP, point.width, point.height);
}

function clusterNearby(points, compact) {
  const radius = compact ? 62 : 50;
  const maxDiameter = compact ? 166 : 148;
  let groups = points.map(point => groupOf([point]));
  // A complete-link diameter limit prevents an arbitrarily long chain of near
  // neighbours from turning a whole street into one cluster at a close view.
  while (groups.length > 1) {
    let best = null;
    for (let i = 0; i < groups.length - 1; i++) for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i], b = groups[j];
      let touches = false, tooWide = false;
      for (const pa of a.points) for (const pb of b.points) {
        const distance = squaredDistance(pa, pb);
        if (distance > maxDiameter ** 2) tooWide = true;
        if (distance <= radius ** 2 || intersects(naturalRect(pa), naturalRect(pb), 5)) touches = true;
      }
      if (!touches || tooWide) continue;
      const score = squaredDistance(a, b);
      const key = `${a.key}\n${b.key}`;
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

function markerSize(group, viewport) {
  const intended = group.points.length === 1 ? group.points[0]
    : POI_CLUSTER_DIMENSIONS[viewport.compact ? 'compact' : 'desktop'];
  return {
    width: Math.min(intended.width, viewport.width - viewport.padding * 2),
    height: Math.min(intended.height, viewport.height - viewport.padding * 2),
  };
}

function placementCandidates(group, size, blocked, viewport) {
  const minX = viewport.padding, maxX = viewport.width - viewport.padding - size.width;
  const minY = viewport.padding, maxY = viewport.height - viewport.padding - size.height;
  // Leave a visible dot/leader between the real screen anchor and the capsule,
  // even when the capsule does not need collision displacement.
  const wantedX = group.x - size.width / 2, wantedY = group.y - size.height - ANCHOR_GAP;
  const xs = [clamp(wantedX, minX, maxX), minX, maxX];
  const ys = [clamp(wantedY, minY, maxY), minY, maxY];
  // Rectangle edges plus the natural anchor span every available axis-aligned
  // slot. This avoids an arbitrary lift limit or an expensive per-pixel grid.
  for (const obstacle of blocked) {
    xs.push(clamp(obstacle.left - size.width - viewport.gap, minX, maxX), clamp(obstacle.right + viewport.gap, minX, maxX));
    ys.push(clamp(obstacle.top - size.height - viewport.gap, minY, maxY), clamp(obstacle.bottom + viewport.gap, minY, maxY));
  }
  return { xs: [...new Set(xs)], ys: [...new Set(ys)], wantedX, wantedY };
}

function findPlacement(group, size, blocked, viewport, allowOverlap = false) {
  const { xs, ys, wantedX, wantedY } = placementCandidates(group, size, blocked, viewport);
  let best = null;
  for (const top of ys) for (const left of xs) {
    const candidate = rect(left, top, size.width, size.height);
    const distance = (left - wantedX) ** 2 + (top - wantedY) ** 2;
    if (!allowOverlap && best && distance > best.score) continue;
    const collisions = blocked.filter(item => intersects(candidate, item, viewport.gap - 0.01));
    if (collisions.length && !allowOverlap) continue;
    // Only used when even a selected label plus one aggregate physically
    // cannot fit. Keep access to every member and report constrained=true.
    const score = allowOverlap
      ? collisions.reduce((sum, item) => sum + overlapArea(candidate, item, viewport.gap), 0) * (viewport.width ** 2 + viewport.height ** 2 + 1) + distance
      : distance;
    if (!best || score < best.score || (score === best.score && (top < best.top || (top === best.top && left < best.left)))) best = { ...candidate, score };
  }
  return best;
}

function makeMarker(group, placement, selectedId) {
  return {
    key: group.key,
    memberIds: group.memberIds,
    anchorX: group.x,
    anchorY: group.y,
    left: placement.left,
    top: placement.top,
    width: placement.width,
    height: placement.height,
    selected: group.memberIds.length === 1 && group.memberIds[0] === selectedId,
  };
}

/**
 * @param {Array<{id:string,x:number,y:number,visible?:boolean,width?:number,height?:number}>} points
 * @param {{width:number,height:number,selectedId?:string,compact?:boolean,obstacles?:Array<{left:number,top:number,right:number,bottom:number}>}} options
 * @returns {{markers:Array<{key:string,memberIds:string[],anchorX:number,anchorY:number,left:number,top:number,width:number,height:number,selected:boolean}>,representedIds:string[],constrained:boolean}}
 */
export function layoutPoiLabels(points, { width, height, selectedId = null, compact = false, obstacles = [] } = {}) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { markers: [], representedIds: [], constrained: false };
  const viewport = { width, height, compact, padding: Math.min(10, width / 10, height / 10), gap: compact ? 8 : 7 };
  const defaults = POI_CLUSTER_DIMENSIONS[compact ? 'compact' : 'desktop'];
  const unique = new Map();
  const eligible = (points || []).filter(point => point && typeof point.id === 'string' && point.id.length && point.visible !== false
    && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height)
    .map(point => ({
      id: point.id, x: point.x, y: point.y,
      width: Number.isFinite(point.width) && point.width > 0 ? point.width : defaults.width,
      height: Number.isFinite(point.height) && point.height > 0 ? point.height : defaults.height,
    })).sort((a, b) => compareId(a.id, b.id) || a.x - b.x || a.y - b.y || a.width - b.width || a.height - b.height);
  for (const point of eligible) if (!unique.has(point.id)) unique.set(point.id, point);
  const accepted = [...unique.values()];
  if (!accepted.length) return { markers: [], representedIds: [], constrained: false };
  const selectedPoint = unique.get(selectedId);
  const selectedGroup = selectedPoint ? groupOf([selectedPoint]) : null;
  let groups = clusterNearby(accepted.filter(point => point.id !== selectedId), compact);
  const fixed = normalizedObstacles(obstacles, width, height);
  let constrained = false;
  let selectedMarker = null;
  if (selectedGroup) {
    const size = markerSize(selectedGroup, viewport);
    let placement = findPlacement(selectedGroup, size, fixed, viewport);
    if (!placement) { constrained = true; placement = findPlacement(selectedGroup, size, fixed, viewport, true); }
    selectedMarker = makeMarker(selectedGroup, placement, selectedId);
  }
  let markers = [];
  // Each retry reduces the unselected group count; there are at most N-1.
  for (let retry = 0; retry <= accepted.length; retry++) {
    const blocked = [...fixed];
    markers = [];
    if (selectedMarker) {
      markers.push(selectedMarker);
      blocked.push(rect(selectedMarker.left, selectedMarker.top, selectedMarker.width, selectedMarker.height));
    }
    const ordered = [...groups].sort((a, b) => b.points.length - a.points.length || a.y - b.y || a.x - b.x || compareId(a.key, b.key));
    let failed = null;
    for (const group of ordered) {
      const size = markerSize(group, viewport);
      let placement = findPlacement(group, size, blocked, viewport);
      if (!placement) {
        if (groups.length > 1) { failed = group; break; }
        constrained = true;
        placement = findPlacement(group, size, blocked, viewport, true);
      }
      const marker = makeMarker(group, placement, selectedId);
      markers.push(marker);
      blocked.push(rect(marker.left, marker.top, marker.width, marker.height));
    }
    if (!failed) break;
    const other = groups.filter(group => group !== failed).sort((a, b) => squaredDistance(failed, a) - squaredDistance(failed, b) || compareId(a.key, b.key))[0];
    groups = groups.filter(group => group !== failed && group !== other);
    groups.push(groupOf([...failed.points, ...other.points]));
  }
  return { markers, representedIds: markers.flatMap(marker => marker.memberIds).sort(compareId), constrained };
}
