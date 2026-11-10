// Conservative surface ownership for the one oblique street-corner sample.
// Input polygons have already passed the planner's full obstacle checks. All
// returned pieces are subsets of those inputs; this never creates new access.
const DISTANCE_EPSILON = 1e-10;
const AREA_EPSILON = 1e-14;
const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const area = ring => {
  let value = 0;
  for (let i = 1; i < ring.length - 1; i++) value += cross(ring[0], ring[i], ring[i + 1]);
  return value / 2;
};
const bounds = ring => ({ minX: Math.min(...ring.map(p => p[0])), maxX: Math.max(...ring.map(p => p[0])), minZ: Math.min(...ring.map(p => p[1])), maxZ: Math.max(...ring.map(p => p[1])) });
const boxesOverlap = (a, b) => a.minX <= b.maxX + DISTANCE_EPSILON && b.minX <= a.maxX + DISTANCE_EPSILON && a.minZ <= b.maxZ + DISTANCE_EPSILON && b.minZ <= a.maxZ + DISTANCE_EPSILON;

function cleanRing(input) {
  if (!Array.isArray(input) || input.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) throw new TypeError('Street paving needs finite XZ polygons');
  let ring = [];
  for (const p of input) if (!ring.length || distance(p, ring.at(-1)) > DISTANCE_EPSILON) ring.push([...p]);
  if (ring.length > 1 && distance(ring[0], ring.at(-1)) <= DISTANCE_EPSILON) ring.pop();
  let changed = true;
  while (changed && ring.length >= 3) {
    changed = false;
    ring = ring.filter((p, i, all) => {
      const a = all[(i + all.length - 1) % all.length], b = all[(i + 1) % all.length], span = distance(a, b);
      const between = (p[0] - a[0]) * (p[0] - b[0]) + (p[1] - a[1]) * (p[1] - b[1]) <= DISTANCE_EPSILON ** 2;
      if (span > DISTANCE_EPSILON && between && Math.abs(cross(a, b, p)) <= DISTANCE_EPSILON * span) { changed = true; return false; }
      return true;
    });
  }
  if (ring.length < 3 || Math.abs(area(ring)) <= AREA_EPSILON) return [];
  if (area(ring) < 0) ring.reverse();
  return ring;
}

function halfPlane(subject, a, b, keepInside) {
  const span = distance(a, b), sign = keepInside ? 1 : -1, output = [];
  const side = p => { const v = sign * cross(a, b, p) / span; return Math.abs(v) <= DISTANCE_EPSILON ? 0 : v; };
  for (let i = 0; i < subject.length; i++) {
    const p = subject[i], q = subject[(i + 1) % subject.length], dp = side(p), dq = side(q);
    if (dp >= 0) output.push([...p]);
    if ((dp >= 0) !== (dq >= 0)) {
      const t = dp / (dp - dq);
      output.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return cleanRing(output);
}

function subtract(subject, clip) {
  if (!boxesOverlap(bounds(subject), bounds(clip))) return [subject];
  let intersection = subject;
  for (let i = 0; i < clip.length && intersection.length; i++) intersection = halfPlane(intersection, clip[i], clip[(i + 1) % clip.length], true);
  if (!intersection.length) return [subject];
  const pieces = [];
  let remainder = subject;
  // A point belongs to the first clip edge it fails. This partitions a convex
  // difference without double ownership, including an entirely internal hole.
  for (let i = 0; i < clip.length && remainder.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const outside = halfPlane(remainder, a, b, false);
    if (outside.length) pieces.push(outside);
    remainder = halfPlane(remainder, a, b, true);
  }
  return pieces;
}

function sharedEdgeLength(a, b) {
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    const p = a[i], q = a[(i + 1) % a.length], span = distance(p, q), dx = (q[0] - p[0]) / span, dz = (q[1] - p[1]) / span;
    for (let j = 0; j < b.length; j++) {
      const r = b[j], s = b[(j + 1) % b.length];
      if (Math.abs(cross(p, q, r)) / span > DISTANCE_EPSILON || Math.abs(cross(p, q, s)) / span > DISTANCE_EPSILON) continue;
      const u = (r[0] - p[0]) * dx + (r[1] - p[1]) * dz, v = (s[0] - p[0]) * dx + (s[1] - p[1]) * dz;
      result += Math.max(0, Math.min(span, Math.max(u, v)) - Math.max(0, Math.min(u, v)));
    }
  }
  return result;
}

// A clipping vertex on a neighbour's edge must be used by both surfaces.
// Otherwise sampling a non-linear ground function at that T-junction would
// disagree with the neighbour's long triangle edge and make a vertical seam.
function conformBoundaries(cells) {
  const vertices = [];
  for (const cell of cells) for (const p of cell.points) if (!vertices.some(q => distance(p, q) <= DISTANCE_EPSILON)) vertices.push(p);
  return cells.map(cell => {
    const ring = [];
    for (let i = 0; i < cell.points.length; i++) {
      const a = cell.points[i], b = cell.points[(i + 1) % cell.points.length], span = distance(a, b), spanSquared = span ** 2;
      const onEdge = vertices.filter(p => Math.abs(cross(a, b, p)) / span <= DISTANCE_EPSILON)
        .map(p => ({ p, t: ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / spanSquared }))
        .filter(({ t }) => t >= -DISTANCE_EPSILON / span && t < 1 - DISTANCE_EPSILON / span)
        .sort((p, q) => p.t - q.t);
      for (const { p } of onEdge) if (!ring.length || distance(p, ring.at(-1)) > DISTANCE_EPSILON) ring.push([...p]);
    }
    return { ...cell, points: ring, conforming: true };
  });
}

/** Partition overlapping, already-safe convex paving cells. `zone` records
 * their functional source independently of the accent material `role`.
 * Connection > sidewalk > forecourt, then original order, owns each overlap.
 * `connectedToZone` optionally keeps only components sharing a positive-width
 * edge with that zone, excluding isolated paving beyond a side-road gap.
 *
 * Returned cells preserve all source metadata/surface functions and include
 * sourcePavingIndex. Their collinear boundary nodes are intentional: render a
 * centre-to-each-edge fan for conforming cells, not an ordinary vertex fan.
 * Other existing sites should continue using their unchanged source cells. */
export function partitionStreetPaving(cells, { connectedToZone = null } = {}) {
  const priorities = { connection: 3, sidewalk: 2, forecourt: 1 };
  const input = cells.map((cell, index) => {
    const points = cleanRing(cell.points);
    if (points.length && !points.every((p, i) => cross(p, points[(i + 1) % points.length], points[(i + 2) % points.length]) >= -AREA_EPSILON)) throw new TypeError('Street paving ownership requires convex source cells');
    return { ...cell, points, sourcePavingIndex: index };
  }).filter(cell => cell.points.length >= 3);
  const ordered = [...input].sort((a, b) => (priorities[b.zone || b.role] || 0) - (priorities[a.zone || a.role] || 0) || a.sourcePavingIndex - b.sourcePavingIndex);
  const owned = [], accepted = [], clippedSourceIndices = [];
  for (const cell of ordered) {
    let pieces = [cell.points];
    for (const previous of accepted) pieces = pieces.flatMap(points => subtract(points, previous));
    const remainingArea = pieces.reduce((sum, points) => sum + area(points), 0);
    if (area(cell.points) - remainingArea > AREA_EPSILON) clippedSourceIndices.push(cell.sourcePavingIndex);
    owned.push(...pieces.map(points => ({ ...cell, points })));
    accepted.push(cell.points);
  }
  const unionArea = owned.reduce((sum, cell) => sum + area(cell.points), 0);
  let kept = owned;
  if (connectedToZone) {
    const seen = new Set(owned.map((cell, i) => (cell.zone || cell.role) === connectedToZone ? i : -1).filter(i => i >= 0));
    const queue = [...seen], boxes = owned.map(cell => bounds(cell.points));
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const i = queue[cursor];
      for (let j = 0; j < owned.length; j++) if (!seen.has(j) && boxesOverlap(boxes[i], boxes[j]) && sharedEdgeLength(owned[i].points, owned[j].points) > DISTANCE_EPSILON) { seen.add(j); queue.push(j); }
    }
    kept = owned.filter((_, i) => seen.has(i));
  }
  kept.sort((a, b) => a.sourcePavingIndex - b.sourcePavingIndex);
  const output = conformBoundaries(kept), sourceArea = input.reduce((sum, cell) => sum + area(cell.points), 0), retainedArea = kept.reduce((sum, cell) => sum + area(cell.points), 0);
  return { cells: output, stats: {
    sourceCells: input.length, outputCells: output.length,
    sourceArea, unionArea, retainedArea,
    removedOverlapArea: Math.max(0, sourceArea - unionArea),
    disconnectedArea: Math.max(0, unionArea - retainedArea),
    disconnectedPieces: owned.length - kept.length,
    clippedSourceIndices: clippedSourceIndices.sort((a, b) => a - b),
    retainedSourceIndices: [...new Set(output.map(cell => cell.sourcePavingIndex))],
    boundaryVertices: output.reduce((sum, cell) => sum + cell.points.length, 0),
    method: 'connection-sidewalk-court-priority-with-conforming-boundaries',
  } };
}
