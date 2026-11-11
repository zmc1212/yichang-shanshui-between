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

export const EMPTY_TOUR_STATE = Object.freeze({ routeId: null, index: 0, playing: false, complete: false, suspended: false });

// A single cancellable timer owns the tour. Pausing, changing route, hiding the
// page and disposing all cancel that timer so an old stop cannot steal focus.
export function createCityTourController({ routes = CITY_TOURS, onVisit = () => {}, onChange = () => {}, dwellMs = 14000,
  setTimer = setTimeout, clearTimer = clearTimeout, now = () => performance.now() } = {}) {
  let state = { ...EMPTY_TOUR_STATE }, timer = null, startedAt = 0, remaining = dwellMs, generation = 0, disposed = false;
  const route = () => routes.find(item => item.id === state.routeId);
  const publish = () => { if (!disposed) onChange({ ...state }); };
  function cancel(preserve = false) {
    if (timer !== null) {
      clearTimer(timer); timer = null;
      if (preserve) remaining = Math.max(0, remaining - Math.max(0, now() - startedAt));
    }
    generation++;
  }
  function schedule() {
    cancel();
    if (disposed || !state.playing || state.suspended || !route()) return;
    const token = generation; startedAt = now();
    timer = setTimer(() => {
      if (disposed || token !== generation) return;
      timer = null; remaining = dwellMs;
      const current = route();
      if (!current || !state.playing || state.suspended) return;
      if (state.index >= current.stops.length - 1) {
        state = { ...state, playing: false, complete: true }; publish(); return;
      }
      state = { ...state, index: state.index + 1 };
      visit(); publish(); schedule();
    }, Math.max(0, remaining));
  }
  function visit() {
    const stop = route()?.stops[state.index];
    if (stop) onVisit(stop.id, { angle: stop.angle || 'detail', close: Boolean(stop.close), fromTour: true });
  }
  return {
    getState: () => ({ ...state }),
    start(id) {
      const next = routes.find(item => item.id === id);
      if (disposed || !next?.stops.length) return false;
      cancel(); remaining = dwellMs;
      state = { ...state, routeId: id, index: 0, playing: true, complete: false };
      visit(); publish(); schedule(); return true;
    },
    pause() {
      if (disposed || !state.playing) return;
      cancel(true); state = { ...state, playing: false }; publish();
    },
    resume() {
      if (disposed || !route() || state.playing) return;
      if (state.complete) { state = { ...state, index: 0 }; remaining = dwellMs; }
      state = { ...state, playing: true, complete: false };
      visit(); publish(); schedule();
    },
    jump(index) {
      const current = route();
      if (disposed || !current || !Number.isInteger(index) || index < 0 || index >= current.stops.length) return false;
      cancel(); remaining = dwellMs;
      state = { ...state, index, complete: false }; visit(); publish(); schedule(); return true;
    },
    step(direction) { return this.jump(state.index + Math.sign(direction)); },
    setSuspended(value) {
      const suspended = Boolean(value);
      if (disposed || suspended === state.suspended) return;
      cancel(true); state = { ...state, suspended }; publish(); schedule();
    },
    stop() {
      if (disposed) return;
      cancel(); remaining = dwellMs; state = { ...EMPTY_TOUR_STATE, suspended: state.suspended }; publish();
    },
    dispose() { cancel(); disposed = true; },
  };
}
