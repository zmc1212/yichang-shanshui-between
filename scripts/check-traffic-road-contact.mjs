import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { createRoadNetwork, getRoadGrade } from '../src/scene/roadNetwork.js';
import { createCityTraffic } from '../src/scene/cityTraffic.js';

// The oracle is the final road BufferGeometry. Never use the route sampler or
// roadSurface.sample to compute an expected vehicle position or road height.
// A small raycast cache retains the original mesh triangles/material/transform;
// its cell bounds only accelerate intersection tests for the whole-city case.
function roadMeshOracle(group) {
  group.updateMatrixWorld(true);
  const sources = group.children.filter(mesh => mesh.isMesh && / surface$/.test(mesh.name));
  assert(sources.length, 'the actual road factory must provide asphalt meshes');
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const records = sources.map(mesh => {
    const positions = mesh.geometry.getAttribute('position'), index = mesh.geometry.getIndex();
    const triangles = [];
    for (let i = 0; i < index.count; i += 3) {
      const ia = index.getX(i), ib = index.getX(i + 1), ic = index.getX(i + 2);
      a.fromBufferAttribute(positions, ia).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(positions, ib).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(positions, ic).applyMatrix4(mesh.matrixWorld);
      triangles.push({ indices: [ia, ib, ic], minX: Math.min(a.x, b.x, c.x), maxX: Math.max(a.x, b.x, c.x),
        minZ: Math.min(a.z, b.z, c.z), maxZ: Math.max(a.z, b.z, c.z) });
    }
    return { mesh, triangles };
  });
  const cellSize = 2, patches = new Map(), ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0), origin = new THREE.Vector3();
  return {
    sample(x, z) {
      const ix = Math.floor(x / cellSize), iz = Math.floor(z / cellSize), key = `${ix},${iz}`;
      if (!patches.has(key)) {
        const localMeshes = [];
        for (const { mesh, triangles } of records) {
          const indices = [];
          for (const triangle of triangles) {
            if (triangle.maxX < ix * cellSize || triangle.minX > (ix + 1) * cellSize
              || triangle.maxZ < iz * cellSize || triangle.minZ > (iz + 1) * cellSize) continue;
            indices.push(...triangle.indices);
          }
          if (!indices.length) continue;
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', mesh.geometry.getAttribute('position'));
          geometry.setIndex(indices);
          geometry.boundingBox = mesh.geometry.boundingBox?.clone() || null;
          geometry.boundingSphere = mesh.geometry.boundingSphere?.clone() || null;
          const patch = new THREE.Mesh(geometry, mesh.material);
          patch.name = mesh.name;
          patch.matrixAutoUpdate = false; patch.matrix.copy(mesh.matrixWorld); patch.updateMatrixWorld(true);
          localMeshes.push(patch);
        }
        patches.set(key, localMeshes);
      }
      ray.set(origin.set(x, 10000, z), down);
      return ray.intersectObjects(patches.get(key), false)[0] || null;
    },
    dispose() { for (const meshes of patches.values()) for (const mesh of meshes) mesh.geometry.dispose(); },
  };
}

function makeHarness(options) {
  const makeNetwork = roads => createRoadNetwork({ ...options, roads, makeMaterial: () => new THREE.MeshBasicMaterial() });
  const network = makeNetwork(options.roads);
  const traffic = createCityTraffic({ ...options, roadSurface: network.roadSurface });
  const body = traffic.group.children.find(mesh => mesh.name === 'traffic car bodies');
  assert(body?.isInstancedMesh, 'check the actual rendered car instances');
  body.geometry.computeBoundingBox(); traffic.group.updateMatrixWorld(true);
  const oracle = roadMeshOracle(network.group);
  const routes = traffic.getStats().routes, sourceOracles = new Map(), extraNetworks = [];
  assert.equal(body.count, routes.length * 2, 'the actual city factory emits two instances per reported route');
  const groundRoads = options.roads.filter(road => {
    const grade = getRoadGrade(road), rawLayer = road.layer;
    return !grade.bridge && !grade.tunnel && (rawLayer == null || rawLayer === '' || Number(rawLayer) === 0);
  });
  let groundOracle = null;
  if (groundRoads.length) {
    const ground = makeNetwork(groundRoads); extraNetworks.push(ground); groundOracle = roadMeshOracle(ground.group);
  }
  return { ...options, network, traffic, body, oracle, groundOracle,
    sourceOracle(car) {
      // Use source identity from the live controller, never a reconstructed
      // sampleTrafficRoute coordinate. The two-instance contract is explicit.
      const sourceIndex = routes[Math.floor(car / 2)].sourceRoadIndex;
      if (!sourceOracles.has(sourceIndex)) {
        const source = makeNetwork([options.roads[sourceIndex]]); extraNetworks.push(source);
        sourceOracles.set(sourceIndex, roadMeshOracle(source.group));
      }
      return sourceOracles.get(sourceIndex);
    },
    dispose() {
    oracle.dispose(); groundOracle?.dispose(); for (const source of sourceOracles.values()) source.dispose(); traffic.dispose();
    for (const item of [network, ...extraNetworks]) for (const mesh of item.group.children) { mesh.geometry.dispose(); mesh.material.dispose(); }
  } };
}

function inspectContact(harness, { seconds = 0, every = 12 } = {}) {
  const { traffic, body, oracle, groundOracle, heightAt = () => 0, worldUnitsPerMeter: units = .02 } = harness;
  assert(body.count > 0, 'contact checks require actual vehicles, not a vacuous empty result');
  const box = body.geometry.boundingBox, matrix = new THREE.Matrix4(), world = new THREE.Matrix4();
  const local = new THREE.Vector3(), point = new THREE.Vector3();
  const xs = [box.min.x, (box.min.x + box.max.x) / 2, box.max.x];
  const zs = [box.min.z, (box.min.z + box.max.z) / 2, box.max.z];
  const report = { routes: traffic.getStats().routeCount, cars: body.count, snapshots: 0, rays: 0,
    missingAsphalt: 0, penetrating: 0, floating: 0, minGapMeters: Infinity, maxGapMeters: -Infinity,
    sameLayerPenetrating: 0, overpassCoverageSamples: 0, maxOtherGroundRiseMeters: 0,
    maxTerrainAboveRoadMeters: 0, checkedCars: new Set(), examples: [] };
  const example = value => { if (report.examples.length < 5) report.examples.push(value); };
  const inspect = step => {
    // Legacy snapshots lack this diagnostic. Current controllers must never
    // turn an unplaceable car invisible to make a contact assertion disappear.
    assert.equal(traffic.getStats().unplacedVehicles ?? 0, 0, `no unplaceable cars may be hidden at sampled step ${step}`);
    report.snapshots++;
    for (let car = 0; car < body.count; car++) {
      body.getMatrixAt(car, matrix); assert(matrix.elements.every(Number.isFinite), 'finite actual instance matrices');
      // A vanishing endpoint instance has no visible footprint to inspect.
      if (Math.hypot(matrix.elements[0], matrix.elements[1], matrix.elements[2]) < 1e-5) continue;
      world.multiplyMatrices(body.matrixWorld, matrix); report.checkedCars.add(car);
      for (const x of xs) for (const z of zs) {
        point.copy(local.set(x, box.min.y, z)).applyMatrix4(world); report.rays++;
        const hit = harness.sourceOracle(car).sample(point.x, point.z);
        if (!hit) {
          report.missingAsphalt++; example({ step, car, reason: 'footprint outside actual asphalt', x: point.x, z: point.z });
          continue;
        }
        const gapMeters = (point.y - hit.point.y) / units;
        report.minGapMeters = Math.min(report.minGapMeters, gapMeters);
        report.maxGapMeters = Math.max(report.maxGapMeters, gapMeters);
        report.maxTerrainAboveRoadMeters = Math.max(report.maxTerrainAboveRoadMeters,
          (heightAt(point.x, point.z) - hit.point.y) / units);
        const location = { step, car, x: point.x, z: point.z, bodyY: point.y, asphaltY: hit.point.y, mesh: hit.object.name, gapMeters };
        if (gapMeters < -.02) { report.penetrating++; example({ ...location, reason: 'body penetrates asphalt' }); }
        if (gapMeters > .25) { report.floating++; example({ ...location, reason: 'body floats over asphalt' }); }
        const ground = groundOracle?.sample(point.x, point.z);
        if (ground) {
          report.maxOtherGroundRiseMeters = Math.max(report.maxOtherGroundRiseMeters, (ground.point.y - hit.point.y) / units);
          if ((point.y - ground.point.y) / units < -.02) {
            report.sameLayerPenetrating++; example({ ...location, reason: 'body penetrates an overlapping ground road',
              groundY: ground.point.y });
          }
          // An upper roadway can legitimately be over this car. It must not
          // become the car's support surface just because it is the top hit.
          if (x === xs[1] && z === zs[1]) {
            const highest = oracle.sample(point.x, point.z);
            if (highest && highest.point.y - ground.point.y > units * .25) report.overpassCoverageSamples++;
          }
        }
      }
    }
  };
  traffic.update(0, { pixelsPerUnit: 100, motionEnabled: true });
  inspect(0);
  const frames = Math.ceil(seconds / .06);
  for (let step = 1; step <= frames; step++) {
    traffic.update(.06);
    if (step % every === 0 || step === frames) inspect(step);
  }
  assert.equal(report.checkedCars.size, body.count, 'every actual instance was inspected');
  report.checkedCars = report.checkedCars.size;
  for (const key of ['minGapMeters', 'maxGapMeters', 'maxTerrainAboveRoadMeters', 'maxOtherGroundRiseMeters']) report[key] = +report[key].toFixed(5);
  return report;
}

function assertContact(report) {
  assert.equal(report.missingAsphalt, 0, `${report.missingAsphalt} footprint samples miss the rendered asphalt`);
  assert.equal(report.penetrating, 0, `${report.penetrating} footprint samples penetrate the asphalt by > 2 cm`);
  assert.equal(report.floating, 0, `${report.floating} footprint samples float above the asphalt by > 25 cm`);
  assert.equal(report.sameLayerPenetrating, 0, `${report.sameLayerPenetrating} footprint samples penetrate an overlapping ground road`);
}

function cityEnvironment(data) {
  const width = data.meta.width, depth = data.meta.depth, extent = Math.max(width, depth);
  function containsRing(x, z, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  const water = data.water.map(value => {
    const rings = value.rings || [value.ring], outer = rings[0];
    return { rings, minX: Math.min(...outer.map(p => p[0])), maxX: Math.max(...outer.map(p => p[0])),
      minZ: Math.min(...outer.map(p => p[1])), maxZ: Math.max(...outer.map(p => p[1])) };
  });
  const inWater = (x, z) => water.some(p => x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ
    && containsRing(x, z, p.rings[0]) && !p.rings.slice(1).some(ring => containsRing(x, z, ring)));
  // Match the city factory's environment inputs. This is terrain, not a road
  // or traffic height oracle: every contact assertion still raycasts meshes.
  const terrain = data.terrain;
  const valid = terrain && terrain.cols > 1 && terrain.rows > 1 && terrain.heights?.length >= terrain.cols * terrain.rows;
  const hills = valid ? [] : (data.landmarks || []).filter(l => /磨基山|白马山|东山/.test(l.name || ''))
    .map(l => ({ x: l.x, z: l.z, height: /磨基山/.test(l.name) ? 4.8 : 2.4, radius: extent * .065 }));
  const heightAt = (x, z) => {
    if (inWater(x, z)) return 0;
    if (!valid) return hills.reduce((sum, h) => sum + h.height * Math.exp(-((x - h.x) ** 2 + (z - h.z) ** 2) / (h.radius ** 2 * .55)), 0);
    const fx = THREE.MathUtils.clamp((x / (terrain.width || width) + .5) * (terrain.cols - 1), 0, terrain.cols - 1.001);
    const fz = THREE.MathUtils.clamp((z / (terrain.depth || depth) + .5) * (terrain.rows - 1), 0, terrain.rows - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const a = Number(terrain.heights[iz * terrain.cols + ix]) || 0, b = Number(terrain.heights[iz * terrain.cols + ix + 1]) || 0;
    const c = Number(terrain.heights[(iz + 1) * terrain.cols + ix]) || 0, d = Number(terrain.heights[(iz + 1) * terrain.cols + ix + 1]) || 0;
    return THREE.MathUtils.clamp(THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), tz), 0, extent * .12);
  };
  return { inWater, heightAt, extent, worldUnitsPerMeter: data.meta.unitsPerMeter };
}

const results = [];
function check(name, run) {
  let detail;
  try { detail = run(value => { detail = value; }); results.push({ name, passed: true, detail }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, passed: false, error: error.message, detail }); console.error(`FAIL ${name}: ${error.message}`); }
}
const road = (overrides = {}) => ({ points: [[-4, 0], [4, 0]], width: .2, highway: 'primary', name: '沿江大道', ...overrides });
function contactCase(options, duration, publish) {
  const harness = makeHarness(options);
  try { const report = inspectContact(harness, duration); publish(report); assertContact(report); return report; }
  finally { harness.dispose(); }
}

check('flat road baseline uses real mesh heights and actual body geometry', publish =>
  contactCase({ roads: [road()], heightAt: () => 0 }, { seconds: 1 }, publish));

check('nonlinear hill stays in contact with the rendered road triangles', publish =>
  contactCase({ roads: [road()], heightAt: x => .4 * Math.max(0, 1 - (x / 4) ** 2) }, { seconds: 50, every: 16 }, publish));

check('longitudinal and cross slope support the whole car footprint', publish =>
  contactCase({ roads: [road()], heightAt: (x, z) => 1 + .2 * x + .15 * z }, { seconds: 50, every: 16 }, publish));

check('narrow diagonal and open-ended roads retain every visible car corner through recycling', publish =>
  contactCase({ extent: 32, roads: [
    road({ width: .10, points: [[-4, 0], [0, 0], [0, 4]] }),
    road({ width: .13, highway: 'secondary', oneway: '-1', points: [[4, -4], [8, 0], [4, 4]] }),
  ], heightAt: () => 0 }, { seconds: 65, every: 1 }, publish));

check('bridges, tunnels and unresolved non-ground layers cannot emit ground traffic', publish => {
  const details = [];
  for (const grade of [{ bridge: 'yes' }, { tunnel: 'yes' }, { kind: 'bridge' }, { layer: 1 }, { layer: -1 }, { layer: 'unknown' }]) {
    const harness = makeHarness({ roads: [road(grade)] });
    try { details.push({ grade, cars: harness.body.count }); }
    finally { harness.dispose(); }
  }
  publish(details); assert(details.every(value => value.cars === 0), JSON.stringify(details)); return details;
});

check('all real city traffic routes meet the rendered road surface over a full route cycle', publish => {
  const data = JSON.parse(fs.readFileSync(new URL('../public/data/city.json', import.meta.url), 'utf8'));
  const before = JSON.stringify(data.roads), environment = cityEnvironment(data);
  const harness = makeHarness({ roads: data.roads, ...environment });
  try {
    const stats = harness.traffic.getStats();
    assert.equal(stats.routeCount, 18, 'the default city keeps its 18 distributed active route segments');
    assert.equal(harness.body.count, 36, 'inspect all 36 displayed city cars');
    const longest = Math.max(...stats.routes.map(route => {
      const points = data.roads[route.sourceRoadIndex].points, a = points[route.sourceSegmentIndex], b = points[route.sourceSegmentIndex + 1];
      return Math.hypot(b[0] - a[0], b[1] - a[1]);
    }));
    const seconds = longest / (6.5 * environment.worldUnitsPerMeter) + 1;
    const report = inspectContact(harness, { seconds, every: Math.max(1, Math.floor(seconds / .06 / 100)) });
    report.simulatedSeconds = +seconds.toFixed(2);
    report.sourceRoutes = stats.routes.map(route => ({ id: route.id, name: route.name, sourceRoadIndex: route.sourceRoadIndex,
      sourceSegmentIndex: route.sourceSegmentIndex }));
    publish(report); assert.equal(JSON.stringify(data.roads), before, 'rendering and traffic preserve GIS source inputs');
    assert(report.overpassCoverageSamples > 0, 'the full city cycle includes cars under a differently graded road, without snapping them up');
    assertContact(report); return report;
  } finally { harness.dispose(); }
});

console.log(JSON.stringify({ passed: results.filter(value => value.passed).length, total: results.length, results,
  verification: 'CPU raycasts of actual asphalt triangles against actual instance body footprints; no WebGL or GLB occlusion verification' }, null, 2));
if (results.some(value => !value.passed)) process.exitCode = 1;
