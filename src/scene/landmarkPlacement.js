// Placement only: the landmark factory owns geographic yaw and model scaling.
// All coordinates are the scene's local x-east / z-south world coordinates.
function endpointPoint(point) {
  const x = Array.isArray(point) ? point[0] : point?.x;
  const z = Array.isArray(point) ? point[point.length === 3 ? 2 : 1] : point?.z;
  return Number.isFinite(x) && Number.isFinite(z) ? [x, z] : null;
}
function endpointsOf(value) {
  const a = endpointPoint(Array.isArray(value) ? value[0] : value?.from ?? value?.start);
  const b = endpointPoint(Array.isArray(value) ? value[1] : value?.to ?? value?.end);
  return a && b && Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.000001 ? [a, b] : null;
}
function centeredSpan(spec, endpoints, additions = {}) {
  const [a, b] = endpoints;
  return { ...spec, ...additions, endpoints, x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, modelScale: 1 };
}
function westToEast(points) {
  if (points.length < 2) return points;
  const a = points[0], b = points.at(-1);
  return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]) ? [...points].reverse() : points;
}
function zhixiSpan(spec, points) {
  const [a, b] = westToEast(points), dx = b[0] - a[0], dz = b[1] - a[1];
  // These two near-bank points are the main-span tower positions. The whole
  // deck also includes the 250:838:215 side spans used by the model factory.
  const endpoints = [
    [a[0] - dx * 250 / 838, a[1] - dz * 250 / 838],
    [b[0] + dx * 215 / 838, b[1] + dz * 215 / 838],
  ];
  return centeredSpan(spec, endpoints, {
    mainSpanEndpoints: [a, b], spanSource: 'named-road-main-span-with-approaches',
  });
}

/** Pure placement resolver; importing it does not create a renderer or DOM. */
export function resolveLandmarkSpec(spec, { roads = [], inWater = () => false } = {}) {
  if (spec.kind !== 'bridge' && spec.kind !== 'dam') return spec;
  const provided = endpointsOf(spec.endpoints);
  if (provided) return centeredSpan(spec, provided, {
    spanSource: spec.spanSource || spec.alignment?.method || 'provided-endpoints',
  });
  const mainProvided = endpointsOf(spec.mainSpanEndpoints);
  if (spec.id === 'zhixi-bridge' && mainProvided) return zhixiSpan(spec, mainProvided);
  if (spec.kind !== 'bridge') return spec;

  let best = null;
  for (const road of roads) {
    if (road.name !== spec.name || !Array.isArray(road.points)) continue;
    const validPoints = road.points.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    // Normalize before sampling so reversed source-way storage produces exactly
    // the same sampling phase and cannot flip the asymmetric suspension bridge.
    const points = spec.id === 'zhixi-bridge' ? westToEast(validPoints) : validPoints;
    let run = null;
    const finish = () => {
      if (run && run.length > 4 && (!best || run.length > best.length)) best = run;
      run = null;
    };
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], dx = b[0] - a[0], dz = b[1] - a[1];
      const length = Math.hypot(dx, dz), steps = Math.max(1, Math.ceil(length / 0.15));
      for (let j = 0; j < steps; j++) {
        const t = j / steps, point = [a[0] + dx * t, a[1] + dz * t];
        if (inWater(point[0], point[1])) {
          if (!run) run = { first: point, last: point, length: 0 };
          run.last = point; run.length += length / steps;
        } else finish();
      }
    }
    finish();
  }
  if (!best) return spec;
  const dx = best.last[0] - best.first[0], dz = best.last[1] - best.first[1];
  const length = Math.hypot(dx, dz) || 1, approach = 1.25;
  const a = [best.first[0] - dx / length * approach, best.first[1] - dz / length * approach];
  const b = [best.last[0] + dx / length * approach, best.last[1] + dz / length * approach];
  if (spec.id === 'zhixi-bridge') return zhixiSpan(spec, [a, b]);
  return centeredSpan(spec, [a, b], { spanSource: 'named-road-water-crossing' });
}
