import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Exercise the actual city factory, OrbitControls, loader queue and public API.
// Only the GPU renderer/DOM transport is replaced. This checks scheduling and
// state retention, and deliberately makes no WebGL or visual-quality claim.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'src/scene/createCityScene.js');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'yichang-render-lifecycle-'));
let time = 0, nextFrame = 1, engine;
const callbacks = new Map(), requests = [], observers = [], checks = [];
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
  container.parentElement={querySelector:()=>null};
  let ready=0;
  engine=createCityScene({container,data:JSON.parse(fs.readFileSync(path.join(root,'public/data/city.json'),'utf8')),onReady:()=>{ready++;},onCameraChange:()=>{}});
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
