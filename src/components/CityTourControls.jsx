import React, { useEffect, useRef, useState } from 'react';
import { Path, Play, Pause, X, CaretLeft, CaretRight, Waves, Buildings, MapTrifold, ArrowUpRight } from '@phosphor-icons/react';
import { CITY_TOURS, DEFAULT_TOUR_DWELL_MS, TOUR_PACES } from '../lib/cityTour.js';

const ROUTE_ICONS = { river: Waves, building: Buildings, street: MapTrifold };

export default function CityTourControls({ tour, open, onToggle, onClose, onStart, onStop, disabled }) {
  const playRef = useRef(null), launchRef = useRef(null);
  const [, refreshClock] = useState(0);
  useEffect(() => { if (tour.routeId) playRef.current?.focus({ preventScroll: true }); }, [tour.routeId]);
  useEffect(() => {
    if (!tour.routeId || !tour.playing || tour.suspended) return;
    const timer = setInterval(() => refreshClock(value => value + 1), 200);
    return () => clearInterval(timer);
  }, [tour.routeId, tour.playing, tour.suspended]);
  const timing = tour.controls.getTiming?.() || { remainingMs: DEFAULT_TOUR_DWELL_MS, durationMs: DEFAULT_TOUR_DWELL_MS };
  const seconds = Math.ceil(timing.remainingMs / 1000);
  const nextStop = tour.route?.stops[tour.index + 1];
  const status = tour.complete ? '这一程已结束' : !tour.playing ? '已暂停 · 自由观察' : tour.suspended ? '暂缓播放'
    : timing.waitingForModel ? `建筑载入中 · 最多${Math.ceil(timing.modelWaitRemainingMs / 1000)}秒`
      : tour.modelLoading ? `载入较慢 · ${seconds}秒后继续` : `${seconds}秒后${nextStop ? '切换下一站' : '结束本程'}`;
  const progress = Math.min(1, Math.max(0, 1 - timing.remainingMs / timing.durationMs));
  const stop = () => { tour.controls.stop(); onStop?.(); };
  const closePicker = () => { onClose(); launchRef.current?.focus({ preventScroll: true }); };
  if (tour.route) return <section className="tour-dock" aria-label="路线导览控制">
    <div className="tour-dock-top"><span><Path size={13}/>{tour.route.title}</span><span className="tour-count">{tour.index + 1} / {tour.route.stops.length}</span><button className="icon-button" onClick={stop} aria-label="结束路线导览"><X size={15}/></button></div>
    <div className="tour-current"><strong role="status" aria-live="polite">{tour.stop.title}</strong><span className="tour-timing" aria-live="off">{status}</span></div>
    <p className="tour-caption">{tour.stop.caption}</p>
    <div className="tour-progress" role="group" aria-label="选择导览站点">{tour.route.stops.map((stop, index) => <button key={`${stop.id}:${index}`} className={index === tour.index ? 'is-current' : index < tour.index ? 'is-visited' : ''} onClick={() => tour.controls.jump(index)} aria-label={`第${index + 1}站：${stop.title}`} aria-current={index === tour.index ? 'step' : undefined}><span><i style={index === tour.index ? { transform: `scaleX(${progress})` } : undefined}/></span></button>)}</div>
    <div className="tour-playback"><button className="icon-button" aria-label="导览上一站" disabled={tour.index === 0} onClick={() => tour.controls.step(-1)}><CaretLeft size={16}/></button><button ref={playRef} className="tour-play" onClick={tour.playing ? tour.controls.pause : tour.controls.resume}>{tour.playing ? <Pause size={15} weight="fill"/> : <Play size={15} weight="fill"/>}<span>{tour.playing ? '暂停导览' : tour.complete ? '再看一次' : '继续导览'}</span></button><button className="icon-button" aria-label="导览下一站" disabled={tour.index === tour.route.stops.length - 1} onClick={() => tour.controls.step(1)}><CaretRight size={16}/></button></div>
    <div className="tour-pacing"><span className="tour-next" title={nextStop ? `下一站：${nextStop.title}` : '本程最后一站'}>{nextStop ? `下一站：${nextStop.title}` : '本程最后一站'}</span><select aria-label="自动导览切换间隔" value={tour.dwellMs} onChange={event => tour.controls.setDwellMs(Number(event.target.value))}>{TOUR_PACES.map(pace => <option key={pace.value} value={pace.value}>{pace.label}</option>)}</select></div>
  </section>;
  return <div className={`tour-entry ${open ? 'is-open' : ''}`}>
    <button ref={launchRef} className="tour-launch" onClick={onToggle} aria-expanded={open} aria-controls="city-tour-routes"><span className="tour-launch-icon"><Path size={22}/></span><span><strong>跟着路线，慢慢看</strong><small>沿江山水 / 城市建筑 / 街巷细节</small></span><ArrowUpRight size={18}/></button>
    {open && <section id="city-tour-routes" className="tour-picker" aria-label="选择导览路线">
      <header><span>选择一段宜昌风景</span><button className="icon-button" onClick={closePicker} aria-label="关闭导览路线"><X size={16}/></button></header>
      {CITY_TOURS.map(route => { const Icon = ROUTE_ICONS[route.icon]; return <button key={route.id} className="tour-route" disabled={disabled} onClick={() => onStart(route.id)}><Icon size={21}/><span><strong>{route.title}<small>{route.stops.length}站</small></strong><em>{route.subtitle}</em></span><Play size={15}/></button>; })}
      <p>{disabled ? '三维场景就绪后即可开始导览。' : `每站约${(tour.dwellMs || DEFAULT_TOUR_DWELL_MS) / 1000}秒，可调节奏；模型加载最多额外等3秒。拖动沙盘即暂停。`}</p>
    </section>}
  </div>;
}
