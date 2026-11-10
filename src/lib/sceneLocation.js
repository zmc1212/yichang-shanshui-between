// Stable, shareable location presets. A link never contains free camera
// coordinates or claims that a candidate building has survey accuracy.
export const SCENE_LOCATION_DEFAULTS = Object.freeze({
  place: null, theme: 'day', view: 'perspective', angle: 'detail', close: false,
  filter: 'all', query: '',
});

const FILTERS = new Set(['all', 'available', 'preview', 'recovery-pending']);
const KEYS = ['place', 'theme', 'view', 'angle', 'close', 'filter', 'q'];
const RIVER_VIEWS = new Set(['zhenjiang-pavilion', 'tianran-pagoda']);

export function normalizeSceneLocation(value = {}, places = []) {
  const place = places.find(item => item.id === value.place);
  const allowedAngles = place?.kind === 'authored' ? ['detail', 'front', 'facade', 'entrance', 'crown', 'context']
    : place?.kind === 'business-poi' ? ['detail', 'context']
      : RIVER_VIEWS.has(place?.id) ? ['detail', 'river'] : ['detail'];
  if (place?.kind === 'authored' && place.id === 'yichang-international-s01') allowedAngles.push('frontage');
  if (place?.kind === 'authored' && ['wanda-soho-s01','yichang-international-s01'].includes(place.id)) allowedAngles.push('streetscape');
  const angle = place && allowedAngles.includes(value.angle) ? value.angle : 'detail';
  // Existing saved links keep their place selection as recovered items move
  // into the unified preview directory. A real remaining recovery queue stays
  // addressable if later catalog entries still need source files.
  const filter = value.filter === 'registration-pending'
    || (value.filter === 'recovery-pending' && !places.some(item => item.modelStatus === 'recovery-pending'))
    ? 'preview' : value.filter;
  return {
    place: place?.id || null,
    theme: value.theme === 'night' ? 'night' : 'day',
    view: value.view === 'top' ? 'top' : 'perspective',
    angle,
    close: Boolean(place && angle !== 'context' && (value.close === true || value.close === '1')),
    filter: FILTERS.has(filter) ? filter : 'all',
    query: typeof value.query === 'string' ? value.query.slice(0, 120) : '',
  };
}

export function readSceneLocation(hash, places) {
  const raw = typeof hash === 'string' ? hash.replace(/^#/, '') : '';
  if (!raw || raw.length > 2048) return { recognized: false, invalidPlace: false, state: { ...SCENE_LOCATION_DEFAULTS } };
  const params = new URLSearchParams(raw);
  const requestedPlace = params.get('place');
  const recognized = KEYS.some(key => params.has(key));
  const state = normalizeSceneLocation({
    place: requestedPlace, theme: params.get('theme'), view: params.get('view'),
    angle: params.get('angle'), close: params.get('close'),
    filter: params.get('filter'), query: params.get('q') || '',
  }, places);
  return { recognized, invalidPlace: Boolean(requestedPlace && !state.place), state };
}

export function serializeSceneLocation(value, places) {
  const state = normalizeSceneLocation(value, places);
  const params = new URLSearchParams();
  if (state.place) params.set('place', state.place);
  if (state.theme !== 'day') params.set('theme', state.theme);
  if (state.view !== 'perspective') params.set('view', state.view);
  if (state.angle !== 'detail') params.set('angle', state.angle);
  if (state.close) params.set('close', '1');
  if (state.filter !== 'all') params.set('filter', state.filter);
  if (state.query) params.set('q', state.query);
  return params.toString();
}

export function createSceneLocationUrl(value, places, pageUrl) {
  const url = new URL(pageUrl);
  // Site access remains unchanged. Do not copy transient query parameters,
  // tokens, or editor parameters into a user-facing location link.
  url.search = '';
  url.hash = serializeSceneLocation(value, places);
  return url.href;
}
