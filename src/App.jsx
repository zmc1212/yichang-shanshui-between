import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapTrifold, MagnifyingGlass, Sun, MoonStars, ArrowCounterClockwise, Stack, X, CaretLeft, CaretRight, CaretDown, CaretUp, Plus, Minus, Play, Pause, Buildings, Tree, MapPin, CursorClick, List, Compass, ArrowUpRight, CircleNotch, WarningCircle, ArrowLeft, Check, NavigationArrow, Mouse, Camera, Waves, LinkSimple } from '@phosphor-icons/react';
import { createCityScene } from './scene/createCityScene.js';
import { AUTHORED_MODELS } from './scene/authoredModels.js';
import { BUSINESS_BUILDINGS, BUSINESS_REGISTRY_INFO } from './scene/buildingCatalog.js';
import ModelPreview from './components/ModelPreview.jsx';
import { buildDirectoryResults, getDirectoryNavigation, moveDirectoryActiveId, isComposingKeyEvent } from './lib/directoryNavigation.js';
import { createSceneLocationUrl } from './lib/sceneLocation.js';
import { useSceneLocation } from './hooks/useSceneLocation.js';

const businessStatus = building => building.modelStatus === 'available'
  ? '自建模型 · 阶段候选'
  : building.modelStatus === 'registration-pending'
    ? building.assets?.light ? '独立预览 · 待配准' : '模型待配准'
    : '导览点 · 模型待恢复';

function canReceiveFocus(element) {
  if (!element?.isConnected || element.closest('[inert], [hidden], [aria-hidden="true"]')) return false;
  if (element.matches(':disabled, [aria-disabled="true"]') || element.tabIndex < 0) return false;
  const style = window.getComputedStyle(element);
  return style.visibility !== 'hidden' && style.visibility !== 'collapse' && element.getClientRects().length > 0;
}

function focusableControls(container) {
  return [...(container?.querySelectorAll('button, a[href], input, select, textarea, [tabindex]') || [])]
    .filter(canReceiveFocus);
}

function containTabFocus(event, container) {
  if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey) return;
  const controls = focusableControls(container);
  if (!controls.length) { event.preventDefault(); container?.focus(); return; }
  const first = controls[0], last = controls[controls.length - 1];
  const activeIndex = controls.indexOf(document.activeElement);
  if (event.shiftKey && activeIndex <= 0) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (activeIndex < 0 || document.activeElement === last)) { event.preventDefault(); first.focus(); }
}

function isTextEntryTarget(target) {
  return Boolean(target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'));
}

function Modal({ title, children, onClose, className = '', fallbackFocusRef }) {
  const panel = useRef(null);
  useEffect(() => {
    const before = document.activeElement;
    panel.current?.focus();
    const handle = e => {
      if(isComposingKeyEvent(e)) return;
      if(e.key === 'Escape') {e.preventDefault();onClose();}
      containTabFocus(e, panel.current);
    };
    document.addEventListener('keydown', handle);
    return () => {
      document.removeEventListener('keydown', handle);
      if (canReceiveFocus(before)) before.focus({ preventScroll: true });
      else if (canReceiveFocus(fallbackFocusRef?.current)) fallbackFocusRef.current.focus({ preventScroll: true });
    };
  }, [onClose, fallbackFocusRef]);
  return <div className="modal-shade" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title} ref={panel} tabIndex={-1}>
    <header><div><span className="eyebrow">YICHANG · CITY ATLAS</span><h2>{title}</h2></div><button className="icon-button" aria-label="关闭弹窗" onClick={onClose}><X size={20}/></button></header>{children}
  </section></div>;
}

export default function App(){
  const canvasHost = useRef(null);
  const scene = useRef(null);
  const labelRefs = useRef({});
  const compassRef = useRef(null);
  const captureTimer = useRef(null);
  const selectedRef = useRef(null);
  const searchInputRef = useRef(null);
  const sidebarRef = useRef(null);
  const mobileMenuRef = useRef(null);
  const directoryListRef = useRef(null);
  const directoryRowRefs = useRef({});
  const detailPanelRef = useRef(null);
  const detailContentRef = useRef(null);
  const isComposingRef = useRef(false);
  const suppressSearchSubmitRef = useRef(false);
  const compositionEndTimerRef = useRef(null);
  const modalRef = useRef(null);
  const [data,setData]=useState(null);
  const [ready,setReady]=useState(false);
  const [error,setError]=useState('');
  const [query,setQuery]=useState('');
  const [activeResultId,setActiveResultId]=useState(null);
  const [searchFocused,setSearchFocused]=useState(false);
  const [directoryFilter,setDirectoryFilter]=useState('all');
  const [selectedId,setSelectedId]=useState(null);
  const [theme,setTheme]=useState('day');
  const [view,setView]=useState('perspective');
  const [autoRotate,setAutoRotate]=useState(false);
  const [layersOpen,setLayersOpen]=useState(false);
  const [layers,setLayers]=useState({buildings:true,trees:true,labels:true});
  const [modal,setModal]=useState(null);
  const [mobileNav,setMobileNav]=useState(false);
  const [detailCollapsed,setDetailCollapsed]=useState(false);
  const [detailImage,setDetailImage]=useState('');
  const [detailTab,setDetailTab]=useState('story');
  const [closeView,setCloseView]=useState(false);
  const [cameraAngle,setCameraAngle]=useState('detail');
  const [toast,setToast]=useState('');
  const [locationLink,setLocationLink]=useState('');
  const [modelStates,setModelStates]=useState({});
  const [motionEnabled,setMotionEnabled]=useState(()=>!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [compact,setCompact]=useState(()=>window.matchMedia('(max-width: 700px)').matches);
  const landmarks = useMemo(()=>data ? [...data.landmarks, ...BUSINESS_BUILDINGS] : [],[data]);
  const mobileNavOpen = compact && mobileNav;
  modalRef.current = modal;
  const selected = landmarks.find(l=>l.id===selectedId);
  const authored = selected?.kind === 'authored';
  const business = Boolean(selected?.business);
  const guideOnly = business && !authored;
  const canPreviewCandidate = guideOnly && selected.modelStatus === 'registration-pending' && Boolean(selected.assets?.light);
  const registrationLabel = business ? selected.registration?.label || '位置待核准' : '';
  const sourcePeriod = selected?.sourcePeriod || selected?.period;
  const sourcePeriodLabel = sourcePeriod?.startsWith('2022 tour; historic 2021') ? '2022 年导图 · 含 2021 年历史统计' : sourcePeriod;
  const modelState = authored ? modelStates[selectedId] : null;
  const availableCount = BUSINESS_BUILDINGS.filter(l=>l.modelStatus==='available').length;
  const recoveryCount = BUSINESS_BUILDINGS.filter(l=>l.modelStatus==='recovery-pending').length;
  const registrationCount = BUSINESS_BUILDINGS.filter(l=>l.modelStatus==='registration-pending').length;
  const previewCount = BUSINESS_BUILDINGS.filter(l=>l.modelStatus==='registration-pending'&&l.assets?.light).length;
  const {groups:directoryGroups,items:filtered} = useMemo(
    ()=>buildDirectoryResults(landmarks,{query,filter:directoryFilter}),[landmarks,query,directoryFilter]);
  const directoryNavigation = useMemo(()=>getDirectoryNavigation(filtered,selectedId),[filtered,selectedId]);
  const directoryPositions = useMemo(()=>new Map(filtered.map((item,index)=>[item.id,index+1])),[filtered]);
  const activeResult = filtered.find(item=>item.id===activeResultId);

  useEffect(()=>{setActiveResultId(null);},[query,directoryFilter]);
  useEffect(()=>()=>clearTimeout(compositionEndTimerRef.current),[]);
  useEffect(()=>{
    setActiveResultId(id=>filtered.some(item=>item.id===id)?id:null);
  },[filtered]);
  useEffect(()=>{
    if(!searchFocused||!activeResultId)return;
    const list=directoryListRef.current,row=directoryRowRefs.current[activeResultId];
    if(!list||!row)return;
    const listRect=list.getBoundingClientRect(),rowRect=row.getBoundingClientRect();
    if(rowRect.top<listRect.top)list.scrollTop+=rowRect.top-listRect.top;
    else if(rowRect.bottom>listRect.bottom)list.scrollTop+=rowRect.bottom-listRect.bottom;
  },[activeResultId,searchFocused]);
  useEffect(()=>{
    if(!mobileNavOpen)return;
    searchInputRef.current?.focus({preventScroll:true});
    const handle=event=>{if(!modalRef.current)containTabFocus(event,sidebarRef.current);};
    document.addEventListener('keydown',handle);
    return()=>{
      document.removeEventListener('keydown',handle);
      if(!modalRef.current&&canReceiveFocus(mobileMenuRef.current))mobileMenuRef.current.focus({preventScroll:true});
    };
  },[mobileNavOpen]);

  useEffect(()=>{
    const controller = new AbortController();
    fetch('/data/city.json',{signal:controller.signal,cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error('城市数据暂未加载成功');return r.json();}).then(setData).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
    const motionMedia=window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion=()=>setMotionEnabled(!motionMedia.matches);
    motionMedia.addEventListener('change',updateMotion);
    const media=window.matchMedia('(max-width: 700px)');
    const updateCompact=()=>setCompact(media.matches);
    media.addEventListener('change',updateCompact);
    return()=>{controller.abort();media.removeEventListener('change',updateCompact);motionMedia.removeEventListener('change',updateMotion);};
  },[]);

  const capturePostcard=useCallback((delay=1500)=>{
    clearTimeout(captureTimer.current);
    captureTimer.current=setTimeout(()=>{
      try{
        const stats=scene.current?.getStats();
        if(!selectedRef.current)return;
        if(stats?.suspended||stats?.hidden)return;
        if(stats?.authoredSelection&&!stats.authoredModels?.quality)return;
        setDetailImage(scene.current?.getImage?.()||'');
      }catch{}
    },delay);
  },[]);

  const chooseLandmark = useCallback((id,options={})=>{
    const nextView=options.view==='top'?'top':'perspective';
    const nextAngle=options.angle||'detail';
    const nextClose=Boolean(options.close);
    selectedRef.current=id;
    setSelectedId(id);setView(nextView);setDetailTab(nextView==='top'||nextAngle==='front'||nextAngle==='river'?'view':'story');setDetailImage('');setMobileNav(false);setAutoRotate(false);
    setCloseView(nextClose);setCameraAngle(nextAngle);
    scene.current?.setAutoRotate(false);
    scene.current?.focus(id,{angle:nextAngle,close:nextClose});
    scene.current?.setView(nextView);
    capturePostcard();
  },[capturePostcard]);

  const closeDetails=useCallback(()=>{
    clearTimeout(captureTimer.current);
    if(AUTHORED_MODELS.some(model=>model.id===selectedRef.current)){setView('perspective');setAutoRotate(false);}
    selectedRef.current=null;
    setSelectedId(null);setDetailImage('');setCloseView(false);setCameraAngle('detail');setDetailCollapsed(false);
    scene.current?.clearSelection();
  },[]);

  useEffect(()=>{
    if(!data||!canvasHost.current)return;
    let alive=true;
    try{
      const engine=createCityScene({container:canvasHost.current,data,onSelect:chooseLandmark,
        onModelStatus:state=>{
          if(!alive)return;
          setModelStates(previous=>({...previous,[state.id]:state}));
          if(state.state==='ready'&&selectedRef.current===state.id)capturePostcard(1250);
        },
        onInteraction:()=>{if(alive)setAutoRotate(false);},
        onReady:()=>{if(alive)setReady(true);},onError:e=>{if(alive)setError(typeof e==='string'?e:'三维场景暂时无法启动，请刷新重试。');},
        onCameraChange:({labels,heading})=>{
          const placed=[];
          const hostWidth=canvasHost.current?.clientWidth||1;
          const maxLift=hostWidth<700?38:170;
          const measured=(labels||[]).map(label=>({label,el:labelRefs.current[label.id]})).filter(v=>v.el).map(v=>({...v,width:v.el.offsetWidth,height:v.el.offsetHeight,nameHeight:v.el.firstElementChild?.offsetHeight||26,active:v.el.classList.contains('active')})).sort((a,b)=>Number(b.active)-Number(a.active)||a.label.y-b.label.y);
          for(const {label,el,width,height,nameHeight,active} of measured){
            let visible=label.visible,lift=0;
            const center=Math.max(width/2+8,Math.min(hostWidth-width/2-8,label.x));
            let bounds={left:center-width/2-5,right:center+width/2+5,top:label.y-height,bottom:label.y-height+nameHeight+5};
            if(visible){
              const overlaps=()=>placed.some(p=>bounds.left<p.right&&bounds.right>p.left&&bounds.top<p.bottom&&bounds.bottom>p.top);
              while(overlaps()&&lift+nameHeight+8<=maxLift){lift+=nameHeight+8;bounds.top-=nameHeight+8;bounds.bottom-=nameHeight+8;}
              visible=active||(bounds.top>64&&!overlaps());
              if(visible)placed.push(bounds);
            }
            el.style.transform=`translate(${label.x}px, ${label.y}px) translate(-50%, -100%)`;
            el.style.setProperty('--label-lift',`${lift}px`);
            el.style.setProperty('--label-shift-x',`${center-label.x}px`);
            el.style.opacity=visible?'1':'0';el.style.visibility=visible?'visible':'hidden';
          }
          if(compassRef.current)compassRef.current.style.transform=`rotate(${-heading||0}deg)`;
        }
      });
      scene.current=engine;
    }catch(e){setError(/WebGL|context/i.test(e.message||'')?'当前浏览器无法启动三维沙盘，请在支持三维加速的浏览器中打开。':e.message||'当前浏览器无法启动三维场景');}
    return()=>{alive=false;clearTimeout(captureTimer.current);scene.current?.dispose();scene.current=null;};
  },[data,chooseLandmark]);

  useEffect(()=>{scene.current?.setTheme(theme);},[theme,ready]);
  useEffect(()=>{if(ready&&selectedId)capturePostcard(1400);},[theme,ready,selectedId,capturePostcard]);
  useEffect(()=>{scene.current?.setView(view);},[view]);
  useEffect(()=>{scene.current?.setMotion(motionEnabled);},[motionEnabled,ready]);
  useEffect(()=>{
    const paused=Boolean(modal||mobileNavOpen);
    scene.current?.setSuspended(paused);
    clearTimeout(captureTimer.current);
    if(!paused&&ready&&selectedRef.current)capturePostcard(900);
  },[modal,mobileNavOpen,ready,capturePostcard]);
  useEffect(()=>{
    if(detailContentRef.current)detailContentRef.current.scrollTop=0;
  },[selectedId,detailTab]);
  useEffect(()=>{
    const panel=detailPanelRef.current;
    if(!selectedId||!ready||!panel)return;
    // Measure the rendered sheet, including collapse/expand and ordinary
    // landmarks. The engine keeps its managedFocus guard after manual orbit.
    let frame=0;
    const refit=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>scene.current?.refitSelection());};
    refit();
    const observer=new ResizeObserver(refit);
    observer.observe(panel);
    return()=>{cancelAnimationFrame(frame);observer.disconnect();};
  },[selectedId,detailTab,detailCollapsed,compact,ready]);
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),2600);return()=>clearTimeout(t);},[toast]);
  useEffect(()=>{
    const key=e=>{
      if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey||isComposingKeyEvent(e,isComposingRef.current)||modal)return;
      const typing=isTextEntryTarget(e.target);
      if(e.key==='/'&&!typing){
        e.preventDefault();
        if(compact&&!mobileNav)setMobileNav(true);
        else searchInputRef.current?.focus({preventScroll:true});
      }else if(e.key==='Escape'&&!typing){
        if(mobileNavOpen){e.preventDefault();setMobileNav(false);}
        else if(layersOpen){e.preventDefault();setLayersOpen(false);}
        else closeDetails();
      }
    };
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[modal,layersOpen,mobileNav,mobileNavOpen,compact,closeDetails]);
  const reset=()=>{closeDetails();scene.current?.reset();setView('perspective');setAutoRotate(false);scene.current?.setAutoRotate(false);};
  const frameSelected=({angle=cameraAngle,close=closeView}={})=>{
    if(!selectedId)return;
    setView('perspective');setCameraAngle(angle);setCloseView(close);setAutoRotate(false);
    scene.current?.setAutoRotate(false);scene.current?.focus(selectedId,{angle,close});capturePostcard();
  };
  const changeView=(next)=>{
    setView(next);setAutoRotate(false);scene.current?.setAutoRotate(false);
    if(selectedId)capturePostcard();
  };
  const stepLandmark=(direction)=>{
    const id=direction<0?directoryNavigation.previousId:directoryNavigation.nextId;
    if(id)chooseLandmark(id);
  };
  const activateSearchResult=()=>{
    const next=activeResult||filtered[0];
    if(next)chooseLandmark(next.id);
  };
  const handleSearchSubmit=e=>{
    e.preventDefault();
    if(isComposingRef.current||suppressSearchSubmitRef.current){suppressSearchSubmitRef.current=false;return;}
    activateSearchResult();
  };
  const handleSearchKeyDown=e=>{
    if(isComposingKeyEvent(e,isComposingRef.current)){
      // Some IMEs report the confirming key as Process/229, not Enter.
      suppressSearchSubmitRef.current=true;
      return;
    }
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    suppressSearchSubmitRef.current=false;
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){
      e.preventDefault();
      setActiveResultId(id=>moveDirectoryActiveId(filtered,id,e.key==='ArrowDown'?1:-1));
    }else if(e.key==='Enter'){
      e.preventDefault();
      activateSearchResult();
    }else if(e.key==='Escape'){
      e.preventDefault();e.stopPropagation();
      if(query){setQuery('');setActiveResultId(null);}
      else if(mobileNavOpen)setMobileNav(false);
    }
  };
  const toggleDetailFocus=()=>frameSelected({
    angle:authored?(closeView&&view==='perspective'?'context':'detail'):guideOnly?'context':cameraAngle,
    close:!(closeView&&view==='perspective'),
  });
  const startSearchComposition=()=>{
    clearTimeout(compositionEndTimerRef.current);
    isComposingRef.current=true;
    suppressSearchSubmitRef.current=true;
  };
  const endSearchComposition=()=>{
    isComposingRef.current=false;
    // A native submit can follow compositionend in the same browser event.
    clearTimeout(compositionEndTimerRef.current);
    compositionEndTimerRef.current=setTimeout(()=>{suppressSearchSubmitRef.current=false;},0);
  };
  const toggleRotate=()=>{scene.current?.setAutoRotate(!autoRotate);setAutoRotate(!autoRotate);};
  const toggleLayer=(name)=>{const next=!layers[name];setLayers({...layers,[name]:next});if(name!=='labels')scene.current?.setLayer(name,next);};
  const closeModal=useCallback(()=>setModal(null),[]);
  const saveView=()=>{
    try {const image=scene.current?.getImage();if(!image)throw new Error();const a=document.createElement('a');a.href=image;a.download=`宜昌-江山之间-${selected?.name||'城市全景'}-${theme==='night'?'夜景':'日景'}.png`;document.body.appendChild(a);a.click();a.remove();setToast('正在保存这张宜昌风景');}
    catch{setToast('暂时无法保存画面，请稍后重试');}
  };

  const locationState={place:selectedId,theme,view,angle:cameraAngle,close:closeView,filter:directoryFilter,query};
  const restoreLocation=(next,{invalidPlace=false}={})=>{
    clearTimeout(captureTimer.current);
    setModal(null);setLayersOpen(false);setMobileNav(false);
    setQuery(next.query);setDirectoryFilter(next.filter);setTheme(next.theme);
    if(next.place)chooseLandmark(next.place,{angle:next.angle,close:next.close,view:next.view});
    else {reset();setView(next.view);scene.current?.setView(next.view);}
    if(invalidPlace)setToast('链接中的地点暂不可用，已回到城市全景');
  };
  useSceneLocation({ready,places:landmarks,state:locationState,onRestore:restoreLocation});
  const copyLocation=async()=>{
    const url=createSceneLocationUrl(locationState,landmarks,window.location.href);
    try{
      if(!navigator.clipboard?.writeText)throw new Error('clipboard-unavailable');
      await navigator.clipboard.writeText(url);
      setToast('定位链接已复制，打开后可回到此处');
    }catch{setLocationLink(url);setModal('location-link');}
  };

  return <div className={`app theme-${theme}`}>
    <header className="app-header">
      <button className="brand" onClick={reset} inert={mobileNavOpen} aria-label="宜昌江山之间，回到全景"><MapTrifold size={30} weight="duotone"/><span><strong>宜昌 · 江山之间</strong><small>YICHANG · A CITY IN MINIATURE</small></span></button>
      <div className="header-breadcrumb"><span>城市导览</span><span className="slash">/</span><strong>{authored?'自建建筑':business?'楼宇导览':'三维沙盘'}</strong></div>
      <div className="header-right"><span className="header-poem">沿江山水，慢慢看宜昌。</span><button className="text-button save-view-button" inert={mobileNavOpen} aria-label="保存当前画面" title="保存当前画面" disabled={!ready||Boolean(error)} onClick={saveView}><Camera size={18}/><span>保存画面</span></button><button className="text-button guide-button" inert={mobileNavOpen} aria-label="操作指引" onClick={()=>setModal('guide')}><CursorClick size={17}/><span>操作指引</span></button><button ref={mobileMenuRef} className="icon-button mobile-menu" onClick={()=>setMobileNav(!mobileNav)} aria-label={mobileNavOpen?'关闭地标与楼宇目录':'打开地标与楼宇目录'} aria-expanded={mobileNavOpen} aria-controls="city-directory"><List size={23}/></button></div>
    </header>
    <div className="app-body">
      {mobileNavOpen&&<button className="sidebar-backdrop" tabIndex={-1} aria-label="关闭地标与楼宇目录" onClick={()=>setMobileNav(false)}/>}
      <aside ref={sidebarRef} id="city-directory" className={`sidebar ${mobileNavOpen?'is-open':''}`} aria-label="宜昌地标与楼宇目录" role={compact?'dialog':undefined} aria-modal={mobileNavOpen?true:undefined} tabIndex={-1} inert={compact&&!mobileNavOpen} aria-hidden={compact&&!mobileNavOpen?true:undefined}>
        <div className="sidebar-mobile-heading"><span>地标与楼宇</span><button className="icon-button" aria-label="收起目录" onClick={()=>setMobileNav(false)}><X size={20}/></button></div>
        <div className="sidebar-intro"><p className="eyebrow">城市漫游</p><h1>一城山水，自在宜昌。</h1><p className="intro-copy">从一座楼阁，走进一座城。</p></div>
        <form className="search" onSubmit={handleSearchSubmit}><MagnifyingGlass size={17}/><input ref={searchInputRef} type="search" maxLength={120} enterKeyHint="search" autoComplete="off" aria-label="搜索宜昌地标与楼宇，支持别名" aria-controls="directory-results" aria-describedby="directory-search-help directory-result-status" placeholder="搜索地标、楼宇或别名" value={query} onChange={e=>setQuery(e.target.value)} onFocus={()=>setSearchFocused(true)} onBlur={()=>{setSearchFocused(false);isComposingRef.current=false;}} onKeyDown={handleSearchKeyDown} onCompositionStart={startSearchComposition} onCompositionEnd={endSearchComposition}/>{query?<button type="button" aria-label="清空搜索" onClick={()=>{setQuery('');setActiveResultId(null);searchInputRef.current?.focus({preventScroll:true});}}><X size={14}/></button>:<kbd className="search-shortcut" aria-hidden="true">/</kbd>}</form>
        <p id="directory-search-help" className="sr-only">上下键预选目录结果，回车打开；Escape先清空搜索，搜索为空时可收起手机目录。非输入状态按斜杠可搜索。</p>
        <p id="directory-result-status" className="sr-only" role="status" aria-live="polite">{`${filtered.length}项结果${searchFocused&&activeResult?`，预选${activeResult.name}，第${directoryPositions.get(activeResult.id)}项`:''}`}</p>
        <section className="business-summary" aria-label="商务楼宇目录状态">
          <div><span><Buildings size={14}/>商务楼宇</span><strong>{BUSINESS_BUILDINGS.length}<small> 项</small></strong></div>
          <p><span><b>{availableCount}</b> 沙盘模型</span><span><b>{recoveryCount}</b> 待恢复</span>{registrationCount>0&&<span><b>{registrationCount}</b> 待配准</span>}</p>
          <small>原导图项目数，含多塔组团</small>
        </section>
        <div className="directory-filters" role="group" aria-label="筛选地标与楼宇">
          {[{id:'all',label:'全部'},{id:'available',label:'沙盘模型'},{id:'recovery-pending',label:'待恢复'},...(registrationCount?[{id:'registration-pending',label:'待配准'}]:[])].map(filter=><button key={filter.id} className={directoryFilter===filter.id?'active':''} aria-pressed={directoryFilter===filter.id} onClick={()=>setDirectoryFilter(filter.id)}>{filter.label}</button>)}
        </div>
        <div className="directory-heading"><span>{directoryFilter==='all'?'探索地标与建筑':'商务楼宇目录'}</span><span>{String(filtered.length).padStart(2,'0')} 项</span></div>
        <nav ref={directoryListRef} id="directory-results" className="landmark-list" aria-label="选择地标与楼宇">
          {!data&&<p className="list-loading">正在展开城市目录…</p>}
          {data&&!filtered.length&&<div className="search-empty"><MagnifyingGlass size={24}/><strong>暂无符合条件的地点</strong><p>试试“镇江阁”或“首信财富”，<br/>也可以调整楼宇筛选。</p><button onClick={()=>{setQuery('');setDirectoryFilter('all');}}>查看全部地标与楼宇</button></div>}
          {directoryGroups.map(({category,items})=><section className="landmark-group" key={category}><h2>{category}<span>{items.length}</span></h2>{items.map(l=><button key={l.id} ref={element=>{directoryRowRefs.current[l.id]=element;}} className={`landmark-row ${selectedId===l.id?'selected':''} ${searchFocused&&activeResultId===l.id?'keyboard-active':''} ${l.business?'business-row':''}`} onClick={()=>chooseLandmark(l.id)} aria-pressed={selectedId===l.id}><span className="landmark-index">{String(directoryPositions.get(l.id)).padStart(2,'0')}</span><span className="landmark-row-content"><strong>{l.name}</strong>{l.business?<small className={`business-status status-${l.modelStatus}`}>{businessStatus(l)}</small>:selectedId===l.id&&<small>{l.subtitle||'沿着江岸，发现宜昌'}</small>}</span>{l.kind==='authored'&&<span className="authored-tag">自建</span>}<CaretRight size={12}/></button>)}</section>)}
        </nav>
        <div className="sidebar-bottom"><div className="sidebar-note"><MapPin size={14}/><span>宜昌中心城区 · 风格化沙盘</span></div><button onClick={()=>setModal('about')} className="about-link">关于这座沙盘 <ArrowUpRight size={13}/></button><div className="edition"><span>YICHANG ONLINE</span><span>VOL. 01</span></div></div>
      </aside>
      <main className={`main-scene ${selected?'detail-open':''} ${authored?'authored-open':''} ${business?'business-open':''}`} inert={mobileNavOpen} aria-hidden={mobileNavOpen?true:undefined} aria-label={authored?'宜昌城市沙盘与自建建筑':business?'宜昌城市沙盘与楼宇导览点':'宜昌城市三维微缩沙盘'}>
        <div className="canvas-host" ref={canvasHost}/>
        <div className={`map-labels ${layers.labels&&ready?'':'hidden'}`} inert={!layers.labels||!ready} aria-hidden={!layers.labels||!ready?true:undefined} aria-label="地图地标标注">
          {landmarks.map(l=><button key={l.id} ref={el=>{labelRefs.current[l.id]=el;}} className={`map-label ${selectedId===l.id?'active':''} ${l.kind==='business-poi'?'guide-point-label':''}`} onClick={()=>chooseLandmark(l.id)} aria-label={`查看${l.name}${l.kind==='business-poi'?'的导览参考点':''}`}><span className="label-name">{l.name}{selectedId===l.id&&l.kind==='business-poi'&&<small>导览参考点</small>}</span><span className="label-pin"><MapPin size={13} weight={l.kind==='business-poi'?'regular':'fill'}/></span></button>)}
        </div>
        {(!ready||error)&&<div className="scene-loading" role="status">{error?<><WarningCircle size={32}/><h2>这座城还在路上</h2><p>{error}</p><button onClick={()=>window.location.reload()}>重新打开沙盘</button></>:<><MapTrifold size={44} weight="duotone"/><span className="eyebrow">YICHANG · 江山之间</span><h2>让山水，慢慢展开。</h2><p>{data?'正在安放楼阁、街巷与树木':'正在读取宜昌城市轮廓'}</p><CircleNotch className="spinner" size={22}/></>}</div>}
        <div className="scene-toolbar" aria-label="沙盘显示设置"><div className="view-segment"><button className={view==='perspective'?'active':''} onClick={()=>changeView('perspective')} aria-pressed={view==='perspective'}><Buildings size={16}/><span>{authored&&cameraAngle!=='context'?'建筑视角':'城市沙盘'}</span></button><button className={view==='top'?'active':''} onClick={()=>changeView('top')} aria-pressed={view==='top'}><MapTrifold size={16}/><span>{authored&&cameraAngle!=='context'?'俯瞰建筑':'俯瞰地图'}</span></button></div><span className="toolbar-divider"/><button className="toolbar-button reset-button" onClick={reset} title="回到全景"><ArrowCounterClockwise size={16}/><span>回到全景</span></button><span className="toolbar-divider day-divider"/><div className="day-segment"><button className={theme==='day'?'active':''} onClick={()=>setTheme('day')} aria-pressed={theme==='day'} title="日景"><Sun size={17}/><span>日景</span></button><button className={theme==='night'?'active':''} onClick={()=>setTheme('night')} aria-pressed={theme==='night'} title="夜景"><MoonStars size={16}/><span>夜景</span></button></div></div>
        {business&&<div className="authored-note"><span className="eyebrow">{authored?`自建建筑 · ${selected.stage||'阶段待核准'}`:businessStatus(selected)}</span><p><span>{registrationLabel}</span>{authored&&<button onClick={()=>frameSelected({angle:cameraAngle==='context'?'detail':'context',close:cameraAngle==='context'})}>{cameraAngle==='context'?'靠近建筑':'连同沙盘看'} <ArrowUpRight size={12}/></button>}</p></div>}
        {authored&&ready&&(!modelState||modelState.state==='loading'||modelState.state==='error')&&<div className="model-load-state" role="status">{modelState?.state==='error'?<><WarningCircle size={24}/><strong>模型暂未载入</strong><p>可以重试，也可以继续探索其他地标。</p><button onClick={()=>scene.current?.retryModel()}>重新载入</button></>:<><CircleNotch className="spinner" size={24}/><strong>正在展开建筑细节</strong><p>正在载入这座自建建筑。</p></>}</div>}
        <div className="map-tools-top"><button className={`layer-toggle ${layersOpen?'active':''}`} onClick={()=>setLayersOpen(!layersOpen)} aria-expanded={layersOpen} aria-label="图层"><Stack size={17}/><span>图层</span></button>{layersOpen&&<section className="layer-panel" aria-label="图层设置"><header><strong>看见城市的层次</strong><button className="icon-button" onClick={()=>setLayersOpen(false)} aria-label="关闭图层设置"><X size={15}/></button></header>{[{id:'buildings',label:'城市建筑',Icon:Buildings},{id:'trees',label:'山林与树木',Icon:Tree},{id:'labels',label:'地标名称',Icon:MapPin}].map(({id,label,Icon})=><label key={id}><Icon size={17}/><span>{label}</span><input type="checkbox" checked={layers[id]} onChange={()=>toggleLayer(id)}/></label>)}<label className="motion-setting"><Waves size={17}/><span>江面动态</span><input type="checkbox" checked={motionEnabled} onChange={e=>setMotionEnabled(e.target.checked)}/></label><p className="layer-note">{authored?'城市与自建建筑一起显示。':'靠近江岸，看看船只缓缓经过。'}</p></section>}</div>
        <div className="compass"><span>N</span><div ref={compassRef}><NavigationArrow size={22} weight="fill"/></div></div>
        {selected&&<section ref={detailPanelRef} className={`detail-panel ${compact&&detailCollapsed?'is-collapsed':''}`} aria-label={`${selected.name}介绍`}>
          <div className="detail-header">
            <div className="detail-top"><span>{selected.category} / {authored?(selected.stage||'阶段待核准'):business?'导览参考点':'城市手记'}</span><div className="detail-navigation"><span className="detail-result-count" aria-label={directoryNavigation.position?`当前结果第${directoryNavigation.position}项，共${directoryNavigation.total}项`:`当前地点不在${directoryNavigation.total}项结果中`}>{directoryNavigation.position||'—'}<span> / {directoryNavigation.total}</span></span><button className="icon-button" disabled={!directoryNavigation.canStep} onClick={()=>stepLandmark(-1)} aria-label="当前结果中的上一项" title="当前结果中的上一项"><CaretLeft size={15}/></button><button className="icon-button" disabled={!directoryNavigation.canStep} onClick={()=>stepLandmark(1)} aria-label="当前结果中的下一项" title="当前结果中的下一项"><CaretRight size={15}/></button><span className="detail-navigation-divider"/><button className="icon-button" onClick={closeDetails} aria-label="关闭地标介绍"><X size={18}/></button></div></div>
            <div className="detail-title"><span>{directoryNavigation.position?String(directoryNavigation.position).padStart(2,'0'):'—'}</span><h2>{selected.name}</h2><button className="icon-button location-link-button" aria-label="复制定位链接" title="复制楼宇、预设视角与日夜状态" disabled={!ready} onClick={copyLocation}><LinkSimple size={17}/></button></div>
            {directoryNavigation.outside&&<p className="directory-outside-note" role="status"><span>当前地点不在结果中</span>{directoryNavigation.total===1?<button onClick={()=>chooseLandmark(filtered[0].id)}>查看唯一结果</button>:directoryNavigation.total===0?<button onClick={()=>{setQuery('');setDirectoryFilter('all');}}>查看全部</button>:<span>用前后按钮进入结果</span>}</p>}
            <p className="detail-subtitle" hidden={compact&&detailCollapsed}>{selected.subtitle||'在山水之间，与宜昌相遇。'}</p>
            {compact&&<div className="detail-mobile-actions"><button className="detail-collapse-toggle" aria-expanded={!detailCollapsed} aria-controls="detail-content" onClick={()=>setDetailCollapsed(value=>!value)}>{detailCollapsed?<CaretUp size={14}/>:<CaretDown size={14}/>}<span>{detailCollapsed?'展开介绍':'收起介绍'}</span></button><button className="detail-quick-focus" aria-pressed={closeView&&view==='perspective'} onClick={toggleDetailFocus}><span>{closeView&&view==='perspective'?(authored?'连同沙盘看':guideOnly?'拉远看街区':'回到地标全景'):guideOnly?'看看周边街区':'靠近看看'}</span><ArrowUpRight size={14}/></button></div>}
            <div className="detail-tabs" hidden={compact&&detailCollapsed} role="tablist" aria-label="地标内容"><button id="story-tab" role="tab" aria-controls="landmark-panel" aria-selected={detailTab==='story'} className={detailTab==='story'?'active':''} onClick={()=>setDetailTab('story')}>{business?'楼宇手记':'地标手记'}</button><button id="view-tab" role="tab" aria-controls="landmark-panel" aria-selected={detailTab==='view'} className={detailTab==='view'?'active':''} onClick={()=>setDetailTab('view')}>观察视角</button></div>
          </div>
          <div ref={detailContentRef} id="detail-content" className="detail-content" hidden={compact&&detailCollapsed}>
          {detailTab==='story'?<div id="landmark-panel" role="tabpanel" aria-labelledby="story-tab" className="detail-story">
            <div className="scene-postcard">{detailImage?<img src={detailImage} alt={guideOnly?`${selected.name}导览参考点周边的沙盘画面`:`${selected.name}的三维沙盘视角`}/>:guideOnly?<div className="postcard-loading"><MapPin size={22}/><span>导览参考位置</span></div>:<div className="postcard-loading"><CircleNotch className="spinner" size={20}/><span>正在靠近这处风景</span></div>}<span>{guideOnly?'导览点周边':'沙盘取景'} · {selected.name}</span></div>
            <p className="landmark-description">{selected.description}</p><div className="detail-location"><MapPin size={14}/><span>{selected.location||'湖北 · 宜昌'}</span></div>
            {guideOnly&&<p className="business-poi-note">原导览点不等于精确楼体中心。这里先看周边街区，{selected.modelStatus==='registration-pending'?'模型将在位置与朝向核准后接入。':'模型源件仍待恢复与核对。'}</p>}
            {canPreviewCandidate&&<button className="candidate-preview-button" onClick={()=>setModal('candidate')}><Buildings size={16}/><span>查看候选模型<small>独立查看 · 地图配准待核准</small></span><ArrowUpRight size={16}/></button>}
            <button className="detail-focus" aria-pressed={closeView&&view==='perspective'} onClick={toggleDetailFocus}>{closeView&&view==='perspective'?(authored?'连同沙盘看':guideOnly?'拉远看街区':'回到地标全景'):guideOnly?'看看周边街区':'靠近看看'} {closeView&&view==='perspective'?<ArrowCounterClockwise size={17}/>:<ArrowUpRight size={17}/>}</button>
          </div>:<div id="landmark-panel" role="tabpanel" aria-labelledby="view-tab" className="detail-view">
            <p>换一个角度，发现城市的另一面。</p>
            {canPreviewCandidate&&<button onClick={()=>setModal('candidate')}><Buildings size={20}/><span><strong>查看候选模型</strong><small>单独旋转查看，城市沙盘保持原位</small></span><ArrowUpRight size={16}/></button>}
            {authored&&<button className={cameraAngle==='context'&&view==='perspective'?'active':''} onClick={()=>frameSelected({angle:'context',close:false})}><MapTrifold size={20}/><span><strong>连同沙盘看</strong><small>建筑与城市，一起入镜</small></span><ArrowUpRight size={16}/></button>}
            <button className={cameraAngle==='detail'&&closeView&&view==='perspective'?'active':''} onClick={()=>frameSelected({angle:'detail',close:true})}><Buildings size={20}/><span><strong>{authored?'建筑近景':guideOnly?'周边街区':'地标近景'}</strong><small>{authored?'靠近建筑，按需载入细节':guideOnly?'观察导览参考点附近的城市轮廓':'看见建筑与层次'}</small></span><ArrowUpRight size={16}/></button>
            {authored&&<button className={cameraAngle==='front'&&view==='perspective'?'active':''} onClick={()=>frameSelected({angle:'front',close:true})}><Buildings size={20}/><span><strong>正立面</strong><small>观察立面、窗格与入口</small></span><ArrowUpRight size={16}/></button>}
            {['zhenjiang-pavilion','tianran-pagoda'].includes(selectedId)&&<button className={cameraAngle==='river'&&view==='perspective'?'active':''} onClick={()=>frameSelected({angle:'river',close:false})}><Waves size={20}/><span><strong>江岸视角</strong><small>从江面，望向一城风景</small></span><ArrowUpRight size={16}/></button>}
            <button className={view==='top'?'active':''} onClick={()=>{if(authored)frameSelected({angle:'detail',close:true});changeView('top');}}><MapTrifold size={20}/><span><strong>{authored?'顶部与轮廓':'俯瞰此处'}</strong><small>{authored?'查看候选模型的顶部形态':'读懂街巷与江岸'}</small></span><ArrowUpRight size={16}/></button>
            <button onClick={reset}><Compass size={20}/><span><strong>回到城市全景</strong><small>收起介绍，继续探索宜昌</small></span><ArrowUpRight size={16}/></button>
          </div>}
          {authored&&<div className="model-quality" role="status"><span className={`quality-dot ${modelState?.quality?'is-ready':''}`}/><span>{modelState?.state==='error'?'模型暂未载入':modelState?.detailState==='loading'?'正在载入近景细节':modelState?.detailState==='error'?'近景细节暂未载入':modelState?.quality==='detail'?'近景模型已就绪':modelState?.quality==='light'?'轻量模型已就绪':'模型载入中'}</span>{modelState?.state==='error'||modelState?.detailState==='error'?<button onClick={()=>scene.current?.retryModel()}>重试</button>:<button onClick={()=>setModal('model')}>模型说明</button>}</div>}
          {guideOnly&&<div className="model-quality poi-quality"><MapPin size={12}/><span>{businessStatus(selected)}</span><button onClick={()=>setModal('model')}>资料说明</button></div>}
          <footer>{authored?'等比微缩 · 尺寸与朝向非实测':guideOnly?'导览参考点 · 楼体位置与尺寸待核准':'建筑与景观为风格化表达'}</footer>
          </div>
        </section>}
        <div className="scene-bottom-caption"><span className="eyebrow">{authored?'YICHANG / 建筑细读':'YICHANG / 长江之畔'}</span><p>{selected?selected.name:'把一座城，放在眼前。'}</p></div>
        <div className="interaction-hint"><Mouse size={14}/><span>拖动旋转</span><span className="hint-dot">·</span><span>滚轮缩放</span><span className="hint-dot">·</span><span>点击地标探索</span></div>
        <div className="map-controls"><button className={autoRotate?'active':''} onClick={toggleRotate} aria-pressed={autoRotate} title={autoRotate?'暂停环绕':'自动环绕'} aria-label={autoRotate?'暂停环绕':'自动环绕'}>{autoRotate?<Pause size={16}/>:<Play size={16}/>}</button><div className="zoom-controls"><button aria-label="放大沙盘" onClick={()=>scene.current?.zoom(1)}><Plus size={19}/></button><button aria-label="缩小沙盘" onClick={()=>scene.current?.zoom(-1)}><Minus size={19}/></button></div></div>
        <div className="scene-attribution"><button onClick={()=>setModal(business?'model':'about')}>{business?'楼宇资料与说明':'地图数据与来源'}</button><span>© OpenStreetMap contributors</span></div>
        {toast&&<div className="toast" role="status"><Check size={17}/>{toast}</div>}
      </main>
    </div>
    {modal==='guide'&&<Modal fallbackFocusRef={mobileMenuRef} title="用自己的节奏，认识宜昌。" onClose={closeModal}><div className="guide-steps"><div><Mouse size={26}/><span><strong>转一转，看见山水</strong><p>按住鼠标左键拖动，旋转沙盘；右键拖动可平移。</p></span></div><div><Plus size={26}/><span><strong>近一点，看见细节</strong><p>滚动鼠标滚轮，或使用右下角的加减按钮缩放。</p></span></div><div><CursorClick size={26}/><span><strong>点一处，听一座城</strong><p>点击地标名称或左侧目录，镜头会带你靠近风景。</p></span></div><div><Sun size={26}/><span><strong>从日景，走到夜色</strong><p>切换顶部日夜按钮，也可以开启自动环绕慢慢欣赏。</p></span></div></div><p className="touch-note">触屏：单指旋转，双指缩放与平移。手机介绍可收起，留出更多画面。点击顶部相机可保存画面，楼名旁的链接按钮可复制定位；图层里可暂停江面动态。</p><button className="primary-button" onClick={closeModal}>开始探索 <ArrowUpRight size={17}/></button></Modal>}
    {modal==='about'&&<Modal fallbackFocusRef={mobileMenuRef} title="关于这座沙盘" onClose={closeModal}><div className="about-content"><p className="about-lead">把宜昌的山水、街巷与楼阁，装进一座可以探索的微缩城市。</p><p>沙盘以公开道路、水系和建筑轮廓为基础，采用统一的色彩与简化造型呈现中心城区。地标、树木、江面船只与部分建筑高度经过展示性处理，适合城市导览与空间探索。</p><div className="about-data"><span>地图与轮廓</span><strong>OpenStreetMap · Overture Maps</strong><span>展示范围</span><strong>{data?.meta?.name||'宜昌中心城区'}</strong><span>商务楼宇</span><strong>{BUSINESS_BUILDINGS.length} 项</strong><span>恢复进度</span><strong>已恢复 {availableCount+registrationCount} 项 · {recoveryCount} 项待恢复</strong><span>模型展示</span><strong>{availableCount} 项沙盘模型 · {previewCount} 项独立预览</strong>{registrationCount>previewCount&&<><span>待配准源件</span><strong>{registrationCount-previewCount} 项尚待网页转换</strong></>}<span>作品</span><strong>宜昌Online · 江山之间</strong></div><p className="data-note">{BUSINESS_REGISTRY_INFO.note} 没有可用网页模型的项目先显示导览参考点，参考点不等于精确楼体中心。独立预览的候选仍待地图配准，阶段候选也不等于通过实景验收。</p><p className="data-note">地标位置为公开资料参考，模型并非测绘或工程成果。</p><a className="source-link" href="/data/sources.txt" target="_blank" rel="noreferrer">查看完整数据来源与说明 <ArrowUpRight size={15}/></a>{BUSINESS_REGISTRY_INFO.sourceUrl&&<a className="source-link" href={BUSINESS_REGISTRY_INFO.sourceUrl} target="_blank" rel="noreferrer">查看原商务楼宇导图 <ArrowUpRight size={15}/></a>}</div><button className="primary-button" onClick={closeModal}>回到山水之间 <ArrowLeft size={17}/></button></Modal>}
    {modal==='model'&&business&&<Modal fallbackFocusRef={mobileMenuRef} title={`${selected.name} · ${authored?'模型':'资料'}说明`} onClose={closeModal}><div className="about-content">
      <p className="about-lead">{authored?selected.subtitle||'近一点，看见建筑的细节。':businessStatus(selected)}</p>
      <p>{selected.description}</p>
      {authored?<p>网页使用原生模型另行导出的副本，保持楼体外形与三轴比例。全景使用轻量模型，近看按需载入细节。</p>:<p>当前显示原导图换算后的导览参考位置，可以查看周边街区。{selected.modelStatus==='registration-pending'?'已恢复的模型仍需核准位置与朝向，可先独立查看候选外观。':'模型源件仍待恢复，目录保留这个项目的记录。'}</p>}
      <div className="about-data"><span>模型状态</span><strong>{businessStatus(selected)}</strong>{selected.stage&&<><span>当前阶段</span><strong>{selected.stage}</strong></>}<span>{authored?'地图落位':'导览位置'}</span><strong>{registrationLabel}</strong><span>位置说明</span><strong>{selected.location||'位置待核准'}</strong>{selected.sourceName&&<><span>原导图名称</span><strong>{selected.sourceName}</strong></>}{sourcePeriodLabel&&<><span>资料时期</span><strong>{sourcePeriodLabel}</strong></>}{authored&&<><span>模型比例</span><strong>三轴等比缩放 · 非实测模型</strong></>}</div>
      <p className="data-note">{selected.caveat||'位置、尺寸与朝向仍待核准，资料不代表当前经营状态。'}</p>
      <p className="data-note">{authored?'阶段候选不等于已通过实景验收。夜景灯光为展示性处理，模型不属于实测或工程成果。':'导览参考点不等于精确楼体中心，周边普通楼体是城市底图的风格化表达。'}</p>
      {selected.registrationUrl&&<a className="source-link" href={selected.registrationUrl} target="_blank" rel="noreferrer">查看地图配准依据 <ArrowUpRight size={15}/></a>}
      {selected.modelNotesUrl&&<a className="source-link" href={selected.modelNotesUrl} target="_blank" rel="noreferrer">查看模型交接说明 <ArrowUpRight size={15}/></a>}
      {selected.sourceUrl&&<a className="source-link" href={selected.sourceUrl} target="_blank" rel="noreferrer">查看原商务楼宇导图 <ArrowUpRight size={15}/></a>}
    </div>{canPreviewCandidate&&<button className="candidate-preview-button" onClick={()=>setModal('candidate')}><Buildings size={17}/><span>查看候选模型<small>独立查看 · 地图配准待核准</small></span><ArrowUpRight size={16}/></button>}<button className="primary-button" onClick={closeModal}>{authored?'继续看建筑':'继续看街区'} <ArrowLeft size={17}/></button></Modal>}
    {modal==='location-link'&&<Modal fallbackFocusRef={mobileMenuRef} title="带走这一处风景" onClose={closeModal}>
      <div className="about-content"><p className="about-lead">选中并复制下方定位链接。</p><p>打开后恢复当前地点、预设观察角度与日夜模式。链接沿用原站的访问权限。</p><input className="location-link-input" aria-label="当前定位链接" readOnly value={locationLink} onFocus={event=>event.target.select()}/></div>
      <button className="primary-button" onClick={closeModal}>回到沙盘 <ArrowLeft size={17}/></button>
    </Modal>}
    {modal==='candidate'&&canPreviewCandidate&&<Modal fallbackFocusRef={mobileMenuRef} title={`${selected.name} · 候选模型`} className="model-preview-modal" onClose={closeModal}>
      <ModelPreview key={selected.id} model={selected} theme={theme}/>
      <div className="candidate-preview-provenance"><p>{selected.caveat}</p>{selected.modelNotesUrl&&<a className="source-link" href={selected.modelNotesUrl} target="_blank" rel="noreferrer">模型交接说明 <ArrowUpRight size={14}/></a>}</div>
      <button className="primary-button" onClick={closeModal}>回到城市导览 <ArrowLeft size={17}/></button>
    </Modal>}
  </div>;
}
