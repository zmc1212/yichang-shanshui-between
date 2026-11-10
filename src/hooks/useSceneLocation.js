import { useEffect, useRef } from 'react';
import { normalizeSceneLocation, readSceneLocation, serializeSceneLocation } from '../lib/sceneLocation.js';

// Selection creates a history entry; changes to its view, theme or directory
// replace that entry. Browser back/forward restore the same public preset.
export function useSceneLocation({ ready, places, state, onRestore }) {
  const latest = useRef({ places, state, onRestore });
  latest.current = { places, state, onRestore };
  const tracking = useRef({ initialized: false, pending: null, lastPlace: null, lastReadUrl: '' });
  const key = serializeSceneLocation(state, places);

  useEffect(() => {
    if (!ready || !places.length) return undefined;
    const record = tracking.current;
    const applyLocation = (force = false) => {
      if (!force && record.lastReadUrl === window.location.href) return;
      record.lastReadUrl = window.location.href;
      const current = latest.current;
      const parsed = readSceneLocation(window.location.hash, current.places);
      if (force && !parsed.recognized && !record.initialized) {
        // A person may already have selected a place while the first city
        // frame was preparing. An empty initial URL must not undo that action.
        record.pending = null;
        record.lastPlace = normalizeSceneLocation(current.state, current.places).place;
        record.initialized = true;
        return;
      }
      // Runtime capabilities can downgrade a valid saved preset (for example,
      // a frontage whose source geometry is no longer certified). Track the
      // state actually applied by the UI, or the pending key could never match
      // its next render and would block every later location update.
      const applied = normalizeSceneLocation(
        current.onRestore(parsed.state, { invalidPlace: parsed.invalidPlace }) ?? parsed.state,
        current.places,
      );
      const targetKey = serializeSceneLocation(applied, current.places);
      const currentKey = serializeSceneLocation(current.state, current.places);
      record.pending = targetKey === currentKey ? null : targetKey;
      record.lastPlace = applied.place;
      record.initialized = true;
      if (record.pending === null) {
        // Equivalent hashes (or an unknown ID while already at overview) do
        // not change React's key, so no later effect is guaranteed to run.
        const url = new URL(window.location.href);
        const targetHash = targetKey ? '#' + targetKey : '';
        if (url.hash !== targetHash) {
          url.hash = targetKey;
          window.history.replaceState(window.history.state, '', url);
          record.lastReadUrl = window.location.href;
        }
      }
    };
    applyLocation(true);
    const onNavigation = () => applyLocation();
    window.addEventListener('hashchange', onNavigation);
    window.addEventListener('popstate', onNavigation);
    return () => {
      window.removeEventListener('hashchange', onNavigation);
      window.removeEventListener('popstate', onNavigation);
      record.initialized = false;
    };
  }, [ready, places.length]);

  useEffect(() => {
    const record = tracking.current;
    if (!ready || !record.initialized) return;
    // React applies a restored preset in the next render. Do not overwrite a
    // deep link with the previous selection while that update is pending.
    if (record.pending !== null && key !== record.pending) return;
    record.pending = null;
    const current = normalizeSceneLocation(latest.current.state, latest.current.places);
    const url = new URL(window.location.href);
    const targetHash = key ? '#' + key : '';
    if (url.hash !== targetHash) {
      url.hash = key;
      const method = record.lastPlace !== current.place ? 'pushState' : 'replaceState';
      window.history[method](window.history.state, '', url);
    }
    record.lastPlace = current.place;
    record.lastReadUrl = window.location.href;
  }, [ready, key]);
}
