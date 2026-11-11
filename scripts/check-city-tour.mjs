import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CITY_TOURS, DEFAULT_TOUR_DWELL_MS, TOUR_MODEL_WAIT_MS, createCityTourController } from '../src/lib/cityTour.js';
import { BUSINESS_BUILDINGS } from '../src/scene/buildingCatalog.js';
import { normalizeSceneLocation } from '../src/lib/sceneLocation.js';
import { resolveAuthoredPlacement, planAuthoredGround } from '../src/scene/authoredPlacement.js';
import { resolveBuildingInspection } from '../src/scene/buildingInspection.js';
import { planStreetDetails } from '../src/scene/streetDetails.js';
import { planInternationalStreetSite } from '../src/scene/internationalStreetSite.js';
import { planStreetObservations } from '../src/scene/streetObservation.js';

// Behavioral checks use an independent deterministic event loop. Retaining
// cancelled callbacks also simulates a browser callback already queued when a
// user interrupts a tour. No controller internals are inspected or duplicated.
function clock() {
  let time = 0, sequence = 0;
  const pending = new Map(), history = new Map();
  return {
    now: () => time,
    setTimer(fn, delay) {
      assert(Number.isFinite(delay) && delay >= 0, 'scheduled delay is finite and nonnegative');
      const id = ++sequence;
      pending.set(id, { at: time + delay, fn });
      history.set(id, fn);
      return id;
    },
    clearTimer(id) { pending.delete(id); },
    advance(ms) {
      const end = time + ms;
      let count = 0;
      while (true) {
        const next = [...pending].filter(([, task]) => task.at <= end)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        assert(++count < 1000, 'tour cannot schedule an unbounded synchronous loop');
        time = next[1].at;
        pending.delete(next[0]);
        next[1].fn();
      }
      time = end;
    },
    pendingIds: () => [...pending.keys()],
    fireQueued(id) {
      assert(history.has(id), 'test must reference a real scheduled callback');
      history.get(id)();
    },
  };
}

// Existing behavioral checks deliberately retain their original 14-second
// fixture. Passing {} below exercises the new production default separately.
function setup(options = { dwellMs: 14000 }) {
  const time = clock(), visits = [], changes = [];
  const controller = createCityTourController({
    ...options,
    onVisit: (id, options) => visits.push({ at: time.now(), id, options }),
    onChange: state => changes.push(state),
    now: time.now, setTimer: time.setTimer, clearTimer: time.clearTimer,
  });
  return { controller, time, visits, changes };
}

const checked = [], failures = [];
function check(name, fn) {
  try { fn(); checked.push(name); }
  catch (error) { failures.push({ name, error: error.stack }); }
}

check('Every itinerary visits its published stops in order and stops after the last dwell', () => {
  for (const route of CITY_TOURS) {
    const { controller: tour, time, visits } = setup();
    assert.equal(tour.start(route.id), true);
    assert.equal(visits.length, 1, 'starting visits the first stop immediately');
    for (let index = 0; index < route.stops.length; index++) {
      assert.equal(tour.getState().index, index);
      assert.equal(tour.getState().playing, true);
      const count = visits.length;
      time.advance(13999);
      assert.equal(visits.length, count, 'the current stop receives its full dwell');
      time.advance(1);
    }
    assert.deepEqual(visits.map(visit => visit.id), route.stops.map(stop => stop.id));
    assert.equal(tour.getState().index, route.stops.length - 1);
    assert.equal(tour.getState().complete, true);
    assert.equal(tour.getState().playing, false);
    assert.equal(time.pendingIds().length, 0);
    time.advance(1_000_000);
    assert.equal(visits.length, route.stops.length, 'completion cannot loop or revisit');
    route.stops.forEach((stop, index) => assert.deepEqual(visits[index].options,
      { angle: stop.angle || 'detail', close: Boolean(stop.close), fromTour: true }));
    tour.resume();
    assert.equal(tour.getState().index, 0, 'replay restarts at the first stop');
    assert.equal(tour.getState().complete, false);
    assert.equal(visits.at(-1).id, route.stops[0].id);
    tour.dispose();
  }
});

check('Pause and resume retain the unspent dwell across multiple interruptions', () => {
  const { controller: tour, time, visits } = setup();
  tour.start('river');
  time.advance(5000);
  tour.pause();
  const count = visits.length;
  time.advance(60_000);
  assert.equal(visits.length, count);
  assert.equal(time.pendingIds().length, 0);
  tour.resume();
  assert.equal(visits.at(-1).id, CITY_TOURS[0].stops[0].id, 'resume restores the paused camera target');
  time.advance(2000);
  tour.pause();
  time.advance(120_000);
  tour.resume();
  time.advance(6999);
  assert.equal(tour.getState().index, 0);
  time.advance(1);
  assert.equal(tour.getState().index, 1, 'only 14 seconds of foreground playing time count');
  assert.equal(time.pendingIds().length, 1);
  tour.dispose();
});

check('Resume is idempotent while playing and cannot extend the current stop', () => {
  const { controller: tour, time, visits, changes } = setup();
  tour.start('river');
  time.advance(5000);
  const pending = time.pendingIds(), visitCount = visits.length, changeCount = changes.length;
  tour.resume();
  tour.resume();
  assert.deepEqual(time.pendingIds(), pending, 'an already playing tour retains its original deadline');
  assert.equal(visits.length, visitCount, 'repeated resume must not refocus the camera');
  assert.equal(changes.length, changeCount);
  time.advance(8999);
  assert.equal(tour.getState().index, 0);
  time.advance(1);
  assert.equal(tour.getState().index, 1, 'the first stop still ends at its original 14 second deadline');
  time.advance(3000);
  tour.pause();
  time.advance(60_000);
  tour.resume();
  time.advance(4000);
  tour.resume();
  time.advance(6999);
  assert.equal(tour.getState().index, 1);
  time.advance(1);
  assert.equal(tour.getState().index, 2, 'idempotence also preserves a previously paused remaining dwell');
  tour.dispose();
});

check('Combined document-hidden and overlay reasons suspend without consuming dwell', () => {
  const { controller: tour, time, visits } = setup();
  let hidden = false, overlay = false;
  const applyReasons = () => tour.setSuspended(hidden || overlay);
  tour.start('architecture');
  time.advance(4000);
  hidden = true; applyReasons();
  const pendingVisitCount = visits.length;
  time.advance(60_000);
  overlay = true; applyReasons();
  hidden = false; applyReasons();
  time.advance(60_000);
  assert.equal(visits.length, pendingVisitCount, 'closing one of two reasons must not restart the tour');
  assert.equal(tour.getState().playing, true, 'suspension preserves the user playback choice');
  assert.equal(tour.getState().suspended, true);
  assert.equal(time.pendingIds().length, 0);
  overlay = false; applyReasons();
  assert.equal(visits.length, pendingVisitCount, 'automatic unsuspension does not revisit the current camera target');
  time.advance(9999);
  assert.equal(tour.getState().index, 0);
  time.advance(1);
  assert.equal(tour.getState().index, 1);
  tour.dispose();
});

check('A user pause while suspended survives visibility restoration', () => {
  const { controller: tour, time } = setup();
  tour.start('river');
  time.advance(3000);
  tour.setSuspended(true);
  tour.pause();
  time.advance(90_000);
  tour.setSuspended(false);
  assert.equal(tour.getState().playing, false);
  assert.equal(time.pendingIds().length, 0);
  time.advance(90_000);
  assert.equal(tour.getState().index, 0);
  tour.resume();
  time.advance(10999);
  assert.equal(tour.getState().index, 0);
  time.advance(1);
  assert.equal(tour.getState().index, 1);
  tour.dispose();
});

check('Manual jump, previous/next, and route replacement cancel every stale callback', () => {
  const { controller: tour, time, visits } = setup();
  tour.start('river');
  const [oldRouteTimer] = time.pendingIds();
  time.advance(13000);
  assert.equal(tour.jump(2), true);
  const [oldStopTimer] = time.pendingIds();
  const beforeStale = visits.length;
  time.fireQueued(oldRouteTimer);
  assert.equal(visits.length, beforeStale, 'a queued old callback cannot undo a manual stop');
  time.advance(13999);
  assert.equal(tour.getState().index, 2);
  assert.equal(tour.start('streets'), true);
  const snapshot = tour.getState(), count = visits.length;
  time.fireQueued(oldRouteTimer);
  time.fireQueued(oldStopTimer);
  assert.deepEqual(tour.getState(), snapshot);
  assert.equal(visits.length, count, 'a replaced route cannot steal the camera');
  assert.equal(time.pendingIds().length, 1);
  time.advance(13999);
  assert.equal(tour.getState().index, 0);
  time.advance(1);
  assert.equal(tour.getState().index, 1);
  tour.pause();
  assert.equal(tour.step(-1), true);
  assert.equal(tour.getState().index, 0);
  assert.equal(tour.getState().playing, false, 'manual navigation preserves paused playback');
  assert.equal(time.pendingIds().length, 0);
  assert.equal(tour.step(1), true);
  assert.equal(tour.getState().index, 1);
  tour.dispose();
});

check('Rejected route and stop choices leave the active tour and its deadline untouched', () => {
  const { controller: tour, time, visits, changes } = setup();
  assert.equal(tour.start('missing'), false);
  tour.start('river');
  time.advance(6000);
  const snapshot = tour.getState(), visitCount = visits.length, changeCount = changes.length;
  const pending = time.pendingIds();
  assert.equal(tour.start('missing'), false);
  for (const index of [-1, CITY_TOURS[0].stops.length, 1.5, NaN, Infinity]) assert.equal(tour.jump(index), false);
  assert.deepEqual(tour.getState(), snapshot);
  assert.deepEqual(time.pendingIds(), pending);
  assert.equal(visits.length, visitCount);
  assert.equal(changes.length, changeCount);
  time.advance(7999);
  assert.equal(tour.getState().index, 0);
  time.advance(1);
  assert.equal(tour.getState().index, 1);
  tour.dispose();
});

check('Stop and disposal cannot deliver late camera moves or state updates', () => {
  const { controller: tour, time, visits, changes } = setup();
  tour.start('architecture');
  const [stoppedTimer] = time.pendingIds();
  tour.stop();
  const afterStop = { state: tour.getState(), visits: visits.length, changes: changes.length };
  time.fireQueued(stoppedTimer);
  tour.resume();
  assert.deepEqual(tour.getState(), afterStop.state);
  assert.equal(visits.length, afterStop.visits);
  assert.equal(changes.length, afterStop.changes);
  tour.start('streets');
  const [disposedTimer] = time.pendingIds();
  tour.dispose();
  const afterDispose = { state: tour.getState(), visits: visits.length, changes: changes.length };
  time.fireQueued(stoppedTimer);
  time.fireQueued(disposedTimer);
  for (const action of [() => tour.start('river'), () => tour.pause(), () => tour.resume(),
    () => tour.jump(1), () => tour.step(1), () => tour.setSuspended(true), () => tour.stop(), () => tour.dispose()]) action();
  time.advance(1_000_000);
  assert.deepEqual(tour.getState(), afterDispose.state);
  assert.equal(visits.length, afterDispose.visits);
  assert.equal(changes.length, afterDispose.changes);
  assert.equal(time.pendingIds().length, 0);
});

check('Starting a new route while suspended preserves suspension and gives the first stop its full dwell', () => {
  const { controller: tour, time } = setup();
  tour.setSuspended(true);
  tour.start('river');
  time.advance(100_000);
  assert.equal(tour.getState().index, 0);
  assert.equal(tour.getState().suspended, true);
  assert.equal(time.pendingIds().length, 0);
  tour.stop();
  tour.start('architecture');
  assert.equal(tour.getState().suspended, true);
  tour.setSuspended(false);
  time.advance(13999);
  assert.equal(tour.getState().index, 0);
  time.advance(1);
  assert.equal(tour.getState().index, 1);
  tour.dispose();
});

check('Production defaults switch after five seconds and finish the last stop without looping', () => {
  assert.equal(DEFAULT_TOUR_DWELL_MS, 5000);
  assert.equal(TOUR_MODEL_WAIT_MS, 3000);
  const { controller: tour, time, visits } = setup({});
  tour.start('river');
  assert.equal(tour.getState().dwellMs, 5000);
  assert.equal(tour.getTiming().durationMs, 5000);
  assert.equal(tour.getTiming().remainingMs, 5000);
  assert.equal(visits.length, 1, 'the first camera move remains immediate');
  time.advance(4999);
  assert.equal(visits.length, 1);
  assert.equal(tour.getTiming().remainingMs, 1);
  time.advance(1);
  assert.equal(tour.getState().index, 1);
  assert.equal(visits[1].at, 5000);
  tour.jump(CITY_TOURS[0].stops.length - 1);
  time.advance(4999);
  assert.equal(tour.getState().complete, false);
  time.advance(1);
  assert.equal(tour.getState().complete, true);
  assert.equal(tour.getState().playing, false);
  assert.equal(time.pendingIds().length, 0);
  const count = visits.length;
  time.advance(60_000);
  assert.equal(visits.length, count);
  tour.dispose();
});

check('Countdown samples share the navigation deadline and freeze during user or overlay pauses', () => {
  const { controller: tour, time } = setup({});
  tour.start('river');
  const pending = time.pendingIds();
  time.advance(1250);
  for (let index = 0; index < 10; index++) assert.equal(tour.getTiming().remainingMs, 3750);
  assert.deepEqual(time.pendingIds(), pending, 'reading countdown cannot reset or add a navigation timer');
  tour.pause();
  time.advance(90_000);
  assert.equal(tour.getTiming().remainingMs, 3750);
  assert.equal(time.pendingIds().length, 0);
  tour.resume();
  time.advance(250);
  tour.setSuspended(true);
  time.advance(90_000);
  assert.equal(tour.getTiming().remainingMs, 3500);
  tour.setSuspended(false);
  time.advance(3499);
  assert.equal(tour.getState().index, 0);
  assert.equal(tour.getTiming().remainingMs, 1);
  time.advance(1);
  assert.equal(tour.getState().index, 1);
  tour.dispose();
});

check('Changing pace preserves elapsed dwell and cannot leave an already elapsed stop waiting', () => {
  const { controller: tour, time, visits } = setup({});
  tour.start('river');
  const [oldTimer] = time.pendingIds();
  time.advance(2000);
  tour.setDwellMs(3000);
  assert.equal(tour.getState().dwellMs, 3000);
  assert.equal(tour.getTiming().durationMs, 3000);
  assert.equal(tour.getTiming().remainingMs, 1000);
  time.fireQueued(oldTimer);
  assert.equal(tour.getState().index, 0, 'the old pace callback is invalidated');
  time.advance(999);
  assert.equal(visits.length, 1);
  time.advance(1);
  assert.equal(tour.getState().index, 1);
  time.advance(1000);
  tour.setDwellMs(8000);
  assert.equal(tour.getTiming().remainingMs, 7000, 'slowing down keeps the already spent second');
  time.advance(3000);
  tour.setDwellMs(3000);
  assert.equal(tour.getTiming().remainingMs, 0, 'speeding up cannot create negative countdown');
  time.advance(0);
  assert.equal(tour.getState().index, 2, 'an already spent new duration advances without another full dwell');
  assert.equal(time.pendingIds().length, 1);
  tour.dispose();
});

check('A model that never loads adds at most three seconds before normal countdown resumes', () => {
  const { controller: tour, time, visits } = setup({});
  const first = CITY_TOURS.find(route => route.id === 'architecture').stops[0].id;
  tour.start('architecture');
  tour.setModelLoading(first, true);
  assert.equal(tour.getState().modelLoading, true);
  assert.equal(tour.getTiming().waitingForModel, true);
  assert.equal(tour.getTiming().modelWaitRemainingMs, 3000);
  assert.equal(time.pendingIds().length, 1, 'model grace and dwell share one navigation timer');
  time.advance(2000);
  tour.setModelLoading(first, true);
  assert.equal(tour.getTiming().modelWaitRemainingMs, 1000, 'duplicate loading notifications cannot restart grace');
  assert.equal(tour.getTiming().remainingMs, 5000, 'grace does not spend the view dwell');
  time.advance(999);
  assert.equal(tour.getTiming().waitingForModel, true);
  time.advance(1);
  assert.equal(tour.getState().modelLoading, true);
  assert.equal(tour.getState().modelWaitExpired, true);
  assert.equal(tour.getTiming().waitingForModel, false);
  assert.equal(tour.getTiming().modelWaitRemainingMs, 0);
  time.advance(4999);
  assert.equal(tour.getState().index, 0);
  time.advance(1);
  assert.equal(tour.getState().index, 1);
  assert.equal(visits.at(-1).at, 8000, 'slow network cannot hold this station indefinitely');
  tour.dispose();
});

check('A ready model immediately releases grace and repeated loading shares the same visit budget', () => {
  const { controller: tour, time } = setup({});
  const first = CITY_TOURS.find(route => route.id === 'architecture').stops[0].id;
  tour.start('architecture');
  tour.setModelLoading(first, true);
  time.advance(1000);
  tour.setModelLoading(first, false);
  assert.equal(tour.getTiming().waitingForModel, false);
  assert.equal(tour.getTiming().remainingMs, 5000);
  time.advance(1000);
  assert.equal(tour.getTiming().remainingMs, 4000, 'dwell starts as soon as the model is ready');
  tour.setModelLoading(first, true);
  assert.equal(tour.getTiming().modelWaitRemainingMs, 2000, 'a second loading phase receives only unused grace');
  time.advance(2000);
  assert.equal(tour.getState().modelWaitExpired, true);
  tour.setModelLoading(first, false);
  tour.setModelLoading(first, true);
  assert.equal(tour.getTiming().waitingForModel, false, 'status toggles cannot replenish an expired budget');
  time.advance(3999);
  assert.equal(tour.getState().index, 0);
  time.advance(1);
  assert.equal(tour.getState().index, 1);
  tour.dispose();
});

check('Loading grace freezes while paused or hidden and a ready model cannot override user pause', () => {
  const { controller: tour, time } = setup({});
  const first = CITY_TOURS.find(route => route.id === 'architecture').stops[0].id;
  tour.start('architecture');
  tour.setModelLoading(first, true);
  time.advance(1000);
  tour.pause();
  time.advance(60_000);
  assert.equal(tour.getTiming().modelWaitRemainingMs, 2000);
  assert.equal(tour.getTiming().remainingMs, 5000);
  assert.equal(time.pendingIds().length, 0);
  tour.resume();
  time.advance(500);
  tour.setSuspended(true);
  time.advance(60_000);
  assert.equal(tour.getTiming().modelWaitRemainingMs, 1500);
  tour.pause();
  tour.setModelLoading(first, false);
  tour.setSuspended(false);
  assert.equal(tour.getState().playing, false);
  assert.equal(time.pendingIds().length, 0);
  time.advance(60_000);
  assert.equal(tour.getState().index, 0);
  tour.resume();
  time.advance(4999);
  assert.equal(tour.getState().index, 0);
  time.advance(1);
  assert.equal(tour.getState().index, 1);
  tour.dispose();
});

check('Jumping resets per-visit grace and rejects stale model notifications and cancelled grace callbacks', () => {
  const { controller: tour, time, visits } = setup({});
  const route = CITY_TOURS.find(route => route.id === 'architecture');
  tour.start(route.id);
  tour.setModelLoading(route.stops[0].id, true);
  const [oldGrace] = time.pendingIds();
  time.advance(1000);
  tour.step(1);
  assert.equal(tour.getState().index, 1);
  assert.equal(visits.at(-1).id, route.stops[1].id, 'next station responds immediately during loading');
  tour.setModelLoading(route.stops[1].id, true);
  const before = tour.getState(), pending = time.pendingIds();
  tour.setModelLoading(route.stops[0].id, false);
  tour.setModelLoading(route.stops[0].id, true);
  time.fireQueued(oldGrace);
  assert.deepEqual(tour.getState(), before);
  assert.deepEqual(time.pendingIds(), pending);
  assert.equal(tour.getTiming().modelWaitRemainingMs, 3000, 'new station receives its own budget');
  time.advance(7999);
  assert.equal(tour.getState().index, 1);
  time.advance(1);
  assert.equal(tour.getState().index, 2);
  tour.jump(0);
  tour.setModelLoading(route.stops[0].id, true);
  assert.equal(tour.getTiming().modelWaitRemainingMs, 3000, 'explicit revisit resets that visit budget');
  const [stoppedGrace] = time.pendingIds();
  tour.stop();
  const count = visits.length;
  time.fireQueued(stoppedGrace);
  tour.setModelLoading(route.stops[0].id, false);
  time.advance(60_000);
  assert.equal(tour.getState().routeId, null);
  assert.equal(visits.length, count);
  assert.equal(time.pendingIds().length, 0);
  tour.dispose();
});

const city = JSON.parse(await readFile(new URL('../public/data/city.json', import.meta.url), 'utf8'));
const places = [...city.landmarks, ...BUSINESS_BUILDINGS];
check('All three published itineraries resolve to current city IDs and permitted presets', () => {
  assert.deepEqual(CITY_TOURS.map(route => route.id), ['river', 'architecture', 'streets']);
  assert.deepEqual(CITY_TOURS.map(route => route.stops.length), [5, 4, 3]);
  for (const route of CITY_TOURS) for (const stop of route.stops) {
    const item = places.find(place => place.id === stop.id);
    assert(item, `${route.id}: ${stop.id} exists in the current scene`);
    if (item.kind === 'authored') {
      assert.equal(item.modelStatus, 'available', `${stop.id}: tour cannot target a missing model`);
      assert.equal(item.inspectionPresets, true, `${stop.id}: guided detail presets require supported registration`);
    }
    const location = normalizeSceneLocation({ place: stop.id, angle: stop.angle || 'detail', close: Boolean(stop.close) }, places);
    assert.equal(location.place, stop.id);
    assert.equal(location.angle, stop.angle || 'detail', `${stop.id}: no silent angle fallback`);
    assert.equal(location.close, Boolean(stop.close));
  }
});

// Validate the itinerary against generated camera/ground plans rather than
// only strings accepted by location serialization. Real water geometry is
// retained; flat ground suffices for availability, not visual fidelity.
const streetEvidence = [];
check('Street itinerary frames current source roads and complete models without weakening old paving guards', () => {
  const models = BUSINESS_BUILDINGS.map(spec => resolveAuthoredPlacement(spec, city.meta)).filter(Boolean);
  const inRing = ([x, z], ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  };
  const inWater = (x, z) => city.water.some(water => inRing([x, z], water.rings[0]) && !water.rings.slice(1).some(hole => inRing([x, z], hole)));
  const inputSnapshot = JSON.stringify({ models, roads: city.roads });
  const input = { data: city, authoredModels: models,
    authoredGround: planAuthoredGround(models, city, 3.8),
    waterfrontPlan: { omittedBuildingIndices: new Set() },
    inWater, heightAt: () => 0,
  };
  const plan = planStreetDetails(input);
  const observations = planStreetObservations({ models, roads: city.roads,
    heightAt: input.heightAt, inWater, unitsPerMeter: city.meta.unitsPerMeter });
  // Current23 has its own triangle-verified apron-edge profile. The independent
  // observation camera is still not permission to accept unreviewed geometry.
  const frontage = planInternationalStreetSite(input);
  assert.equal(frontage.sites[0]?.connectionEvidence.method, 'current23-existing-apron-edge-to-same-side-source-road');
  assert.equal(plan.stats.streetFrontageConnections, 1);
  assert.equal(plan.streetViews.length, 1, 'only the reviewed International frontage is restored');
  const international = models.find(model => model.id === 'yichang-international-s01');
  for (const mutation of [{sourceModelSha256: 'unreviewed'},
    {assets: {...international.assets, light: '/unreviewed.glb'}},
    {sourceBounds: {...international.sourceBounds, min: [-999, ...international.sourceBounds.min.slice(1)]}}]) {
    const changed = {...input, authoredModels: models.map(model => model.id === international.id ? {...model, ...mutation} : model)};
    assert.equal(planInternationalStreetSite(changed).reason, 'unreviewed-source-geometry');
  }
  const streetStops = CITY_TOURS.find(route => route.id === 'streets').stops;
  assert.equal(streetStops.filter(stop => stop.angle === 'street').length, 2);
  for (const stop of streetStops) {
    const model = models.find(candidate => candidate.id === stop.id);
    if (stop.angle === 'street') {
      const view = observations.views.find(candidate => candidate.id === stop.id);
      assert(view, `${stop.id}: a current source-road observation exists`);
      assert(observations.stats.availableIds.includes(stop.id));
      assert(!observations.stats.unavailableIds.includes(stop.id));
      assert(view.center.length === 3 && view.center.every(Number.isFinite));
      assert(view.direction.length === 3 && view.direction.every(Number.isFinite));
      assert(Math.abs(Math.hypot(...view.direction) - 1) < 1e-9, 'camera direction is normalized');
      assert(Number.isFinite(view.span) && view.span > 0);
      assert(Number.isFinite(view.gapMeters) && view.gapMeters > 0 && view.gapMeters <= 110, 'the observed road is local to the model');
      const road = city.roads[view.sourceRoadIndex];
      assert(road && Number.isInteger(view.sourceSegmentIndex));
      assert.equal(view.osmId, road.osmId);
      assert.equal(view.roadName, road.name);
      assert.equal(road.name, '沿江大道', `${stop.id}: itinerary text matches the observed road`);
      const segment = [road.points[view.sourceSegmentIndex], road.points[view.sourceSegmentIndex + 1]];
      assert.deepEqual(view.sourceEndpoints, segment, 'the camera retains an exact existing source-road segment');
      const [a, b] = segment, dx = b[0] - a[0], dz = b[1] - a[1], square = dx * dx + dz * dz;
      assert(square > 0);
      for (const p of view.observedEndpoints) {
        assert(p.length === 2 && p.every(Number.isFinite));
        const projection = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / square;
        assert(projection >= -1e-9 && projection <= 1 + 1e-9, 'observed endpoints stay on the source segment');
        assert(Math.abs(dx * (p[1] - a[1]) - dz * (p[0] - a[0])) / Math.sqrt(square) < 1e-9);
      }
      assert(Math.hypot(...view.observedEndpoints[1].map((value, index) => value - view.observedEndpoints[0][index])) > 0);
      assert(view.streetPoints.length >= 2, 'the frame includes actual street points as well as the model');
      assert(view.streetPoints.every(p => p.length === 3 && p.every(Number.isFinite) && !inWater(p[0], p[2])), 'street framing points remain outside mapped water');
      assert(view.framePoints.every(p => p.length === 3 && p.every(Number.isFinite)));
      const containsPoint = point => view.framePoints.some(p => p.every((value, axis) => Math.abs(value - point[axis]) < 1e-9));
      for (const p of view.streetPoints) assert(containsPoint(p));
      for (const [x, z] of model.footprint) {
        assert(containsPoint([x, .065, z]), 'the frame includes the entire current model footprint');
        assert(containsPoint([x, .065 + model.localSize.y, z]), 'the frame includes the complete current building height');
      }
      assert.equal(view.framePoints.length, model.footprint.length * 2 + view.streetPoints.length);
      streetEvidence.push({ id: stop.id, road: view.roadName, osmId: view.osmId,
        gapMeters: view.gapMeters, framePoints: view.framePoints.length, streetPoints: view.streetPoints.length });
    } else if (stop.angle === 'streetscape') assert(plan.streetViews.some(view => view.siteIds.includes(stop.id)), `${stop.id}: generated streetscape exists`);
    else if (stop.angle === 'frontage') assert(plan.sites.find(site => site.id === stop.id)?.frontageView, `${stop.id}: generated frontage exists`);
    else if (stop.angle === 'entrance') {
      const subject = resolveBuildingInspection(model, 0, 'entrance');
      assert(subject && subject.center.toArray().every(Number.isFinite) && subject.span > 0, `${stop.id}: entrance subject is finite and nonempty`);
    } else assert.fail(`${stop.id}: an untested street itinerary preset was introduced`);
  }
  assert.equal(JSON.stringify({ models, roads: city.roads }), inputSnapshot, 'observations cannot modify model transforms or source roads');
});

console.log(JSON.stringify({ ok: failures.length === 0, routes: CITY_TOURS.length,
  stops: CITY_TOURS.reduce((count, route) => count + route.stops.length, 0), checked, streetEvidence,
  scope: 'Controller timer behavior and existing scene preset availability; browser/React integration is verified separately.',
  ...(failures.length ? { failures } : {}),
}, null, 2));
if (failures.length) process.exitCode = 1;
