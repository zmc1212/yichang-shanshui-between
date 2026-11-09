import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createAuthoredStage } from '../src/scene/authoredModels.js';
import { createLightLoadScheduler } from '../src/scene/modelLoadScheduler.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const spec = id => ({ id, displayHeight: 10, assets: { light: `${id}/light`, detail: `${id}/detail` } });
function asset() {
  let closes = 0, geometryDisposals = 0;
  const bitmap = { width: 4, height: 4, close() { closes++; } };
  // Two different textures share one decoded bitmap, as GLTFLoader can do.
  const color = new THREE.Texture(bitmap), normal = new THREE.Texture(bitmap);
  const material = new THREE.MeshStandardMaterial({ color: '#c5cbb9', map: color, normalMap: normal });
  const geometry = new THREE.BoxGeometry(2, 10, 3);
  geometry.addEventListener('dispose', () => { geometryDisposals++; });
  const object = new THREE.Group(); object.add(new THREE.Mesh(geometry, material));
  return { object, closes: () => closes, geometryDisposals: () => geometryDisposals };
}

// Observe the real loader boundary, rather than the scheduler's internal count.
// A fetched file still owns its slot while its deliberately deferred parser runs.
const scheduler = createLightLoadScheduler({ concurrency: 2 });
const started = [], requests = [], stages = new Map();
let running = 0, peak = 0;
function loadAsset(url, signal) {
  running++; peak = Math.max(peak, running); started.push(url);
  const request = { url, signal, fetched: deferred(), parsed: deferred() }; requests.push(request);
  return (async () => {
    try { await request.fetched.promise; return await request.parsed.promise; }
    finally { running--; }
  })();
}
for (const id of ['A', 'B', 'C', 'D', 'E']) stages.set(id, createAuthoredStage({
  catalog: [spec(id)], showPlinth: false, loadAsset,
  scheduleLight: scheduler.schedule, prioritizeLight: scheduler.prioritize,
}));
const pending = [...stages].map(([id, stage]) => stage.select(id));
await flush();
assert.deepEqual(started, ['A/light', 'B/light']);
assert.equal(running, 2);

const priorityPending = stages.get('E').select('E', { priority: true });
stages.get('C').dispose(); // Cancel while still queued: loadAsset must not run.
const firstA = requests[0];
firstA.fetched.resolve(); await flush();
stages.get('A').dispose(); // A non-abortable parser still has to finish.
assert.equal(firstA.signal.aborted, true);
await flush();
assert.deepEqual(started, ['A/light', 'B/light'], 'Fetch completion/abort must not release a still-parsing slot');
const lateA = asset(); firstA.parsed.resolve(lateA.object);
await pending[0]; await flush();
assert.deepEqual(started, ['A/light', 'B/light', 'E/light'], 'Focused queued model must run next');
assert.equal(lateA.closes(), 1, 'Late parser output must close a shared bitmap exactly once');
assert.equal(lateA.geometryDisposals(), 1);

requests[1].fetched.reject(new Error('deliberate transport failure'));
await pending[1]; await flush();
assert.deepEqual(started, ['A/light', 'B/light', 'E/light', 'D/light']);
stages.get('B').retry(); await flush();
assert.equal(requests.filter(r => r.url === 'B/light').length, 1, 'Retry must wait for an occupied global slot');
assert.equal(running, 2);
const retryPending = stages.get('B').select('B', { priority: true });
const readyE = asset(), requestE = requests.find(r => r.url === 'E/light');
requestE.fetched.resolve(); requestE.parsed.resolve(readyE.object);
await priorityPending; await flush();
assert.deepEqual(started, ['A/light', 'B/light', 'E/light', 'D/light', 'B/light']);
const readyD = asset(), readyB = asset();
const requestD = requests.find(r => r.url === 'D/light'), retryB = requests.filter(r => r.url === 'B/light')[1];
requestD.fetched.resolve(); requestD.parsed.resolve(readyD.object);
retryB.fetched.resolve(); retryB.parsed.resolve(readyB.object);
await Promise.all([...pending, retryPending]); await flush();
assert.equal(peak, 2, 'Five real light loaders, focus and retry must never exceed two concurrent loads');
assert.equal(running, 0);
assert.equal(started.includes('C/light'), false, 'An aborted queued model must never invoke its loader');
assert.equal(stages.get('B').getStats().quality, 'light');
for (const stage of stages.values()) stage.dispose();
assert.equal(readyB.closes(), 1); assert.equal(readyD.closes(), 1); assert.equal(readyE.closes(), 1);
scheduler.dispose();

// Detail uses the existing single-building owner. Exercise both stale parser
// disposal and a normal ready -> light -> dispose cycle, with shared bitmaps.
const light = asset(), detailRequests = [];
const detailStage = createAuthoredStage({
  catalog: [spec('F')], showPlinth: false,
  loadAsset(url, signal) {
    if (url.endsWith('/light')) return Promise.resolve(light.object);
    const result = deferred(); detailRequests.push({ result, signal }); return result.promise;
  },
});
await detailStage.select('F');
detailStage.setDetailWanted(true); await flush();
detailStage.releaseDetail();
assert.equal(detailRequests[0].signal.aborted, true);
const staleDetail = asset(); detailRequests[0].result.resolve(staleDetail.object); await flush();
assert.equal(staleDetail.closes(), 1);
assert.equal(detailStage.getStats().quality, 'light'); assert.equal(light.closes(), 0);
detailStage.setDetailWanted(true); await flush();
const currentDetail = asset(); detailRequests[1].result.resolve(currentDetail.object); await flush();
assert.equal(detailStage.getStats().quality, 'detail');
detailStage.releaseDetail(); detailStage.releaseDetail();
assert.equal(currentDetail.closes(), 1);
assert.equal(currentDetail.geometryDisposals(), 1);
assert.equal(detailStage.getStats().quality, 'light'); assert.equal(light.closes(), 0);
detailStage.dispose(); detailStage.dispose();
assert.equal(light.closes(), 1); assert.equal(currentDetail.closes(), 1); assert.equal(staleDetail.closes(), 1);

console.log(JSON.stringify({
  pass: true, lightPeak: peak, lightLoaderStarts: started,
  checked: ['five-controller global limit', 'focus priority', 'retry limit', 'queued abort', 'slot held through deferred parse', 'late bitmap disposal', 'shared bitmap closes once', 'detail release preserves resident light'],
}, null, 2));
