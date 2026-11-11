import React, { useEffect, useRef } from 'react';
import { Path, Play, Pause, X, CaretLeft, CaretRight, Waves, Buildings, MapTrifold, ArrowUpRight } from '@phosphor-icons/react';
import { CITY_TOURS } from '../lib/cityTour.js';

const ROUTE_ICONS = { river: Waves, building: Buildings, street: MapTrifold };

export default function CityTourControls({ tour, open, onToggle, onClose, onStart, onStop, disabled, waitingForModel = false }) {
  const playRef = useRef(null), launchRef = useRef(null);
  useEffect(() => { if (tour.routeId) playRef.current?.focus({ preventScroll: true }); }, [tour.routeId]);
  const stop = () => { tour.controls.stop(); onStop?.(); };
  const closePicker = () => { onClose(); launchRef.current?.focus({ preventScroll: true }); };
  if (tour.route) return <section className="tour-dock" aria-label="路线导览控制">
    <div className="tour-dock-top"><span><Path size={13}/>{tour.route.title}</span><span className="tour-count">{tour.index + 1} / {tour.route.stops.length}</span><button className="icon-button" onClick={stop} aria-label="结束路线导览"><X size={15}/></button></div>
    <div className="tour-current" role="status" aria-live="polite"><strong>{tour.stop.title}</strong><span>{tour.complete ? '这一程已结束' : tour.playing ? waitingForModel ? '等待建筑载入' : tour.suspended ? '暂缓播放' : '自动导览中' : '已暂停 · 自由观察'}</span></div>
    <p className="tour-caption">{tour.stop.caption}</p>
    <div className="tour-progress" role="group" aria-label="选择导览站点">{tour.route.stops.map((stop, index) => <button key={`${stop.id}:${index}`} className={index === tour.index ? 'is-current' : index < tour.index ? 'is-visited' : ''} onClick={() => tour.controls.jump(index)} aria-label={`第${index + 1}站：${stop.title}`} aria-current={index === tour.index ? 'step' : undefined}><span/></button>)}</div>
    <div className="tour-playback"><button className="icon-button" aria-label="导览上一站" disabled={tour.index === 0} onClick={() => tour.controls.step(-1)}><CaretLeft size={16}/></button><button ref={playRef} className="tour-play" onClick={tour.playing ? tour.controls.pause : tour.controls.resume}>{tour.playing ? <Pause size={15} weight="fill"/> : <Play size={15} weight="fill"/>}<span>{tour.playing ? '暂停导览' : tour.complete ? '再看一次' : '继续导览'}</span></button><button className="icon-button" aria-label="导览下一站" disabled={tour.index === tour.route.stops.length - 1} onClick={() => tour.controls.step(1)}><CaretRight size={16}/></button></div>
  </section>;
  return <div className={`tour-entry ${open ? 'is-open' : ''}`}>
    <button ref={launchRef} className="tour-launch" onClick={onToggle} aria-expanded={open} aria-controls="city-tour-routes"><span className="tour-launch-icon"><Path size={22}/></span><span><strong>跟着路线，慢慢看</strong><small>沿江山水 / 城市建筑 / 街巷细节</small></span><ArrowUpRight size={18}/></button>
    {open && <section id="city-tour-routes" className="tour-picker" aria-label="选择导览路线">
      <header><span>选择一段宜昌风景</span><button className="icon-button" onClick={closePicker} aria-label="关闭导览路线"><X size={16}/></button></header>
      {CITY_TOURS.map(route => { const Icon = ROUTE_ICONS[route.icon]; return <button key={route.id} className="tour-route" disabled={disabled} onClick={() => onStart(route.id)}><Icon size={21}/><span><strong>{route.title}<small>{route.stops.length}站</small></strong><em>{route.subtitle}</em></span><Play size={15}/></button>; })}
      <p>{disabled ? '三维场景就绪后即可开始导览。' : '每站停留约14秒；拖动沙盘即暂停，可随时接着看。'}</p>
    </section>}
  </div>;
}
