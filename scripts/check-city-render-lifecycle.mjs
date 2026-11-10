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
let toolbarRect = null, captionRect = null, attributionRect = null;
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
    const box={'.detail-panel':panelRect,'.authored-note':noteRect,'.scene-toolbar':toolbarRect,
      '.scene-bottom-caption':captionRect,'.scene-attribution':attributionRect}[selector];
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
  const sourceRoadLayer=renderer.scene.getObjectByName('roads');
  const streetBeforeToggle=engine.getStats().streetDetails;
  assert.equal(streetBeforeToggle.streetVisibleTier,2,'Shouxin whole-building view reveals the street sample');
  assert.ok(streetBeforeToggle.streetVisibleDrawCalls>0);
  wake(()=>engine.setLayer('streetDetails',false),'street details off');
  assert.equal(engine.getStats().streetDetails.streetVisibleDrawCalls,0);
  assert.equal(sourceRoadLayer.visible,true,'street detail toggle retains the base road network');
  wake(()=>engine.setLayer('streetDetails',true),'street details on');
  assert.equal(engine.getStats().streetDetails.streetVisibleTier,2);
  assert.equal(renderer.scene.getObjectByName('street tree crowns').parent.visible,false,'street trees honor the existing tree layer');
  checks.push('street sample wakes on toggle, reveals by screen scale, retains base roads and existing tree-layer state, then returns to idle');
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

  // Independently project the authored source box through the real camera.
  // Its eight corners retain the model's local orientation; using the scene's
  // world AABB here would reproduce the original double-padding regression.
  // The pending network requests do not need to resolve to check camera fit.
  const authoredCorners=new Map(AUTHORED_MODELS.map(spec=>{
    const resident=engine.getStats().authoredResidents.find(value=>value.id===spec.id);
    const [min,max]=[spec.sourceBounds.min,spec.sourceBounds.max];
    const middleX=(min[0]+max[0])/2, middleZ=(min[2]+max[2])/2;
    const c=Math.cos(resident.yaw),s=Math.sin(resident.yaw),scale=resident.uniformScale;
    const points=[];
    for(const x of [min[0],max[0]]) for(const y of [min[1],max[1]]) for(const z of [min[2],max[2]]) {
      const px=(x-middleX)*scale,pz=(z-middleZ)*scale;
      points.push(new Vector3(resident.position[0]+px*c+pz*s,resident.position[1]+(y-min[1])*scale,resident.position[2]-px*s+pz*c));
    }
    return [spec.id,points];
  }));
  // Native facade samples were checked against each recovered GLB. Transform
  // them independently of the camera's inspection helper so the oracle cannot
  // reproduce an incorrect centering, source origin or yaw calculation.
  const facadeSamples={
    'shouxin-wealth-s01':[0,53.87,11.72],
    'wanda-soho-s01':[0,55,8],
    'yichang-international-s01':[-31.5,55,-.4],
    'zhongnan-s09':[10.31,58.61,-.008],
    'jinjiang-s03':[.337,39.66,-.28],
    'fujiang-s01':[0,54.94,8.31],
    'jiuzhou-s01':[-1.84,55,9.16],
  };
  const detailPartSamples={
    'shouxin-wealth-s01':{entrance:[0,6.86,9.23],crown:[0,94,11.72]},
    'zhongnan-s09':{entrance:[10.31,7.46,1.20],crown:[10,99.3,-10]},
    'jinjiang-s03':{entrance:[.34,5.05,16.58],crown:[.34,67.79,-.51]},
    'wanda-soho-s01':{entrance:[0,7.05,10.16],crown:[0,98.7,0]},
    'fujiang-s01':{entrance:[0,6.88,10.42],crown:[0,93.99,8.31]},
    'yichang-international-s01':{entrance:[-36.5,3.4,2.6],crown:[-31.5,94.06,-.43]},
    'jiuzhou-s01':{entrance:[-10.03,3,16.62],crown:[-1.84,94.03,9.16]},
  };
  const sourcePointToWorld=(id,[x,y,z])=>{
    const spec=AUTHORED_MODELS.find(value=>value.id===id);
    const resident=engine.getStats().authoredResidents.find(value=>value.id===id);
    const [min,max]=[spec.sourceBounds.min,spec.sourceBounds.max];
    const px=(x-(min[0]+max[0])/2)*resident.uniformScale,pz=(z-(min[2]+max[2])/2)*resident.uniformScale;
    const c=Math.cos(resident.yaw),s=Math.sin(resident.yaw);
    return new Vector3(resident.position[0]+px*c+pz*s,resident.position[1]+(y-min[1])*resident.uniformScale,resident.position[2]-px*s+pz*c);
  };
  const stableModelTransforms=()=>JSON.stringify(landmarkLayer.children.filter(object=>object!==selectedRing).map(object=>({uuid:object.uuid,position:object.position.toArray(),quaternion:object.quaternion.toArray(),scale:object.scale.toArray()})));
  const beforeBuildingFocus=stableModelTransforms();
  const projectPoints=points=>points.map(point=>{
    const p=point.clone().project(renderer.camera);
    return {x:(p.x+1)*rect.width/2,y:(1-p.y)*rect.height/2,depth:p.z};
  });
  const screenBounds=points=>{
    const p=projectPoints(points),xs=p.map(point=>point.x),ys=p.map(point=>point.y);
    return {left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys)};
  };
  const availableBuildingRect=(whole=false)=>({
    left:windowProbe.innerWidth<=700?18:24,
    right:windowProbe.innerWidth<=700?rect.width-18:panelRect.left-rect.left-20,
    // Full buildings may rise beside desktop overlays. On phones the controls
    // span the canvas and the information sheet limits the available height.
    top:whole
      ?windowProbe.innerWidth>700?14:Math.max(68,noteRect?noteRect.bottom-rect.top+12:0,toolbarRect?toolbarRect.bottom-rect.top+12:0)
      :noteRect?noteRect.bottom-rect.top+28:84,
    bottom:windowProbe.innerWidth<=700?panelRect.top-rect.top-14:rect.height-(whole?18:50),
  });
  const visibleObstacles=()=>[toolbarRect,noteRect,captionRect,attributionRect].filter(Boolean).map(box=>({
    left:box.left-rect.left,right:box.left-rect.left+box.width,
    top:box.top-rect.top,bottom:(box.bottom??box.top+box.height)-rect.top,
  }));
  const assertPointClearsUi=(point,available,label,whole=false)=>{
    assert.ok(point.x>available.left-2&&point.x<available.right+2,`${label}: clears the horizontal UI edges`);
    assert.ok(point.y>(whole?available.top-2:68)&&point.y<available.bottom+2,`${label}: clears the canvas and detail card`);
    for(const obstacle of visibleObstacles()) {
      const inOverlay=point.x>obstacle.left-4&&point.x<obstacle.right+4&&point.y>obstacle.top-4&&point.y<obstacle.bottom+4;
      assert.equal(inOverlay,false,`${label}: clears measured controls and captions`);
    }
    assert.ok(point.depth>=-1&&point.depth<=1,`${label}: stays inside the camera clipping planes`);
  };
  let offscreenDetailCenters=0;
  const assertDetailRetained=(id,label)=>{
    const residents=engine.getStats().authoredResidents;
    assert.equal(residents.find(value=>value.id===id)?.detailRequested,true,
      `${label}: a visible local subject must retain its requested detail LOD even when the whole-building center is offscreen`);
    assert.deepEqual(residents.filter(value=>value.detailRequested).map(value=>value.id),[id],
      `${label}: only the selected local subject may request detailed geometry`);
    const center=new Box3().setFromPoints(authoredCorners.get(id)).getCenter(new Vector3()).project(renderer.camera);
    if(Math.abs(center.x)>1.2||Math.abs(center.y)>1.2) offscreenDetailCenters++;
  };
  const assertBuildingFits=(id,label,{minOccupancy=0,whole=false}={})=>{
    const points=authoredCorners.get(id)||allPoints.get(id).slice(1);
    const available=availableBuildingRect(whole),box=screenBounds(points);
    // A full-building camera is sized by its real body, not an elevated label
    // anchor. Selected-label visibility is checked separately below.
    for(const point of projectPoints(whole?points:[...points,worldAnchors.get(id)])) {
      assertPointClearsUi(point,available,`${label}: ${id}`,whole);
    }
    const lane={...available};
    if(whole) for(const obstacle of visibleObstacles()) {
      assert.equal(box.left<obstacle.right+4&&box.right>obstacle.left-4&&box.top<obstacle.bottom+4&&box.bottom>obstacle.top-4,false,
        `${label}: complete projected body must not intersect an overlay`);
      // Measure its limiting clear lane independently from the camera's chosen
      // fit rectangle. A wide group may be width-limited; a tower is height-limited.
      if(box.left<obstacle.right+4&&box.right>obstacle.left-4) {
        if(obstacle.bottom<box.top) lane.top=Math.max(lane.top,obstacle.bottom+10);
        if(obstacle.top>box.bottom) lane.bottom=Math.min(lane.bottom,obstacle.top-10);
      }
      if(box.top<obstacle.bottom+4&&box.bottom>obstacle.top-4) {
        if(obstacle.right<box.left) lane.left=Math.max(lane.left,obstacle.right+10);
        if(obstacle.left>box.right) lane.right=Math.min(lane.right,obstacle.left-10);
      }
    }
    const width=box.right-box.left,height=box.bottom-box.top;
    const occupancy=Math.max(width/(lane.right-lane.left),height/(lane.bottom-lane.top));
    assert.ok(occupancy>minOccupancy,`${label}: ${id} is too small (${occupancy.toFixed(3)} of the unobstructed frame)`);
    if(whole) {
      assert.ok(occupancy<=1.001,`${label}: the full model exceeds its clear lane`);
      const selectedLabel=projection.labels.find(value=>value.id===id);
      assert.ok(selectedLabel&&selectedLabel.x>=0&&selectedLabel.x<=rect.width&&selectedLabel.y>=0&&selectedLabel.y<=rect.height,
        `${label}: the selected roof label anchor remains on screen without enlarging the camera fit`);
    }
    assert.equal(renderer.scene,cityScene);assert.equal(renderer.domElement,cityCanvas);
    assert.equal(cityScene.getObjectByName('Yichang miniature').visible,true,'building inspection retains the city');
    for(const layer of ['terrain','buildings','roads']) assert.equal(cityScene.getObjectByName(layer).visible,true,`${label}: ${layer} remains visible`);
    return {width,height,occupancy,zoom:renderer.camera.zoom};
  };
  const assertInspectionFits=(id,label,{nativePoint=facadeSamples[id],checkPatch=true}={})=>{
    assert.ok(nativePoint,`${id}: the inspection oracle needs a verified source sample`);
    const available=availableBuildingRect(),spec=AUTHORED_MODELS.find(value=>value.id===id);
    const height=spec.sourceBounds.max[1]-spec.sourceBounds.min[1];
    const nativePoints=[nativePoint];
    if(checkPatch) for(const sign of [-1,1]) nativePoints.push([nativePoint[0],nativePoint[1]+height*.07*sign,nativePoint[2]]);
    for(const point of projectPoints(nativePoints.map(value=>sourcePointToWorld(id,value)))) {
      assertPointClearsUi(point,available,`${label}: ${id} detail sample`);
    }
    const body=screenBounds(authoredCorners.get(id));
    assert.ok(body.left<available.left||body.right>available.right||body.top<available.top||body.bottom>available.bottom,
      `${label}: ${id} must show a local detail rather than refitting the entire building`);
    assert.equal(renderer.scene,cityScene);assert.equal(renderer.domElement,cityCanvas);
    assert.equal(cityScene.getObjectByName('Yichang miniature').visible,true);
    for(const layer of ['terrain','buildings','roads']) assert.equal(cityScene.getObjectByName(layer).visible,true,`${label}: ${layer} remains visible`);
    assertDetailRetained(id,label);
    return {height:body.bottom-body.top,zoom:renderer.camera.zoom};
  };
  const focusViewports=[
    {name:'desktop',rect:{width:1616,height:849,top:70,left:304},innerWidth:1920,panel:{left:1572,top:163,width:318,height:606},note:{left:338,top:164,bottom:238,width:261,height:74},inspectionNote:{left:338,top:164,bottom:306,width:304,height:142},toolbar:{left:334,top:97,bottom:140,width:452,height:43},caption:{left:339,top:775,bottom:855,width:138,height:80},attribution:{left:330,top:880,bottom:904,width:212,height:24}},
    {name:'phone collapsed card',rect:{width:390,height:784,top:60,left:0},innerWidth:390,panel:{left:12,top:665,width:366,height:129},note:{left:17,top:126,bottom:198,width:357,height:72},inspectionNote:{left:17,top:126,bottom:273,width:357,height:147},toolbar:{left:12,top:73,bottom:112,width:226,height:39}},
    {name:'phone expanded card',rect:{width:390,height:784,top:60,left:0},innerWidth:390,panel:{left:12,top:430,width:366,height:364},note:{left:17,top:126,bottom:198,width:357,height:72},inspectionNote:{left:17,top:126,bottom:273,width:357,height:147},toolbar:{left:12,top:73,bottom:112,width:226,height:39}},
  ];
  const useFocusViewport=viewport=>{
    rect={...viewport.rect};windowProbe.innerWidth=viewport.innerWidth;panelRect={...viewport.panel};noteRect={...viewport.note};
    toolbarRect=viewport.toolbar?{...viewport.toolbar}:null;captionRect=viewport.caption?{...viewport.caption}:null;attributionRect=viewport.attribution?{...viewport.attribution}:null;
    observers[0].callback([]);settle();
  };
  const buildingFraming=[];
  for(const viewport of focusViewports) {
    useFocusViewport(viewport);
    for(const spec of AUTHORED_MODELS) {
      noteRect={...viewport.note};
      wake(()=>engine.focus(spec.id,{close:false}),`${viewport.name} ${spec.name} default`);
      const overview=assertBuildingFits(spec.id,`${viewport.name} default`,{minOccupancy:.9,whole:true});
      const overviewPose={position:renderer.camera.position.clone(),quaternion:renderer.camera.quaternion.clone(),zoom:renderer.camera.zoom};
      noteRect={...viewport.inspectionNote};
      wake(()=>engine.focus(spec.id,{close:true}),`${viewport.name} ${spec.name} full-height close`);
      const whole=assertBuildingFits(spec.id,`${viewport.name} full-height close`,{minOccupancy:.9,whole:true});
      const wholePose={position:renderer.camera.position.clone(),quaternion:renderer.camera.quaternion.clone(),zoom:renderer.camera.zoom};
      assertDetailRetained(spec.id,`${viewport.name} full-height close`);
      assert.equal(engine.getStats().focusAngle,'detail','default close must retain the whole-building preset');
      wake(()=>engine.focus(spec.id,{angle:'facade',close:true}),`${viewport.name} ${spec.name} explicit facade`);
      const detail=assertInspectionFits(spec.id,`${viewport.name} facade`);
      assert.ok(detail.zoom>whole.zoom*2,`${viewport.name}: ${spec.name} explicit inspection must be substantially closer than the complete-building preset`);
      buildingFraming.push({viewport:viewport.name,id:spec.id,defaultHeight:Math.round(overview.height),wholeHeight:Math.round(whole.height),wholeOccupancy:Number(whole.occupancy.toFixed(3)),detailProjectedBodyHeight:Math.round(detail.height),detailZoomGain:Number((detail.zoom/whole.zoom).toFixed(2))});
      const facadePosition=renderer.camera.position.clone();
      for(const angle of ['entrance','crown']) {
        wake(()=>engine.focus(spec.id,{angle,close:true}),`${viewport.name} ${spec.name} ${angle}`);
        assertInspectionFits(spec.id,`${viewport.name} ${angle}`,{nativePoint:detailPartSamples[spec.id][angle],checkPatch:false});
        assert.equal(engine.getStats().focusAngle,angle,'the requested inspection subject remains selected');
        assert.ok(renderer.camera.position.distanceTo(facadePosition)>1e-5,'entrance and crown must not reuse the facade camera target');
      }
      if(spec.id==='yichang-international-s01') {
        wake(()=>engine.focus(spec.id,{angle:'frontage',close:true}),`${viewport.name} International Plaza frontage`);
        assert.equal(engine.getStats().focusAngle,'frontage');
        const frontage=cityScene.getObjectByName('Building forecourts and illustrative streets').getObjectByName(spec.id);
        assert.ok(frontage,'the frontage preset requires a successfully planned street connection');
        const points=[];
        frontage.traverse(mesh=>{
          if(!mesh.isMesh||!['forecourt, entrance path and sidewalk','street paving insets'].includes(mesh.name))return;
          const position=mesh.geometry.attributes.position;
          for(let i=0;i<position.count;i++)points.push(new Vector3().fromBufferAttribute(position,i).applyMatrix4(mesh.matrixWorld));
        });
        assert.ok(points.length>0,'the camera oracle uses actual emitted street surfaces');
        // The whole added ground strip and the original passage join must be
        // visible together. No camera-target/span calculation is duplicated.
        points.push(sourcePointToWorld(spec.id,[33.4,.10041078109802713,23.00016418147591]));
        for(const point of projectPoints(points))assertPointClearsUi(point,availableBuildingRect(),`${viewport.name}: complete frontage ground`);
        assertDetailRetained(spec.id,`${viewport.name}: frontage retains its selected model`);
        assert.ok(engine.getStats().streetDetails.streetVisibleIds.includes(spec.id));
        for(const layer of ['terrain','buildings','roads'])assert.equal(cityScene.getObjectByName(layer).visible,true);
      }
      wake(()=>engine.focus(spec.id,{angle:'detail',close:true}),`${viewport.name} ${spec.name} return to full-height building`);
      assertBuildingFits(spec.id,`${viewport.name} restored full-height building`,{minOccupancy:.9,whole:true});
      assert.ok(renderer.camera.position.distanceTo(wholePose.position)<1e-9);
      assert.ok(1-Math.abs(renderer.camera.quaternion.dot(wholePose.quaternion))<1e-10);
      assert.ok(Math.abs(renderer.camera.zoom-wholePose.zoom)<1e-9,'whole-view action restores its full-height framing after an explicit local crop');
      noteRect={...viewport.note};
      wake(()=>engine.focus(spec.id,{close:false}),`${viewport.name} ${spec.name} return to whole building`);
      assertBuildingFits(spec.id,`${viewport.name} restored whole building`,{minOccupancy:.9,whole:true});
      assert.ok(renderer.camera.position.distanceTo(overviewPose.position)<1e-9);
      assert.ok(1-Math.abs(renderer.camera.quaternion.dot(overviewPose.quaternion))<1e-10);
      assert.ok(Math.abs(renderer.camera.zoom-overviewPose.zoom)<1e-9,'return-to-whole must restore its framing, not the city overview');
    }
  }
  wake(()=>engine.focus('shouxin-wealth-s01',{angle:'frontage',close:true}),'unsupported frontage preset');
  assert.equal(engine.getStats().focusAngle,'detail','unsupported frontage preset normalizes to complete-building view');
  assertBuildingFits('shouxin-wealth-s01','unsupported frontage falls back to whole building',{minOccupancy:.9,whole:true});
  checks.push('International Plaza frontage frames every emitted paving vertex and the retained passage edge on desktop and both phone sheet states; selected detail persists, whole-building pose restores exactly, and unsupported frontage links fall back safely');
  // A short phone with its introduction expanded can leave no real framing
  // area between the provenance note and the sheet. Preserve the camera
  // instead of manufacturing a viewport behind that sheet; a later card-only
  // resize must still be able to fit the newly selected building.
  rect={width:390,height:470,top:60,left:0};windowProbe.innerWidth=390;
  panelRect={left:12,top:235,width:366,height:249};
  noteRect={left:17,top:126,bottom:184,width:357,height:58};
  observers[0].callback([]);settle();
  const coveredPose={position:renderer.camera.position.clone(),quaternion:renderer.camera.quaternion.clone(),zoom:renderer.camera.zoom};
  wake(()=>engine.focus('shouxin-wealth-s01',{close:true}),'single building in covered short phone');
  assert.ok(renderer.camera.position.distanceTo(coveredPose.position)<1e-10,'covered viewport must retain camera position');
  assert.ok(1-Math.abs(renderer.camera.quaternion.dot(coveredPose.quaternion))<1e-10,'covered viewport must retain viewing direction');
  assert.ok(Math.abs(renderer.camera.zoom-coveredPose.zoom)<1e-10,'covered viewport must retain zoom');
  panelRect={left:12,top:355,width:366,height:129};
  wake(()=>engine.refitSelection(),'card-only collapse frees single-building framing');
  assertBuildingFits('shouxin-wealth-s01','recovered short-phone whole building',{minOccupancy:.9,whole:true});
  assert.ok(renderer.camera.position.distanceTo(coveredPose.position)>1e-4,'newly selected building refits once the card frees actual space');
  checks.push('covered short-phone single-building focus retains its pose, then a card-only refit recovers when real space becomes available');

  // The smallest tower's roof must not be held at the former 1.8-unit world
  // height floor. Inspect a wide multi-tower project too, so tighter framing
  // cannot clip another tower or its shared podium.
  useFocusViewport(focusViewports[0]);
  for(const id of ['shouxin-wealth-s01','wanda-soho-s01']) {
    noteRect={...focusViewports[0].note};
    wake(()=>engine.focus(id,{angle:'front',close:false}),`${id} full front`);
    assertBuildingFits(id,'whole front elevation',{minOccupancy:.9,whole:true});
    noteRect={...focusViewports[0].inspectionNote};
    wake(()=>engine.focus(id,{angle:'front',close:true}),`${id} close whole front`);
    assertBuildingFits(id,'close whole front elevation',{minOccupancy:.9,whole:true});
    noteRect={...focusViewports[0].note};
    wake(()=>engine.setView('top'),`${id} roof`);
    assertBuildingFits(id,'roof and full footprint',{minOccupancy:.70});
    if(id==='shouxin-wealth-s01') assert.ok((renderer.camera.top-renderer.camera.bottom)/renderer.camera.zoom<1.8,'small roof view must clear the former fixed world-height cap');
  }
  noteRect={...focusViewports[0].inspectionNote};
  wake(()=>engine.focus('shouxin-wealth-s01',{angle:'facade',close:true}),'manual facade zoom baseline');
  const nearZoom=renderer.camera.zoom;
  for(let i=0;i<8;i++) {
    wake(()=>engine.zoom(1),`manual facade zoom ${i}`);
    assertDetailRetained('shouxin-wealth-s01',`manual facade zoom ${i}`);
  }
  assert.ok(renderer.camera.zoom>nearZoom*2,'manual zoom must go meaningfully closer than the facade preset');
  assert.ok(Number.isFinite(renderer.camera.zoom),'manual close zoom remains finite');
  assert.ok(offscreenDetailCenters>0,'the LOD regression must exercise a visible subject with its building center outside the former screen gate');
  checks.push('visible facade/entrance/crown subjects retain exactly one selected detail LOD request even with offscreen building centers and after manual close zoom');

  // Small ordinary landmarks previously inherited large neighborhood-sized
  // minimum frames. Their full geometry must now fill a useful part of the
  // viewport without borrowing a guide-only POI's synthetic envelope.
  engine.setMotion(false);settle();
  noteRect=null;toolbarRect=null;captionRect=null;attributionRect=null;
  for(const id of ['zhenjiang-pavilion','tianran-pagoda']) {
    wake(()=>engine.focus(id,{close:false}),`${id} default landmark`);
    const overview=assertBuildingFits(id,'compact landmark default',{minOccupancy:.54});
    wake(()=>engine.focus(id,{close:true}),`${id} close landmark`);
    const detail=assertBuildingFits(id,'compact landmark close',{minOccupancy:.70});
    assert.ok(detail.height>overview.height*1.16,`${id}: landmark close view remains distinct`);
  }
  wake(()=>engine.focus('business-1649141',{close:false}),'guide-only neighborhood');
  assert.equal(engine.getStats().authoredSelection,false);
  assert.ok((renderer.camera.top-renderer.camera.bottom)/renderer.camera.zoom>=25,'guide-only POI keeps neighborhood context, not a pretend tower close-up');
  wake(()=>engine.focus('shouxin-wealth-s01',{angle:'context',close:false}),'explicit city context');
  assert.ok((renderer.camera.top-renderer.camera.bottom)/renderer.camera.zoom>100,'explicit city context retains the city-wide frame');
  assert.equal(stableModelTransforms(),beforeBuildingFocus,'camera presets and zoom must not stretch, rotate, move, or replace models');
  assert.deepEqual(selections,[],'programmatic camera checks must not introduce a new POI selection callback');
  checks.push('all seven authored buildings default to complete near-full-height/width bodies for close and ordinary links; measured overlay rectangles stay clear, separate explicit facade/entrance/crown samples retain detail, whole framing restores, and front/roof/manual zoom, guide/context frames and model transforms remain intact');
  panelRect=null;noteRect=null;toolbarRect=null;captionRect=null;attributionRect=null;windowProbe.innerWidth=1280;rect={top:70,left:280,width:940,height:730};
  observers[0].callback([]);settle();wake(()=>engine.reset(),'reset after building framing checks');

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
  console.log(JSON.stringify({passed:true,checks,buildingFraming,renderFrames:frames(),webglVerified:false},null,2));
} finally {
  engine?.dispose(); await flush();
  for(const [key,descriptor] of saved) { if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]; }
  fs.rmSync(temporary,{recursive:true,force:true});
}
