import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { layoutRoadLabels, roadNameSize } from '../lib/roadLabelLayout.js';
import './RoadLabels.css';

const OBSTACLES = '.environment-panel,.tour-entry,.tour-dock,.tour-picker,.scene-toolbar,.map-tools-top,.layer-panel,.detail-panel,.authored-note,.map-controls,.compass,.scene-attribution,.scene-bottom-caption,.interaction-hint,.poi-group-popover,.poi-cluster-popup';
const SLOT_COUNT = 6;

// A small passive text layer, updated only by camera/UI invalidation. It is
// intentionally separate from interactive place labels and owns no RAF/timer.
const RoadLabels = forwardRef(function RoadLabels({ visible = true, compact = false, getPoiObstacles, layoutKey }, forwardedRef) {
  const hostRef = useRef(null), slotsRef = useRef([]), latestProjection = useRef(null);
  const lastLayout = useRef({ labels: [], candidateCount: 0 }), propsRef = useRef(null), mounted = useRef(true);
  const measurements = useRef(new Map()), measureContext = useRef(null);
  propsRef.current = { visible, compact, getPoiObstacles };

  const measureNames = useCallback(candidates => {
    const slot = slotsRef.current[0];
    if (!slot) return candidates;
    if (!measureContext.current) measureContext.current = document.createElement('canvas').getContext('2d');
    const context = measureContext.current, style = getComputedStyle(slot), small = propsRef.current.compact;
    if (context) context.font = style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const spacing = parseFloat(style.letterSpacing) || 0;
    return candidates.map(candidate => {
      const key = `${small}:${candidate.name}`;
      if (!measurements.current.has(key)) {
        const fallback = roadNameSize(candidate.name, small), count = Array.from(candidate.name).length;
        measurements.current.set(key, { width: context ? Math.ceil(context.measureText(candidate.name).width + Math.max(0, count - 1) * spacing + 12) : fallback.width, height: fallback.height });
      }
      return { ...candidate, ...measurements.current.get(key) };
    });
  }, []);

  const project = useCallback(payload => {
    if (payload) latestProjection.current = payload;
    const host = hostRef.current, projection = latestProjection.current, current = propsRef.current;
    if (!host || !projection || !mounted.current) return;
    const main = host.closest('.main-scene') || host.parentElement;
    const width = Number.isFinite(projection.width) ? projection.width : main.clientWidth;
    const height = Number.isFinite(projection.height) ? projection.height : main.clientHeight;
    const mainRect = main.getBoundingClientRect();
    const obstacles = [...main.querySelectorAll(OBSTACLES)].flatMap(element => {
      const style = getComputedStyle(element), box = element.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || box.width <= 0 || box.height <= 0) return [];
      return [{ left: box.left - mainRect.left, right: box.right - mainRect.left, top: box.top - mainRect.top, bottom: box.bottom - mainRect.top }];
    });
    // Keep the currently inspected building's full silhouette clear, not
    // just its elevated POI label. Other source roads remain passive context.
    if (projection.selectedBuildingRect) obstacles.push(projection.selectedBuildingRect);
    const inspection = projection.focusClose && ['entrance', 'facade', 'crown'].includes(projection.focusAngle);
    const show = Boolean(current.visible && !inspection);
    const candidates = show ? measureNames(projection.roadLabels || []) : [];
    const result = layoutRoadLabels(candidates, { width, height, compact: current.compact, obstacles,
      poiObstacles: current.getPoiObstacles?.() || [], previousLabels: lastLayout.current.labels, selectedId: projection.selectedId });
    lastLayout.current = result;
    slotsRef.current.forEach((slot, index) => {
      if (!slot) return;
      const label = result.labels[index];
      slot.style.visibility = label ? 'visible' : 'hidden';
      if (!label) { slot.textContent = ''; slot.removeAttribute('data-road-name'); return; }
      slot.textContent = label.name; slot.dataset.roadName = label.name; slot.dataset.roadSourceId = label.sourceId || '';
      slot.style.left = `${label.x}px`; slot.style.top = `${label.y}px`;
      slot.style.width = `${label.width}px`; slot.style.height = `${label.height}px`;
      slot.style.transform = `translate(-50%,-50%) rotate(${label.angle}deg)`;
    });
    host.dataset.roadCount = String(result.labels.length);
    host.dataset.roadNames = JSON.stringify(result.labels.map(label => label.name));
    host.dataset.roadCandidates = String(result.candidateCount);
    host.dataset.roadNamesEnabled = String(current.visible);
    host.dataset.roadInspectionHidden = String(Boolean(inspection));
  }, [measureNames]);
  const refresh = useCallback(() => project(), [project]);
  useImperativeHandle(forwardedRef, () => ({ project, refresh, getStats: () => ({ count: lastLayout.current.labels.length, names: lastLayout.current.labels.map(label => label.name) }) }), [project, refresh]);
  useLayoutEffect(() => { refresh(); }, [visible, compact, getPoiObstacles, layoutKey, refresh]);
  useEffect(() => {
    mounted.current = true;
    const observer = new ResizeObserver(refresh);
    if (hostRef.current) observer.observe(hostRef.current);
    document.fonts?.ready.then(() => { if (mounted.current) { measurements.current.clear(); refresh(); } });
    return () => { mounted.current = false; observer.disconnect(); };
  }, [refresh]);

  return <div ref={hostRef} className={`road-label-layer${compact ? ' is-compact' : ''}${visible ? '' : ' is-hidden'}`}
    aria-hidden="true" data-road-count="0" data-road-names="[]" data-road-names-enabled={String(visible)}>
    {Array.from({ length: SLOT_COUNT }, (_, index) => <span key={index} className="road-label-text" ref={element => { slotsRef.current[index] = element; }}/>) }
  </div>;
});

export default RoadLabels;
