import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { normalizeEnvironment, environmentProfile, terrainColorFactors, addRiverSurface, createRainEffect } from '../src/scene/atmosphere.js';

const checks = [];
assert.deepEqual(normalizeEnvironment({ weather: 'rain' }, { timeOfDay: 'sunset', weather: 'clear' }), { timeOfDay: 'sunset', weather: 'rain' });
assert.deepEqual(normalizeEnvironment({ timeOfDay: '<unknown>', weather: null }, { timeOfDay: 'night', weather: 'mist' }), { timeOfDay: 'night', weather: 'mist' });
assert.deepEqual(normalizeEnvironment(null), { timeOfDay: 'day', weather: 'clear' });
for (const timeOfDay of ['day', 'sunset', 'night']) for (const weather of ['clear', 'overcast', 'mist', 'rain']) {
  const profile = environmentProfile({ timeOfDay, weather });
  assert.ok(profile.sun > 0 && profile.hemisphere > 0);
  assert.ok(profile.sky.isColor && profile.sky.toArray().every(Number.isFinite));
  assert.equal(profile.lamps, timeOfDay !== 'day');
  assert.ok(profile.roughness > 0 && profile.roughness <= 1);
  if (profile.fog) assert.ok(profile.fog[1] > profile.fog[0] && profile.fog[0] > 1);
}
assert.ok(environmentProfile({ timeOfDay: 'sunset' }).sunPosition[1] < environmentProfile({ timeOfDay: 'day' }).sunPosition[1]);
assert.ok(environmentProfile({ weather: 'rain' }).sun < environmentProfile({ weather: 'clear' }).sun);
checks.push('all twelve authored light/weather combinations are finite, weather updates preserve time, and sunset changes the sun angle');

const flat = terrainColorFactors({ x: 5, z: 9, height: 0, slope: 0 });
const hill = terrainColorFactors({ x: 5, z: 9, height: 5, slope: .4 });
assert.ok(hill.every((value, index) => value < flat[index]));
assert.ok([...flat, ...hill].every(value => value > .6 && value < 1.1));
const material = new THREE.MeshStandardMaterial();
const river = addRiverSurface(material);
const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
material.onBeforeCompile(shader);
assert.ok(shader.vertexShader.includes('vRiverPosition = position.xz;'));
assert.ok(shader.fragmentShader.includes('float glint ='));
assert.ok(shader.fragmentShader.includes('#include <tonemapping_fragment>'), 'water preserves standard lighting and output color conversion');
river.setEnvironment({ timeOfDay: 'sunset', weather: 'rain' });
assert.equal(shader.uniforms.uRiverSunset.value, 1); assert.equal(shader.uniforms.uRiverRain.value, 1);
river.update(500); assert.ok(river.getStats().time <= .06, 'long suspended intervals cannot jump water time');
assert.equal(river.getStats().textures, 0);
checks.push('terrain tint shades existing relief; the river augments the installed standard material without textures or replacing its lighting/output pipeline');

const rain = createRainEffect({ width: 60, depth: 40, heightAt: (x, z) => Math.max(0, x * .03 + z * .02) });
assert.equal(rain.group.visible, false);
rain.setEnvironment({ timeOfDay: 'night', weather: 'rain' });
rain.setViewport({ target: { x: 29, y: 18, z: -19 }, visibleHeight: 4, aspect: .65 });
rain.update(.033);
const rainGeometry = rain.group.children[0].geometry;
const positions = rainGeometry.attributes.position;
assert.equal(positions.count, 640 * 2);
for (let i = 0; i < positions.count; i++) {
  assert.ok(Number.isFinite(positions.getX(i)) && Number.isFinite(positions.getY(i)) && Number.isFinite(positions.getZ(i)));
  assert.ok(positions.getX(i) >= -30 && positions.getX(i) <= 30 && positions.getZ(i) >= -20 && positions.getZ(i) <= 20);
  assert.ok(positions.getY(i) > 15, 'close-up rain follows the viewed building height');
}
let geometryDisposed = 0; rainGeometry.addEventListener('dispose', () => geometryDisposed++);
rain.dispose(); assert.equal(geometryDisposed, 1); assert.equal(rain.update(.033), false);
checks.push('640 rain strokes remain inside the finite board, follow a tower close-up, and release geometry on disposal');

// Exercise the actual city/controls/queues and environment API, replacing only
// the unavailable GPU renderer and DOM transport. This is not a WebGL render.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'src/scene/createCityScene.js');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'yichang-environment-'));
let time = 0, nextFrame = 1, engine, renderer;
const callbacks = new Map(), requests = [];
const rect = { top: 70, left: 280, width: 1000, height: 730 };
const saved = new Map(['document', 'window', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'fetch', '__EnvironmentRendererProbe'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
class Element extends EventTarget {
  constructor() { super(); this.dataset = {}; this.style = {}; }
  getRootNode() { return documentProbe; }
  getBoundingClientRect() { return { ...rect }; }
  get clientWidth() { return rect.width; }
  get clientHeight() { return rect.height; }
  getContext() { return null; }
  setAttribute() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  remove() {}
  toDataURL() { return 'data:image/png;base64,cHJvYmU='; }
}
const documentProbe = new EventTarget(); documentProbe.hidden = false; documentProbe.createElement = () => new Element();
const media = new EventTarget(); media.matches = false;
class RendererProbe {
  constructor() { renderer = this; this.domElement = new Element(); this.shadowMap = {}; this.info = { render: { calls: 0, triangles: 0 }, memory: {} }; this.frames = 0; }
  setPixelRatio() {}
  setSize() {}
  render(scene, camera) { this.frames++; this.scene = scene; this.camera = camera; scene.updateMatrixWorld(); camera.updateMatrixWorld(); }
  dispose() { this.disposed = true; }
}
function tick(ms = 16) { time += ms; const batch = [...callbacks]; callbacks.clear(); batch.forEach(([, fn]) => fn(time)); }
function settle(limit = 200) {
  let count = 0;
  while (callbacks.size) { assert.ok(count++ < limit, 'a static environment must return to idle'); tick(); }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const globals = {
  document: documentProbe, window: { innerWidth: 1280, devicePixelRatio: 1, matchMedia: () => media },
  performance: { now: () => time }, requestAnimationFrame: fn => { const id = nextFrame++; callbacks.set(id, fn); return id; }, cancelAnimationFrame: id => callbacks.delete(id),
  ResizeObserver: class { observe() {} disconnect() {} },
  fetch: (url, { signal } = {}) => new Promise((resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }); requests.push(url);
  }),
  __EnvironmentRendererProbe: RendererProbe,
};
try {
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  const source = fs.readFileSync(sourcePath, 'utf8').replace('new THREE.WebGLRenderer(', 'new globalThis.__EnvironmentRendererProbe(')
    .replace(/from '([^']+)'/g, (_, specifier) => `from '${specifier.startsWith('.') ? new URL(specifier, pathToFileURL(sourcePath)).href : import.meta.resolve(specifier)}'`);
  const entry = path.join(temporary, 'scene.mjs'); fs.writeFileSync(entry, source);
  const { createCityScene } = await import(pathToFileURL(entry).href);
  const container = new Element(); container.appendChild = () => {}; container.parentElement = { querySelector: () => null };
  const data = JSON.parse(fs.readFileSync(path.join(root, 'public/data/city.json'), 'utf8'));
  engine = createCityScene({ container, data });
  settle(); await flush(); settle();
  assert.equal(callbacks.size, 0); assert.equal(engine.getStats().traffic.enabled, true);
  assert.equal(engine.getStats().traffic.visible, false); assert.equal(requests.length, 2);
  const original = { scene: renderer.scene, canvas: renderer.domElement, models: JSON.stringify(engine.getStats().authoredResidents.map(({ id, position, yaw, uniformScale }) => ({ id, position, yaw, uniformScale }))) };
  const assertSameCity = () => {
    assert.equal(renderer.scene, original.scene); assert.equal(renderer.domElement, original.canvas);
    assert.equal(JSON.stringify(engine.getStats().authoredResidents.map(({ id, position, yaw, uniformScale }) => ({ id, position, yaw, uniformScale }))), original.models);
    assert.equal(requests.length, 2, 'environment changes do not restart the resident asset queue');
  };
  for (const timeOfDay of ['sunset', 'night', 'day']) for (const weather of ['clear', 'overcast', 'mist']) {
    renderer.shadowMap.needsUpdate = false;
    engine.setEnvironment({ timeOfDay, weather }); settle();
    assert.equal(engine.getStats().environment.timeOfDay, timeOfDay); assert.equal(engine.getStats().environment.weather, weather);
    assert.equal(renderer.domElement.dataset.weather, weather); assert.equal(renderer.shadowMap.needsUpdate, true);
    assert.equal(renderer.scene.fog !== null, weather === 'mist'); assertSameCity();
  }
  engine.setTheme('night'); settle();
  assert.equal(engine.getStats().environment.weather, 'mist', 'the legacy day/night control preserves weather');
  engine.setEnvironment({ timeOfDay: 'sunset', weather: 'rain' });
  for (let i = 0; i < 12; i++) tick();
  const rainTime = engine.getStats().environment.rain.elapsed;
  assert.ok(rainTime > 0); assert.equal(callbacks.size, 1);
  const startFrames = renderer.frames;
  for (let i = 0; i < 60; i++) tick();
  assert.ok(renderer.frames - startFrames <= 30, 'rain-only drawing is capped at 30 fps');
  assertSameCity();
  engine.setMotion(false); settle();
  const stoppedRain = engine.getStats().environment.rain.elapsed;
  time += 60000; assert.equal(callbacks.size, 0); assert.equal(engine.getStats().environment.rain.elapsed, stoppedRain);
  engine.setMotion(true); for (let i = 0; i < 8; i++) tick();
  assert.ok(engine.getStats().environment.rain.elapsed > stoppedRain);
  engine.setSuspended(true);
  const held = { frames: renderer.frames, rain: engine.getStats().environment.rain.elapsed };
  tick(10000); assert.equal(callbacks.size, 0); assert.equal(renderer.frames, held.frames);
  assert.equal(engine.getStats().environment.rain.elapsed, held.rain);
  documentProbe.hidden = true; documentProbe.dispatchEvent(new Event('visibilitychange'));
  engine.setSuspended(false); assert.equal(callbacks.size, 0);
  documentProbe.hidden = false; documentProbe.dispatchEvent(new Event('visibilitychange'));
  for (let i = 0; i < 8; i++) tick();
  assert.ok(engine.getStats().environment.rain.elapsed > held.rain && engine.getStats().environment.rain.elapsed - held.rain < .2, 'resume advances local elapsed time without the hidden interval');
  engine.setEnvironment({ weather: 'clear' }); settle();
  assert.equal(callbacks.size, 0); assert.equal(engine.getStats().environment.rain.enabled, false);
  checks.push('actual factory preserves all model transforms and asset queue through environment changes; rain is capped, pauses with motion/overlay/hidden, resumes without a time jump, and clear overview sleeps');

  // Find a visible real-route close-up using normal public camera selection.
  engine.setMotion(false); settle();
  let trafficFocus = null;
  for (const id of ['wanda-soho-s01', 'yichang-international-s01', 'shouxin-wealth-s01', 'jinjiang-s03']) {
    engine.focus(id, { angle: 'frontage', close: true }); settle();
    if (engine.getStats().traffic.visible) { trafficFocus = id; break; }
  }
  assert.ok(trafficFocus, 'one known street close-up must reveal actual traffic routes');
  const trafficMatrix = engine.getStats().traffic.matrixUpdates;
  engine.setMotion(true); for (let i = 0; i < 10; i++) tick();
  assert.ok(engine.getStats().traffic.matrixUpdates > trafficMatrix); assert.equal(callbacks.size, 1);
  engine.setSuspended(true); const trafficHeld = engine.getStats().traffic.matrixUpdates;
  tick(5000); assert.equal(callbacks.size, 0); assert.equal(engine.getStats().traffic.matrixUpdates, trafficHeld);
  engine.setSuspended(false); for (let i = 0; i < 8; i++) tick();
  assert.ok(engine.getStats().traffic.matrixUpdates > trafficHeld);
  documentProbe.hidden = true; documentProbe.dispatchEvent(new Event('visibilitychange'));
  const hiddenTraffic = engine.getStats().traffic.matrixUpdates; tick(5000);
  assert.equal(callbacks.size, 0); assert.equal(engine.getStats().traffic.matrixUpdates, hiddenTraffic);
  documentProbe.hidden = false; documentProbe.dispatchEvent(new Event('visibilitychange'));
  for (let i = 0; i < 8; i++) tick();
  assert.ok(engine.getStats().traffic.matrixUpdates > hiddenTraffic);
  engine.setLayer('traffic', false); settle(); assert.equal(engine.getStats().traffic.visible, false); assert.equal(callbacks.size, 0);
  engine.setLayer('traffic', true); for (let i = 0; i < 8; i++) tick();
  assert.equal(engine.getStats().traffic.visible, true); assert.equal(callbacks.size, 1);
  engine.setMotion(false); settle(); assert.equal(engine.getStats().traffic.moving, false);
  engine.reset(); settle(); assert.equal(engine.getStats().traffic.visible, false);
  engine.setMotion(true); settle(); assert.equal(callbacks.size, 0);
  checks.push(`actual default-enabled traffic appears in ${trafficFocus}, moves only in the visible near view, pauses/resumes across motion/hidden/overlay/layer controls, and overview returns to zero callbacks`);
  engine.setMotion(false); settle();
  assert.equal(engine.focusDistrict({ immediate: true }), true); settle();
  assert.equal(engine.getStats().districtView, true);
  assert.equal(renderer.domElement.dataset.focusAngle, 'riverfront-district');
  assert.equal(engine.getStats().sunlight.mode, 'focused');
  assert.ok(engine.getStats().sunlight.texelWorld < data.meta.width * 1.56 / 2048 / 4, 'district shadows resolve at least four times finer than the full board');
  assert.ok(engine.getStats().urbanBuildings.preparedBuildings > 0 || engine.getStats().buildings > 15000);
  assert.equal(engine.getStats().urbanTerrain.textures, 1);
  assert.ok(engine.getStats().urbanTerrain.treatedPixels > 0);
  assert.ok(engine.getStats().urbanStreetGround.urbanStreetVisibleDrawCalls > 0);
  engine.setLayer('streetDetails', false); settle();
  assert.equal(engine.getStats().urbanStreetGround.urbanStreetVisibleDrawCalls, 0);
  engine.setLayer('streetDetails', true); engine.setView('top'); settle();
  assert.equal(engine.getStats().districtView, true); assert.equal(engine.getStats().view, 'top');
  engine.setView('perspective'); settle();
  assertSameCity(); assert.equal(callbacks.size, 0);
  engine.reset(); settle(); assert.equal(engine.getStats().districtView, false);
  assert.equal(renderer.domElement.dataset.focusAngle, 'overview');
  assert.equal(engine.getStats().urbanStreetGround.urbanStreetVisibleDrawCalls, 0);
  checks.push('actual riverfront camera preserves residents, supports immediate/plan views, reveals bounded street detail and sharper sunlight, respects layers and resets to the idle full board');
  engine.dispose(); assert.equal(callbacks.size, 0); assert.equal(renderer.disposed, true);
  checks.push('disposal cancels the actual frame queue and renderer after atmospheric and traffic motion');
} finally {
  engine?.dispose();
  for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  fs.rmSync(temporary, { recursive: true, force: true }); material.dispose();
}
console.log(JSON.stringify({ passed: checks.length, checks, visualVerification: 'not performed: GPU renderer replaced only for behavioral checks' }, null, 2));
