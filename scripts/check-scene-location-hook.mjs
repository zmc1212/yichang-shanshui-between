import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SCENE_LOCATION_DEFAULTS, normalizeSceneLocation, readSceneLocation, serializeSceneLocation } from '../src/lib/sceneLocation.js';

// Exercise the production hook with a deferred render/effect boundary and the
// browser's public history behavior. Only React's two hook primitives and the
// window transport are replaced; none of the location synchronization logic is
// copied, and no private tracking refs are inspected. An optional source path
// permits checking that this regression fails against the previous hook.
const source = fs.readFileSync(process.argv[2] || new URL('../src/hooks/useSceneLocation.js', import.meta.url), 'utf8');
const createHook = new Function('useRef', 'useEffect', 'normalizeSceneLocation', 'readSceneLocation', 'serializeSceneLocation', 'window',
  source.replace(/^import[^\n]*\n/gm, '').replace('export function useSceneLocation', 'function useSceneLocation') + '\nreturn useSceneLocation;');
const places = [
  { id: 'yichang-international-s01', kind: 'authored' },
  { id: 'shouxin-wealth-s01', kind: 'authored' },
  { id: 'wanda-soho-s01', kind: 'authored' },
];
const stateFor = (place, extra = {}) => normalizeSceneLocation({ ...SCENE_LOCATION_DEFAULTS, place, ...extra }, places);
const urlFor = state => 'https://scene.example.test/#' + serializeSceneLocation(state, places);
const frontage = stateFor('yichang-international-s01', { angle: 'frontage', close: true });
const whole = stateFor('yichang-international-s01', { close: true });
const shouxin = stateFor('shouxin-wealth-s01', { close: true });
const entrance = stateFor('shouxin-wealth-s01', { angle: 'entrance', close: true });

function historyWindow(url) {
  const window = new EventTarget(), entries = [{ url: new URL(url).href, state: null }], writes = [];
  let index = 0;
  Object.defineProperty(window, 'location', { get: () => new URL(entries[index].url) });
  const write = (method, state, url) => {
    const entry = { url: new URL(url, window.location).href, state };
    if (method === 'pushState') { entries.splice(index + 1); entries.push(entry); index++; }
    else entries[index] = entry;
    writes.push({ method, url: entry.url });
  };
  const go = delta => {
    const next = index + delta;
    if (next < 0 || next >= entries.length) return;
    const previousHash = window.location.hash;
    index = next;
    window.dispatchEvent(new Event('popstate'));
    // A fragment traversal also emits hashchange. The hook must not restore
    // the same entry twice while React's next render is still pending.
    if (previousHash !== window.location.hash) window.dispatchEvent(new Event('hashchange'));
  };
  window.history = {
    get state() { return entries[index].state; },
    get length() { return entries.length; },
    pushState(state, unused, url) { write('pushState', state, url); },
    replaceState(state, unused, url) { write('replaceState', state, url); },
    back() { go(-1); }, forward() { go(1); },
  };
  return { window, writes };
}

function mount({ url, initialState = SCENE_LOCATION_DEFAULTS, apply = state => state, returnsState = true }) {
  const transport = historyWindow(url), slots = [], restored = [];
  let cursor = 0, effects = [], queuedState = null, state = { ...initialState };
  function useRef(initial) {
    const index = cursor++;
    return slots[index] ||= { current: initial };
  }
  function useEffect(effect, dependencies) {
    const index = cursor++, previous = slots[index];
    const changed = !previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]));
    const slot = slots[index] ||= {};
    slot.dependencies = [...dependencies];
    if (changed) effects.push(() => { slot.cleanup?.(); slot.cleanup = effect(); });
  }
  const hook = createHook(useRef, useEffect, normalizeSceneLocation, readSceneLocation, serializeSceneLocation, transport.window);
  const onRestore = (requested, metadata) => {
    const applied = normalizeSceneLocation(apply(requested), places);
    restored.push({ requested, applied, metadata });
    // App state commits after both effects from the current render have run.
    queuedState = applied;
    if (returnsState) return applied;
  };
  function render() {
    cursor = 0; effects = [];
    hook({ ready: true, places, state, onRestore });
    const pendingEffects = effects; effects = [];
    for (const effect of pendingEffects) effect();
  }
  function settle() {
    let renders = 0;
    while (queuedState) {
      assert.ok(++renders < 20, 'Location restoration must settle');
      state = queuedState; queuedState = null; render();
    }
  }
  render(); settle();
  return {
    ...transport, restored,
    get state() { return state; },
    choose(next) { state = { ...next }; render(); settle(); },
    back() { transport.window.history.back(); settle(); },
    forward() { transport.window.history.forward(); settle(); },
    unmount() { for (const slot of slots) slot.cleanup?.(); },
  };
}

const checks = [];
const downgradeFrontage = state => state.angle === 'frontage' ? { ...state, angle: 'detail' } : state;
const unsupported = mount({ url: urlFor(frontage), apply: downgradeFrontage });
assert.deepEqual(unsupported.state, whole);
assert.equal(unsupported.window.location.href, urlFor(whole), 'An unsupported runtime preset must canonicalize to the applied state');
assert.equal(unsupported.window.history.length, 1, 'Restoration must replace its entry, not create a second one');
assert.equal(unsupported.restored.length, 1, 'Restore callback runs once on initial load');
unsupported.choose(shouxin);
assert.equal(unsupported.window.location.href, urlFor(shouxin), 'Runtime downgrade must not leave pending state blocking later selection');
assert.equal(unsupported.window.history.length, 2, 'A later place selection creates a history entry');
unsupported.choose(entrance);
assert.equal(unsupported.window.location.href, urlFor(entrance));
assert.equal(unsupported.window.history.length, 2, 'Changing a view keeps the selected place history entry');
unsupported.back();
assert.deepEqual(unsupported.state, whole, 'Back restores the canonical whole-building view');
assert.equal(unsupported.restored.length, 2, 'popstate plus hashchange restores once');
unsupported.forward();
assert.deepEqual(unsupported.state, entrance, 'Forward restores the later place and its view');
assert.equal(unsupported.restored.length, 3);
assert.equal(unsupported.window.history.length, 2, 'Back/forward must not duplicate entries');
checks.push('runtime frontage downgrade canonicalizes without locking later selections', 'place push and view replace remain distinct', 'back/forward restore once without duplicating history');

const equivalent = mount({ url: urlFor(frontage), initialState: whole, apply: downgradeFrontage });
assert.deepEqual(equivalent.state, whole);
assert.equal(equivalent.window.location.href, urlFor(whole), 'A downgraded target already equal to UI state must update the URL without relying on a changed render key');
assert.equal(equivalent.writes.length, 1);
assert.equal(equivalent.writes[0].method, 'replaceState');
equivalent.choose(shouxin);
assert.equal(equivalent.window.history.length, 2);
checks.push('equivalent applied state canonicalizes even when the render key does not change');

const legacy = mount({ url: urlFor(frontage), returnsState: false });
assert.deepEqual(legacy.state, frontage, 'A callback with no return preserves the existing requested-state contract');
assert.equal(legacy.window.location.href, urlFor(frontage));
legacy.choose(shouxin); legacy.back();
assert.deepEqual(legacy.state, frontage);
legacy.forward();
assert.deepEqual(legacy.state, shouxin);
assert.equal(legacy.window.history.length, 2);
checks.push('legacy void callback retains supported frontage and browser navigation');

const redirected = mount({ url: urlFor(frontage), apply: () => ({ ...SCENE_LOCATION_DEFAULTS }) });
assert.equal(redirected.window.location.hash, '', 'The returned applied state may also replace a no-longer-available place');
assert.equal(redirected.window.history.length, 1);
redirected.choose(whole);
assert.equal(redirected.window.history.length, 2, 'lastPlace must use the applied place, so a subsequent selection pushes history');
checks.push('returned place fallback also updates history ownership');

for (const harness of [unsupported, equivalent, legacy, redirected]) {
  const before = harness.restored.length;
  harness.unmount();
  harness.window.history.back();
  assert.equal(harness.restored.length, before, 'Unmount removes navigation listeners');
}
checks.push('unmount removes both navigation subscriptions');
console.log(JSON.stringify({ pass: true, checks }, null, 2));
