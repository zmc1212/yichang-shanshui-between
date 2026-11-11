import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Vector3 } from 'three';
import { AUTHORED_MODELS } from '../src/scene/authoredModels.js';
import { resolveAuthoredPlacement } from '../src/scene/authoredPlacement.js';
import { planStreetObservations } from '../src/scene/streetObservation.js';

const checks = [];
const model = { id: 'test', kind: 'authored', x: 0, z: 0, footprint: [[-1,-1],[1,-1],[1,1],[-1,1]], localSize: { x: 2, y: 4, z: 2 } };
const road = (z, extra = {}) => ({ name: `road ${z}`, highway: 'residential', width: .4, points: [[-4,z],[4,z]], ...extra });
const roads = [road(1.4,{bridge:true}),road(1.5,{tunnel:true}),road(1.6,{layer:1}),road(1.7,{highway:'footway'}),road(0),road(-4),road(2)];
const original = JSON.stringify({ model, roads });
let plan = planStreetObservations({ models: [model], roads, unitsPerMeter: 1 });
assert.equal(plan.views[0].sourceRoadIndex, 6);
assert.equal(plan.views[0].roadName, 'road 2');
assert.ok(plan.views[0].direction[1] > .4, 'street observation must remain elevated, not a first-person walking route');
assert.equal(JSON.stringify({ model, roads }), original);
assert.ok(plan.views[0].framePoints.some(p => p[1] > 4), 'the complete building top is part of the view');
assert.ok(plan.views[0].streetPoints.length >= 4, 'the real road ribbon is included');
plan = planStreetObservations({ models: [model], roads, unitsPerMeter: 1, inWater: (x,z) => z > 1.7 });
assert.equal(plan.views[0].sourceRoadIndex, 5, 'a road crossing water is not a valid street camera anchor');
assert.equal(planStreetObservations({models:[model],roads:[road(100)],unitsPerMeter:1}).views.length,0);
assert.equal(planStreetObservations({models:[model],roads:[road(2,{points:[[-4,2],null,[4,2]]})],unitsPerMeter:1}).views.length,0);
checks.push('nearest valid surface carriageway wins; bridge/tunnel/elevated/pedestrian/intersecting/water/far/broken segments are excluded without moving any source data');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(fs.readFileSync(path.join(root,'public/data/city.json'),'utf8'));
function inside(point, ring) { let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit; }
const inWater = (x,z) => data.water.some(p=>inside([x,z],p.rings[0])&&!p.rings.slice(1).some(ring=>inside([x,z],ring)));
const models = AUTHORED_MODELS.map(model=>resolveAuthoredPlacement(model,data.meta)).filter(Boolean);
const sourceBefore = JSON.stringify({ models, roads:data.roads });
const real = planStreetObservations({ models, roads:data.roads, unitsPerMeter:data.meta.unitsPerMeter, inWater });
const requiredIds = ['wanda-soho-s01','yichang-international-s01','shouxin-wealth-s01'];
for(const id of requiredIds) assert.ok(real.stats.availableIds.includes(id),`${id} needs a supported street observation`);
for(const view of real.views) {
  const source = data.roads[view.sourceRoadIndex];
  assert.deepEqual(view.sourceEndpoints,[source.points[view.sourceSegmentIndex],source.points[view.sourceSegmentIndex+1]]);
  const [a,b]=view.sourceEndpoints,dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
  for(const p of view.observedEndpoints) {
    const perpendicular=Math.abs((p[0]-a[0])*dz-(p[1]-a[1])*dx)/length;
    const t=((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(length*length);
    assert.ok(perpendicular<1e-8&&t>=-1e-9&&t<=1+1e-9, 'framing never extends or shortcuts a source road');
  }
  assert.ok(view.gapMeters>=.4&&view.gapMeters<=110);
  assert.ok(view.framePoints.flat().every(Number.isFinite));
}
assert.equal(JSON.stringify({models,roads:data.roads}),sourceBefore);
checks.push('actual current models expose bounded road observations, including Wanda, International Plaza and Shouxin; observed segments remain inside the original source lines');

// Real camera fitting, scene setup and original geometric guards. Only the GPU
// renderer and DOM transport are substituted; no visual-render claim follows.
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'yichang-street-observation-'));
const sourcePath=path.join(root,'src/scene/createCityScene.js');
const keys=['document','window','performance','requestAnimationFrame','cancelAnimationFrame','ResizeObserver','fetch','__StreetRendererProbe'];
const saved=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
let time=0,next=0,renderer,engine,resizeCallback,rect={top:70,left:280,width:1000,height:730},panel=null,dock=null;
const callbacks=new Map();
class Element extends EventTarget {
  constructor(){super();this.style={};this.dataset={};}
  getRootNode(){return documentProbe;}getBoundingClientRect(){return {...rect};}
  get clientWidth(){return rect.width;}get clientHeight(){return rect.height;}
  setAttribute(){}getContext(){return null;}remove(){}setPointerCapture(){}releasePointerCapture(){}
}
const documentProbe=new EventTarget();documentProbe.hidden=false;documentProbe.createElement=()=>new Element();
const media=new EventTarget();media.matches=false;
const windowProbe={innerWidth:1280,devicePixelRatio:1,matchMedia:()=>media};
class RendererProbe {
  constructor(){renderer=this;this.domElement=new Element();this.shadowMap={};this.info={render:{calls:0,triangles:0},memory:{}};}
  setPixelRatio(){}setSize(){}dispose(){}
  render(scene,camera){this.scene=scene;this.camera=camera;scene.updateMatrixWorld();camera.updateMatrixWorld();}
}
const globals={document:documentProbe,window:windowProbe,performance:{now:()=>time},
  requestAnimationFrame:fn=>{callbacks.set(++next,fn);return next;},cancelAnimationFrame:id=>callbacks.delete(id),
  ResizeObserver:class{constructor(fn){resizeCallback=fn;}observe(){}disconnect(){}},
  fetch:(url,{signal}={})=>new Promise((resolve,reject)=>{signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});}),
  __StreetRendererProbe:RendererProbe,
};
function settle(){let count=0;while(callbacks.size){assert.ok(count++<220,'camera transition settles');time+=16;const batch=[...callbacks];callbacks.clear();for(const [,fn]of batch)fn(time);}}
try {
  for(const [key,value]of Object.entries(globals))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  const instrumented=fs.readFileSync(sourcePath,'utf8').replace('new THREE.WebGLRenderer(','new globalThis.__StreetRendererProbe(')
    .replace(/from '([^']+)'/g,(_,specifier)=>`from '${specifier.startsWith('.')?new URL(specifier,pathToFileURL(sourcePath)).href:import.meta.resolve(specifier)}'`);
  const entry=path.join(temporary,'scene.mjs');fs.writeFileSync(entry,instrumented);
  const {createCityScene}=await import(pathToFileURL(entry).href);
  const container=new Element();container.appendChild=()=>{};container.parentElement={querySelector:selector=>{const value=selector==='.detail-panel'?panel:selector==='.tour-dock'?dock:null;return value?{getBoundingClientRect:()=>({...value})}:null;}};
  engine=createCityScene({container,data});engine.setMotion(false);settle();
  const initial=engine.getStats();
  const positions=JSON.stringify(initial.authoredResidents.map(({id,position,yaw,uniformScale})=>({id,position,yaw,uniformScale})));
  const guardedStreetViews=JSON.stringify(initial.streetDetails.streetViewSiteIds);
  const results=[];
  for(const viewport of [
    {name:'desktop',rect:{top:70,left:280,width:1000,height:730},innerWidth:1280,panel:{top:155,left:957,width:298,height:520},dock:null},
    {name:'desktop tour',rect:{top:70,left:280,width:1000,height:730},innerWidth:1280,panel:{top:155,left:957,width:298,height:520},dock:{top:597,left:310,width:320,height:165}},
    {name:'phone tour',rect:{top:60,left:0,width:390,height:784},innerWidth:390,panel:{top:665,left:12,width:366,height:129},dock:{top:545,left:12,width:366,height:108}},
  ]) {
    rect=viewport.rect;windowProbe.innerWidth=viewport.innerWidth;panel=viewport.panel;dock=viewport.dock;resizeCallback();settle();
    for(const id of requiredIds) {
      engine.focus(id,{angle:'street',close:true});settle();
      const stats=engine.getStats();assert.equal(stats.focusAngle,'street');assert.ok(stats.streetObservationIds.includes(id));
      const resident=stats.authoredResidents.find(r=>r.id===id),spec=AUTHORED_MODELS.find(s=>s.id===id),view=real.views.find(v=>v.id===id);
      const [min,max]=[spec.sourceBounds.min,spec.sourceBounds.max],cx=(min[0]+max[0])/2,cz=(min[2]+max[2])/2;
      const c=Math.cos(resident.yaw),s=Math.sin(resident.yaw),scale=resident.uniformScale;
      const points=[];
      for(const x of [min[0],max[0]])for(const y of [min[1],max[1]])for(const z of [min[2],max[2]]) {
        const px=(x-cx)*scale,pz=(z-cz)*scale;
        points.push(new Vector3(resident.position[0]+px*c+pz*s,resident.position[1]+(y-min[1])*scale,resident.position[2]-px*s+pz*c));
      }
      points.push(...view.streetPoints.map(p=>new Vector3(...p)));
      const right=viewport.innerWidth<=700?rect.width-18:panel.left-rect.left-20;
      const bottom=Math.min(viewport.innerWidth<=700?panel.top-rect.top-14:rect.height-50,dock?dock.top-rect.top-12:Infinity);
      for(const point of points) {
        const p=point.clone().project(renderer.camera),x=(p.x+1)*rect.width/2,y=(1-p.y)*rect.height/2;
        assert.ok(x>=18&&x<=right&&y>=68&&y<=bottom,`${viewport.name} ${id}: whole building and observed road must clear the UI (${x},${y})`);
      }
      assert.equal(JSON.stringify(stats.authoredResidents.map(({id,position,yaw,uniformScale})=>({id,position,yaw,uniformScale}))),positions);
      assert.equal(JSON.stringify(stats.streetDetails.streetViewSiteIds),guardedStreetViews,'the new camera must not bypass the old street geometry guards');
      results.push({viewport:viewport.name,id,road:view.roadName||'unnamed source road',zoom:stats.cameraZoom});
    }
  }
  engine.focus('zhenjiang-pavilion',{angle:'street',close:true});settle();
  assert.equal(engine.getStats().focusAngle,'detail','an unsupported street angle falls back to the existing landmark camera');
  checks.push('actual camera fits complete model corners plus source-road margin on desktop, desktop tour and phone tour; source transforms and old frontage/street guards remain unchanged; unsupported targets fall back');
  console.log(JSON.stringify({passed:checks.length,checks,availableCount:real.views.length,requiredObservations:results,webglVerified:false},null,2));
} finally {
  engine?.dispose();for(const [key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  fs.rmSync(temporary,{recursive:true,force:true});
}
