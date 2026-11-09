import React, { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, CaretRight, MagnifyingGlassPlus, MapPin, Stack, X } from '@phosphor-icons/react';
import { layoutPoiLabels, POI_CLUSTER_DIMENSIONS } from '../lib/poiLabelLayout.js';

const OBSTACLES = '.scene-toolbar,.map-tools-top,.layer-panel,.detail-panel,.authored-note,.map-controls,.scene-attribution,.scene-bottom-caption,.interaction-hint';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const circlePath = (x, y, radius) => 'M' + (x - radius) + ',' + y + 'a' + radius + ',' + radius + ' 0 1,0 ' + (radius * 2) + ',0a' + radius + ',' + radius + ' 0 1,0 ' + (-radius * 2) + ',0';

function placeStatus(place) {
  if (!place.business) return place.category || '城市地标';
  if (place.modelStatus === 'available') return (place.stage || '自建模型 · 阶段候选') + ' · 非实测';
  if (place.modelStatus === 'registration-pending') return '独立候选预览 · 地图配准待核准';
  return '导览参考点 · 模型待恢复';
}

function focusable(element) {
  return Boolean(element?.isConnected && !element.closest('[inert], [hidden], [aria-hidden="true"]')
    && !element.disabled && element.getClientRects().length
    && getComputedStyle(element).visibility !== 'hidden');
}

// Geographic anchors belong to the scene. Only these screen labels are grouped
// and moved; neither a cluster centre nor a displaced label is written back.
const PoiLabels = forwardRef(function PoiLabels({
  places = [], selectedId = null, visible = true, compact = false,
  onSelect, onZoomGroup, onOpenGroup, layoutKey,
}, forwardedRef) {
  const hostRef = useRef(null);
  const svgRef = useRef(null);
  const lineRef = useRef(null);
  const selectedLineRef = useRef(null);
  const dotsRef = useRef(null);
  const selectedDotRef = useRef(null);
  const soloRefs = useRef(new Map());
  const clusterRefs = useRef(new Map());
  const measureRef = useRef(new Map());
  const popupRef = useRef(null);
  const popupRowsRef = useRef(new Map());
  const latestProjection = useRef(null);
  const latestLayout = useRef({ markers: [], representedIds: [], constrained: false });
  const topologyRef = useRef('');
  const openRef = useRef(null);
  const focusFrameRef = useRef(0);
  const mountedRef = useRef(true);
  const propsRef = useRef(null);
  const [clusters, setClusters] = useState([]);
  const [openGroup, setOpenGroup] = useState(null);
  const popupTitleId = useId();
  propsRef.current = { places, selectedId, visible, compact, onSelect, onZoomGroup, onOpenGroup };

  const dismiss = useCallback(({ restoreFocus = false } = {}) => {
    const previous = openRef.current;
    if (!previous) return false;
    openRef.current = null;
    setOpenGroup(null);
    cancelAnimationFrame(focusFrameRef.current);
    if (restoreFocus) {
      focusFrameRef.current = requestAnimationFrame(() => {
        if (!mountedRef.current || !propsRef.current.visible) return;
        const trigger = clusterRefs.current.get(previous.key);
        const selected = soloRefs.current.get(propsRef.current.selectedId);
        if (focusable(trigger)) trigger.focus({ preventScroll: true });
        else if (focusable(selected)) selected.focus({ preventScroll: true });
        else if (focusable(hostRef.current)) hostRef.current.focus({ preventScroll: true });
      });
    }
    return true;
  }, []);

  const positionPopup = useCallback(() => {
    const popup = popupRef.current, host = hostRef.current, current = openRef.current;
    if (!popup || !host || !current) return;
    if (propsRef.current.compact) {
      popup.style.removeProperty('left');
      popup.style.removeProperty('top');
      return;
    }
    const marker = latestLayout.current.markers.find(item => item.key === current.key);
    if (!marker) return;
    const width = host.clientWidth, height = host.clientHeight;
    const popupWidth = popup.offsetWidth, popupHeight = popup.offsetHeight, margin = 12;
    const left = clamp(marker.left + marker.width / 2 - popupWidth / 2, margin, Math.max(margin, width - popupWidth - margin));
    const below = marker.top + marker.height + 9;
    const wantedTop = below + popupHeight <= height - margin ? below : marker.top - popupHeight - 9;
    popup.style.left = left + 'px';
    popup.style.top = clamp(wantedTop, margin, Math.max(margin, height - popupHeight - margin)) + 'px';
  }, []);

  const measureSoloButtons = useCallback(() => {
    const measured = new Map();
    const savedWidths = new Map();
    // Measure intrinsic text, not the width assigned by the previous layout.
    // Batch these writes before reading so repeated refreshes cannot grow a
    // label or retain the previous device/font's wider measurement.
    for (const [id, button] of soloRefs.current) {
      savedWidths.set(id, button.style.width);
      button.style.width = 'max-content';
    }
    for (const place of propsRef.current.places) {
      const button = soloRefs.current.get(place.id);
      if (!button) continue;
      const title = button.querySelector('.poi-label-title');
      const note = button.querySelector('.poi-label-note');
      const style = getComputedStyle(button);
      const horizontal = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
        + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
      const vertical = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
        + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const textWidth = Math.max(title?.scrollWidth || 0, note?.scrollWidth || 0,
        title?.getBoundingClientRect().width || 0, note?.getBoundingClientRect().width || 0);
      measured.set(place.id, {
        width: Math.ceil(Math.max(parseFloat(style.minWidth) || 0,
          textWidth + horizontal + 1)),
        height: Math.ceil(Math.max(parseFloat(style.minHeight) || 0,
          (title?.offsetHeight || 14) + (note ? note.offsetHeight + 3 : 0) + vertical)),
      });
    }
    for (const [id, button] of soloRefs.current) button.style.width = savedWidths.get(id) || '';
    measureRef.current = measured;
  }, []);

  const applyLayout = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const show = propsRef.current.visible;
    const { markers, representedIds, constrained } = latestLayout.current;
    const activeSoloIds = new Set(), activeClusterKeys = new Set();
    let lines = '', selectedLines = '';
    for (const marker of markers) {
      const solo = marker.memberIds.length === 1;
      const element = solo ? soloRefs.current.get(marker.memberIds[0]) : clusterRefs.current.get(marker.key);
      if (solo) activeSoloIds.add(marker.memberIds[0]); else activeClusterKeys.add(marker.key);
      if (element) {
        element.style.left = marker.left + 'px';
        element.style.top = marker.top + 'px';
        element.style.width = marker.width + 'px';
        element.style.height = marker.height + 'px';
        element.style.visibility = show ? 'visible' : 'hidden';
        element.style.pointerEvents = show ? 'auto' : 'none';
        element.tabIndex = show ? 0 : -1;
        element.setAttribute('aria-hidden', show ? 'false' : 'true');
      }
      const x = clamp(marker.anchorX, marker.left, marker.left + marker.width);
      const y = clamp(marker.anchorY, marker.top, marker.top + marker.height);
      if (Math.hypot(x - marker.anchorX, y - marker.anchorY) > 3) {
        const segment = 'M' + marker.anchorX + ',' + marker.anchorY + 'L' + x + ',' + y;
        if (marker.selected) selectedLines += segment; else lines += segment;
      }
    }
    const hide = element => {
      element.style.visibility = 'hidden'; element.style.pointerEvents = 'none';
      element.tabIndex = -1; element.setAttribute('aria-hidden', 'true');
    };
    for (const [id, element] of soloRefs.current) if (!activeSoloIds.has(id)) hide(element);
    for (const [key, element] of clusterRefs.current) if (!activeClusterKeys.has(key)) hide(element);
    lineRef.current?.setAttribute('d', show ? lines : '');
    selectedLineRef.current?.setAttribute('d', show ? selectedLines : '');
    const represented = new Set(representedIds);
    let dots = '', selectedDot = '';
    for (const point of latestProjection.current?.labels || []) {
      if (!represented.has(point.id)) continue;
      if (point.id === propsRef.current.selectedId) selectedDot += circlePath(point.x, point.y, 3.2);
      else dots += circlePath(point.x, point.y, 1.8);
    }
    dotsRef.current?.setAttribute('d', show ? dots : '');
    selectedDotRef.current?.setAttribute('d', show ? selectedDot : '');
    host.dataset.representedPois = String(show ? representedIds.length : 0);
    host.dataset.representedIds = JSON.stringify(show ? representedIds : []);
    host.dataset.clusterCount = String(show ? markers.filter(item => item.memberIds.length > 1).length : 0);
    host.dataset.layoutConstrained = String(constrained);
    positionPopup();
  }, [positionPopup]);

  const project = useCallback(payload => {
    if (payload) latestProjection.current = payload;
    const projection = latestProjection.current, host = hostRef.current;
    if (!projection || !host || !mountedRef.current) return;
    const current = propsRef.current;
    const main = host.closest('.main-scene') || host.parentElement;
    const width = Number.isFinite(projection.width) ? projection.width : main.clientWidth;
    const height = Number.isFinite(projection.height) ? projection.height : main.clientHeight;
    if (!(width > 0 && height > 0)) return;
    if (!measureRef.current.size) measureSoloButtons();
    const mainRect = main.getBoundingClientRect();
    const obstacles = [...main.querySelectorAll(OBSTACLES)].filter(element => {
      const style = getComputedStyle(element), box = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
    }).map(element => {
      const box = element.getBoundingClientRect();
      return { left: box.left - mainRect.left, top: box.top - mainRect.top,
        right: box.right - mainRect.left, bottom: box.bottom - mainRect.top };
    });
    const known = new Set(current.places.map(place => place.id));
    const points = (projection.labels || []).filter(point => known.has(point.id))
      .map(point => ({ ...point, ...(measureRef.current.get(point.id) || { width: 96, height: current.compact ? 44 : 32 }) }));
    const visibleIds = [...new Set(points.filter(point => point.visible !== false
      && Number.isFinite(point.x) && Number.isFinite(point.y)
      && point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height).map(point => point.id))];
    const layout = layoutPoiLabels(points, { width, height, selectedId: current.selectedId, compact: current.compact, obstacles });
    latestLayout.current = layout;
    host.dataset.visiblePois = String(current.visible ? visibleIds.length : 0);
    host.dataset.visibleIds = JSON.stringify(current.visible ? visibleIds : []);
    svgRef.current?.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    const nextClusters = layout.markers.filter(marker => marker.memberIds.length > 1)
      .map(marker => ({ key: marker.key, memberIds: marker.memberIds }));
    const topology = nextClusters.map(marker => marker.key).sort().join('\n');
    if (topology !== topologyRef.current) {
      topologyRef.current = topology;
      setClusters(nextClusters);
    }
    if (openRef.current && !layout.markers.some(marker => marker.key === openRef.current.key)) {
      // A zoom may split a cluster. Its old snapshot must not remain a second,
      // stale navigation list after the map has regrouped.
      dismiss({ restoreFocus: Boolean(popupRef.current?.contains(document.activeElement)) });
    }
    applyLayout();
  }, [applyLayout, dismiss, measureSoloButtons]);

  const refresh = useCallback(() => { measureSoloButtons(); project(); }, [measureSoloButtons, project]);
  useImperativeHandle(forwardedRef, () => ({ project, refresh, dismiss }), [project, refresh, dismiss]);

  useLayoutEffect(() => { refresh(); }, [places, selectedId, compact, visible, layoutKey, refresh]);
  useLayoutEffect(() => { applyLayout(); }, [clusters, applyLayout]);
  useEffect(() => { if (!visible) dismiss(); }, [visible, dismiss]);
  useEffect(() => {
    mountedRef.current = true;
    const host = hostRef.current;
    const observer = new ResizeObserver(refresh);
    if (host) observer.observe(host);
    document.fonts?.ready.then(() => { if (mountedRef.current) refresh(); });
    return () => {
      mountedRef.current = false; observer.disconnect();
      cancelAnimationFrame(focusFrameRef.current);
    };
  }, [refresh]);

  useLayoutEffect(() => {
    if (!openGroup) return;
    positionPopup();
    const first = popupRowsRef.current.get(openGroup.memberIds[0]);
    first?.focus({ preventScroll: true });
    const observer = new ResizeObserver(positionPopup);
    if (popupRef.current) observer.observe(popupRef.current);
    return () => observer.disconnect();
  }, [openGroup, positionPopup]);

  useEffect(() => {
    if (!openGroup) return;
    const outside = event => {
      const trigger = clusterRefs.current.get(openRef.current?.key);
      if (!popupRef.current?.contains(event.target) && !trigger?.contains(event.target)) dismiss();
    };
    const key = event => {
      if (event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); dismiss({ restoreFocus: true });
      }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', key);
    };
  }, [openGroup, dismiss]);

  const open = marker => {
    if (!propsRef.current.visible) return;
    if (openRef.current?.key === marker.key) { dismiss({ restoreFocus: true }); return; }
    propsRef.current.onOpenGroup?.(marker.memberIds);
    const next = { key: marker.key, memberIds: [...marker.memberIds] };
    openRef.current = next;
    setOpenGroup(next);
  };
  const selectMember = id => {
    dismiss();
    propsRef.current.onSelect?.(id);
    cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = requestAnimationFrame(() => {
      const marker = soloRefs.current.get(id);
      if (focusable(marker)) marker.focus({ preventScroll: true });
      else if (focusable(hostRef.current)) hostRef.current.focus({ preventScroll: true });
    });
  };
  const popupKeys = event => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const ids = openRef.current?.memberIds || [];
    if (!ids.length) return;
    const index = ids.findIndex(id => popupRowsRef.current.get(id) === document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1
      : index < 0 ? event.key === 'ArrowUp' ? ids.length - 1 : 0
        : (index + (event.key === 'ArrowUp' ? -1 : 1) + ids.length) % ids.length;
    event.preventDefault();
    popupRowsRef.current.get(ids[next])?.focus({ preventScroll: true });
    popupRowsRef.current.get(ids[next])?.scrollIntoView({ block: 'nearest' });
  };
  const placeById = new Map(places.map(place => [place.id, place]));
  const clusterSize = POI_CLUSTER_DIMENSIONS[compact ? 'compact' : 'desktop'];

  return <div ref={hostRef} className={'poi-label-layer' + (compact ? ' is-compact' : '') + (!visible ? ' is-hidden' : '')}
    data-poi-clusters="" data-visible-pois="0" data-represented-pois="0" data-cluster-count="0"
    inert={!visible} aria-hidden={!visible ? true : undefined} aria-label="地图地点标注与附近分组" tabIndex={-1}>
    <svg ref={svgRef} className="poi-anchor-lines" aria-hidden="true">
      <path ref={lineRef} className="poi-connector"/>
      <path ref={selectedLineRef} className="poi-connector is-selected"/>
      <path ref={dotsRef} className="poi-anchor-dots"/>
      <path ref={selectedDotRef} className="poi-anchor-dots is-selected"/>
    </svg>
    {places.map(place => <button key={place.id}
      ref={element => { if (element) soloRefs.current.set(place.id, element); else soloRefs.current.delete(place.id); }}
      className={'poi-marker poi-solo' + (selectedId === place.id ? ' is-selected' : '') + (place.kind === 'business-poi' ? ' is-reference' : '')}
      data-poi-members={JSON.stringify([place.id])} data-poi-count="1" tabIndex={-1}
      title={place.name + (place.kind === 'business-poi' ? ' · 导览参考点' : '')}
      aria-label={'查看' + place.name + (place.kind === 'business-poi' ? '的导览参考点' : '')}
      onClick={() => selectMember(place.id)}>
      <span className="poi-label-title">{place.name}</span>
      {selectedId === place.id && place.kind === 'business-poi' && <small className="poi-label-note">导览参考点</small>}
    </button>)}
    {clusters.map(marker => <button key={marker.key}
      ref={element => { if (element) clusterRefs.current.set(marker.key, element); else clusterRefs.current.delete(marker.key); }}
      className={'poi-marker poi-cluster' + (openGroup?.key === marker.key ? ' is-open' : '')}
      style={{ width: clusterSize.width, height: clusterSize.height }}
      data-poi-members={JSON.stringify(marker.memberIds)} data-poi-count={marker.memberIds.length} tabIndex={-1}
      aria-label={'附近' + marker.memberIds.length + '处地点，展开列表'} aria-haspopup="dialog"
      aria-expanded={openGroup?.key === marker.key} aria-controls={openGroup?.key === marker.key ? popupTitleId + '-panel' : undefined}
      onClick={() => open(marker)}>
      <Stack size={13}/><span>附近 <strong>{marker.memberIds.length}</strong> 处</span>
    </button>)}
    {visible && openGroup && <section ref={popupRef} id={popupTitleId + '-panel'} className="poi-group-popover"
      role="dialog" aria-labelledby={popupTitleId} onKeyDown={popupKeys}>
      <header><div><span className="eyebrow">沿着街区，逐处看看</span><h3 id={popupTitleId}>附近 {openGroup.memberIds.length} 处</h3></div>
        <button className="icon-button" aria-label="关闭附近地点列表" onClick={() => dismiss({ restoreFocus: true })}><X size={18}/></button>
      </header>
      <div className="poi-group-list">
        {openGroup.memberIds.map(id => {
          const place = placeById.get(id);
          if (!place) return null;
          return <button key={id} ref={element => { if (element) popupRowsRef.current.set(id, element); else popupRowsRef.current.delete(id); }}
            className={'poi-group-row' + (selectedId === id ? ' is-selected' : '')} onClick={() => selectMember(id)}>
            <MapPin size={15}/><span><strong>{place.name}</strong><small>{placeStatus(place)}</small></span><CaretRight size={14}/>
          </button>;
        })}
      </div>
      <footer><span>可直接选择地点，也可放大后逐处查看。</span><button onClick={() => {
        const ids = [...openGroup.memberIds]; dismiss();
        propsRef.current.onZoomGroup?.(ids);
        hostRef.current?.focus({ preventScroll: true });
      }}><MagnifyingGlassPlus size={15}/>放大这组<ArrowUpRight size={13}/></button></footer>
    </section>}
  </div>;
});

export default PoiLabels;
