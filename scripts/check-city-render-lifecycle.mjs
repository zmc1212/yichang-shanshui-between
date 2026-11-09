import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Box3, Vector3 } from 'three';
import { AUTHORED_MODELS } from '../src/scene/buildingCatalog.js';
import { resolveAuthoredPlacement, authoredWorldBounds } from '../src/scene/authoredPlacement.js';

// Exercise the actual city factory, OrbitControls, loader queue and public API.
// Only the GPU renderer/DOM transport is replaced. This checks scheduling and
// state retention, and deliberately makes no WebGL or visual-quality claim.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'src/scene/createCityScene.js');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'yichang-render-lifecycle-'));
let time = 0, nextFrame = 1, engine, projection, panelRect = null, noteRect = null;
const callbacks = new Map(), requests = [], observers = [], checks = [];
const interactions = [], selections = [];
let rect = { top: 70, left: 280, width: 1000, height: 730 };
const saved = new Map(['document','window','performance','requestAnimationFrame','cancelAnimationFrame','ResizeObserver','fetch','__CityRendererProbe'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));

class Element extends EventTarget {
  constructor() { super(); this.dataset = {}; this.style = {}; this.attributes = {}; }
  getRootNode() { return documentProbe; }
  getBoundingClientRect() { return { ...rect }; }
  get clientWidth() { return rect.width; }
  get clientHeight() { return rect.height; }
  getContext() { return null; }
  setAttribute(name,value) { this.attributes[name] = value; }
  setPointerCapture() {}
  releasePointerCapture() {}
  remove() { this.removed = true; }
  toDataURL() { return 'data:image/png;base64,c2NoZWR1bGluZy1wcm9iZQ=='; }
}
const documentProbe = new EventTarget();
documentProbe.hidden = false;
documentProbe.createElement = () => new Element();
const media = new EventTarget(); media.matches = false;
const windowProbe = { innerWidth: 1280, devicePixelRatio: 1, matchMedia: () => media };
let renderer;
class RendererProbe {
  constructor() {
    renderer = this; this.domElement = new Element(); this.shadowMap = {};
    this.info = { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } };
    this.renders = 0; this.sizes = 0;
  }
  setPixelRatio() {}
  setSize() { this.sizes++; }
  render(scene,camera) {
    this.renders++; this.scene = scene; this.camera = camera;
    scene.updateMatrixWorld(); camera.updateMatrixWorld();
  }
  dispose() { this.disposed = true; }
}
const globals = {
  document: documentProbe,
  window: windowProbe,
  performance: { now: () => time },
  requestAnimationFrame: callback => { const id=nextFrame++; callbacks.set(id,callback); return id; },
  cancelAnimationFrame: id => callbacks.delete(id),
  ResizeObserver: class { constructor(callback) { this.callback=callback; observers.push(this); } observe() {} disconnect() {} },
  fetch: (url,{signal}={}) => new Promise((resolve,reject) => {
    const onAbort = () => reject(new DOMException('Test request aborted', 'AbortError'));
    signal?.addEventListener('abort',onAbort,{once:true});
    requests.push({url,resolve:response=>{signal?.removeEventListener('abort',onAbort);resolve(response);}});
  }),
  __CityRendererProbe: RendererProbe,
};
function tick(duration=16) {
  time += duration;
  const batch=[...callbacks]; callbacks.clear();
  batch.forEach(([,callback])=>callback(time));
}
function settle(limit=200) {
  let count=0;
  while(callbacks.size) { assert.ok(count++<limit,'actual city did not stop scheduling'); tick(); }
  assert.equal(renderer.domElement.dataset.renderState,'idle');
  return count;
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function frames() { return Number(renderer.domElement.dataset.renderFrames); }
function wake(action,label) {
  const before=frames(); action();
  assert.equal(callbacks.size,1,`${label} must schedule one wakeup`);
  settle(); assert.ok(frames()>before,`${label} must produce a frame`);
}

try {
  for(const [key,value] of Object.entries(globals)) Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  const source=fs.readFileSync(sourcePath,'utf8');
  assert.equal(source.match(/new THREE\.WebGLRenderer\(/g)?.length,1);
  const instrumented=source.replace('new THREE.WebGLRenderer(', 'new globalThis.__CityRendererProbe(')
    .replace(/from '([^']+)'/g,(_,specifier)=>`from '${specifier.startsWith('.') ? new URL(specifier,pathToFileURL(sourcePath)).href : import.meta.resolve(specifier)}'`);
  const entry=path.join(temporary,'scene.mjs'); fs.writeFileSync(entry,instrumented);
  const {createCityScene}=await import(pathToFileURL(entry).href);
  const container=new Element(); container.appendChild=element=>{container.canvas=element;};
  container.parentElement={querySelector:selector=>{
    const box=selector==='.detail-panel'?panelRect:selector==='.authored-note'?noteRect:null;
    return box?{getBoundingClientRect:()=>({...box})}:null;
  }};
  let ready=0;
  const data=JSON.parse(fs.readFileSync(path.join(root,'public/data/city.json'),'utf8'));
  engine=createCityScene({container,data,onReady:()=>{ready++;},onCameraChange:value=>{projection=value;},onInteraction:value=>interactions.push(value),onSelect:id=>selections.push(id)});
  settle(); await flush(); settle();
  assert.equal(ready,1); assert.equal(requests.length,2,'both resident workers must start before idle');
  assert.ok(frames()>=3,'initial framing is complete');
  const restingFrames=frames(); time+=10000;
  assert.equal(callbacks.size,0); assert.equal(frames(),restingFrames);
  checks.push('actual factory finishes initial framing, starts two resident workers, then has zero idle frame callbacks');

  requests[0].resolve({ok:false,status:503}); await flush();
  assert.equal(callbacks.size,1,'late model failure/status change wakes the city');
  settle(); await flush();
  assert.ok(requests.length>=3,'resident queue continues after an error');
  checks.push('late loader completion wakes a sleeping city and does not strand the loading queue');

  wake(()=>engine.setTheme('night'),'theme');
  wake(()=>engine.setLayer('trees',false),'layer');
  wake(()=>engine.zoom(1),'zoom button');
  wake(()=>engine.setView('top'),'top view');
  wake(()=>engine.setView('perspective'),'perspective view');
  wake(()=>engine.focus('shouxin-wealth-s01',{close:true}),'focus');
  wake(()=>engine.refitSelection(),'selection refit');
  wake(()=>engine.reset(),'reset');
  const wheel=new Event('wheel',{cancelable:true}); Object.assign(wheel,{deltaY:-100,deltaMode:0,ctrlKey:false,clientX:600,clientY:400});
  wake(()=>renderer.domElement.dispatchEvent(wheel),'real OrbitControls wheel event');
  rect={...rect,width:940}; wake(()=>observers[0].callback([]),'resize observer');
  checks.push('theme, layers, zoom, view, focus, refit, reset, real OrbitControls and resize all wake after idle');

  // Verify the real cluster camera using independently recovered world anchors
  // and source bounds, including pending POIs and a long bridge.
  // No collision/grouping implementation is substituted into the scene.
  const cityScene=renderer.scene, cityCanvas=renderer.domElement;
  const landmarkLayer=cityScene.getObjectByName('landmarks');
  const worldAnchors=new Map(projection.labels.map(label=>[label.id,new Vector3(label.x/projection.width*2-1,1-label.y/projection.height*2,label.depth).unproject(renderer.camera)]));
  const allPoints=new Map();
  for(const [id,anchor] of worldAnchors) {
    const sourceModel=AUTHORED_MODELS.find(spec=>spec.id===id);
    const sourceLandmark=data.landmarks.find(spec=>spec.id===id);
    let bounds;
    if(sourceModel) {
      const base=engine.getStats().authoredResidents.find(record=>record.id===id).position[1];
      bounds=authoredWorldBounds(resolveAuthoredPlacement(sourceModel,data.meta),base);
    } else if(sourceLandmark) bounds=new Box3().setFromObject(landmarkLayer.getObjectByName(sourceLandmark.name));
    else bounds=new Box3(new Vector3(anchor.x-4,anchor.y-.5,anchor.z-4),new Vector3(anchor.x+4,anchor.y+4.5,anchor.z+4));
    const points=[anchor];
    for(const x of [bounds.min.x,bounds.max.x]) for(const y of [bounds.min.y,bounds.max.y]) for(const z of [bounds.min.z,bounds.max.z]) points.push(new Vector3(x,y,z));
    allPoints.set(id,points);
  }
  const unchangedModels=JSON.stringify(landmarkLayer.children.map(object=>({uuid:object.uuid,position:object.position.toArray(),quaternion:object.quaternion.toArray(),scale:object.scale.toArray()})));
  const assertClusterFits=(ids,label,fullBounds=false)=>{
    assert.equal(projection.width,rect.width); assert.equal(projection.height,rect.height);
    assert.equal(projection.zoom,renderer.camera.zoom);
    for(const id of ids) for(const point of fullBounds?allPoints.get(id):allPoints.get(id).slice(0,1)) {
      const p=point.clone().project(renderer.camera), x=(p.x+1)*rect.width/2,y=(1-p.y)*rect.height/2;
      assert.ok(x>0&&x<rect.width&&y>64&&y<rect.height-40,`${label}: ${id} must fit outside toolbar/footer`);
      if(panelRect) {
        if(windowProbe.innerWidth<=700) assert.ok(y<panelRect.top-rect.top-10,`${label}: ${id} must clear the mobile card`);
        else assert.ok(x<panelRect.left-rect.left-10,`${label}: ${id} must clear the desktop card`);
      }
    }
    assert.equal(renderer.scene,cityScene); assert.equal(renderer.domElement,cityCanvas);
  };
  assert.equal(engine.focusCluster([]),false); assert.equal(engine.focusCluster(['unknown']),false);
  assert.equal(callbacks.size,0,'empty groups must not wake the scene');
  const group=['jinjiang-s03','wanda-soho-s01','shouxin-wealth-s01','meilian-s05','business-1649141','yiling-bridge'];
  const groupDirection=renderer.camera.getWorldDirection(new Vector3());
  wake(()=>assert.equal(engine.focusCluster([...group,group[0],'unknown']),true),'cluster focus');
  assert.ok(renderer.camera.getWorldDirection(new Vector3()).distanceTo(groupDirection)<1e-10,'cluster framing preserves the current viewing direction');
  assertClusterFits(group,'desktop group');
  assert.equal(JSON.stringify(landmarkLayer.children.map(object=>({uuid:object.uuid,position:object.position.toArray(),quaternion:object.quaternion.toArray(),scale:object.scale.toArray()}))),unchangedModels,'group focus must not move any landmark, model or selection ring');

  engine.setAutoRotate(true); tick(); tick();
  const rotatingDirection=renderer.camera.getWorldDirection(new Vector3());
  wake(()=>engine.focusCluster(group),'cluster stops auto-rotation');
  assert.ok(renderer.camera.getWorldDirection(new Vector3()).distanceTo(rotatingDirection)<1e-10,'residual orbit damping must not change the requested group direction');
  assert.equal(interactions.at(-1)?.type,'cluster'); assert.deepEqual(selections,[]);
  assertClusterFits(group,'rotated group');
  wake(()=>engine.focusCluster(['yiling-bridge']),'bridge reference-point group');
  assertClusterFits(['yiling-bridge'],'bridge reference-point group');
  assert.ok(allPoints.get('yiling-bridge').slice(1).some(point=>{
    const p=point.clone().project(renderer.camera);return Math.abs(p.x)>1||Math.abs(p.y)>1;
  }),'group zoom must not retreat just to include a bridge engineering envelope');

  wake(()=>engine.focus('shouxin-wealth-s01',{close:true}),'selection before cluster');
  const selectedAnchor=renderer.domElement.dataset.modelAnchor;
  const selectedRing=landmarkLayer.children.find(object=>object.material?.color?.getHexString()==='e4ae55');
  const ringPosition=selectedRing.position.clone();
  for(const viewport of [
    {width:940,height:730,innerWidth:1280,top:70,left:280,panel:{left:897,top:153,width:298,height:520},view:'perspective'},
    {width:390,height:780,innerWidth:390,top:60,left:0,panel:{left:12,top:430,width:366,height:364},view:'perspective'},
    {width:390,height:780,innerWidth:390,top:60,left:0,panel:{left:12,top:665,width:366,height:129},view:'top'},
  ]) {
    const {innerWidth,panel,view,...nextRect}=viewport;
    windowProbe.innerWidth=innerWidth; rect=nextRect; panelRect=panel;
    observers[0].callback([]); settle(); engine.setView(view); settle();
    const direction=renderer.camera.getWorldDirection(new Vector3());
    wake(()=>engine.focusCluster(group),`${innerWidth}px ${view} selected group`);
    assert.equal(engine.getStats().view,view);
    assert.ok(renderer.camera.getWorldDirection(new Vector3()).distanceTo(direction)<1e-10);
    assertClusterFits(group,`${innerWidth}px ${view} selected group`);
    assert.equal(engine.getStats().authoredSelection,true);
    assert.equal(renderer.domElement.dataset.modelAnchor,selectedAnchor);
    assert.ok(selectedRing.position.distanceTo(ringPosition)<1e-12&&selectedRing.visible);
    const frame=frames(),position=renderer.camera.position.clone();
    engine.refitSelection(); settle();
    assert.equal(frames(),frame,'detail-card resize must not refocus the old selection after group framing');
    assert.ok(renderer.camera.position.distanceTo(position)<1e-12);
  }
  const previousRect={...rect}, previousPanel={...panelRect};
  rect={...rect,height:360};
  panelRect={left:12,top:rect.top+123,width:366,height:191};
  noteRect={left:12,top:rect.top+72,bottom:rect.top+124,width:350,height:52};
  observers[0].callback([]); settle();
  const crowdedFrames=frames(),crowdedPosition=renderer.camera.position.clone();
  assert.equal(engine.focusCluster(group),false,'a fully covered viewport must return a recoverable failure');
  assert.equal(callbacks.size,0);assert.equal(frames(),crowdedFrames);
  assert.ok(renderer.camera.position.distanceTo(crowdedPosition)<1e-12,'a failed group fit must not disturb the current camera');
  rect=previousRect;panelRect=previousPanel;noteRect=null;observers[0].callback([]);settle();
  wake(()=>engine.focusCluster(['shouxin-wealth-s01','shouxin-wealth-s01']),'coincident group');
  assertClusterFits(['shouxin-wealth-s01'],'coincident small building',true);
  const repeatedZoom=renderer.camera.zoom, repeatedPosition=renderer.camera.position.clone();
  for(let i=0;i<3;i++) wake(()=>engine.focusCluster(['shouxin-wealth-s01']),`repeat coincident group ${i}`);
  assert.ok(Math.abs(renderer.camera.zoom-repeatedZoom)<1e-10);
  assert.ok(renderer.camera.position.distanceTo(repeatedPosition)<1e-10);
  assert.ok((renderer.camera.top-renderer.camera.bottom)/renderer.camera.zoom>=12-1e-9,'coincident group keeps a finite neighborhood-height floor');
  engine.setSuspended(true); const pausedGroupFrames=frames();
  engine.focusCluster(group); time+=5000;
  assert.equal(callbacks.size,0); assert.equal(frames(),pausedGroupFrames);
  engine.setSuspended(false); settle(); assertClusterFits(group,'group requested under overlay');
  checks.push('cluster framing preserves direction/selection/models, clears desktop/mobile cards, bounds repeated coincident zoom, uses bridge anchors rather than full spans, rejects covered viewports, and resumes from overlays');
  panelRect=null; windowProbe.innerWidth=1280; rect={top:70,left:280,width:940,height:730};
  observers[0].callback([]); settle(); wake(()=>engine.reset(),'reset after cluster checks');

  engine.setAutoRotate(true); tick(); tick();
  const cameraBefore=renderer.camera.position.clone(),heldScene=renderer.scene,heldCanvas=renderer.domElement;
  engine.setSuspended(true);
  assert.equal(callbacks.size,0); assert.equal(heldCanvas.dataset.renderState,'suspended');
  const frozen=frames(),sizes=renderer.sizes;
  rect={...rect,width:900}; observers[0].callback([]);
  time+=5000; tick();
  assert.equal(frames(),frozen); assert.equal(renderer.sizes,sizes,'paused resize must not clear the canvas');
  assert.ok(renderer.camera.position.distanceTo(cameraBefore)<1e-12);
  const image=engine.getImage();
  assert.ok(image.startsWith('data:image/png')); assert.equal(frames(),frozen+1,'snapshot explicitly draws exactly once');
  assert.equal(callbacks.size,0); assert.equal(heldCanvas.dataset.renderState,'suspended');
  assert.equal(renderer.sizes,sizes,'paused snapshot preserves the retained viewport');
  assert.equal(renderer.scene,heldScene); assert.equal(renderer.domElement,heldCanvas); assert.equal(renderer.disposed,undefined);
  documentProbe.hidden=true; documentProbe.dispatchEvent(new Event('visibilitychange'));
  engine.setSuspended(false); assert.equal(callbacks.size,0); assert.equal(heldCanvas.dataset.renderState,'hidden');
  time+=2000; documentProbe.hidden=false; documentProbe.dispatchEvent(new Event('visibilitychange'));
  assert.equal(callbacks.size,1); tick();
  assert.equal(renderer.sizes,sizes+1,'the deferred resize is applied on resume');
  assert.equal(renderer.scene,heldScene); assert.equal(renderer.domElement,heldCanvas);
  assert.equal(callbacks.size,1,'auto-rotation intent survives suspension');
  engine.setAutoRotate(false); settle();
  checks.push('overlay+hidden suspend rendering without replacing city/canvas; resize waits; snapshot draws once; resume retains motion intent');

  engine.setMotion(false); settle();
  wake(()=>engine.focus('zhenjiang-pavilion',{close:true}),'river landmark');
  engine.setMotion(true); tick();
  assert.equal(engine.getStats().motionRunning,true,'waterfront animation is eligible');
  assert.equal(callbacks.size,1,'boats keep demand-driven frames live');
  engine.setMotion(false); settle();
  checks.push('waterfront motion remains live while enabled and returns to idle when stopped');

  engine.dispose(); assert.equal(callbacks.size,0); assert.equal(heldCanvas.dataset.renderState,'disposed');
  await flush(); assert.equal(callbacks.size,0);
  checks.push('disposing cancels frames and late model promises cannot revive the city');
  console.log(JSON.stringify({passed:true,checks,renderFrames:frames(),webglVerified:false},null,2));
} finally {
  engine?.dispose(); await flush();
  for(const [key,descriptor] of saved) { if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]; }
  fs.rmSync(temporary,{recursive:true,force:true});
}
