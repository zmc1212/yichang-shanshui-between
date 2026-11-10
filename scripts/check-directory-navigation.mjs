import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildDirectoryResults,
  getDirectoryNavigation,
  moveDirectoryActiveId,
  isComposingKeyEvent,
} from '../src/lib/directoryNavigation.js';
import { BUSINESS_BUILDINGS } from '../src/scene/buildingCatalog.js';

// Behavioral checks with explicit directory-order oracles. These checks do not
// create a DOM or renderer, and are not evidence of browser/IME/device testing.
const city = JSON.parse(fs.readFileSync(new URL('../public/data/city.json', import.meta.url), 'utf8'));
const landmarks = [...city.landmarks, ...BUSINESS_BUILDINGS];
const byScene = new Map(BUSINESS_BUILDINGS.map(item => [String(item.sourceSceneId), item]));
const ids = items => items.map(item => item.id);
const passed = [];
function check(name, run) {
  try { run(); passed.push(name); }
  catch (error) { error.message = `${name}: ${error.message}`; throw error; }
}

// The source order intentionally interleaves categories. Cycling its raw array
// would skip the visible next row in the grouped directory.
const mixed = [
  { id: 'office-a', name: '甲座', category: '商务楼宇', modelStatus: 'available', aliases: ['甲栋'] },
  { id: 'pavilion', name: '古阁', category: '历史文化' },
  { id: 'office-b', name: '乙座', category: '商务楼宇', modelStatus: 'available' },
  { id: 'park', name: '公园', category: '山水公园' },
  { id: 'pagoda', name: '古塔', category: '历史文化' },
  { id: 'plain', name: '未分类参考点' },
  { id: 'office-c', name: '丙座', category: '商务楼宇', modelStatus: 'recovery-pending' },
];
const beforeMixed = JSON.stringify(mixed);
const mixedResults = buildDirectoryResults(mixed);

check('grouped rendering order is the navigation order', () => {
  assert.deepEqual(mixedResults.groups.map(group => group.category), ['商务楼宇', '历史文化', '山水公园', '城市地标']);
  assert.deepEqual(mixedResults.groups.map(group => ids(group.items)), [
    ['office-a', 'office-b', 'office-c'], ['pavilion', 'pagoda'], ['park'], ['plain'],
  ]);
  assert.deepEqual(ids(mixedResults.items), ['office-a', 'office-b', 'office-c', 'pavilion', 'pagoda', 'park', 'plain']);
  assert.equal(getDirectoryNavigation(mixedResults.items, 'office-a').nextId, 'office-b');
  assert.equal(JSON.stringify(mixed), beforeMixed, 'building the directory must not reorder/mutate its source');
});

check('filter and query produce the same flattened order as rendered groups', () => {
  const result = buildDirectoryResults(mixed, { filter: 'available', query: '座' });
  assert.deepEqual(result.groups.map(group => group.category), ['商务楼宇']);
  assert.deepEqual(ids(result.items), ['office-a', 'office-b']);
  assert.deepEqual(ids(buildDirectoryResults(mixed, { query: '古' }).items), ['pavilion', 'pagoda']);
  assert.deepEqual(ids(buildDirectoryResults(mixed, { query: '甲栋' }).items), ['office-a']);
});

check('real all-directory order groups the historical towers before waterworks', () => {
  const result = buildDirectoryResults(landmarks);
  assert.equal(result.items.length, 30);
  assert.deepEqual(result.groups.map(group => group.category), ['历史文化', '水利工程', '城市桥梁', '山水公园', '商务楼宇']);
  assert.deepEqual(ids(result.items).slice(0, 7), [
    'zhenjiang-pavilion', 'tianran-pagoda', 'gezhouba-dam', 'zhixi-bridge', 'yiling-bridge', 'mojishan-park', 'xiba-island',
  ]);
  assert.deepEqual(ids(result.items).slice(7), ids(BUSINESS_BUILDINGS));
  assert.equal(getDirectoryNavigation(result.items, 'zhenjiang-pavilion').nextId, 'tianran-pagoda');
});

const available = buildDirectoryResults(landmarks, { filter: 'available' }).items;
const jiuzhou = byScene.get('1649133');
const zhongnan = byScene.get('1649149');
const meilian = byScene.get('1649135');
const jinjiang = byScene.get('1649132');
const wanda = byScene.get('1649138');

check('real seven-model filter cannot step into a pending model', () => {
  assert.deepEqual(available.map(item => item.sourceSceneId), ['1649149', '1649132', '1649138', '1649129', '1649145', '1649136', '1649133']);
  const end = getDirectoryNavigation(available, jiuzhou.id);
  assert.equal(end.position, 7);
  assert.equal(end.total, 7);
  assert.equal(end.nextId, zhongnan.id);
  assert.equal(getDirectoryNavigation(available, zhongnan.id).previousId, jiuzhou.id);
  assert.equal(end.canStep, true);
  assert.equal(end.outside, false);
});

check('23 projects distinguish city, group, partial and identity-review models', () => {
  assert.equal(buildDirectoryResults(landmarks, { filter: 'recovery-pending' }).items.length, 0);
  assert.equal(buildDirectoryResults(landmarks, { filter: 'partial-ready' }).items.length, 14);
  assert.deepEqual(ids(buildDirectoryResults(landmarks, { filter: 'identity-review' }).items), ['business-1649127']);
  assert.deepEqual(ids(buildDirectoryResults(landmarks, { filter: 'registration-pending' }).items), [meilian.id]);
  const previews=buildDirectoryResults(landmarks, { filter: 'preview' }).items;
  assert.equal(previews.length, 16);
  assert(previews.every(item=>item.kind==='business-poi'&&item.assets.light));
  assert.equal(available.length + previews.length, BUSINESS_BUILDINGS.length);
  assert.equal(getDirectoryNavigation(previews, previews.at(-1).id).nextId, meilian.id);
  assert.equal(getDirectoryNavigation(previews, meilian.id).nextId, 'business-1649141');
  assert.deepEqual(ids(buildDirectoryResults(landmarks, {filter:'preview',query:'时代中心'}).items), ['business-1649147']);
});

check('Chinese aliases, spaces and Latin case find the intended building', () => {
  assert.deepEqual(ids(buildDirectoryResults(landmarks, { query: '锦江银座' }).items), [jinjiang.id]);
  assert.deepEqual(ids(buildDirectoryResults(landmarks, { query: '金江银座' }).items), [jinjiang.id]);
  assert.deepEqual(ids(buildDirectoryResults(landmarks, { query: '  锦 江\t银\n座  ' }).items), [jinjiang.id]);
  assert.deepEqual(ids(buildDirectoryResults(landmarks, { query: 'sO hO' }).items), [wanda.id]);
  assert.deepEqual(ids(buildDirectoryResults(landmarks, { query: '美联御峰写字楼' }).items), [meilian.id]);
  assert.equal(buildDirectoryResults(landmarks, { query: '锦江银座', filter: 'recovery-pending' }).items.length, 0);
});

check('zero results disable navigation without falling back to the full directory', () => {
  const result = buildDirectoryResults(landmarks, { query: '不存在的专用测试地点XYZ' });
  assert.deepEqual(result.groups, []);
  assert.deepEqual(result.items, []);
  const state = getDirectoryNavigation(result.items, jiuzhou.id);
  assert.equal(state.total, 0);
  assert.equal(state.position, 0);
  assert.equal(state.canStep, false);
  assert.equal(state.previousId, null);
  assert.equal(state.nextId, null);
  assert.equal(moveDirectoryActiveId(result.items, null, 1), null);
});

check('one result disables both stepping controls but remains searchable', () => {
  const single = [jinjiang];
  for (const selection of [jinjiang.id, jiuzhou.id, null]) {
    const state = getDirectoryNavigation(single, selection);
    assert.equal(state.canStep, false);
    assert.equal(state.previousId, null);
    assert.equal(state.nextId, null);
    assert.equal(state.total, 1);
  }
  assert.equal(getDirectoryNavigation(single, jinjiang.id).position, 1);
  assert.equal(moveDirectoryActiveId(single, null, 1), jinjiang.id);
  assert.equal(moveDirectoryActiveId(single, null, -1), jinjiang.id);
});

check('selection outside results is explicit and enters the visible endpoints', () => {
  const state = getDirectoryNavigation(available, meilian.id);
  assert.equal(state.index, -1);
  assert.equal(state.position, 0);
  assert.equal(state.outside, true);
  assert.equal(state.canStep, true);
  assert.equal(state.nextId, zhongnan.id);
  assert.equal(state.previousId, jiuzhou.id);
  assert.equal(getDirectoryNavigation(available, null).outside, false);
});

check('active keyboard result enters, advances and wraps in rendered order', () => {
  const items = mixedResults.items;
  assert.equal(moveDirectoryActiveId(items, null, 1), 'office-a');
  assert.equal(moveDirectoryActiveId(items, null, -1), 'plain');
  assert.equal(moveDirectoryActiveId(items, 'office-a', 1), 'office-b');
  assert.equal(moveDirectoryActiveId(items, 'office-b', -1), 'office-a');
  assert.equal(moveDirectoryActiveId(items, 'plain', 1), 'office-a');
  assert.equal(moveDirectoryActiveId(items, 'office-a', -1), 'plain');
});

check('stale keyboard result cannot select an item excluded by a new filter', () => {
  assert.equal(moveDirectoryActiveId(available, meilian.id, 1), zhongnan.id);
  assert.equal(moveDirectoryActiveId(available, meilian.id, -1), jiuzhou.id);
});

check('composition event variants are guarded before Enter or shortcuts', () => {
  assert.equal(isComposingKeyEvent({ key: 'Enter' }, true), true);
  assert.equal(isComposingKeyEvent({ key: 'Enter', isComposing: true }), true);
  assert.equal(isComposingKeyEvent({ key: 'Enter', nativeEvent: { isComposing: true } }), true);
  assert.equal(isComposingKeyEvent({ key: 'Enter', keyCode: 229 }), true);
  assert.equal(isComposingKeyEvent({ key: '/', nativeEvent: { keyCode: 229 } }), true);
  assert.equal(isComposingKeyEvent({ key: 'Enter', keyCode: 13, isComposing: false }), false);
  assert.equal(isComposingKeyEvent({ key: '/' }), false);
});

console.log(JSON.stringify({
  result: 'passed',
  script: fileURLToPath(import.meta.url),
  checks: passed,
  scope: 'Directory/search semantics and IME event guards only; DOM focus, real IME, responsive layout and WebGL require browser checks.',
}, null, 2));
