import * as THREE from 'three';

const DISTANCE_EPSILON = 1e-10;
const AREA_EPSILON = 1e-14;
const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

function signedArea(ring) {
  if (ring.length < 3) return 0;
  // Subtract a nearby origin before summation: the small curb area should not
  // be obtained by subtracting products of much larger world coordinates.
  const origin = ring[0];
  let area = 0;
  for (let i = 1; i < ring.length - 1; i++) area += cross(origin, ring[i], ring[i + 1]);
  return area / 2;
}

function cleanRing(input) {
  if (!Array.isArray(input) || input.some(p => !Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return [];
  let ring = [];
  for (const p of input) if (!ring.length || distance(p, ring.at(-1)) > DISTANCE_EPSILON) ring.push([p[0], p[1]]);
  if (ring.length > 1 && distance(ring[0], ring.at(-1)) <= DISTANCE_EPSILON) ring.pop();
  let changed = true;
  while (changed && ring.length >= 3) {
    changed = false;
    ring = ring.filter((p, i, all) => {
      const previous = all[(i + all.length - 1) % all.length], next = all[(i + 1) % all.length];
      const span = distance(previous, next);
      const between = (p[0] - previous[0]) * (p[0] - next[0]) + (p[1] - previous[1]) * (p[1] - next[1]) <= DISTANCE_EPSILON ** 2;
      if (span > DISTANCE_EPSILON && between && Math.abs(cross(previous, next, p)) <= DISTANCE_EPSILON * span) { changed = true; return false; }
      return true;
    });
  }
  const area = signedArea(ring);
  if (ring.length < 3 || Math.abs(area) <= AREA_EPSILON) return [];
  return area > 0 ? ring : ring.reverse();
}

function convexParts(input) {
  const ring = cleanRing(input);
  if (!ring.length) return [];
  if (ring.every((p, i) => cross(p, ring[(i + 1) % ring.length], ring[(i + 2) % ring.length]) >= -AREA_EPSILON)) return [ring];
  // Current planner cells are convex. Retaining this fallback makes the
  // renderer usable when a later site supplies a concave but simple outline.
  return THREE.ShapeUtils.triangulateShape(ring.map(p => new THREE.Vector2(...p)), [])
    .map(indices => cleanRing(indices.map(i => ring[i]))).filter(points => points.length >= 3);
}

function bounds(ring) {
  return { minX: Math.min(...ring.map(p => p[0])), maxX: Math.max(...ring.map(p => p[0])), minZ: Math.min(...ring.map(p => p[1])), maxZ: Math.max(...ring.map(p => p[1])) };
}
const boxesOverlap = (a, b) => a.minX <= b.maxX && b.minX <= a.maxX && a.minZ <= b.maxZ && b.minZ <= a.maxZ;

function clipHalfPlane(subject, a, b, keepInside = true) {
  const length = distance(a, b);
  if (subject.length < 3 || length <= DISTANCE_EPSILON) return [];
  const sign = keepInside ? 1 : -1;
  const side = point => {
    const value = sign * cross(a, b, point) / length;
    return Math.abs(value) <= DISTANCE_EPSILON ? 0 : value;
  };
  const output = [];
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

function intersectConvex(subject, clip) {
  let result = subject;
  for (let i = 0; i < clip.length && result.length; i++) result = clipHalfPlane(result, clip[i], clip[(i + 1) % clip.length]);
  return result;
}

function subtractConvex(subject, clip) {
  if (!boxesOverlap(bounds(subject), bounds(clip)) || !intersectConvex(subject, clip).length) return [subject];
  const output = [];
  let remainder = subject;
  // Each outside fragment belongs to the first clip edge it fails. Those
  // convex fragments partition the difference without overlapping one another.
  for (let i = 0; i < clip.length && remainder.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const outside = clipHalfPlane(remainder, a, b, false);
    if (outside.length) output.push(outside);
    remainder = clipHalfPlane(remainder, a, b, true);
  }
  return output;
}

function curbFrame(curb, ring) {
  let a = curb.a, b = curb.b;
  if (!Array.isArray(a) || !Array.isArray(b) || !a.every(Number.isFinite) || !b.every(Number.isFinite) || distance(a, b) <= DISTANCE_EPSILON) {
    let longest = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length], length = distance(p, q);
      if (length > longest) { a = p; b = q; longest = length; }
    }
  }
  const length = distance(a, b), tangent = [(b[0] - a[0]) / length, (b[1] - a[1]) / length], normal = [-tangent[1], tangent[0]];
  const project = p => [(p[0] - a[0]) * tangent[0] + (p[1] - a[1]) * tangent[1], (p[0] - a[0]) * normal[0] + (p[1] - a[1]) * normal[1]];
  const point = (u, v) => [a[0] + tangent[0] * u + normal[0] * v, a[1] + tangent[1] * u + normal[1] * v];
  const projected = ring.map(project), minV = Math.min(...projected.map(p => p[1])), maxV = Math.max(...projected.map(p => p[1]));
  return { project, point, minV, maxV };
}

/** Return convex curb cells, leaving the planner and all source coordinates
 * untouched. Only curbs with positive-area connection overlap get an opening.
 *
 * A connection ends on the building-side curb centreline. Merely subtracting
 * its polygon leaves half the raised curb across the doorway. For each actual
 * overlap, its tangent interval is therefore cut through this curb's own full
 * thickness. No tangent padding or global road-edge buffer is introduced. */
export function trimStreetCurbs(site) {
  const connections = (site.paving || []).flatMap((cell, index) => cell.role === 'connection'
    ? convexParts(cell.points).map(points => ({ points, bounds: bounds(points), index })) : []);
  // Corner courts may merge into the same-side sidewalk. Only an explicitly
  // marked building-side curb accepts these already-safe court masks; the
  // carriageway edge must stay continuous. Ordinary five-site plans retain
  // their original connection-only behaviour.
  const courtOpenings = (site.courtOpeningMasks || []).flatMap((ring, index) =>
    convexParts(ring).map(points => ({ points, bounds: bounds(points), courtIndex: index })));
  const cells = [], cutouts = [];
  for (let curbIndex = 0; curbIndex < (site.curbs || []).length; curbIndex++) {
    const curb = site.curbs[curbIndex], ring = cleanRing(curb.footprint);
    if (!ring.length) continue;
    const sourceParts = convexParts(ring), sourceBounds = bounds(ring), overlaps = [];
    for (const connection of curb.side === 'building' ? [...connections, ...courtOpenings] : connections) {
      if (!boxesOverlap(sourceBounds, connection.bounds)) continue;
      for (const subject of sourceParts) {
        const points = intersectConvex(subject, connection.points);
        if (points.length && signedArea(points) > AREA_EPSILON) overlaps.push({ points, connectionIndex: connection.index, courtIndex: connection.courtIndex });
      }
    }
    if (!overlaps.length) {
      cells.push(...sourceParts.map(points => ({ points, sourceCurbIndex: curbIndex })));
      continue;
    }
    const frame = curbFrame(curb, ring), intervals = [];
    let penetration = 0;
    for (const overlap of overlaps) {
      const local = overlap.points.map(frame.project), us = local.map(p => p[0]), vs = local.map(p => p[1]);
      intervals.push([Math.min(...us), Math.max(...us)]);
      penetration = Math.max(penetration, Math.min(...vs) - frame.minV, frame.maxV - Math.max(...vs));
    }
    intervals.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const interval of intervals) {
      const last = merged.at(-1);
      if (last && interval[0] <= last[1] + DISTANCE_EPSILON) last[1] = Math.max(last[1], interval[1]);
      else merged.push([...interval]);
    }
    let remaining = sourceParts;
    const openingMasks = merged.map(([minU, maxU]) => cleanRing([
      frame.point(minU, frame.minV), frame.point(maxU, frame.minV),
      frame.point(maxU, frame.maxV), frame.point(minU, frame.maxV),
    ])).filter(mask => mask.length >= 3);
    for (const mask of openingMasks) remaining = remaining.flatMap(subject => subtractConvex(subject, mask));
    cells.push(...remaining.map(points => ({ points, sourceCurbIndex: curbIndex })));
    // Report union area even if a future planner has touching/overlapping
    // entry cells; duplicate connection masks must not double-count removal.
    let originalRemainder = sourceParts;
    for (const overlap of overlaps) originalRemainder = originalRemainder.flatMap(subject => subtractConvex(subject, overlap.points));
    const originalOverlapArea = signedArea(ring) - originalRemainder.reduce((sum, points) => sum + signedArea(points), 0);
    const removedArea = signedArea(ring) - remaining.reduce((sum, points) => sum + signedArea(points), 0);
    cutouts.push({
      sourceCurbIndex: curbIndex,
      connectionCellIndices: [...new Set(overlaps.map(overlap => overlap.connectionIndex).filter(index => index != null))],
      ...(overlaps.some(overlap => overlap.courtIndex != null) ? { courtMaskIndices: [...new Set(overlaps.map(overlap => overlap.courtIndex).filter(index => index != null))] } : {}),
      openingWidth: merged.reduce((sum, [a, b]) => sum + b - a, 0),
      curbWidth: frame.maxV - frame.minV,
      maxPenetration: removedArea - originalOverlapArea <= AREA_EPSILON ? 0 : Math.min(frame.maxV - frame.minV, Math.max(0, penetration)),
      originalOverlapArea, removedArea,
      openingMasks,
      unitsPerMeter: site.units || null,
    });
  }
  // Array iteration remains the advertised [{points: ...}] API. The optional
  // non-enumerable record supports QA/stats without duplicating every cutout
  // on each surviving fragment (fully removed segments have none).
  Object.defineProperty(cells, 'cutouts', { value: cutouts, enumerable: false });
  return cells;
}

/** One indexed geometry for all curb tops and exposed vertical sides. Base
 * vertices sample surface(x,z); top vertices use that same sample plus lift. */
export function createStreetCurbGeometry(cells, surface, lift = 0.0035) {
  if (typeof surface !== 'function' || !Number.isFinite(lift) || lift < 0) throw new TypeError('Street curbs require a surface function and a finite non-negative lift');
  const positions = [], normals = [], uvs = [], indices = [], edgeMap = new Map();
  let topTriangles = 0, sideTriangles = 0, renderedCells = 0;
  const height = (x, z) => {
    const value = surface(x, z);
    if (!Number.isFinite(value)) throw new TypeError('Street curb surface returned a non-finite height');
    return value;
  };
  const addVertex = (x, y, z, normal, uv) => {
    const index = positions.length / 3;
    positions.push(x, y, z); normals.push(...normal); uvs.push(...uv);
    return index;
  };
  const pointKey = p => `${p[0]},${p[1]}`;
  const normalAt = (x, z) => {
    const step = 0.001;
    const dx = (height(x + step, z) - height(x - step, z)) / (2 * step);
    const dz = (height(x, z + step) - height(x, z - step)) / (2 * step), length = Math.hypot(dx, 1, dz);
    return [-dx / length, 1 / length, -dz / length];
  };
  for (const cell of cells || []) {
    // Remove a coincident/sliver edge after the same Float32 quantisation the
    // renderer uses, so no zero-length side can generate an invalid normal.
    const ring = cleanRing((cell.points || []).map(p => [Math.fround(p[0]), Math.fround(p[1])]));
    if (!ring.length) continue;
    renderedCells++;
    const top = ring.map(([x, z]) => addVertex(x, height(x, z) + lift, z, normalAt(x, z), [x, z]));
    for (let i = 1; i < top.length - 1; i++) { indices.push(top[0], top[i + 1], top[i]); topTriangles++; }
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], ka = pointKey(a), kb = pointKey(b), forward = ka < kb;
      const key = forward ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (!edgeMap.has(key)) edgeMap.set(key, { low: forward ? a : b, high: forward ? b : a, balance: 0 });
      edgeMap.get(key).balance += forward ? 1 : -1;
    }
  }
  let boundaryEdges = 0;
  if (lift > 0) for (const { low, high, balance } of edgeMap.values()) {
    if (!balance) continue; // Exact shared fragments have no internal wall.
    const a = balance > 0 ? low : high, b = balance > 0 ? high : low;
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    if (length <= DISTANCE_EPSILON) continue;
    const normal = [dz / length, 0, -dx / length], ya = height(...a), yb = height(...b);
    const ab = addVertex(a[0], ya, a[1], normal, [0, 0]);
    const bb = addVertex(b[0], yb, b[1], normal, [length, 0]);
    const at = addVertex(a[0], ya + lift, a[1], normal, [0, lift]);
    const bt = addVertex(b[0], yb + lift, b[1], normal, [length, lift]);
    indices.push(ab, bt, bb, ab, at, bt); sideTriangles += 2; boundaryEdges++;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.userData.streetCurbs = {
    renderedCells, boundaryEdges, topTriangles, sideTriangles, lift,
    cutouts: cells?.cutouts || [],
    geometryBytes: Object.values(geometry.attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, 0) + geometry.index.array.byteLength,
  };
  return geometry;
}
