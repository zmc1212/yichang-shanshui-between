// These are camera itineraries through existing scene presets, not walking
// directions or claims that the modeled forecourts are publicly accessible.
export const CITY_TOURS = Object.freeze([
  {
    id: 'river', title: '沿江看宜昌', subtitle: '桥、楼阁与一江山水', icon: 'river',
    stops: [
      { id: 'gezhouba-dam', title: '葛洲坝', caption: '从大江枢纽，展开一城山水。' },
      { id: 'zhixi-bridge', title: '至喜大桥', caption: '沿着桥梁，读懂长江两岸。' },
      { id: 'zhenjiang-pavilion', title: '镇江阁', caption: '换到江岸一侧，看看楼阁与步道。', angle: 'river' },
      { id: 'yiling-bridge', title: '夷陵大桥', caption: '让桥塔与城市天际线一起入镜。' },
      { id: 'tianran-pagoda', title: '天然塔', caption: '在江边古塔，为这一程收尾。', angle: 'river' },
    ],
  },
  {
    id: 'architecture', title: '城市建筑巡礼', subtitle: '四处楼宇，四种城市表情', icon: 'building',
    stops: [
      { id: 'jinjiang-s03', title: '锦江银座', caption: '完整入镜，先看楼体比例。', close: true },
      { id: 'wanda-soho-s01', title: '万达 SOHO', caption: '观察沿江楼宇的立面节奏。', close: true },
      { id: 'yichang-international-s01', title: '宜昌国际广场', caption: '看看建筑组团与底层空间。', close: true },
      { id: 'shouxin-wealth-s01', title: '首信财富中心', caption: '从竖向幕墙，看到顶部轮廓。', close: true },
    ],
  },
  {
    id: 'streets', title: '走近街巷', subtitle: '沿街空间、楼宇与建筑入口', icon: 'street',
    stops: [
      { id: 'wanda-soho-s01', title: '万达沿街空间', caption: '把楼宇主体与沿江大道一起看。', angle: 'street', close: true },
      { id: 'yichang-international-s01', title: '国际广场街区', caption: '从道路一侧，观察建筑与街区。', angle: 'street', close: true },
      { id: 'shouxin-wealth-s01', title: '首信建筑入口', caption: '停在入口，细看近处构件。', angle: 'entrance', close: true },
    ],
  },
]);

export const DEFAULT_TOUR_DWELL_MS = 5000;
export const TOUR_MODEL_WAIT_MS = 3000;
export const TOUR_PACES = Object.freeze([
  { value: 3000, label: '快览 · 3秒' },
  { value: DEFAULT_TOUR_DWELL_MS, label: '标准 · 5秒' },
  { value: 8000, label: '慢看 · 8秒' },
]);
export const EMPTY_TOUR_STATE = Object.freeze({ routeId: null, index: 0, playing: false, complete: false, suspended: false,
  dwellMs: DEFAULT_TOUR_DWELL_MS, modelLoading: false, modelWaitExpired: false });

// A single cancellable timer owns the tour. Pausing, changing route, hiding the
// page and disposing all cancel that timer so an old stop cannot steal focus.
export function createCityTourController({ routes = CITY_TOURS, onVisit = () => {}, onChange = () => {}, dwellMs = DEFAULT_TOUR_DWELL_MS,
  setTimer = setTimeout, clearTimer = clearTimeout, now = () => performance.now() } = {}) {
  const validDuration = value => Number.isFinite(value) && value >= 1000 && value <= 60_000;
  let state = { ...EMPTY_TOUR_STATE, dwellMs: validDuration(dwellMs) ? dwellMs : DEFAULT_TOUR_DWELL_MS };
  let timer = null, timerPhase = null, startedAt = 0, remaining = state.dwellMs;
  let modelWaitRemaining = TOUR_MODEL_WAIT_MS, generation = 0, disposed = false;
  const route = () => routes.find(item => item.id === state.routeId);
  const publish = () => { if (!disposed) onChange({ ...state }); };
  const waitingForModel = () => Boolean(route() && !state.complete && state.modelLoading && !state.modelWaitExpired && modelWaitRemaining > 0);
  const timeLeft = phase => Math.max(0, (phase === 'model' ? modelWaitRemaining : remaining)
    - (timer !== null && timerPhase === phase ? Math.max(0, now() - startedAt) : 0));
  function cancel(preserve = false) {
    if (timer !== null) {
      if (preserve) {
        if (timerPhase === 'model') modelWaitRemaining = timeLeft('model');
        else remaining = timeLeft('dwell');
      }
      clearTimer(timer); timer = null;
      timerPhase = null;
    }
    generation++;
  }
  function resetStop() {
    remaining = state.dwellMs; modelWaitRemaining = TOUR_MODEL_WAIT_MS;
    state = { ...state, modelLoading: false, modelWaitExpired: false };
  }
  function schedule() {
    cancel();
    if (disposed || !state.playing || state.suspended || !route()) return;
    const token = generation, phase = waitingForModel() ? 'model' : 'dwell';
    startedAt = now(); timerPhase = phase;
    timer = setTimer(() => {
      if (disposed || token !== generation) return;
      timer = null; timerPhase = null;
      const current = route();
      if (!current || !state.playing || state.suspended) return;
      if (phase === 'model') {
        modelWaitRemaining = 0; state = { ...state, modelWaitExpired: true };
        publish(); schedule(); return;
      }
      remaining = 0;
      if (state.index >= current.stops.length - 1) {
        state = { ...state, playing: false, complete: true }; publish(); return;
      }
      state = { ...state, index: state.index + 1 };
      resetStop();
      visit(); publish(); schedule();
    }, Math.max(0, phase === 'model' ? modelWaitRemaining : remaining));
  }
  function visit() {
    const stop = route()?.stops[state.index];
    if (stop) onVisit(stop.id, { angle: stop.angle || 'detail', close: Boolean(stop.close), fromTour: true });
  }
  return {
    getState: () => ({ ...state }),
    // The control's countdown reads the navigation clock directly. It does not
    // run a second playback clock or ask the whole scene to rerender every tick.
    getTiming: () => ({ remainingMs: timeLeft('dwell'), durationMs: state.dwellMs,
      modelWaitRemainingMs: timeLeft('model'), waitingForModel: waitingForModel() }),
    start(id) {
      const next = routes.find(item => item.id === id);
      if (disposed || !next?.stops.length) return false;
      cancel();
      state = { ...state, routeId: id, index: 0, playing: true, complete: false };
      resetStop();
      visit(); publish(); schedule(); return true;
    },
    pause() {
      if (disposed || !state.playing) return;
      cancel(true); state = { ...state, playing: false }; publish();
    },
    resume() {
      if (disposed || !route() || state.playing) return;
      if (state.complete) { state = { ...state, index: 0 }; resetStop(); }
      state = { ...state, playing: true, complete: false };
      visit(); publish(); schedule();
    },
    jump(index) {
      const current = route();
      if (disposed || !current || !Number.isInteger(index) || index < 0 || index >= current.stops.length) return false;
      cancel(); state = { ...state, index, complete: false }; resetStop();
      visit(); publish(); schedule(); return true;
    },
    step(direction) { return this.jump(state.index + Math.sign(direction)); },
    setDwellMs(value) {
      if (disposed || !validDuration(value) || value === state.dwellMs) return false;
      cancel(true);
      const elapsed = state.dwellMs - remaining;
      state = { ...state, dwellMs: value };
      remaining = state.complete ? 0 : Math.max(0, value - elapsed);
      publish(); schedule(); return true;
    },
    setModelLoading(id, value) {
      const loading = Boolean(value);
      if (disposed || !route() || route().stops[state.index]?.id !== id || loading === state.modelLoading) return;
      cancel(true); state = { ...state, modelLoading: loading }; publish(); schedule();
    },
    setSuspended(value) {
      const suspended = Boolean(value);
      if (disposed || suspended === state.suspended) return;
      cancel(true); state = { ...state, suspended }; publish(); schedule();
    },
    stop() {
      if (disposed) return;
      cancel(); state = { ...EMPTY_TOUR_STATE, suspended: state.suspended, dwellMs: state.dwellMs };
      resetStop(); publish();
    },
    dispose() { cancel(); disposed = true; },
  };
}
