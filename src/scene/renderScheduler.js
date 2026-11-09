// One demand-driven frame queue. Pauses retain invalidations without touching
// the renderer or scene; independent pause reasons must all clear to resume.
export function createRenderScheduler({
  onFrame,
  onPause,
  onResume,
  onState,
  requestFrame = callback => requestAnimationFrame(callback),
  cancelFrame = id => cancelAnimationFrame(id),
  now = () => performance.now(),
} = {}) {
  if (typeof onFrame !== 'function') throw new TypeError('A frame callback is required');
  const pauses = new Set();
  let queued = null, inFrame = false, invalidated = false, disposed = false;
  let pausedAt = null, publishedState = null;

  function getState() {
    if (disposed) return 'disposed';
    if (pauses.has('hidden')) return 'hidden';
    if (pauses.size) return 'suspended';
    return queued !== null || inFrame ? 'active' : 'idle';
  }
  function publish() {
    const state = getState();
    if (state !== publishedState) { publishedState = state; onState?.(state); }
  }
  function schedule() {
    if (!disposed && !pauses.size && !inFrame && queued === null) queued = requestFrame(run);
    publish();
  }
  function run(time) {
    queued = null;
    if (disposed || pauses.size) { publish(); return; }
    invalidated = false;
    inFrame = true;
    let continuing = false;
    try { continuing = Boolean(onFrame(time)); }
    finally {
      inFrame = false;
      if (continuing || invalidated) schedule();
      else publish();
    }
  }
  function invalidate() {
    if (disposed) return;
    invalidated = true;
    schedule();
  }
  function setPaused(reason, value) {
    if (disposed || pauses.has(reason) === Boolean(value)) return;
    const wasPaused = pauses.size > 0;
    if (value) pauses.add(reason); else pauses.delete(reason);
    if (!wasPaused && pauses.size) {
      pausedAt = now();
      if (queued !== null) { cancelFrame(queued); queued = null; }
      onPause?.();
    } else if (wasPaused && !pauses.size) {
      const resumedAt = now();
      onResume?.({ pausedAt, resumedAt, duration: resumedAt - pausedAt });
      pausedAt = null;
      invalidate();
    }
    publish();
  }
  publish();
  return {
    invalidate,
    setPaused,
    getState,
    isPaused: () => pauses.size > 0,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (queued !== null) cancelFrame(queued);
      queued = null;
      invalidated = false;
      pauses.clear();
      publish();
    },
  };
}
