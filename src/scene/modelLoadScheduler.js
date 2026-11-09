// One queue is shared by resident loading, focus, and retry. A slot covers the
// complete load/parse promise, including a parser that outlives a fetch abort.
export function createLightLoadScheduler({ concurrency = 2 } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Invalid model load concurrency');
  const queue = [];
  let active = 0, disposed = false;
  const aborted = () => new DOMException('Model load cancelled', 'AbortError');

  function cancelQueued(task) {
    if (task.state !== 'queued') return;
    const index = queue.indexOf(task);
    if (index >= 0) queue.splice(index, 1);
    task.state = 'settled';
    task.signal?.removeEventListener('abort', task.onAbort);
    task.reject(aborted());
  }
  function drain() {
    while (!disposed && active < concurrency && queue.length) {
      const task = queue.shift();
      if (task.signal?.aborted) { cancelQueued(task); continue; }
      task.state = 'running';
      task.signal?.removeEventListener('abort', task.onAbort);
      active++;
      const finish = (settle, value) => {
        task.state = 'settled'; active--;
        settle(value); drain();
      };
      Promise.resolve().then(() => {
        if (task.signal?.aborted) throw aborted();
        return task.run();
      }).then(value => finish(task.resolve, value), error => finish(task.reject, error));
    }
  }
  return {
    schedule(run, { key, signal, priority = false } = {}) {
      if (disposed || signal?.aborted) return Promise.reject(aborted());
      return new Promise((resolve, reject) => {
        const task = { key, signal, run, resolve, reject, state: 'queued' };
        task.onAbort = () => { cancelQueued(task); drain(); };
        signal?.addEventListener('abort', task.onAbort, { once: true });
        if (priority) queue.unshift(task); else queue.push(task);
        drain();
      });
    },
    prioritize(key) {
      const index = queue.findIndex(task => task.key === key);
      if (index > 0) queue.unshift(...queue.splice(index, 1));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const task of [...queue]) cancelQueued(task);
      // Running jobs retain their slot until completion. Their owner aborts
      // the request and disposes any late parser result.
    },
  };
}
