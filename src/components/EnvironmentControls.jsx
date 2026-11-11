import React, { useEffect, useRef } from 'react';
import { Sun, SunHorizon, MoonStars, Cloud, CloudFog, CloudRain, X, CaretDown } from '@phosphor-icons/react';

export const SCENE_TIMES = [
  { id: 'day', label: '晴昼', note: '清朗日光', Icon: Sun },
  { id: 'sunset', label: '日落', note: '金色江岸', Icon: SunHorizon },
  { id: 'night', label: '夜景', note: '灯火初上', Icon: MoonStars },
];
export const SCENE_WEATHER = [
  { id: 'clear', label: '晴朗', Icon: Sun },
  { id: 'overcast', label: '多云', Icon: Cloud },
  { id: 'mist', label: '江雾', Icon: CloudFog },
  { id: 'rain', label: '小雨', Icon: CloudRain },
];

export default function EnvironmentControls({ timeOfDay, weather, onTimeChange, onWeatherChange, open, onToggle, onClose, disabled }) {
  const root = useRef(null), toggle = useRef(null);
  const selectedTime = SCENE_TIMES.find(item => item.id === timeOfDay) || SCENE_TIMES[0];
  const selectedWeather = SCENE_WEATHER.find(item => item.id === weather) || SCENE_WEATHER[0];
  const Icon = selectedWeather.id === 'clear' ? selectedTime.Icon : selectedWeather.Icon;
  const closeWithFocus = () => { onClose(); toggle.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    if (!open) return;
    const pointer = event => { if (!root.current?.contains(event.target)) onClose(); };
    const keyboard = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); toggle.current?.focus(); } };
    document.addEventListener('pointerdown', pointer);
    root.current?.addEventListener('keydown', keyboard);
    const element = root.current;
    return () => { document.removeEventListener('pointerdown', pointer); element?.removeEventListener('keydown', keyboard); };
  }, [open, onClose]);
  return <div className="environment-controls" ref={root}>
    <button ref={toggle} className={`layer-toggle environment-toggle ${open ? 'active' : ''}`} onClick={onToggle}
      aria-expanded={open} aria-controls="scene-environment" aria-label={`场景氛围：${selectedTime.label}，${selectedWeather.label}`}>
      <Icon size={17}/><span>时光与天气</span><CaretDown size={11}/>
    </button>
    {open && <section id="scene-environment" className="environment-panel" aria-label="时光与天气设置">
      <header><div><span className="eyebrow">一城山水 · 多种光景</span><h2>此刻，你想看怎样的宜昌？</h2></div><button className="icon-button" onClick={closeWithFocus} aria-label="关闭时光与天气设置"><X size={16}/></button></header>
      <fieldset disabled={disabled}><legend>一天的光线</legend><div className="environment-times">{SCENE_TIMES.map(({ id, label, note, Icon: TimeIcon }) =>
        <button key={id} className={`time-choice time-${id} ${timeOfDay === id ? 'is-active' : ''}`} aria-pressed={timeOfDay === id} onClick={() => onTimeChange(id)}><TimeIcon size={23}/><strong>{label}</strong><small>{note}</small></button>)}</div></fieldset>
      <fieldset disabled={disabled}><legend>江城天气</legend><div className="environment-weather">{SCENE_WEATHER.map(({ id, label, Icon: WeatherIcon }) =>
        <button key={id} className={weather === id ? 'is-active' : ''} aria-pressed={weather === id} onClick={() => onWeatherChange(id)}><WeatherIcon size={19}/><span>{label}</span></button>)}</div></fieldset>
      <p className="environment-note">{disabled ? '三维场景就绪后，可切换光线与天气。' : '场景氛围模拟 · 可在图层中暂停动态'}</p>
    </section>}
  </div>;
}
