import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MapTrifold, MagnifyingGlass, Sun, MoonStars, ArrowCounterClockwise, Stack, X, CaretLeft, CaretRight, Plus, Minus, Play, Pause, Buildings, Tree, MapPin, CursorClick, List, Compass, ArrowUpRight, CircleNotch, WarningCircle, ArrowLeft, Check, NavigationArrow, Mouse, Camera, Waves } from '@phosphor-icons/react';
import { createCityScene } from './scene/createCityScene.js';
import { AUTHORED_MODELS } from './scene/authoredModels.js';

function Modal({ title, children, onClose, className = '' }) {
  const panel = useRef(null);
  useEffect(() => {
    const before = document.activeElement;
    panel.current?.focus();
    const handle = e => {
      if(e.key === 'Escape') onClose();
      if(e.key === 'Tab') {
        const controls = panel.current?.querySelectorAll('button, a[href], input, [tabindex="0"]');
        if(!controls?.length) return;
        const first=controls[0], last=controls[controls.length-1];
        if(e.shiftKey && (document.activeElement===first||document.activeElement===panel.current)) {e.preventDefault();last.focus();}
        else if(!e.shiftKey && document.activeElement===last) {e.preventDefault();first.focus();}
      }
    };
    document.addEventListener('keydown', handle);
    return () => {document.removeEventListener('keydown', handle);before?.focus?.();};
  }, [onClose]);
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
  const [data,setData]=useState(null);
  const [ready,setReady]=useState(false);
  const [error,setError]=useState('');
  const [query,setQuery]=useState('');
  const [selectedId,setSelectedId]=useState(null);
  const [theme,setTheme]=useState('day');
  const [view,setView]=useState('perspective');
  const [autoRotate,setAutoRotate]=useState(false);
  const [layersOpen,setLayersOpen]=useState(false);
  const [layers,setLayers]=useState({buildings:true,trees:true,labels:true});
  const [modal,setModal]=useState(null);
  const [mobileNav,setMobileNav]=useState(false);
  const [detailImage,setDetailImage]=useState('');
  const [detailTab,setDetailTab]=useState('story');
  const [closeView,setCloseView]=useState(false);
  const [cameraAngle,setCameraAngle]=useState('detail');
  const [toast,setToast]=useState('');
  const [modelStates,setModelStates]=useState({});
  const [motionEnabled,setMotionEnabled]=useState(()=>!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [compact,setCompact]=useState(()=>window.matchMedia('(max-width: 700px)').matches);
  const landmarks = data ? [...data.landmarks, ...AUTHORED_MODELS] : [];
  const selected = landmarks.find(l=>l.id===selectedId);
  const exhibit = selected?.placement === 'exhibit';
  const modelState = exhibit ? modelStates[selectedId] : null;
  const filtered = landmarks.filter(l=>`${l.name} ${l.category} ${l.subtitle||''}`.toLowerCase().includes(query.toLowerCase().trim()));
  const categories = [...new Set(filtered.map(l=>l.category || '城市地标'))];

  useEffect(()=>{
    const controller = new AbortController();
    fetch('/data/city.json',{signal:controller.signal}).then(r=>{if(!r.ok)throw new Error('城市数据暂未加载成功');return r.json();}).then(setData).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
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
        if(stats?.exhibitionMode&&!stats.authoredModels.quality)return;
        setDetailImage(scene.current?.getImage?.()||'');
      }catch{}
    },delay);
  },[]);

  const chooseLandmark = useCallback((id)=>{
    selectedRef.current=id;
    setSelectedId(id);setView('perspective');setDetailTab('story');setDetailImage('');setMobileNav(false);setAutoRotate(false);
    setCloseView(false);setCameraAngle('detail');
    scene.current?.setAutoRotate(false);
    scene.current?.focus(id);
    capturePostcard();
  },[capturePostcard]);

  const closeDetails=useCallback(()=>{
    clearTimeout(captureTimer.current);
    if(AUTHORED_MODELS.some(model=>model.id===selectedRef.current)){setView('perspective');setAutoRotate(false);}
    selectedRef.current=null;
    setSelectedId(null);setDetailImage('');setCloseView(false);setCameraAngle('detail');
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

  useEffect(()=>{scene.current?.setTheme(theme);if(selectedId&&scene.current)capturePostcard(1400);},[theme,ready,selectedId,capturePostcard]);
  useEffect(()=>{scene.current?.setView(view);},[view]);
  useEffect(()=>{scene.current?.setMotion(motionEnabled);},[motionEnabled,ready]);
  useEffect(()=>{
    if(!AUTHORED_MODELS.some(model=>model.id===selectedId))return;
    // Fit after the detail sheet is actually laid out, including its mobile
    // height and the different story/view tabs.
    const frame=requestAnimationFrame(()=>scene.current?.refitSelection());
    return()=>cancelAnimationFrame(frame);
  },[selectedId,detailTab,compact]);
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),2600);return()=>clearTimeout(t);},[toast]);
  useEffect(()=>{
    const key=e=>{if(e.key==='Escape'&&!modal){if(layersOpen)setLayersOpen(false);else if(mobileNav)setMobileNav(false);else closeDetails();}};
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[modal,layersOpen,mobileNav,closeDetails]);
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
    const index=landmarks.findIndex(l=>l.id===selectedId);
    const next=landmarks[(index+direction+landmarks.length)%landmarks.length];
    if(next)chooseLandmark(next.id);
  };
  const toggleRotate=()=>{scene.current?.setAutoRotate(!autoRotate);setAutoRotate(!autoRotate);};
  const toggleLayer=(name)=>{const next=!layers[name];setLayers({...layers,[name]:next});if(name!=='labels')scene.current?.setLayer(name,next);};
  const closeModal=useCallback(()=>setModal(null),[]);
  const saveView=()=>{
    try {const image=scene.current?.getImage();if(!image)throw new Error();const a=document.createElement('a');a.href=image;a.download=`宜昌-江山之间-${selected?.name||'城市全景'}-${theme==='night'?'夜景':'日景'}.png`;document.body.appendChild(a);a.click();a.remove();setToast('正在保存这张宜昌风景');}
    catch{setToast('暂时无法保存画面，请稍后重试');}
  };

  return <div className={`app theme-${theme}`}>
    <header className="app-header">
      <button className="brand" onClick={reset} aria-label="宜昌江山之间，回到全景"><MapTrifold size={30} weight="duotone"/><span><strong>宜昌 · 江山之间</strong><small>YICHANG · A CITY IN MINIATURE</small></span></button>
      <div className="header-breadcrumb"><span>城市导览</span><span className="slash">/</span><strong>{exhibit?'建筑展台':'三维沙盘'}</strong></div>
      <div className="header-right"><span className="header-poem">沿江山水，慢慢看宜昌。</span><button className="text-button save-view-button" aria-label="保存当前画面" title="保存当前画面" disabled={!ready||Boolean(error)} onClick={saveView}><Camera size={18}/><span>保存画面</span></button><button className="text-button guide-button" aria-label="操作指引" onClick={()=>setModal('guide')}><CursorClick size={17}/><span>操作指引</span></button><button className="icon-button mobile-menu" onClick={()=>setMobileNav(!mobileNav)} aria-label={mobileNav?'关闭景点目录':'打开景点目录'} aria-expanded={mobileNav}><List size={23}/></button></div>
    </header>
    <div className="app-body">
      {mobileNav&&<button className="sidebar-backdrop" aria-label="关闭景点目录" onClick={()=>setMobileNav(false)}/>}
      <aside className={`sidebar ${mobileNav?'is-open':''}`} aria-label="宜昌景点目录" inert={compact&&!mobileNav} aria-hidden={compact&&!mobileNav?true:undefined}>
        <div className="sidebar-intro"><p className="eyebrow">城市漫游</p><h1>一城山水，自在宜昌。</h1><p className="intro-copy">从一座楼阁，走进一座城。</p></div>
        <form className="search" onSubmit={e=>{e.preventDefault();if(filtered[0])chooseLandmark(filtered[0].id);}}><MagnifyingGlass size={17}/><input aria-label="搜索宜昌地标" placeholder="寻找一处风景" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button type="button" aria-label="清空搜索" onClick={()=>setQuery('')}><X size={14}/></button>}</form>
        <div className="directory-heading"><span>探索地标与建筑</span><span>{String(landmarks.length).padStart(2,'0')} 项</span></div>
        <nav className="landmark-list" aria-label="选择地标">
          {!data&&<p className="list-loading">正在展开城市目录…</p>}
          {data&&!filtered.length&&<div className="search-empty"><MagnifyingGlass size={24}/><strong>还没找到这处风景</strong><p>试试“镇江阁”或“长江”</p><button onClick={()=>setQuery('')}>查看全部地标</button></div>}
          {categories.map(category=><section className="landmark-group" key={category}><h2>{category}<span>{filtered.filter(l=>(l.category||'城市地标')===category).length}</span></h2>{filtered.filter(l=>(l.category||'城市地标')===category).map(l=><button key={l.id} className={`landmark-row ${selectedId===l.id?'selected':''}`} onClick={()=>chooseLandmark(l.id)} aria-pressed={selectedId===l.id}><span className="landmark-index">{String(landmarks.indexOf(l)+1).padStart(2,'0')}</span><span className="landmark-row-content"><strong>{l.name}</strong>{selectedId===l.id&&<small>{l.placement==='exhibit'?'独立展示 · 配准待核准':l.subtitle||'沿着江岸，发现宜昌'}</small>}</span>{l.placement==='exhibit'&&<span className="exhibit-tag">展台</span>}<CaretRight size={12}/></button>)}</section>)}
        </nav>
        <div className="sidebar-bottom"><div className="sidebar-note"><MapPin size={14}/><span>宜昌中心城区 · 风格化沙盘</span></div><button onClick={()=>setModal('about')} className="about-link">关于这座沙盘 <ArrowUpRight size={13}/></button><div className="edition"><span>YICHANG ONLINE</span><span>VOL. 01</span></div></div>
      </aside>
      <main className={`main-scene ${selected?'detail-open':''} ${exhibit?'exhibition-open':''}`} aria-label={exhibit?'宜昌城市沙盘与建筑展台':'宜昌城市三维微缩沙盘'}>
        <div className="canvas-host" ref={canvasHost}/>
        <div className={`map-labels ${layers.labels&&ready?'':'hidden'}`} aria-label="地图地标标注">
          {landmarks.map(l=><button key={l.id} ref={el=>{labelRefs.current[l.id]=el;}} className={`map-label ${selectedId===l.id?'active':''}`} onClick={()=>chooseLandmark(l.id)} aria-label={`查看${l.name}`}><span className="label-name">{l.name}</span><span className="label-pin"><MapPin size={13} weight="fill"/></span></button>)}
        </div>
        {(!ready||error)&&<div className="scene-loading" role="status">{error?<><WarningCircle size={32}/><h2>这座城还在路上</h2><p>{error}</p><button onClick={()=>window.location.reload()}>重新打开沙盘</button></>:<><MapTrifold size={44} weight="duotone"/><span className="eyebrow">YICHANG · 江山之间</span><h2>让山水，慢慢展开。</h2><p>{data?'正在安放楼阁、街巷与树木':'正在读取宜昌城市轮廓'}</p><CircleNotch className="spinner" size={22}/></>}</div>}
        <div className="scene-toolbar" aria-label="沙盘显示设置"><div className="view-segment"><button className={view==='perspective'?'active':''} onClick={()=>changeView('perspective')} aria-pressed={view==='perspective'}><Buildings size={16}/><span>{exhibit?'建筑展台':'城市沙盘'}</span></button><button className={view==='top'?'active':''} onClick={()=>changeView('top')} aria-pressed={view==='top'}><MapTrifold size={16}/><span>{exhibit?'俯瞰模型':'俯瞰地图'}</span></button></div><span className="toolbar-divider"/><button className="toolbar-button reset-button" onClick={reset} title="回到全景"><ArrowCounterClockwise size={16}/><span>回到全景</span></button><span className="toolbar-divider day-divider"/><div className="day-segment"><button className={theme==='day'?'active':''} onClick={()=>setTheme('day')} aria-pressed={theme==='day'} title="日景"><Sun size={17}/><span>日景</span></button><button className={theme==='night'?'active':''} onClick={()=>setTheme('night')} aria-pressed={theme==='night'} title="夜景"><MoonStars size={16}/><span>夜景</span></button></div></div>
        {exhibit&&<div className="exhibition-note"><span className="eyebrow">ARCHITECTURE / {selected.stage}</span><p>沙盘旁 · 独立展台 <span>位置 · 尺寸 · 朝向待核准</span><button onClick={()=>frameSelected({angle:cameraAngle==='context'?'detail':'context',close:cameraAngle==='context'})}>{cameraAngle==='context'?'靠近建筑':'连同沙盘看'} <ArrowUpRight size={12}/></button></p></div>}
        {exhibit&&ready&&(!modelState||modelState.state==='loading'||modelState.state==='error')&&<div className="model-load-state" role="status">{modelState?.state==='error'?<><WarningCircle size={24}/><strong>模型暂未载入</strong><p>可以重试，或先回到城市继续探索。</p><button onClick={()=>scene.current?.retryModel()}>重新载入</button></>:<><CircleNotch className="spinner" size={24}/><strong>正在展开建筑细节</strong><p>首次打开需要载入模型。</p></>}</div>}
        <div className="map-tools-top"><button className={`layer-toggle ${layersOpen?'active':''}`} onClick={()=>setLayersOpen(!layersOpen)} aria-expanded={layersOpen} aria-label="图层"><Stack size={17}/><span>图层</span></button>{layersOpen&&<section className="layer-panel" aria-label="图层设置"><header><strong>看见城市的层次</strong><button className="icon-button" onClick={()=>setLayersOpen(false)} aria-label="关闭图层设置"><X size={15}/></button></header>{[{id:'buildings',label:'城市建筑',Icon:Buildings},{id:'trees',label:'山林与树木',Icon:Tree},{id:'labels',label:'地标名称',Icon:MapPin}].map(({id,label,Icon})=><label key={id}><Icon size={17}/><span>{label}</span><input type="checkbox" checked={layers[id]} onChange={()=>toggleLayer(id)}/></label>)}<label className="motion-setting"><Waves size={17}/><span>江面动态</span><input type="checkbox" checked={motionEnabled} onChange={e=>setMotionEnabled(e.target.checked)}/></label><p className="layer-note">{exhibit?'城市始终保留，展台位于沙盘之外。':'靠近江岸，看看船只缓缓经过。'}</p></section>}</div>
        <div className="compass" hidden={exhibit}><span>N</span><div ref={compassRef}><NavigationArrow size={22} weight="fill"/></div></div>
        {selected&&<section className="detail-panel" aria-label={`${selected.name}介绍`}>
          <div className="detail-top"><span>{selected.category} / {exhibit?'S01 外观候选':'城市手记'}</span><div className="detail-navigation"><button className="icon-button" onClick={()=>stepLandmark(-1)} aria-label="上一处地标" title="上一处地标"><CaretLeft size={15}/></button><button className="icon-button" onClick={()=>stepLandmark(1)} aria-label="下一处地标" title="下一处地标"><CaretRight size={15}/></button><span className="detail-navigation-divider"/><button className="icon-button" onClick={closeDetails} aria-label="关闭地标介绍"><X size={18}/></button></div></div>
          <div className="detail-title"><span>{String(landmarks.indexOf(selected)+1).padStart(2,'0')}</span><h2>{selected.name}</h2></div>
          <p className="detail-subtitle">{selected.subtitle||'在山水之间，与宜昌相遇。'}</p>
          <div className="detail-tabs" role="tablist" aria-label="地标内容"><button id="story-tab" role="tab" aria-controls="landmark-panel" aria-selected={detailTab==='story'} className={detailTab==='story'?'active':''} onClick={()=>setDetailTab('story')}>地标手记</button><button id="view-tab" role="tab" aria-controls="landmark-panel" aria-selected={detailTab==='view'} className={detailTab==='view'?'active':''} onClick={()=>setDetailTab('view')}>观察视角</button></div>
          {detailTab==='story'?<div id="landmark-panel" role="tabpanel" aria-labelledby="story-tab" className="detail-story">
            <div className="scene-postcard">{detailImage?<img src={detailImage} alt={`${selected.name}的三维沙盘视角`}/>:<div className="postcard-loading"><CircleNotch className="spinner" size={20}/><span>正在靠近这处风景</span></div>}<span>沙盘取景 · {selected.name}</span></div>
            <p className="landmark-description">{selected.description}</p><div className="detail-location"><MapPin size={14}/><span>{selected.location||'湖北 · 宜昌'}</span></div>
            <button className="detail-focus" aria-pressed={closeView&&view==='perspective'} onClick={()=>frameSelected({angle:exhibit?(closeView&&view==='perspective'?'context':'detail'):cameraAngle,close:!(closeView&&view==='perspective')})}>{closeView&&view==='perspective'?(exhibit?'连同沙盘看':'回到地标全景'):'靠近看看'} {closeView&&view==='perspective'?<ArrowCounterClockwise size={17}/>:<ArrowUpRight size={17}/>}</button>
          </div>:<div id="landmark-panel" role="tabpanel" aria-labelledby="view-tab" className="detail-view">
            <p>换一个角度，发现城市的另一面。</p>
            {exhibit&&<button className={cameraAngle==='context'&&view==='perspective'?'active':''} onClick={()=>frameSelected({angle:'context',close:false})}><MapTrifold size={20}/><span><strong>连同沙盘看</strong><small>城市与板外展台，一起入镜</small></span><ArrowUpRight size={16}/></button>}
            <button className={cameraAngle==='detail'&&closeView&&view==='perspective'?'active':''} onClick={()=>frameSelected({angle:'detail',close:true})}><Buildings size={20}/><span><strong>{exhibit?'建筑近景':'地标近景'}</strong><small>{exhibit?'靠近幕墙，展开完整细节':'看见建筑与层次'}</small></span><ArrowUpRight size={16}/></button>
            {exhibit&&<button className={cameraAngle==='front'&&view==='perspective'?'active':''} onClick={()=>frameSelected({angle:'front',close:true})}><Buildings size={20}/><span><strong>正立面</strong><small>观察竖肋、窗格与入口</small></span><ArrowUpRight size={16}/></button>}
            {['zhenjiang-pavilion','tianran-pagoda'].includes(selectedId)&&<button className={cameraAngle==='river'&&view==='perspective'?'active':''} onClick={()=>frameSelected({angle:'river',close:false})}><Waves size={20}/><span><strong>江岸视角</strong><small>从江面，望向一城风景</small></span><ArrowUpRight size={16}/></button>}
            <button className={view==='top'?'active':''} onClick={()=>{if(exhibit)frameSelected({angle:'detail',close:true});changeView('top');}}><MapTrifold size={20}/><span><strong>{exhibit?'顶部与轮廓':'俯瞰此处'}</strong><small>{exhibit?'屋顶为候选，尚待核准':'读懂街巷与江岸'}</small></span><ArrowUpRight size={16}/></button>
            <button onClick={reset}><Compass size={20}/><span><strong>回到城市全景</strong><small>收起介绍，继续探索宜昌</small></span><ArrowUpRight size={16}/></button>
          </div>}
          {exhibit&&<div className="model-quality" role="status"><span className={`quality-dot ${modelState?.quality?'is-ready':''}`}/><span>{modelState?.detailState==='loading'?'正在载入近景细节':modelState?.detailState==='error'?'近景细节暂未载入':modelState?.quality==='detail'?'完整细节已就绪':modelState?.quality==='light'?'轻量模型已就绪':'模型载入中'}</span>{modelState?.detailState==='error'?<button onClick={()=>scene.current?.retryModel()}>重试</button>:<button onClick={()=>setModal('model')}>模型说明</button>}</div>}
          <footer>{exhibit?'等比微缩 · 背面与屋顶仍待核准':'建筑与景观为风格化表达'}</footer>
        </section>}
        <div className="scene-bottom-caption"><span className="eyebrow">{exhibit?'YICHANG / 建筑细读':'YICHANG / 长江之畔'}</span><p>{selected?selected.name:'把一座城，放在眼前。'}</p></div>
        <div className="interaction-hint"><Mouse size={14}/><span>拖动旋转</span><span className="hint-dot">·</span><span>滚轮缩放</span><span className="hint-dot">·</span><span>点击地标探索</span></div>
        <div className="map-controls"><button className={autoRotate?'active':''} onClick={toggleRotate} aria-pressed={autoRotate} title={autoRotate?'暂停环绕':'自动环绕'} aria-label={autoRotate?'暂停环绕':'自动环绕'}>{autoRotate?<Pause size={16}/>:<Play size={16}/>}</button><div className="zoom-controls"><button aria-label="放大沙盘" onClick={()=>scene.current?.zoom(1)}><Plus size={19}/></button><button aria-label="缩小沙盘" onClick={()=>scene.current?.zoom(-1)}><Minus size={19}/></button></div></div>
        <div className="scene-attribution"><button onClick={()=>setModal(exhibit?'model':'about')}>{exhibit?'模型来源与说明':'地图数据与来源'}</button><span>{exhibit?'宜昌Online · 自建建筑候选':'© OpenStreetMap contributors'}</span></div>
        {toast&&<div className="toast" role="status"><Check size={17}/>{toast}</div>}
      </main>
    </div>
    {modal==='guide'&&<Modal title="用自己的节奏，认识宜昌。" onClose={closeModal}><div className="guide-steps"><div><Mouse size={26}/><span><strong>转一转，看见山水</strong><p>按住鼠标左键拖动，旋转沙盘；右键拖动可平移。</p></span></div><div><Plus size={26}/><span><strong>近一点，看见细节</strong><p>滚动鼠标滚轮，或使用右下角的加减按钮缩放。</p></span></div><div><CursorClick size={26}/><span><strong>点一处，听一座城</strong><p>点击地标名称或左侧目录，镜头会带你靠近风景。</p></span></div><div><Sun size={26}/><span><strong>从日景，走到夜色</strong><p>切换顶部日夜按钮，也可以开启自动环绕慢慢欣赏。</p></span></div></div><p className="touch-note">触屏：单指旋转，双指缩放与平移。点击顶部相机可保存画面；图层里可暂停江面动态。</p><button className="primary-button" onClick={closeModal}>开始探索 <ArrowUpRight size={17}/></button></Modal>}
    {modal==='about'&&<Modal title="关于这座沙盘" onClose={closeModal}><div className="about-content"><p className="about-lead">把宜昌的山水、街巷与楼阁，装进一座可以探索的微缩城市。</p><p>沙盘以公开道路、水系和建筑轮廓为基础，采用统一的色彩与简化造型呈现中心城区。地标、树木、江面船只与部分建筑高度经过展示性处理，适合城市导览与空间探索。</p><div className="about-data"><span>地图与轮廓</span><strong>OpenStreetMap · Overture Maps</strong><span>展示范围</span><strong>{data?.meta?.name||'宜昌中心城区'}</strong><span>作品</span><strong>宜昌Online · 江山之间</strong></div><p className="data-note">地标位置为公开资料参考，模型并非测绘或工程成果。</p><a className="source-link" href="/data/sources.txt" target="_blank" rel="noreferrer">查看完整数据来源与说明 <ArrowUpRight size={15}/></a></div><button className="primary-button" onClick={closeModal}>回到山水之间 <ArrowLeft size={17}/></button></Modal>}
    {modal==='model'&&<Modal title="首信财富中心 · 模型说明" onClose={closeModal}><div className="about-content"><p className="about-lead">从一格幕墙，读懂一座建筑。</p><p>此展台使用自建首信财富中心 S01 模型的网页副本，保留楼体比例、主立面竖肋、幕墙分格、顶部冠架及参考时期字牌。三轴统一缩放，近看按需载入完整细节。</p><div className="about-data"><span>当前阶段</span><strong>S01 外观候选</strong><span>展示方式</span><strong>独立展台 · 尚未地图配准</strong><span>尺寸与朝向</span><strong>绝对尺寸、真北朝向待核准</strong><span>未完成部分</span><strong>完整背面与屋顶</strong></div><p className="data-note">字牌保留参考时期外观，不证明当前营业或商户。夜景灯光为展示性处理。模型不属于实测或工程成果。</p><a className="source-link" href="/models/shouxin-s01/README.txt" target="_blank" rel="noreferrer">查看原始交接说明 <ArrowUpRight size={15}/></a></div><button className="primary-button" onClick={closeModal}>继续看建筑 <ArrowLeft size={17}/></button></Modal>}
  </div>;
}
