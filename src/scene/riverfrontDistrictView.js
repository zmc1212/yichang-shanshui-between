import * as THREE from 'three';
import { authoredWorldBounds } from './authoredPlacement.js';
import { getRoadGrade, getRoadWidth } from './roadNetwork.js';

export const RIVERFRONT_DISTRICT_IDS = Object.freeze(['wanda-soho-s01', 'yichang-international-s01']);

const validPoint = point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]);
const finiteHeight = (heightAt, x, z) => { const height = heightAt(x, z); return Number.isFinite(height) ? height : 0; };

function boxCorners(box) {
  const points = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) points.push(new THREE.Vector3(x, y, z));
  return points;
}

function clipSegment(a, b, box) {
  let low = 0, high = 1;
  for (const [axis, min, max] of [[0, box.min.x, box.max.x], [1, box.min.z, box.max.z]]) {
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < 1e-12) { if (a[axis] < min || a[axis] > max) return null; continue; }
    let from = (min - a[axis]) / delta, to = (max - a[axis]) / delta;
    if (from > to) [from, to] = [to, from];
    low = Math.max(low, from); high = Math.min(high, to);
    if (low >= high) return null;
  }
  return { from: low, to: high, endpoints: [low, high].map(t => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]) };
}

function insideRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

const insideWater = (point, rings) => insideRing(point, rings[0]) && !rings.slice(1).some(ring => insideRing(point, ring));

function nearestShore(anchor, polygons, maxDistance) {
  let nearest = null;
  for (const polygon of polygons) for (let ringIndex = 0; ringIndex < polygon.rings.length; ringIndex++) {
    const ring = polygon.rings[ringIndex];
    for (let segmentIndex = 0; segmentIndex < ring.length; segmentIndex++) {
      const a = ring[segmentIndex], b = ring[(segmentIndex + 1) % ring.length];
      const dx = b[0] - a[0], dz = b[1] - a[1], lengthSq = dx * dx + dz * dz;
      if (lengthSq < 1e-12) continue;
      const t = THREE.MathUtils.clamp(((anchor[0] - a[0]) * dx + (anchor[1] - a[1]) * dz) / lengthSq, 0, 1);
      const shore = [a[0] + dx * t, a[1] + dz * t];
      const distance = Math.hypot(shore[0] - anchor[0], shore[1] - anchor[1]);
      if (distance > maxDistance || (nearest && distance >= nearest.distance)) continue;
      const length = Math.sqrt(lengthSq);
      nearest = { ...polygon, ringIndex, segmentIndex, shore, distance, tangent: [dx / length, dz / length] };
    }
  }
  return nearest;
}

function sampleRiverStrip(anchors, water, units, riverDepthMeters) {
  const polygons = water.flatMap((polygon, sourceWaterIndex) => {
    const rings = (polygon.rings || (polygon.ring ? [polygon.ring] : [])).map(ring => ring.filter(validPoint)).filter(ring => ring.length >= 3);
    return rings.length ? [{ rings, sourceWaterIndex, name: String(polygon.name || '') }] : [];
  });
  // Prefer the explicitly named river to unrelated ornamental ponds. If that
  // name is unavailable, only a nearby source water polygon may contribute.
  const namedRiver = polygons.filter(polygon => /长江|yangtze/i.test(polygon.name));
  const candidates = namedRiver.length ? namedRiver : polygons;
  const samples = [];
  for (const anchor of anchors) {
    const nearest = nearestShore(anchor, candidates, 400 * units);
    if (!nearest) continue;
    const { shore, tangent, rings } = nearest;
    const outward = new THREE.Vector2(shore[0] - anchor[0], shore[1] - anchor[1]).normalize();
    const directions = [[-tangent[1], tangent[0]], [tangent[1], -tangent[0]], [outward.x, outward.y]];
    let best = null;
    for (const direction of directions) {
      if (Math.hypot(...direction) < .9) continue;
      let depth = 0;
      // Every step must remain in the source polygon, including its holes.
      // The result is a camera extent, never generated shoreline geometry.
      for (let step = 1; step <= 20; step++) {
        const distance = riverDepthMeters * units * step / 20;
        if (!insideWater([shore[0] + direction[0] * distance, shore[1] + direction[1] * distance], rings)) break;
        depth = distance;
      }
      if (depth && (!best || depth > best.depth)) best = { depth, water: [shore[0] + direction[0] * depth, shore[1] + direction[1] * depth] };
    }
    if (best) samples.push({ sourceWaterIndex: nearest.sourceWaterIndex, name: nearest.name,
      sourceRingIndex: nearest.ringIndex, sourceSegmentIndex: nearest.segmentIndex,
      shore, water: best.water, depthMeters: best.depth / units });
  }
  return samples;
}

/**
 * A presentation camera for the two existing riverside models. All geometry,
 * heights, registration transforms and source data remain unchanged. `models`
 * must already have passed resolveAuthoredPlacement(). Missing either model
 * returns null so the caller can use its existing overview.
 *
 * `baseHalfHeight` is the unzoomed OrthographicCamera half-height; do not cap
 * the returned zoom at the old city overview's 16x limit. Passing the scene's
 * existing cameraDistance (extent * 1.6) preserves its near/far arrangement.
 * Bounds and frame points include the complete model world boxes, a bounded
 * piece of source road, nearby ground and a short strip of source river.
 * Padding is a fraction of each screen edge; DOM overlays are caller-owned.
 */
export function planRiverfrontDistrictView({ models = [], roads = [], water = [], aspect, baseHalfHeight,
  view = 'perspective', heightAt = () => 0, unitsPerMeter = .02, cameraDistance,
  groundPaddingMeters = 40, riverDepthMeters = 70, padding = .08 } = {}) {
  if (!(Number.isFinite(aspect) && aspect > 0) || !(Number.isFinite(baseHalfHeight) && baseHalfHeight > 0)) throw new Error('Riverfront district framing needs positive aspect and baseHalfHeight');
  const units = Number.isFinite(unitsPerMeter) && unitsPerMeter > 0 ? unitsPerMeter : .02;
  const selected = RIVERFRONT_DISTRICT_IDS.map(id => models.find(model => model.id === id));
  if (selected.some(model => !model || !Number.isFinite(model.x) || !Number.isFinite(model.z) || !Number.isFinite(model.yaw)
    || !['x', 'y', 'z'].every(axis => Number.isFinite(model.localSize?.[axis]) && model.localSize[axis] > 0))) return null;
  const modelBounds = selected.map(model => authoredWorldBounds(model, finiteHeight(heightAt, model.x, model.z) + .065));
  const modelUnion = new THREE.Box3(); modelBounds.forEach(box => modelUnion.union(box));
  const points = modelBounds.flatMap(boxCorners);
  const groundBox = modelUnion.clone();
  const groundMargin = THREE.MathUtils.clamp(Number(groundPaddingMeters) || 0, 0, 150) * units;
  groundBox.min.x -= groundMargin; groundBox.max.x += groundMargin;
  groundBox.min.z -= groundMargin; groundBox.max.z += groundMargin;
  // Keep each building's neighborhood instead of adding the empty opposite
  // corners of one large diagonal district box, especially on portrait screens.
  for (const box of modelBounds) for (const x of [box.min.x - groundMargin, box.max.x + groundMargin]) for (const z of [box.min.z - groundMargin, box.max.z + groundMargin]) points.push(new THREE.Vector3(x, finiteHeight(heightAt, x, z) + .06, z));

  const roadSegments = [];
  roads.forEach((road, sourceRoadIndex) => {
    if (!String(road.name || '').includes('沿江大道')) return;
    const grade = getRoadGrade(road);
    if (grade.bridge || grade.tunnel || (grade.layer !== null && grade.layer !== 0)) return;
    const width = getRoadWidth(road);
    for (let segmentIndex = 0; segmentIndex < (road.points || []).length - 1; segmentIndex++) {
      const a = road.points[segmentIndex], b = road.points[segmentIndex + 1];
      if (!validPoint(a) || !validPoint(b)) continue;
      const clipped = clipSegment(a, b, groundBox);
      if (!clipped) continue;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 1e-8) continue;
      const normal = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
      for (const end of clipped.endpoints) for (const side of [-1, 1]) {
        const x = end[0] + normal[0] * width * .5 * side, z = end[1] + normal[1] * width * .5 * side;
        points.push(new THREE.Vector3(x, finiteHeight(heightAt, x, z) + .14, z));
      }
      roadSegments.push({ sourceRoadIndex, sourceSegmentIndex: segmentIndex, osmId: road.osmId || null, name: road.name, ...clipped });
    }
  });

  const anchors = selected.map(model => [model.x, model.z]);
  anchors.push([(anchors[0][0] + anchors[1][0]) / 2, (anchors[0][1] + anchors[1][1]) / 2]);
  const depthMeters = THREE.MathUtils.clamp(Number(riverDepthMeters) || 0, 0, 150);
  const waterSamples = depthMeters > 0 ? sampleRiverStrip(anchors, water, units, depthMeters) : [];
  for (const sample of waterSamples) for (const [x, z] of [sample.shore, sample.water]) points.push(new THREE.Vector3(x, finiteHeight(heightAt, x, z) + .045, z));

  const bounds = new THREE.Box3().setFromPoints(points);
  const target = bounds.getCenter(new THREE.Vector3());
  // The overview's southeast azimuth is retained with a lower ~35 degree
  // elevation, making the facades legible while keeping the river in view.
  const direction = (view === 'top' ? new THREE.Vector3(0, 1, .0001) : new THREE.Vector3(.62, .72, .84)).normalize();
  const right = new THREE.Vector3(direction.z, 0, -direction.x).normalize();
  const up = new THREE.Vector3().crossVectors(direction, right).normalize();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minDepth = Infinity, maxDepth = -Infinity;
  for (const point of points) {
    const x = point.dot(right), y = point.dot(up), depth = point.dot(direction);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minDepth = Math.min(minDepth, depth); maxDepth = Math.max(maxDepth, depth);
  }
  target.addScaledVector(right, (minX + maxX) / 2 - target.dot(right));
  target.addScaledVector(up, (minY + maxY) / 2 - target.dot(up));
  const margin = Number.isFinite(padding) ? THREE.MathUtils.clamp(padding, 0, .3) : .08;
  const visibleHeight = Math.max(maxY - minY, (maxX - minX) / aspect) / (1 - 2 * margin);
  const zoom = 2 * baseHalfHeight / visibleHeight;
  const requestedDistance = Number.isFinite(cameraDistance) && cameraDistance > 0 ? cameraDistance : baseHalfHeight * 3;
  // Orthographic framing is independent of eye distance. Leave the full depth
  // interval ahead of the eye even when a caller has a small local frustum.
  const distance = Math.max(requestedDistance, maxDepth - minDepth + Math.max(1, 50 * units));
  return { target, position: target.clone().addScaledVector(direction, distance), zoom, bounds,
    ids: RIVERFRONT_DISTRICT_IDS.slice(), framePoints: points.map(point => point.toArray()),
    modelBounds, roadSegments, waterSamples, visibleHeight, visibleWidth: visibleHeight * aspect,
    policy: 'registered-full-model-world-bounds; source-road-and-river-context; camera-only' };
}
