import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AUTHORED_MODELS, createAuthoredStage, prepareAuthoredModel } from '../src/scene/authoredModels.js';

// Exercise real GLB parsing and observable exhibition behavior without a GPU.
// Requests are deliberately deferred so navigation/failure/disposal can happen
// during loading. These checks do not assert visual or device performance QA.
const spec = AUTHORED_MODELS[0], loader = new GLTFLoader();
const files = Object.fromEntries(['light', 'detail'].map(tier => [tier, fs.readFileSync(`public/models/shouxin-s01/${tier}.glb`)]));
const passed = [];
const settle = () => new Promise(resolve => setImmediate(resolve));
async function parse(tier) {
  const bytes = files[tier];
  return (await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
}
function approx(a, b, message) { assert(Math.abs(a - b) < 0.00002, `${message}: ${a} != ${b}`); }
function geometryBounds(object) { object.updateMatrixWorld(true); return new Box3().setFromObject(object); }
function watchDisposal(object) {
  const resources = new Map();
  const watch = value => {
    if (!value || resources.has(value)) return;
    resources.set(value, 0);
    value.addEventListener('dispose', () => resources.set(value, resources.get(value) + 1));
  };
  object.traverse(child => {
    watch(child.geometry);
    for (const material of Array.isArray(child.material) ? child.material : child.material ? [child.material] : []) {
      watch(material);
      for (const value of Object.values(material)) if (value?.isTexture) watch(value);
    }
  });
  return {
    object,
    assertDisposed() { assert(resources.size > 0); for (const count of resources.values()) assert.equal(count, 1, 'Every owned resource must be disposed exactly once'); },
    assertLive() { for (const count of resources.values()) assert.equal(count, 0, 'Visible/cached resources must remain live'); },
  };
}
function harness(catalog = AUTHORED_MODELS) {
  const requests = [], statuses = [];
  let changes = 0;
  const stage = createAuthoredStage({
    catalog, onStatus: status => statuses.push(status), onChange: () => { changes++; },
    loadAsset(url, signal) {
      const request = { url, signal, tier: url.includes('/detail.glb') ? 'detail' : 'light', completed: false };
      requests.push(request);
      return new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; });
    },
  });
  return {
    stage, requests, statuses,
    async complete(index) {
      const request = requests[index]; assert(request && !request.completed);
      request.watched ||= watchDisposal(await parse(request.tier));
      request.completed = true; request.resolve(request.watched.object); await settle();
      return request.watched;
    },
    async fail(index) { const request = requests[index]; assert(request && !request.completed); request.completed = true; request.reject(new Error('Controlled asset failure')); await settle(); },
    get latest() { return statuses.at(-1); },
    get changeCount() { return changes; },
  };
}

// Real source geometry must be uniformly scaled; neither LOD may jump in size
// or origin when swapped after the camera has already framed the model.
{
  const bounds = [];
  for (const tier of ['light', 'detail']) {
    const raw = await parse(tier), before = geometryBounds(raw).getSize(new Vector3());
    const prepared = prepareAuthoredModel(raw, spec), after = geometryBounds(prepared);
    const size = after.getSize(new Vector3()), center = after.getCenter(new Vector3());
    assert.equal(prepared.scale.x, prepared.scale.y); assert.equal(prepared.scale.y, prepared.scale.z);
    approx(size.y, spec.displayHeight, `${tier} display height`);
    approx(size.x / size.y, before.x / before.y, `${tier} facade aspect`);
    approx(size.z / size.y, before.z / before.y, `${tier} depth aspect`);
    approx(after.min.y, 0, `${tier} floor anchor`); approx(center.x, 0, `${tier} center x`); approx(center.z, 0, `${tier} center z`);
    raw.traverse(child => { if (child.isMesh) { assert(child.material.flatShading); assert(!child.material.transparent); assert.equal(child.userData.landmarkId, spec.id); } });
    bounds.push(after);
  }
  bounds[0].min.toArray().forEach((value, i) => approx(value, bounds[1].min.toArray()[i], 'LOD min'));
  bounds[0].max.toArray().forEach((value, i) => approx(value, bounds[1].max.toArray()[i], 'LOD max'));
  passed.push('Real GLBs preserve aspect ratios, common anchor and 16-unit uniform display height');
}

{
  const h = harness();
  assert.equal(h.requests.length, 0); assert(!h.stage.group.visible);
  h.stage.select(spec.id);
  assert.deepEqual(h.requests.map(r => r.tier), ['light']);
  assert.equal(h.stage.getActiveMeshes().length, 0);
  const light = await h.complete(0);
  assert.equal(h.stage.getStats().quality, 'light'); assert.equal(h.stage.getActiveMeshes().length, 18);
  h.stage.setDetailWanted(true);
  assert.deepEqual(h.requests.map(r => r.tier), ['light', 'detail']);
  assert.equal(h.stage.getStats().quality, 'light', 'Keep the light model visible while detail loads');
  h.stage.setDetailWanted(false);
  const detail = await h.complete(1);
  assert.equal(h.stage.getStats().quality, 'light', 'A delayed detail response must not override a newer overview choice');
  assert.equal(h.stage.getActiveMeshes().length, 18);
  h.stage.select(spec.id, { detail: true });
  assert.equal(h.requests.length, 2, 'Reuse detail already loaded for the current selection');
  assert.equal(h.stage.getStats().quality, 'detail'); assert.equal(h.stage.getActiveMeshes().length, 19);
  light.assertLive(); detail.assertLive();
  h.stage.hide();
  assert(!h.stage.group.visible); assert.equal(h.stage.getActiveMeshes().length, 0); assert.equal(h.stage.getStats().loaded.length, 0);
  light.assertDisposed(); detail.assertDisposed(); h.stage.dispose();
  passed.push('Light first, detail on demand, no late-quality override, reuse and release');
}

{
  const h = harness();
  h.stage.select(spec.id, { detail: true });
  h.stage.select(spec.id, { detail: false });
  assert.equal(h.requests.length, 1, 'Repeated same-ID selection must not duplicate an in-flight light request');
  const asset = await h.complete(0);
  assert.equal(h.requests.length, 1, 'A cancelled near-view intention must not start a detail request after light arrives');
  assert.equal(h.stage.getStats().quality, 'light');
  h.stage.dispose(); asset.assertDisposed();
  passed.push('Rapid near/back before light completion honors the latest intent');
}

{
  const h = harness();
  h.stage.select(spec.id, { detail: true });
  const light = await h.complete(0);
  assert.equal(h.requests[1].tier, 'detail');
  await h.fail(1);
  assert.equal(h.latest.detailState, 'error'); assert.equal(h.stage.getStats().quality, 'light');
  assert.equal(h.stage.getActiveMeshes().length, 18); light.assertLive();
  h.stage.select(spec.id, { detail: true }); await settle();
  assert.equal(h.requests.length, 2, 'A detail failure must not trigger an automatic retry loop');
  h.stage.retry(); await settle();
  assert.equal(h.requests.length, 3); assert.equal(h.requests[2].tier, 'detail');
  const detail = await h.complete(2);
  assert.equal(h.latest.detailState, 'ready'); assert.equal(h.stage.getStats().quality, 'detail');
  h.stage.dispose(); light.assertDisposed(); detail.assertDisposed();
  passed.push('Detail failure preserves light; explicit retry restores complete detail');
}

{
  const h = harness();
  h.stage.select(spec.id);
  await h.fail(0);
  assert.equal(h.latest.state, 'error'); assert.equal(h.stage.getActiveMeshes().length, 0);
  h.stage.retry(); await settle();
  assert.equal(h.requests.length, 2);
  const asset = await h.complete(1);
  assert.equal(h.latest.state, 'ready'); assert.equal(h.stage.getStats().quality, 'light');
  h.stage.dispose(); asset.assertDisposed();
  passed.push('Initial model failure remains recoverable with an explicit retry');
}

{
  const other = { ...spec, id: `${spec.id}-other` }, h = harness([spec, other]);
  h.stage.select(spec.id, { detail: true });
  h.stage.select(other.id);
  assert(h.requests[0].signal.aborted, 'Changing the selection must abort the previous request');
  const stale = await h.complete(0);
  stale.assertDisposed(); assert.equal(h.stage.getActiveMeshes().length, 0);
  assert.equal(h.stage.getStats().activeId, other.id); assert.equal(h.requests.length, 2);
  const current = await h.complete(1);
  assert.equal(h.stage.getStats().quality, 'light');
  for (const mesh of h.stage.getActiveMeshes()) assert.equal(mesh.userData.landmarkId, other.id);
  h.stage.dispose(); current.assertDisposed();
  passed.push('Changing ID aborts and disposes a stale parse without resurrecting the old selection');
}

{
  const h = harness();
  h.stage.select(spec.id);
  h.stage.hide();
  assert(h.requests[0].signal.aborted);
  h.stage.select(spec.id);
  const newest = await h.complete(1), changes = h.changeCount;
  const oldest = await h.complete(0);
  oldest.assertDisposed(); newest.assertLive();
  assert.equal(h.changeCount, changes, 'A stale same-ID parse must not mutate the new stage');
  assert.equal(h.stage.getStats().quality, 'light'); assert.equal(h.stage.getActiveMeshes().length, 18);
  h.stage.dispose(); newest.assertDisposed();
  passed.push('Leave and re-enter the same ID rejects the old request generation');
}

{
  const h = harness();
  h.stage.select(spec.id, { detail: true });
  const light = await h.complete(0);
  h.stage.dispose();
  const changes = h.changeCount, statusCount = h.statuses.length;
  assert(h.requests[1].signal.aborted); light.assertDisposed();
  const late = await h.complete(1);
  late.assertDisposed(); assert.equal(h.changeCount, changes); assert.equal(h.statuses.length, statusCount);
  assert.equal(h.stage.getActiveMeshes().length, 0); assert.equal(h.stage.getStats().loaded.length, 0);
  h.stage.select(spec.id); assert.equal(h.requests.length, 2, 'Disposed stage must not start requests');
  h.stage.dispose(); light.assertDisposed(); late.assertDisposed();
  passed.push('Dispose releases loaded assets and late parse results without callbacks or new requests');
}

{
  // Simulate a parse that outlives the resource timeout: the fetch has already
  // completed, so aborting does not itself reject its outstanding parse promise.
  const h = harness(), originalSetTimeout = globalThis.setTimeout;
  let expire;
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay === 20000) { expire = () => callback(...args); return { simulatedTimer: true }; }
    return originalSetTimeout(callback, delay, ...args);
  };
  try { h.stage.select(spec.id); } finally { globalThis.setTimeout = originalSetTimeout; }
  assert(expire); expire(); assert(h.requests[0].signal.aborted);
  const late = await h.complete(0);
  late.assertDisposed(); assert.equal(h.latest.state, 'error', 'A timed-out parse must leave loading and expose retry');
  assert.equal(h.stage.getActiveMeshes().length, 0);
  h.stage.retry(); await settle();
  const recovered = await h.complete(1);
  assert.equal(h.latest.state, 'ready'); assert.equal(h.stage.getStats().quality, 'light');
  h.stage.dispose(); recovered.assertDisposed();
  passed.push('Parse timeout enters recoverable error instead of permanent loading');
}

console.log(JSON.stringify({ passed: true, webglVerified: false, physicalPhoneVerified: false, checks: passed }, null, 2));
