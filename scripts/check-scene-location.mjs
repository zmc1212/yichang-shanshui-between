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
assert.equal(readSceneLocation('#unknown-section', places).recognized, false);
assert.equal(readSceneLocation('#place=%E0%A4%A', places).invalidPlace, true);
assert.equal(readSceneLocation('#q=' + 'a'.repeat(200), places).state.query.length, 120);
assert.equal(readSceneLocation('#q=' + 'a'.repeat(2050), places).recognized, false);
for (const item of places) {
  const state = { place: item.id, theme: 'day', view: 'perspective', angle: 'detail', close: false, filter: 'all', query: '' };
  assert.deepEqual(readSceneLocation('#' + serializeSceneLocation(state, places), places).state, state);
}
console.log(JSON.stringify({ ok: true, stableIds: places.length, checked: ['Chinese query and view round-trip', 'transient query excluded from copied URL', 'unknown and malformed IDs', 'per-building view restrictions', 'bounded query and fragment input'] }, null, 2));
