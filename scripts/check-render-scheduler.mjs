import assert from 'node:assert/strict';
import { createRenderScheduler } from '../src/scene/renderScheduler.js';

// Observable queue/clock behavior, without a renderer. These checks exercise
// asynchronous invalidations and overlapping pause owners, not WebGL visuals.
function clock() {
  let time = 0, nextId = 1;
  const callbacks = new Map();
  return {
    requestFrame: callback => { const id = nextId++; callbacks.set(id, callback); return id; },
    cancelFrame: id => callbacks.delete(id),
    now: () => time,
    advance: duration => { time += duration; },
    queued: () => callbacks.size,
    tick(duration = 16) {
      time += duration;
      const batch = [...callbacks]; callbacks.clear();
      batch.forEach(([,callback]) => callback(time));
    },
    drain(limit = 100) {
      let frames = 0;
      while (callbacks.size) {
        assert.ok(frames++ < limit, 'scheduler failed to return to rest');
        this.tick();
      }
      return frames;
    },
  };
}
const checks = [];

{
  const time = clock(), states = []; let frames = 0;
  const queue = createRenderScheduler({ ...time, onFrame: () => { frames++; }, onState: state => states.push(state) });
  assert.equal(time.queued(), 0, 'constructing the scheduler must not spin');
  for (let i=0; i<30; i++) queue.invalidate();
  assert.equal(time.queued(), 1, 'a burst of controls/model/resize events coalesces');
  time.drain();
  assert.equal(frames, 1); assert.equal(queue.getState(), 'idle');
  time.advance(60000);
  assert.equal(time.queued(), 0, 'a resting city schedules no idle polling');
  assert.equal(frames, 1);
  queue.invalidate(); time.drain();
  assert.equal(frames, 2, 'a late model completion can wake a resting scene');
  assert.deepEqual(states, ['idle','active','idle','active','idle']);
  queue.dispose(); checks.push('event bursts coalesce; idle has no callbacks; late async completion wakes once');
}

{
  const time = clock(); let frames = 0, continuing = true;
  const queue = createRenderScheduler({ ...time, onFrame: () => { frames++; return continuing; } });
  queue.invalidate();
  for (let i=0; i<12; i++) { assert.equal(time.queued(), 1); time.tick(); }
  assert.equal(frames, 12, 'an active transition/orbit/motion sequence must stay live');
  continuing = false; time.drain();
  assert.equal(frames, 13); assert.equal(queue.getState(), 'idle');
  queue.dispose(); checks.push('continuous animation progresses until it explicitly settles');
}

{
  const time = clock(); let frames = 0;
  const queue = createRenderScheduler({ ...time, onFrame: () => {
    frames++;
    if (frames === 1) { queue.invalidate(); queue.invalidate(); }
    return false;
  } });
  queue.invalidate(); time.drain();
  assert.equal(frames, 2, 'an invalidation during rendering cannot be lost or doubled');
  assert.equal(queue.getState(), 'idle');
  queue.dispose(); checks.push('in-frame invalidation produces exactly one follow-up frame');
}

{
  const time = clock(), resumes = []; let frames = 0, pauses = 0;
  const queue = createRenderScheduler({ ...time, onFrame: () => { frames++; }, onPause: () => { pauses++; }, onResume: value => resumes.push(value) });
  queue.invalidate();
  queue.setPaused('overlay', true);
  assert.equal(time.queued(), 0, 'opening an overlay cancels a pending frame');
  time.advance(100); queue.invalidate(); queue.setPaused('hidden', true);
  assert.equal(queue.getState(), 'hidden');
  time.advance(200); queue.setPaused('overlay', false);
  assert.equal(time.queued(), 0, 'closing overlay cannot wake a hidden document');
  assert.equal(resumes.length, 0);
  time.advance(300); queue.setPaused('hidden', false);
  assert.deepEqual(resumes, [{ pausedAt: 0, resumedAt: 600, duration: 600 }]);
  assert.equal(pauses, 1, 'overlapping reasons share one uninterrupted pause');
  assert.equal(time.queued(), 1, 'all paused invalidations become one resumed frame');
  time.drain(); assert.equal(frames, 1);
  queue.setPaused('hidden', false); queue.setPaused('overlay', false);
  assert.equal(time.queued(), 0, 'idempotent resume does not restart an idle scene');
  queue.dispose(); checks.push('overlay + hidden pauses compose, retain pending work, and report one exact paused interval');
}

{
  const time = clock(); let tweenStarted = -100, frames = 0;
  const queue = createRenderScheduler({ ...time, onFrame: () => { frames++; }, onResume: ({pausedAt,resumedAt}) => {
    tweenStarted += resumedAt - Math.max(pausedAt,tweenStarted);
  } });
  queue.setPaused('overlay', true);
  time.advance(500); queue.setPaused('overlay', false);
  assert.equal(time.now()-tweenStarted, 100, 'an existing transition preserves its pre-pause progress');
  time.drain();
  queue.setPaused('overlay', true); time.advance(200);
  tweenStarted = time.now(); queue.invalidate();
  time.advance(800); queue.setPaused('overlay', false);
  assert.equal(time.now()-tweenStarted, 0, 'a focus created while paused starts on resume');
  time.drain(); assert.equal(frames, 2);
  queue.dispose(); checks.push('transition clocks neither jump forward nor count a pause twice');
}

{
  const time = clock(); let frames = 0, bootstrapped = false;
  const queue = createRenderScheduler({ ...time, onFrame: () => {
    frames++;
    if (frames === 3) bootstrapped = true;
    return frames < 3;
  } });
  queue.setPaused('hidden', true); queue.invalidate();
  time.advance(5000); assert.equal(frames, 0);
  queue.setPaused('hidden', false); time.drain();
  assert.equal(bootstrapped, true); assert.equal(frames, 3);
  assert.equal(queue.getState(), 'idle');
  queue.dispose(); checks.push('initial hidden state preserves the complete multi-frame bootstrap');
}

{
  const time = clock(); let frames = 0;
  const queue = createRenderScheduler({ ...time, onFrame: () => { frames++; return true; } });
  queue.invalidate(); time.tick(); queue.dispose();
  assert.equal(time.queued(), 0);
  queue.invalidate(); queue.setPaused('overlay', false); time.tick();
  assert.equal(frames, 1); assert.equal(queue.getState(), 'disposed');
  checks.push('dispose cancels all work and ignores late events');
}

console.log(JSON.stringify({ passed: true, checks, webglVerified: false }, null, 2));
