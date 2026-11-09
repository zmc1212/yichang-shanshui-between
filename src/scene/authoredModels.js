import * as THREE from 'three';
import { SHOUXIN_REGISTRATION } from './authoredPlacement.js';

// Registration records keep source CRS, footprint identity and uncertainty.
// Scene placement recalculates the uniform scale from its own map metadata.
export const AUTHORED_MODELS = [{
  id: 'shouxin-wealth-s01',
  name: '首信财富中心',
  category: '城市建筑',
  subtitle: '一格幕墙，一座城市的细节。',
  kind: 'authored',
  placement: 'city',
  stage: 'S01 外观候选',
  description: '沿江大道旁，米白竖肋与青蓝幕墙勾勒出首信财富中心的轮廓。模型已与地图中的建筑位置和轮廓匹配，主立面朝向江边。靠近看看裙房、窗格与顶部冠架，再沿着江岸继续探索。',
  location: '宜昌 · 伍家岗区沿江大道 182 号',
  caveat: '位置与朝向依据原导图及地图轮廓配准，未作现场测绘。模型保持原形比，绝对尺寸、精确方位、背面与屋顶仍待复核；字牌保留参考时期外观。',
  sourceBounds: { min: [-20.43000030517578, 0, -14.0649995803833], max: [20.43000030517578, 97.94000244140625, 14.065000534057617] },
  displayHeight: 1.6228058571002701,
  registration: SHOUXIN_REGISTRATION,
  front: '+Z',
  assets: {
    light: '/models/shouxin-s01/light.glb?v=s01-20261109-1',
    detail: '/models/shouxin-s01/detail.glb?v=s01-20261109-1',
  },
}];

function disposeObject(object) {
  if (!object) return;
  const geometries = new Set(), materials = new Set(), textures = new Set();
  object.traverse(child => {
    if (child.geometry) geometries.add(child.geometry);
    for (const material of Array.isArray(child.material) ? child.material : child.material ? [child.material] : []) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  geometries.forEach(value => value.dispose());
  materials.forEach(value => value.dispose());
  textures.forEach(value => value.dispose());
  object.removeFromParent();
}

// Pure geometry preparation is also exercised without creating a WebGL context.
export function prepareAuthoredModel(object, spec) {
  object.updateMatrixWorld(true);
  const sourceBox = new THREE.Box3().setFromObject(object);
  const size = sourceBox.getSize(new THREE.Vector3());
  if (sourceBox.isEmpty() || !Number.isFinite(size.y) || size.y <= 0) throw new Error('模型缺少有效包围盒');
  const center = sourceBox.getCenter(new THREE.Vector3());
  const wrapper = new THREE.Group();
  wrapper.name = `${spec.id}:uniform-display-scale`;
  object.position.sub(new THREE.Vector3(center.x, sourceBox.min.y, center.z));
  wrapper.add(object);
  // One scalar for all axes. The city background's vertical exaggeration must
  // never be applied to the architectural asset's Y axis.
  wrapper.scale.setScalar(spec.displayHeight / size.y);
  wrapper.userData.sourceBounds = { min: sourceBox.min.toArray(), max: sourceBox.max.toArray() };
  wrapper.userData.scalePolicy = spec.scalePolicy || 'uniform-exhibit-not-metres';
  object.traverse(child => {
    if (!child.isMesh) return;
    child.userData.landmarkId = spec.id;
    child.castShadow = true;
    child.receiveShadow = true;
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      // The source deliberately omits NORMAL. Preserve the authored hard edges.
      material.flatShading = true;
      material.transparent = false;
      material.opacity = 1;
      material.userData.authoredDayColor = material.color.clone();
      material.userData.authoredGlass = /^Glass_bluegreen/.test(material.name);
      material.roughness = Math.max(material.roughness, material.userData.authoredGlass ? 0.48 : 0.6);
      material.needsUpdate = true;
    }
  });
  return wrapper;
}

function themeModel(object, night) {
  const visited = new Set();
  object.traverse(child => {
    for (const material of Array.isArray(child.material) ? child.material : child.material ? [child.material] : []) {
      if (visited.has(material) || !material.userData.authoredDayColor) continue;
      visited.add(material);
      material.color.copy(material.userData.authoredDayColor).multiplyScalar(night ? 0.84 : 1);
      if (material.emissive) {
        material.emissive.set(night && material.userData.authoredGlass ? '#7ca8ac' : '#000000');
        material.emissiveIntensity = night && material.userData.authoredGlass ? 0.12 : 0;
      }
    }
  });
}

export function createAuthoredStage({ catalog = AUTHORED_MODELS, onChange, onStatus, loadAsset, showPlinth = true } = {}) {
  const group = new THREE.Group();
  group.name = showPlinth ? 'Independent architectural exhibition — not a map location' : 'Authored city architecture';
  group.visible = false;
  const content = new THREE.Group(); group.add(content);
  const baseMaterials = showPlinth ? [
    new THREE.MeshStandardMaterial({ color: '#e6ddc5', roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: '#fbf6e7', roughness: 0.87 }),
    new THREE.MeshStandardMaterial({ color: '#b4bd9e', roughness: 0.9 }),
  ] : [];
  if (showPlinth) {
    const plinth = new THREE.Group(); group.add(plinth);
    for (const [w, h, d, y, material] of [
      [10.6, 0.48, 7.8, -0.25, baseMaterials[0]],
      [10.4, 0.065, 7.6, 0.0225, baseMaterials[1]],
      [10.64, 0.06, 7.84, -0.42, baseMaterials[2]],
    ]) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.y = y; mesh.castShadow = true; mesh.receiveShadow = true; plinth.add(mesh);
    }
  }
  content.position.y = showPlinth ? 0.055 : 0;
  const records = new Map();
  let activeId = null, wantedDetail = false, disposed = false, night = false;
  let activeQuality = null;
  const findSpec = id => catalog.find(spec => spec.id === id);
  const keyFor = (id, quality) => `${id}:${quality}`;
  const recordFor = (id, quality) => records.get(keyFor(id, quality));
  const notify = () => {
    if (disposed || !activeId) return;
    const light = recordFor(activeId, 'light'), detail = recordFor(activeId, 'detail');
    onStatus?.({
      id: activeId,
      state: light?.state || 'idle',
      quality: activeQuality,
      detailState: detail?.state || 'idle',
      message: light?.state === 'error' ? '模型暂未载入，请重试。' : detail?.state === 'error' ? '近景细节暂未载入，仍可查看轻量模型。' : '',
    });
  };
  const syncVisible = () => {
    for (const record of records.values()) if (record.object) record.object.visible = false;
    const detail = activeId && recordFor(activeId, 'detail');
    const light = activeId && recordFor(activeId, 'light');
    const visible = wantedDetail && detail?.state === 'ready' ? detail : light?.state === 'ready' ? light : null;
    activeQuality = visible?.quality || null;
    if (visible?.object) visible.object.visible = true;
    onChange?.(); notify();
  };
  async function defaultLoad(url, signal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`模型资源请求失败 (${response.status})`);
    const bytes = await response.arrayBuffer();
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    return (await new GLTFLoader().parseAsync(bytes, '/')).scene;
  }
  function ensure(quality, retry = false) {
    if (disposed || !activeId) return Promise.resolve();
    const id = activeId, spec = findSpec(id), key = keyFor(id, quality);
    const previous = records.get(key);
    if (previous && (!retry || previous.state !== 'error')) return previous.promise || Promise.resolve();
    const controller = new AbortController();
    const record = { id, quality, state: 'loading', controller, object: null };
    records.set(key, record); notify();
    const timeout = setTimeout(() => controller.abort(), 20000);
    record.promise = (async () => {
      let raw;
      try {
        raw = await (loadAsset || defaultLoad)(spec.assets[quality], controller.signal);
        if (disposed || records.get(key) !== record || activeId !== id) {
          disposeObject(raw); return;
        }
        if (controller.signal.aborted) { disposeObject(raw); record.state = 'error'; syncVisible(); return; }
        const prepared = prepareAuthoredModel(raw, spec);
        record.object = prepared; record.state = 'ready';
        themeModel(prepared, night); content.add(prepared); syncVisible();
      } catch (error) {
        if (raw && !record.object) disposeObject(raw);
        if (disposed || records.get(key) !== record || activeId !== id) return;
        record.state = 'error'; syncVisible();
      } finally { clearTimeout(timeout); }
    })();
    return record.promise;
  }
  function release() {
    for (const record of records.values()) { record.controller.abort(); disposeObject(record.object); }
    records.clear(); activeQuality = null;
  }
  return {
    group,
    select(id, { detail = false } = {}) {
      if (disposed || !findSpec(id)) return;
      if (activeId !== id) { release(); activeId = id; }
      group.visible = true; wantedDetail = Boolean(detail);
      ensure('light').then(() => {
        if (!disposed && activeId === id && wantedDetail && recordFor(id, 'light')?.state === 'ready') ensure('detail');
      });
      if (wantedDetail && recordFor(id, 'light')?.state === 'ready') ensure('detail');
      syncVisible();
    },
    setDetailWanted(value) {
      if (!activeId || disposed || wantedDetail === Boolean(value)) return;
      wantedDetail = Boolean(value);
      if (wantedDetail && recordFor(activeId, 'light')?.state === 'ready') ensure('detail');
      syncVisible();
    },
    releaseDetail() {
      if (!activeId || disposed) return;
      const key = keyFor(activeId, 'detail'), detail = records.get(key);
      if (!wantedDetail && !detail) return;
      wantedDetail = false;
      // Invalidate the request generation before aborting: a completed fetch
      // may still have a parser running, even after the light model resumes.
      records.delete(key);
      if (detail) { detail.controller.abort(); disposeObject(detail.object); }
      syncVisible();
    },
    retry() {
      if (!activeId) return;
      const id = activeId;
      ensure('light', true).then(() => {
        if (!disposed && activeId === id && wantedDetail && recordFor(id, 'light')?.state === 'ready') ensure('detail', true);
      });
    },
    hide() { activeId = null; wantedDetail = false; group.visible = false; release(); onChange?.(); },
    setTheme(value) {
      night = Boolean(value);
      baseMaterials.forEach((material, index) => {
        material.color.set((night ? ['#5d6e69', '#a8b7ac', '#708574'] : ['#e6ddc5', '#fbf6e7', '#b4bd9e'])[index]);
      });
      for (const record of records.values()) if (record.object) themeModel(record.object, night);
      onChange?.();
    },
    getActiveMeshes() {
      const meshes = [];
      if (!group.visible) return meshes;
      content.traverseVisible(child => { if (child.isMesh) meshes.push(child); });
      return meshes;
    },
    getStats() {
      return { activeId, quality: activeQuality, detailRequested: wantedDetail, loaded: [...records.values()].map(record => ({ id: record.id, quality: record.quality, state: record.state })) };
    },
    dispose() { if (disposed) return; disposed = true; activeId = null; release(); disposeObject(group); },
  };
}
