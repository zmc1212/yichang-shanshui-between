import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createFocusedSunShadow } from '../src/scene/focusedSunShadow.js';

// Tests real Three light/camera matrices; no stubbed geometry or GPU claims.
const extent = 315.903, unitsPerMeter = .02;
const sun = new THREE.DirectionalLight();
const scene = new THREE.Scene(); scene.add(sun, sun.target);
const renderer = { shadowMap: { autoUpdate: false, needsUpdate: false } };
const shadows = createFocusedSunShadow({ sun, renderer, extent });
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, extent * 16);
const day = new THREE.Vector3(-.55, 1.3, .65).multiplyScalar(extent);
const sunset = new THREE.Vector3(-1.08, .58, .48).multiplyScalar(extent);
const target = new THREE.Vector3(-8.2, 1.1, 18.1);
const direction = new THREE.Vector3(.62, .98, .84).normalize();
let now = 0;

function view(focus = target, viewDirection = direction) {
  camera.position.copy(focus).addScaledVector(viewDirection, extent * 1.6);
  camera.lookAt(focus); camera.updateMatrixWorld();
}
function update(options = {}) {
  return shadows.update({ target, camera, visibleHeight: 14, aspect: 1.8, sunOffset: day,
    settled: true, time: now, ...options });
}
function clipPoint(point) {
  return point.clone().applyMatrix4(sun.shadow.camera.matrixWorldInverse)
    .applyMatrix4(sun.shadow.camera.projectionMatrix);
}
function verifyReceivers({ focus, height, aspect, offset }) {
  scene.updateMatrixWorld(true); sun.shadow.updateMatrices(sun);
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const viewDirection = camera.getWorldDirection(new THREE.Vector3()).negate();
  const lightDirection = offset.clone().normalize();
  let count = 0;
  for (const sx of [-1, -.5, 0, .5, 1]) for (const sy of [-1, -.5, 0, .5, 1]) {
    const screen = focus.clone().addScaledVector(right, sx * height * aspect / 2).addScaledVector(up, sy * height / 2);
    const ground = screen.clone().addScaledVector(viewDirection, -screen.y / viewDirection.y);
    const points = [ground];
    if (screen.y >= 0 && screen.y <= extent * .12) points.push(screen);
    for (const point of points) {
      if (Math.abs(point.x) > extent / 2 || Math.abs(point.z) > extent / 2) continue;
      for (const sample of [point, point.clone().addScaledVector(lightDirection, 13.5 / lightDirection.y)]) {
        const p = clipPoint(sample);
        assert(Math.abs(p.x) <= 1 + 1e-9 && Math.abs(p.y) <= 1 + 1e-9,
          `Visible receiver or its caster clipped in light XY: ${p.toArray()}`);
        assert(p.z >= -1 - 1e-9 && p.z <= 1 + 1e-9, `Caster clipped in depth: ${p.z}`);
        count++;
      }
    }
  }
  return count;
}

view();
assert(update({ visibleHeight: 330 }));
const wide = shadows.getStats();
assert.equal(wide.mode, 'overview');
assert.equal(sun.shadow.camera.left, -extent * .78);
assert.equal(sun.shadow.camera.right, extent * .78);
assert.equal(sun.shadow.camera.near, 1); assert.equal(sun.shadow.camera.far, extent * 4);
assert.equal(sun.shadow.normalBias, .08); assert.equal(sun.shadow.bias, -.0001);
assert(sun.target.position.equals(new THREE.Vector3()));
assert(sun.position.equals(day));

now += 200;
const cameraBefore = JSON.stringify({ position: camera.position, quaternion: camera.quaternion, up: camera.up,
  zoom: camera.zoom, projection: camera.projectionMatrix });
assert(update());
const focused = shadows.getStats();
assert.equal(focused.mode, 'focused');
assert(focused.texelWorld < wide.texelWorld / 8, 'Neighborhood shadow improves linear resolution by at least 8×');
assert(focused.normalBias < .01, 'Near shadow no longer offsets surfaces by four real-world meters');
assert(sun.position.clone().sub(sun.target.position).distanceTo(day) < 1e-10, 'Moving focus keeps lighting direction');
assert.equal(JSON.stringify({ position: camera.position, quaternion: camera.quaternion, up: camera.up,
  zoom: camera.zoom, projection: camera.projectionMatrix }), cameraBefore, 'Viewer camera remains unchanged');
let testedPoints = verifyReceivers({ focus: target, height: 14, aspect: 1.8, offset: day });

// A resting scene must not invalidate the map again; sub-texel camera noise
// also stays on its snapped light-space position.
const stableUpdates = shadows.getStats().updates;
for (let i = 0; i < 20; i++) {
  now += 16; renderer.shadowMap.needsUpdate = false;
  assert.equal(update(), false); assert.equal(renderer.shadowMap.needsUpdate, false);
}
const jitter = target.clone().addScalar(1e-7);
view(jitter);
assert.equal(update({ target: jitter }), false);
assert.equal(shadows.getStats().updates, stableUpdates);

// A moving orbit/flight throttles expensive map renders, but the final frame
// commits immediately, without a timer or a permanent animation loop.
const moved = target.clone().add(new THREE.Vector3(3, 0, 2));
view(moved); now += 200; assert(update({ target: moved, settled: false }));
const movingUpdates = shadows.getStats().updates;
const movedAgain = moved.clone().add(new THREE.Vector3(2, 0, 1));
view(movedAgain); now += 30; renderer.shadowMap.needsUpdate = false;
assert.equal(update({ target: movedAgain, settled: false }), false);
assert.equal(shadows.getStats().deferred, true);
assert.equal(renderer.shadowMap.needsUpdate, false);
assert.equal(shadows.getStats().updates, movingUpdates);
now += 1; assert(update({ target: movedAgain, settled: true }));
assert.equal(shadows.getStats().deferred, false);

// Light changes bypass motion throttling. Slanted sunset rays still include
// receivers and off-screen casting roofs up to the scene's 13.5-unit GIS cap.
now += 1;
assert(update({ target: movedAgain, sunOffset: sunset, settled: false }));
testedPoints += verifyReceivers({ focus: movedAgain, height: 14, aspect: 1.8, offset: sunset });
const sunsetDirection = sun.position.clone().sub(sun.target.position);
assert(sunsetDirection.distanceTo(sunset) < 1e-10);

// Reapplying the same weather preset may set the absolute light position.
// Restore its focus-relative transform even if the cached projection matches.
sun.position.copy(sunset); now += 1;
assert(update({ target: movedAgain, sunOffset: sunset, settled: false }));
assert(sun.position.clone().sub(sun.target.position).distanceTo(sunset) < 1e-10);

for (const sample of [
  { focus: new THREE.Vector3(-6, .8, 20), direction: new THREE.Vector3(.5, .25, 1).normalize(), height: 3.2, aspect: 1.8 },
  { focus: new THREE.Vector3(-6, 2.1, 20), direction: new THREE.Vector3(.4, .8, 1).normalize(), height: .9, aspect: .56 },
  { focus: new THREE.Vector3(140, 1.2, 140), direction: new THREE.Vector3(.62, .98, .84).normalize(), height: 14, aspect: 1.7 },
]) {
  view(sample.focus, sample.direction); now += 200;
  assert(update({ target: sample.focus, visibleHeight: sample.height, aspect: sample.aspect, sunOffset: sunset }));
  assert.equal(shadows.getStats().mode, 'focused');
  testedPoints += verifyReceivers({ ...sample, offset: sunset });
}

// Horizon and overview framing retain safe complete-board coverage.
view(target, new THREE.Vector3(1, .05, 1).normalize()); now += 200;
assert(update()); assert.equal(shadows.getStats().mode, 'overview');
renderer.shadowMap.needsUpdate = false;
assert.equal(update({ visibleHeight: NaN }), false);
assert.equal(update({ sunOffset: [0, 0, 0] }), false);
assert.equal(renderer.shadowMap.needsUpdate, false);
assert.equal(renderer.shadowMap.autoUpdate, false);
assert.equal(scene.children.length, 2, 'No additional lights, scene geometry or shadow passes are created');
assert.deepEqual(sun.shadow.mapSize.toArray(), [2048, 2048]);

console.log(JSON.stringify({ status: 'passed', projectedReceiverAndCasterChecks: testedPoints,
  overviewTexelMeters: wide.texelWorld / unitsPerMeter,
  neighborhoodTexelMeters: focused.texelWorld / unitsPerMeter,
  neighborhoodNormalBiasMeters: focused.normalBias / unitsPerMeter,
  shadowMap: 'one existing 2048² directional map',
  coverage: ['overview', 'district', 'street', 'portrait facade', 'board edge', 'sunset', 'horizon'],
  lifecycle: ['stationary reuse', 'sub-texel snap', 'moving throttle', 'final-frame commit', 'environment repair'],
  limit: 'Projection/lifecycle checks only; image quality and GPU timings require the production browser' }, null, 2));
