import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { buildRoadLabelAnchors, projectRoadLabelAnchors } from '../src/scene/roadLabelAnchors.js';
import { layoutRoadLabels, readableRoadAngle, roadNameSize } from '../src/lib/roadLabelLayout.js';

const checks = [];
function check(name, run) { run(); checks.push(name); }
const point = (name, x, y, overrides = {}) => ({ id: `id:${name}`, roadId: `road:${name}`, name, x, y, angle: 0, spanPx: 180, roadPixels: 2, priority: 40, visible: true, ...overrides });
const desktop = { width: 1200, height: 800 };
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const same = value => JSON.stringify(value);
const sourceRoad = (name, points, other = {}) => ({ name, points, width: .2, highway: 'primary', osmId: `way/${name}`, ...other });

check('use actual named arterial classes and preserve source geometry and metadata', () => {
  const roads = [
    sourceRoad('沿江大道', [[0, 0], [100, 0]]),
    sourceRoad('沿江大道', [[0, .4], [100, .4]], { osmId: 'way/return' }),
    sourceRoad('次干道', [[0, 15], [20, 15]], { highway: 'secondary' }),
    sourceRoad('桥面保持本路名', [[0, 30], [50, 30]], { kind: 'bridge', bridge: 'yes', highway: 'trunk' }),
    sourceRoad('住宅支路', [[0, 40], [50, 40]], { highway: 'residential' }),
    sourceRoad('连接匝道', [[0, 50], [50, 50]], { highway: 'primary_link' }),
    sourceRoad('', [[0, 60], [50, 60]]),
    sourceRoad('无效', [[0, 70], [0, 70], [NaN, 0]]),
  ];
  const before = same(roads), plan = buildRoadLabelAnchors(roads);
  assert.deepEqual(plan.roads.map(road => road.name).sort(), ['次干道', '沿江大道', '桥面保持本路名'].sort());
  assert.equal(plan.roads.find(road => road.name === '沿江大道').paths.length, 2);
  assert.equal(same(roads), before);
  assert.ok(plan.roads.every(road => road.anchors.length <= 8));
  assert.ok(plan.roads.every(road => road.paths.every(path => path.sourceId?.startsWith('way/'))));
});

check('close-up road candidates stay on the retained centreline near the view centre', () => {
  const plan = buildRoadLabelAnchors([sourceRoad('沿江大道', [[0, 0], [100, 0]])]);
  const candidates = projectRoadLabelAnchors(plan, {
    pixelsPerUnit: 70, focusPoint: [39, 1],
    project: ([x, z]) => ({ x: 600 + (x - 39) * 70, y: 400 + z * 70, depth: 0, visible: Math.abs(x - 39) < 4 }),
  });
  assert.ok(candidates.length > 0, 'a source road must not disappear solely because its fixed midpoint is off-screen');
  assert.ok(candidates.every(candidate => Math.abs(candidate.world[1]) < 1e-8));
  assert.ok(candidates.some(candidate => candidate.id.includes(':focus:') && Math.abs(candidate.world[0] - 39) < 1e-8));
  assert.equal(layoutRoadLabels(candidates, desktop).labels.length, 1);
});

check('invalid projection, hidden and extremely close or distant roads are rejected', () => {
  const plan = buildRoadLabelAnchors([sourceRoad('沿江大道', [[0, 0], [100, 0]])]);
  const project = ([x, z]) => ({ x, y: z, visible: false, depth: 0 });
  assert.equal(projectRoadLabelAnchors(plan, { project, pixelsPerUnit: 3 }).length, 0);
  assert.equal(projectRoadLabelAnchors(plan, { project: ([x, z]) => ({ x: 500 + x * 3, y: 300 + z * 3, depth: NaN }), pixelsPerUnit: 3 }).length, 0);
  assert.equal(projectRoadLabelAnchors(plan, { project, pixelsPerUnit: Infinity }).length, 0);
  assert.equal(projectRoadLabelAnchors(plan, { project: ([x, z]) => ({ x, y: z, depth: 0 }), pixelsPerUnit: 300 }).length, 0);
  assert.equal(layoutRoadLabels([point('bad', NaN, 30)], desktop).labels.length, 0);
  assert.equal(layoutRoadLabels([point('bad', 300, 300)], { width: 0, height: 0 }).labels.length, 0);
});

check('same road name appears once across carriageways and source segments', () => {
  const candidates = [point('沿江大道', 150, 200), point('沿江大道', 700, 400, { id: 'same-road-second-source', priority: 41 }), point('东山大道', 400, 550)];
  const before = same(candidates), result = layoutRoadLabels(candidates, desktop);
  assert.equal(result.labels.filter(label => label.name === '沿江大道').length, 1);
  assert.equal(result.labels.length, 2);
  assert.equal(same(candidates), before);
});

check('source direction reversal produces readable text instead of upside-down names', () => {
  assert.equal(readableRoadAngle(170), -10);
  assert.equal(readableRoadAngle(-190), -10);
  assert.equal(readableRoadAngle(-170), 10);
  const result = layoutRoadLabels([point('沿江大道', 300, 300, { angle: 170 })], desktop);
  assert.equal(result.labels[0].angle, -10);
});

check('UI, POI, selected POI and selected building are strict obstacles including rotated text bounds', () => {
  const candidates = [
    point('工具栏后', 140, 80, { priority: 1000 }), point('POI后', 400, 260, { priority: 1000 }),
    point('选中标签边', 613, 260, { priority: 1000 }), point('模型前', 750, 550, { priority: 1000 }),
    point('安全道路', 400, 550, { angle: 42 }),
  ];
  const obstacles = [{ left: 80, top: 30, right: 220, bottom: 100 }, { left: 700, top: 400, right: 900, bottom: 650 }];
  const poiObstacles = [{ left: 360, top: 240, right: 440, bottom: 280 }, { left: 540, top: 230, right: 570, bottom: 290, selected: true }];
  const result = layoutRoadLabels(candidates, { ...desktop, obstacles, poiObstacles, selectedId: 'selected-model' });
  assert.deepEqual(result.labels.map(label => label.name), ['安全道路']);
  assert.ok(result.labels.every(label => [...obstacles, ...poiObstacles].every(obstacle => !overlaps(label, obstacle))));
});

check('display thresholds retain labels across small zoom and rotation changes and eventually hide', () => {
  const initial = layoutRoadLabels([point('沿江大道', 300, 300, { roadPixels: .24, angle: 70 })], desktop);
  assert.equal(initial.labels.length, 1);
  const tinyChange = point('沿江大道', 300, 300, { roadPixels: .18, angle: 77 });
  assert.equal(layoutRoadLabels([tinyChange], desktop).labels.length, 0);
  const kept = layoutRoadLabels([tinyChange], { ...desktop, previousLabels: initial.labels });
  assert.equal(kept.labels.length, 1);
  assert.equal(layoutRoadLabels([{ ...tinyChange, roadPixels: .15 }], { ...desktop, previousLabels: kept.labels }).labels.length, 0);
  assert.equal(layoutRoadLabels([{ ...tinyChange, angle: 80 }], { ...desktop, previousLabels: kept.labels }).labels.length, 0);
  const size = roadNameSize('沿江大道');
  assert.equal(layoutRoadLabels([point('沿江大道', 300, 300, { spanPx: size.width * 1.15 + 8 })], { ...desktop, previousLabels: initial.labels }).labels.length, 1);
  assert.equal(layoutRoadLabels([point('沿江大道', 300, 300, { spanPx: size.width })], { ...desktop, previousLabels: initial.labels }).labels.length, 0);
});

check('small score changes retain the previous source candidate until it is blocked', () => {
  const first = point('沿江大道', 230, 230, { id: 'first', priority: 45 });
  const second = point('沿江大道', 700, 550, { id: 'second', priority: 42 });
  const initial = layoutRoadLabels([first, second], desktop);
  assert.equal(initial.labels[0].id, 'first');
  assert.equal(layoutRoadLabels([first, { ...second, priority: 46 }], desktop).labels[0].id, 'second');
  const retained = layoutRoadLabels([first, { ...second, priority: 46 }], { ...desktop, previousLabels: initial.labels });
  assert.equal(retained.labels[0].id, 'first');
  const switched = layoutRoadLabels([first, second], { ...desktop, previousLabels: retained.labels, obstacles: [{ left: 180, top: 180, right: 280, bottom: 280 }] });
  assert.equal(switched.labels[0].id, 'second');
});

check('panorama and selected-building budgets remain sparse on desktop and phone', () => {
  const candidates = Array.from({ length: 15 }, (_, index) => point(`路${index}`, 120 + index % 5 * 210, 180 + Math.floor(index / 5) * 220));
  assert.equal(layoutRoadLabels(candidates, desktop).labels.length, 6);
  assert.equal(layoutRoadLabels(candidates, { ...desktop, selectedId: 'building' }).labels.length, 3);
  const phone = { width: 390, height: 844, compact: true };
  const mobileCandidates = [point('沿江大道', 140, 200), point('东山大道', 250, 400), point('夷陵大道', 150, 600), point('城东大道', 260, 750)];
  assert.equal(layoutRoadLabels(mobileCandidates, phone).labels.length, 3);
  assert.equal(layoutRoadLabels(mobileCandidates, { ...phone, selectedId: 'building' }).labels.length, 2);
  for (const label of layoutRoadLabels(mobileCandidates, phone).labels) assert.ok(label.left >= 14 && label.right <= phone.width - 14 && label.top >= 14 && label.bottom <= phone.height - 14);
});

const city = JSON.parse(fs.readFileSync(new URL('../public/data/city.json', import.meta.url), 'utf8'));
const original = same(city.roads), start = performance.now(), plan = buildRoadLabelAnchors(city.roads);
const planMs = performance.now() - start;
const sourceNames = new Set(city.roads.map(road => road.name).filter(Boolean));
let projectionMs = 0, panorama;
check('retained city data supplies bounded named-road coverage and no invented names', () => {
  assert.equal(plan.stats.roadLabelNames, plan.roads.length);
  assert.ok(plan.roads.length > 90 && plan.roads.length <= 128);
  assert.ok(plan.roads.every(road => sourceNames.has(road.name)));
  assert.ok(plan.stats.roadLabelMaxCandidates <= plan.roads.length * 9);
  assert.equal(same(city.roads), original);
  const at = performance.now();
  const candidates = projectRoadLabelAnchors(plan, {
    pixelsPerUnit: 2.5, focusPoint: [0, 0],
    project: ([x, z]) => ({ x: 800 + x * 2.5, y: 400 + z * 1.8, depth: 0, visible: true }),
  });
  panorama = layoutRoadLabels(candidates, { width: 1600, height: 800, obstacles: [{ left: 24, top: 22, right: 460, bottom: 70 }] });
  projectionMs = performance.now() - at;
  assert.ok(panorama.labels.length >= 3 && panorama.labels.length <= 6);
  assert.equal(new Set(panorama.labels.map(label => label.name)).size, panorama.labels.length);
  assert.ok(panorama.labels.every(label => sourceNames.has(label.name)));
  assert.equal(same(city.roads), original);
});

console.log(JSON.stringify({ passed: checks.length, checks, data: plan.stats, planMs: Number(planMs.toFixed(2)), projectionAndLayoutMs: Number(projectionMs.toFixed(2)), panoramaNames: panorama.labels.map(label => label.name), resourceBudget: { webglMeshes: 0, maxDomLabels: 6, persistentAnimationLoops: 0 } }, null, 2));
