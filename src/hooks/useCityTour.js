import { useEffect, useMemo, useRef, useState } from 'react';
import { CITY_TOURS, EMPTY_TOUR_STATE, createCityTourController } from '../lib/cityTour.js';

export function useCityTour({ onVisit, suspended = false, modelId = null, modelLoading = false }) {
  const [state, setState] = useState(EMPTY_TOUR_STATE);
  const [hidden, setHidden] = useState(() => document.hidden);
  const visitRef = useRef(onVisit), controllerRef = useRef(null), suspendedRef = useRef(suspended);
  visitRef.current = onVisit;
  suspendedRef.current = suspended;
  useEffect(() => {
    const controller = createCityTourController({ onVisit: (...args) => visitRef.current(...args), onChange: setState });
    controllerRef.current = controller;
    const visibility = () => {
      controller.setSuspended(document.hidden || suspendedRef.current);
      setHidden(document.hidden);
    };
    document.addEventListener('visibilitychange', visibility);
    visibility();
    return () => { controller.dispose(); controllerRef.current = null; document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useEffect(() => { controllerRef.current?.setSuspended(suspended || hidden); }, [suspended, hidden]);
  useEffect(() => { controllerRef.current?.setModelLoading(modelId, modelLoading); },
    [modelId, modelLoading, state.routeId, state.index, state.modelLoading]);
  const controls = useMemo(() => Object.fromEntries(['start', 'pause', 'resume', 'jump', 'step', 'stop', 'setDwellMs', 'getTiming']
    .map(name => [name, (...args) => controllerRef.current?.[name](...args)])), []);
  const route = CITY_TOURS.find(item => item.id === state.routeId) || null;
  return { ...state, route, stop: route?.stops[state.index] || null, controls };
}
