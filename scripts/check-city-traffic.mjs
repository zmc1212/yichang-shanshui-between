import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { planTrafficRoutes, sampleTrafficRoute, createCityTraffic } from '../src/scene/cityTraffic.js';
import { createRoadNetwork } from '../src/scene/roadNetwork.js';

let passed = 0;
const check = (name, run) => { run(); passed++; console.log(`PASS ${name}`); };
const road = (overrides = {}) => ({ points: [[-4, 0], [4, 0]], width: 0.2, highway: 'primary', name: '沿江大道', ...overrides });
function trafficFixture(options) {
  const network = createRoadNetwork({ ...options, makeMaterial: () => new THREE.MeshBasicMaterial() });
  const controller = createCityTraffic({ ...options, roadSurface: network.roadSurface });
  const disposeTraffic = controller.dispose.bind(controller);
  let disposed = false;
  controller.dispose = () => {
    if (disposed) return;
    disposed = true; disposeTraffic();
    network.group.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
  };
  return controller;
}

check('all car corners remain inside their existing source segment ribbon', () => {
  const { routes } = planTrafficRoutes({ roads: [road(), road({ points: [[-4, 2], [4, 6]], oneway: '-1' })] });
  assert.equal(routes.length, 2);
  for (const route of routes) for (const direction of [-1, 1]) for (let step = 0; step <= 100; step++) {
    const p = sampleTrafficRoute(route, step / 100 * route.usableLength, direction);
    assert(Object.values(p).every(Number.isFinite));
    assert(p.scale >= 0 && p.scale <= 1);
    for (const x of [-route.carLength / 2, route.carLength / 2]) for (const z of [-route.carWidth / 2, route.carWidth / 2]) {
      const worldX = p.x + (Math.cos(p.yaw) * x + Math.sin(p.yaw) * z) * p.scale;
      const worldZ = p.z + (-Math.sin(p.yaw) * x + Math.cos(p.yaw) * z) * p.scale;
      const along = (worldX - route.a[0]) * route.tangent[0] + (worldZ - route.a[1]) * route.tangent[1];
      const offset = (worldX - route.a[0]) * route.normal[0] + (worldZ - route.a[1]) * route.normal[1];
      assert(along >= 0 && along <= route.length);
      assert(Math.abs(offset) <= route.width / 2 + 1e-9);
    }
  }
});

check('open routes disappear at ends and do not drive an invented return chord', () => {
  const { routes } = planTrafficRoutes({ roads: [road({ points: [[0, 0], [8, 0], [8, 8]] })] });
  assert.equal(routes.length, 1);
  const route = routes[0];
  for (const direction of [-1, 1]) {
    assert.equal(sampleTrafficRoute(route, 0, direction).scale, 0);
    assert.equal(sampleTrafficRoute(route, route.usableLength, direction).scale, 0);
    assert(sampleTrafficRoute(route, route.usableLength - 1e-6, direction).scale < 1e-7);
    const wrapped = sampleTrafficRoute(route, route.usableLength + 0.01, direction);
    assert.equal(wrapped.z, route.laneOffset * direction);
  }
});

check('water in a segment interior, narrow roads and unknown structure heights are rejected', () => {
  const inputs = [road(), road({ bridge: 'yes' }), road({ tunnel: 'yes' }), road({ width: 0.035 }),
    road({ highway: 'footway' }), road({ points: [[0, 0], [0.01, 0]] })];
  const blocked = planTrafficRoutes({ roads: inputs, inWater: x => Math.abs(x) < 0.7 });
  assert.equal(blocked.routes.length, 0);
  assert.equal(blocked.stats.omitted.structures, 2);
  assert.equal(blocked.stats.omitted.waterSegments, 1);
  assert(blocked.stats.omitted.narrowSegments > 0);
});

check('oneway directions and metric vehicle scale survive planning', () => {
  for (const [oneway, sign] of [['yes', 1], ['-1', -1]]) {
    const { routes, vehicles } = planTrafficRoutes({ roads: [road({ oneway })] });
    assert(vehicles.every(vehicle => vehicle.direction === sign));
    assert.equal(routes[0].laneOffset, 0);
    assert.equal(routes[0].carLength, 4.6 * 0.02);
    const a = sampleTrafficRoute(routes[0], 1, sign), b = sampleTrafficRoute(routes[0], 2, sign);
    assert((b.x - a.x) * sign > 0);
  }
});

check('malformed and duplicate source points are never bridged together', () => {
  const result = planTrafficRoutes({ roads: [road({ points: [[-4, 0], null, [4, 0], [4, 0], [NaN, 0]] })] });
  assert.equal(result.routes.length, 0);
  assert(result.stats.omitted.invalidSegments >= 2);
});

check('traffic stops when offscreen, disabled, or motion is reduced; matrices stay finite', () => {
  const controller = trafficFixture({ roads: [road()], heightAt: x => 1 + x * 0.01 });
  assert.equal(controller.group.children.length, 4);
  assert.equal(controller.shouldAnimate(), false);
  assert.equal(controller.update(0.03, { pixelsPerUnit: 4, motionEnabled: true }), false);
  controller.update(0, { pixelsPerUnit: 100, motionEnabled: false });
  assert.equal(controller.group.visible, true);
  assert.equal(controller.shouldAnimate(), false);
  const first = controller.group.children[0].instanceMatrix.array.slice();
  assert.equal(controller.update(0.03), false);
  assert.deepEqual(controller.group.children[0].instanceMatrix.array, first);
  assert.equal(controller.update(0.03, { motionEnabled: true }), true);
  assert.equal(controller.shouldAnimate(), true);
  assert.notDeepEqual(controller.group.children[0].instanceMatrix.array, first);
  for (const mesh of controller.group.children) assert([...mesh.instanceMatrix.array].every(Number.isFinite));
  controller.setTheme(true);
  assert.equal(controller.getStats().drawCalls, 4);
  const outside = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().makeOrthographic(100, 102, 102, 100, 0.1, 10));
  controller.update(0, { frustum: outside });
  assert.equal(controller.shouldAnimate(), false);
  assert.equal(controller.getStats().visibleRouteCount, 0);
  controller.setEnabled(false);
  assert.equal(controller.shouldAnimate(), false);
  assert.equal(controller.update(100), false);
  controller.dispose(); controller.dispose();
  assert.equal(controller.group.children.length, 0);
});

check('the complete city source remains unchanged and produces at most 36 vehicles', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../public/data/city.json', import.meta.url), 'utf8'));
  const before = JSON.stringify(data.roads);
  function ringContains(x, z, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  const water = data.water.map(polygon => {
    const rings = polygon.rings || [polygon.ring], outer = rings[0];
    return { rings, minX: Math.min(...outer.map(p => p[0])), maxX: Math.max(...outer.map(p => p[0])),
      minZ: Math.min(...outer.map(p => p[1])), maxZ: Math.max(...outer.map(p => p[1])) };
  });
  const inWater = (x, z) => water.some(p => x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ
    && ringContains(x, z, p.rings[0]) && !p.rings.slice(1).some(ring => ringContains(x, z, ring)));
  const result = planTrafficRoutes({ roads: data.roads, inWater, extent: Math.max(data.meta.width, data.meta.depth),
    worldUnitsPerMeter: data.meta.unitsPerMeter });
  assert(result.vehicles.length > 0 && result.vehicles.length <= 36);
  assert(result.routes.length <= 18);
  for (const route of result.routes) {
    const source = data.roads[route.sourceRoadIndex];
    assert.deepEqual(route.a, source.points[route.sourceSegmentIndex]);
    assert.deepEqual(route.b, source.points[route.sourceSegmentIndex + 1]);
    for (let n = 0; n <= 100; n++) for (const direction of [-1, 1]) {
      const p = sampleTrafficRoute(route, route.usableLength * n / 100, direction);
      assert(!inWater(p.x, p.z));
    }
  }
  assert.equal(JSON.stringify(data.roads), before);
  const controller = trafficFixture({ roads: data.roads, inWater, worldUnitsPerMeter: data.meta.unitsPerMeter });
  const firstMatrix = new THREE.Matrix4();
  controller.group.children[0].getMatrixAt(0, firstMatrix);
  assert(firstMatrix.elements.every(Number.isFinite));
  controller.dispose();
  console.log(JSON.stringify({ routes: result.routes.length, cars: result.vehicles.length,
    roadNames: [...new Set(result.routes.map(route => route.name))], omitted: result.stats.omitted }));
});

console.log(`${passed} city traffic checks passed; no WebGL rendering was exercised.`);
