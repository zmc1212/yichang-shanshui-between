import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BUSINESS_BUILDINGS } from '../src/scene/buildingCatalog.js';
import { readSceneLocation, serializeSceneLocation, createSceneLocationUrl } from '../src/lib/sceneLocation.js';

const city = JSON.parse(await readFile(new URL('../public/data/city.json', import.meta.url), 'utf8'));
const places = [...city.landmarks, ...BUSINESS_BUILDINGS];
const target = { place: 'wanda-soho-s01', theme: 'night', view: 'top', angle: 'front', close: true, filter: 'available', query: '万达 SOHO' };
const encoded = serializeSceneLocation(target, places);
assert.deepEqual(readSceneLocation('#' + encoded, places).state, target);
const shared = new URL(createSceneLocationUrl(target, places, 'https://example.test/city?temporary_secret=not-for-sharing#old'));
assert.equal(shared.search, '');
assert.equal(shared.pathname, '/city');
assert.deepEqual(readSceneLocation(shared.hash, places).state, target);
const unknown = readSceneLocation('#place=missing-building&theme=night&angle=front&close=1&filter=unknown', places);
assert.equal(unknown.invalidPlace, true);
assert.equal(unknown.state.place, null);
assert.equal(unknown.state.angle, 'detail');
assert.equal(unknown.state.close, false);
assert.equal(unknown.state.filter, 'all');
assert.equal(unknown.state.theme, 'night');
assert.equal(readSceneLocation('#place=zhenjiang-pavilion&angle=front', places).state.angle, 'detail');
assert.equal(readSceneLocation('#place=zhenjiang-pavilion&angle=river', places).state.angle, 'river');
assert.equal(readSceneLocation('#place=meilian-s05&angle=context&close=1', places).state.close, false);
const previewState = { place:'business-1649141', theme:'night', view:'perspective', angle:'detail', close:false, filter:'preview', query:'兴发广场' };
assert.deepEqual(readSceneLocation('#'+serializeSceneLocation(previewState,places),places).state,previewState);
for (const [filter,place] of [['recovery-pending','business-1649141'],['registration-pending','meilian-s05']]) {
  const restored = readSceneLocation(`#place=${place}&filter=${filter}`,places).state;
  assert.equal(restored.place,place,'A saved guide link keeps its original selected item');
  assert.equal(restored.filter,'preview','Legacy model queues migrate to the visible preview filter');
}
for (const place of BUSINESS_BUILDINGS.filter(item => item.kind === 'authored')) {
  for (const angle of ['detail','front','facade','entrance','crown']) {
    const inspection = { place: place.id, theme: 'day', view: 'perspective', angle, close: true, filter: 'all', query: '' };
    const hash = serializeSceneLocation(inspection, places);
    assert.deepEqual(readSceneLocation('#' + hash, places).state, inspection, `${place.id}: ${angle} preset survives a shared link`);
    const whole = { ...inspection, angle: 'detail', close: false };
    assert.deepEqual(readSceneLocation('#' + serializeSceneLocation(whole, places), places).state, whole, `${place.id}: whole-building link remains distinct`);
  }
  const context = readSceneLocation(`#place=${place.id}&angle=context&close=1`, places).state;
  assert.equal(context.angle, 'context');
  assert.equal(context.close, false, 'city context cannot be mislabeled as local inspection');
}
for (const id of ['meilian-s05','business-1649141','zhenjiang-pavilion','yiling-bridge']) {
  for (const angle of ['facade','entrance','crown']) {
    assert.equal(readSceneLocation(`#place=${id}&angle=${angle}&close=1`, places).state.angle, 'detail', `${id}: native model inspection presets cannot apply to another place kind`);
  }
}
assert.equal(readSceneLocation('#place=shouxin-wealth-s01&angle=unknown&close=1', places).state.angle, 'detail');
const frontage = { place:'yichang-international-s01', theme:'day', view:'perspective', angle:'frontage', close:true, filter:'all', query:'宜昌国际' };
assert.deepEqual(readSceneLocation('#'+serializeSceneLocation(frontage,places),places).state,frontage,'The frontage view survives reload and a copied location link');
for(const place of ['shouxin-wealth-s01','zhenjiang-pavilion','business-1649141']) assert.equal(readSceneLocation(`#place=${place}&angle=frontage&close=1`,places).state.angle,'detail','Frontage view is limited to its actual supported building');
assert.equal(readSceneLocation('#place=shouxin-wealth-s01&close=1', places).state.close, true, 'an existing close-view link remains usable without a new parameter');
assert.equal(readSceneLocation('#place=shouxin-wealth-s01&close=1', places).state.angle, 'detail', 'an existing close-view link now opens the full-building preset, not an implicit facade crop');
assert.equal(readSceneLocation('#unknown-section', places).recognized, false);
assert.equal(readSceneLocation('#place=%E0%A4%A', places).invalidPlace, true);
assert.equal(readSceneLocation('#q=' + 'a'.repeat(200), places).state.query.length, 120);
assert.equal(readSceneLocation('#q=' + 'a'.repeat(2050), places).recognized, false);
for (const item of places) {
  const state = { place: item.id, theme: 'day', view: 'perspective', angle: 'detail', close: false, filter: 'all', query: '' };
  assert.deepEqual(readSceneLocation('#' + serializeSceneLocation(state, places), places).state, state);
}
console.log(JSON.stringify({ ok: true, stableIds: places.length, checked: ['Chinese query and view round-trip', 'authored facade/entrance/crown inspection links and whole-view recovery', 'old close links remain valid', 'transient query excluded from copied URL', 'unknown and malformed IDs', 'per-building view restrictions', 'bounded query and fragment input'] }, null, 2));
