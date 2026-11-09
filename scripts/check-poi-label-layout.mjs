import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { layoutPoiLabels, POI_CLUSTER_DIMENSIONS } from '../src/lib/poiLabelLayout.js';
import { BUSINESS_BUILDINGS } from '../src/scene/buildingCatalog.js';

const passed = [];
function check(name, run) {
  try { run(); passed.push(name); }
  catch (error) { error.message = `${name}: ${error.message}`; throw error; }
}
const point = (id, x, y, size = {}) => ({ id, x, y, visible: true, width: 94, height: 40, ...size });
const desktop = { width: 1100, height: 760 };
const phone = { width: 390, height: 784, compact: true };
const ids = markers => markers.flatMap(marker => marker.memberIds).sort();
const box = marker => ({ left: marker.left, top: marker.top, right: marker.left + marker.width, bottom: marker.top + marker.height });
const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
function everyPointOnce(result, expected) {
  assert.deepEqual(result.representedIds, [...expected].sort());
  assert.deepEqual(ids(result.markers), [...expected].sort());
  assert.equal(new Set(ids(result.markers)).size, expected.length);
}
function usableLayout(result, viewport, obstacles = []) {
  assert.equal(result.constrained, false);
  for (const marker of result.markers) {
    assert.ok([marker.left, marker.top, marker.width, marker.height, marker.anchorX, marker.anchorY].every(Number.isFinite));
    assert.ok(marker.left >= 0 && marker.top >= 0);
    assert.ok(marker.left + marker.width <= viewport.width + 0.001);
    assert.ok(marker.top + marker.height <= viewport.height + 0.001);
    for (const obstacle of obstacles) assert.equal(overlap(box(marker), obstacle), false, `${marker.key} must avoid the UI`);
  }
  for (let i = 0; i < result.markers.length; i++) for (let j = i + 1; j < result.markers.length; j++) {
    assert.equal(overlap(box(result.markers[i]), box(result.markers[j])), false, `${result.markers[i].key} overlaps ${result.markers[j].key}`);
  }
}

check('empty, unready and invalid projected points do not create map locations', () => {
  assert.deepEqual(layoutPoiLabels([], desktop), { markers: [], representedIds: [], constrained: false });
  assert.equal(layoutPoiLabels([point('one', 100, 100)], { width: 0, height: 0 }).markers.length, 0);
  const result = layoutPoiLabels([
    point('inside', 100, 100), point('offscreen-selected', -1, 100),
    point('hidden', 120, 120, { visible: false }), point('bad', NaN, 100),
  ], { ...desktop, selectedId: 'offscreen-selected' });
  everyPointOnce(result, ['inside']);
  assert.equal(result.markers.some(marker => marker.selected), false);
});

check('one POI remains an independent label at its screen anchor', () => {
  const result = layoutPoiLabels([point('single', 200, 160)], desktop);
  everyPointOnce(result, ['single']);
  assert.equal(result.markers[0].kind, 'label');
  assert.equal(result.markers[0].representativeId, 'single');
  assert.equal(result.markers[0].left, 153);
  assert.equal(result.markers[0].top, 112);
  assert.equal(result.markers[0].selected, false);
  assert.equal(result.markers[0].anchorY - result.markers[0].top - result.markers[0].height, 8, 'natural capsule leaves room for a visible anchor dot and leader');
  usableLayout(result, desktop);
});

check('coincident locations retain exact membership in one counted cluster', () => {
  const input = [point('a', 170, 210), point('b', 170, 210), point('c', 170, 210)];
  const result = layoutPoiLabels(input, phone);
  assert.equal(result.markers.length, 1);
  assert.deepEqual(result.markers[0].memberIds, ['a', 'b', 'c']);
  assert.equal(result.markers[0].width, POI_CLUSTER_DIMENSIONS.compact.width);
  assert.equal(result.markers[0].height, 44);
  everyPointOnce(result, ['a', 'b', 'c']);
  usableLayout(result, phone);
});

check('selection plus coincident neighbours keeps two separate clickable entries', () => {
  const input = [point('a', 170, 210), point('b', 170, 210), point('c', 170, 210)];
  const result = layoutPoiLabels(input, { ...phone, selectedId: 'b' });
  assert.equal(result.markers.length, 2);
  assert.deepEqual(result.markers.find(marker => marker.selected)?.memberIds, ['b']);
  assert.deepEqual(result.markers.find(marker => !marker.selected)?.memberIds, ['a', 'c']);
  everyPointOnce(result, ['a', 'b', 'c']);
  usableLayout(result, phone);
});

check('zoomed-apart POIs split naturally without a hidden overflow bucket', () => {
  const near = layoutPoiLabels([point('a', 200, 250), point('b', 225, 260)], desktop);
  const closeView = layoutPoiLabels([point('a', 200, 250), point('b', 400, 340)], desktop);
  assert.equal(near.markers.length, 1);
  assert.equal(closeView.markers.length, 2);
  assert.ok(closeView.markers.every(marker => marker.memberIds.length === 1));
  usableLayout(closeView, desktop);
});

check('overlapping long names aggregate even when point radius alone would miss them', () => {
  const result = layoutPoiLabels([point('a', 220, 250, { width: 150 }), point('b', 340, 250, { width: 150 })], desktop);
  assert.equal(result.markers.length, 1);
  everyPointOnce(result, ['a', 'b']);
});

check('a chain of neighbours cannot swallow arbitrarily distant POIs when space is available', () => {
  const input = Array.from({ length: 7 }, (_, index) => point(`chain-${index}`, 160 + index * 80, 250));
  const result = layoutPoiLabels(input, desktop);
  assert.ok(result.markers.length >= 3);
  assert.ok(result.markers.every(marker => marker.memberIds.length <= 2));
  everyPointOnce(result, input.map(item => item.id));
  usableLayout(result, desktop);
});

check('toolbars and detail sheets are avoided while selected POI remains independent', () => {
  const obstacles = [
    { left: 10, top: 10, right: 300, bottom: 66 },
    { left: 12, top: 560, right: 378, bottom: 740 },
  ];
  const input = [point('selected', 200, 590), point('near', 205, 600), point('top', 100, 40), point('left', 25, 360)];
  const result = layoutPoiLabels(input, { ...phone, selectedId: 'selected', obstacles });
  everyPointOnce(result, input.map(item => item.id));
  assert.deepEqual(result.markers.find(marker => marker.selected)?.memberIds, ['selected']);
  usableLayout(result, phone, obstacles);
});

check('layout is deterministic across reversed source order and never mutates inputs', () => {
  const input = [point('z', 210, 260), point('a', 212, 262), point('q', 350, 450), point('f', 90, 460)];
  const initial = JSON.stringify(input);
  assert.deepEqual(layoutPoiLabels(input, phone), layoutPoiLabels([...input].reverse(), phone));
  assert.equal(JSON.stringify(input), initial);
});

check('landmarks and search targets remain independent beside a named business group', () => {
  const input = [
    point('landmark', 190, 260, { isLandmark: true, priority: 90 }),
    point('search-target', 195, 265, { protected: true, priority: 100 }),
    point('office-a', 198, 267, { priority: 30 }),
    point('office-b', 204, 271, { priority: 50, clusterWidth: 202, clusterHeight: 44 }),
  ];
  const result = layoutPoiLabels(input, phone);
  everyPointOnce(result, input.map(item => item.id));
  for (const id of ['landmark', 'search-target']) {
    const marker = result.markers.find(item => item.memberIds.includes(id));
    assert.deepEqual(marker.memberIds, [id]);
  }
  assert.equal(result.markers.find(item => item.memberIds[0] === 'search-target').kind, 'label');
  const namedGroup = result.markers.find(item => item.kind === 'cluster');
  assert.ok(namedGroup, 'the two nearby business places retain a named grouping');
  assert.equal(namedGroup.representativeId, 'office-b');
  assert.equal(namedGroup.memberIds.length, 2, 'count includes the representative');
  assert.equal(namedGroup.width, 202, 'group uses its representative name measurement');
  assert.equal(namedGroup.height, 44);
  usableLayout(result, phone);
});

check('screen overlap does not merge geographically distant business sites', () => {
  const input = [
    point('near-a', 200, 250, { lon: 111.29, lat: 30.68 }),
    point('near-b', 202, 251, { lon: 111.291, lat: 30.681 }),
    point('far', 204, 252, { lon: 111.39, lat: 30.75 }),
  ];
  const result = layoutPoiLabels(input, desktop);
  assert.ok(result.markers.every(marker => !marker.memberIds.includes('far') || marker.memberIds.length === 1));
  everyPointOnce(result, input.map(item => item.id));
  usableLayout(result, desktop);
});

check('selection is extracted from a previous group with updated nonduplicated membership', () => {
  const input = [point('a', 200, 250), point('b', 202, 252), point('c', 204, 254)];
  const initial = layoutPoiLabels(input, desktop);
  const selected = layoutPoiLabels(input, { ...desktop, selectedId: 'b', previousMarkers: initial.markers });
  everyPointOnce(selected, ['a', 'b', 'c']);
  assert.deepEqual(selected.markers.find(marker => marker.selected).memberIds, ['b']);
  assert.deepEqual(selected.markers.find(marker => marker.kind === 'cluster').memberIds, ['a', 'c']);
  usableLayout(selected, desktop);
});

check('small camera changes preserve group identity and relative label placement', () => {
  const input = [
    point('landmark', 230, 250, { isLandmark: true, priority: 100 }),
    point('office-z', 234, 254, { priority: 50 }),
    point('office-a', 248, 266, { priority: 10 }),
    point('separate', 600, 450),
  ];
  const initial = layoutPoiLabels(input, desktop);
  const moved = input.map(item => ({ ...item, x: item.x + 0.75, y: item.y + 0.4 }));
  const next = layoutPoiLabels(moved, { ...desktop, previousMarkers: initial.markers });
  assert.deepEqual(next.markers.map(marker => marker.key), initial.markers.map(marker => marker.key));
  for (const marker of next.markers) {
    const old = initial.markers.find(item => item.key === marker.key);
    assert.equal(marker.representativeId, old.representativeId);
    assert.ok(Math.abs(marker.left - old.left - 0.75) < 0.00001);
    assert.ok(Math.abs(marker.top - old.top - 0.4) < 0.00001);
  }
  usableLayout(next, desktop);
});

check('compact points need clear extra space before promoting their name again', () => {
  const input = [point('landmark', 200, 300, { isLandmark: true })];
  const corridor = gap => [
    { left: 0, top: 0, right: 200 - gap / 2, bottom: phone.height },
    { left: 200 + gap / 2, top: 0, right: phone.width, bottom: phone.height },
  ];
  const tight = layoutPoiLabels(input, { ...phone, obstacles: corridor(100) });
  assert.equal(tight.markers[0].kind, 'dot');
  const marginal = layoutPoiLabels(input, { ...phone, obstacles: corridor(106), previousMarkers: tight.markers });
  assert.equal(marginal.markers[0].kind, 'dot');
  const clear = layoutPoiLabels(input, { ...phone, previousMarkers: marginal.markers });
  assert.equal(clear.markers[0].kind, 'label');
  usableLayout(tight, phone, corridor(100));
  usableLayout(marginal, phone, corridor(106));
  usableLayout(clear, phone);
});

check('incomplete or stale previous markers cannot manufacture duplicate members', () => {
  const input = [point('a', 200, 250), point('b', 202, 252)];
  const result = layoutPoiLabels(input, { ...desktop, previousMarkers: [
    null, { key: 'incomplete' }, { key: 'old', memberIds: ['a', 'a', 'b', 'removed'] },
  ] });
  everyPointOnce(result, ['a', 'b']);
  usableLayout(result, desktop);
});

check('small valid viewport clamps long labels without dropping selected or clustered members', () => {
  const tiny = { width: 170, height: 150, compact: true, selectedId: 'selected' };
  const result = layoutPoiLabels([point('selected', 85, 75, { width: 280 }), point('a', 85, 75), point('b', 88, 77)], tiny);
  everyPointOnce(result, ['selected', 'a', 'b']);
  assert.equal(result.markers.length, 2);
  usableLayout(result, tiny);
});

check('physically blocked screen reports constraints while retaining all list members', () => {
  const input = [point('selected', 55, 55), point('a', 56, 56), point('b', 57, 57)];
  const result = layoutPoiLabels(input, { width: 110, height: 110, selectedId: 'selected', obstacles: [{ left: 0, top: 0, right: 110, bottom: 110 }] });
  assert.equal(result.constrained, true);
  everyPointOnce(result, ['selected', 'a', 'b']);
  assert.equal(result.markers.filter(marker => marker.selected).length, 1);
  assert.ok(result.markers.length >= 2);
});

const city = JSON.parse(fs.readFileSync(new URL('../public/data/city.json', import.meta.url), 'utf8'));
const registry = [...city.landmarks, ...BUSINESS_BUILDINGS];
check('all 30 existing registry IDs survive dense overview, selected mobile view and obstacle packing', () => {
  assert.equal(registry.length, 30);
  // A deliberately dense screen projection represents a small-city overview;
  // real WebGL projection and visual readability are verified in the browser.
  const input = registry.map((item, index) => point(item.id, 110 + (index % 6) * 30, 210 + Math.floor(index / 6) * 24, {
    width: Math.max(76, item.name.length * 10 + 24),
    priority: item.business ? item.kind === 'authored' ? 50 : 10 : 100 - index,
    isLandmark: !item.business, lon: item.lon, lat: item.lat,
  }));
  for (const selectedId of [null, registry[0].id, registry[13].id, registry[29].id]) {
    const result = layoutPoiLabels(input, { ...phone, selectedId, obstacles: [{ left: 12, top: 560, right: 378, bottom: 740 }] });
    everyPointOnce(result, registry.map(item => item.id));
    usableLayout(result, phone, [{ left: 12, top: 560, right: 378, bottom: 740 }]);
    for (const landmark of registry.filter(item => !item.business)) {
      assert.deepEqual(result.markers.find(marker => marker.memberIds.includes(landmark.id)).memberIds, [landmark.id]);
    }
    const landmarkIds = new Set(registry.filter(item => !item.business).map(item => item.id));
    assert.ok(result.markers.filter(marker => marker.kind === 'label' && landmarkIds.has(marker.representativeId)).length <= 4 + Number(landmarkIds.has(selectedId)), 'phone overview reserves room beyond ordinary landmark names');
    assert.ok(result.markers.some(marker => marker.kind === 'dot'), 'dense mobile uses compact access points instead of swallowing landmarks');
    if (selectedId) assert.deepEqual(result.markers.find(marker => marker.selected)?.memberIds, [selectedId]);
  }
});

check('sparse distribution uses available space instead of collapsing the whole city', () => {
  const input = Array.from({ length: 12 }, (_, index) => point(`sparse-${index}`, 140 + (index % 4) * 230, 160 + Math.floor(index / 4) * 220));
  const result = layoutPoiLabels(input, desktop);
  assert.equal(result.markers.length, 12);
  everyPointOnce(result, input.map(item => item.id));
  usableLayout(result, desktop);
});

const timings = [];
for (let repeat = 0; repeat < 20; repeat++) {
  const sample = registry.map((item, index) => point(item.id, 50 + ((index * 127 + repeat * 11) % 290), 100 + ((index * 73) % 560)));
  const started = performance.now();
  const result = layoutPoiLabels(sample, { ...phone, selectedId: registry[0].id });
  timings.push(performance.now() - started);
  everyPointOnce(result, registry.map(item => item.id));
  usableLayout(result, phone);
}

let observed = null;
if (process.argv[2]) {
  const fixture = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const inputIds = fixture.points.map(item => item.id);
  const viewport = { width: fixture.width, height: fixture.height };
  const result = layoutPoiLabels(fixture.points, viewport);
  check('observed browser projection retains every point with nonoverlapping labels', () => {
    everyPointOnce(result, inputIds);
    usableLayout(result, viewport);
    assert.deepEqual(result, layoutPoiLabels([...fixture.points].reverse(), viewport));
  });
  const measured = [];
  for (let repeat = 0; repeat < 100; repeat++) {
    const start = performance.now();
    layoutPoiLabels(fixture.points, viewport);
    measured.push(performance.now() - start);
  }
  measured.sort((a, b) => a - b);
  observed = {
    source: process.argv[2], points: fixture.points.length, markers: result.markers.length,
    clusters: result.markers.filter(item => item.memberIds.length > 1).map(item => item.memberIds.length),
    soloLabels: result.markers.filter(item => item.memberIds.length === 1).length,
    represented: result.representedIds.length, medianMilliseconds: Number(measured[50].toFixed(2)),
    p95Milliseconds: Number(measured[95].toFixed(2)), maxMilliseconds: Number(measured[99].toFixed(2)),
  };
}

console.log(JSON.stringify({ passed: true, checks: passed, sampleRuns: timings.length, maxSampleMilliseconds: Number(Math.max(...timings).toFixed(2)), observed, scope: 'Pure screen-space membership, collision, viewport and determinism checks; timing is local Node only, not WebGL, touch-device or real browser performance evidence.' }, null, 2));
