import * as THREE from 'three';
import { AUTHORED_MODELS } from './buildingCatalog.js';
export { AUTHORED_MODELS } from './buildingCatalog.js';

const closedImageBitmaps = new WeakSet();

function disposeObject(object) {
  if (!object) return;
  const geometries = new Set(), materials = new Set(), textures = new Set(), images = new Set();
  object.traverse(child => {
    if (child.geometry) geometries.add(child.geometry);
    for (const material of Array.isArray(child.material) ? child.material : child.material ? [child.material] : []) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  geometries.forEach(value => value.dispose());
  materials.forEach(value => value.dispose());
  textures.forEach(value => {
    const image = value.source?.data || value.image;
    for (const candidate of Array.isArray(image) ? image : [image]) {
      if (candidate && typeof candidate.close === 'function') images.add(candidate);
    }
    value.dispose();
  });
  // GLTFLoader uses ImageBitmap when available. Texture.dispose() releases
  // the WebGL texture but does not close its separately owned decoded bitmap.
  images.forEach(image => {
    if (closedImageBitmaps.has(image)) return;
    closedImageBitmaps.add(image); image.close();
  });
  object.removeFromParent();
}

// Pure geometry preparation is also exercised without creating a WebGL context.
export function prepareAuthoredModel(object, spec) {
  object.updateMatrixWorld(true);
  const sourceBox = new THREE.Box3().setFromObject(object);
  const size = sourceBox.getSize(new THREE.Vector3());
  if (sourceBox.isEmpty() || !Number.isFinite(size.y) || size.y <= 0) throw new Error('模型缺少有效包围盒');
  // Both LODs use the same frozen source frame. A simplified crown or a
  // quantized vertex must not move the whole building during a quality switch.
  const referenceBox = spec.sourceBounds
    ? new THREE.Box3(new THREE.Vector3(...spec.sourceBounds.min), new THREE.Vector3(...spec.sourceBounds.max))
    : sourceBox;
  const referenceSize = referenceBox.getSize(new THREE.Vector3());
  const center = referenceBox.getCenter(new THREE.Vector3());
  const wrapper = new THREE.Group();
  wrapper.name = `${spec.id}:uniform-display-scale`;
  object.position.sub(new THREE.Vector3(center.x, referenceBox.min.y, center.z));
  wrapper.add(object);
  // One scalar for all axes. The city background's vertical exaggeration must
  // never be applied to the architectural asset's Y axis.
  wrapper.scale.setScalar(spec.uniformScale || spec.displayHeight / referenceSize.y);
  wrapper.userData.sourceBounds = { min: sourceBox.min.toArray(), max: sourceBox.max.toArray() };
  wrapper.userData.scalePolicy = spec.scalePolicy || 'uniform-exhibit-not-metres';
  object.traverse(child => {
    if (!child.isMesh) return;
    child.userData.landmarkId = spec.id;
    child.castShadow = true;
    child.receiveShadow = true;
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      // New assets retain their authored normals, including Fujiang's curved
      // facade. Shouxin's established export intentionally uses hard edges.
      material.flatShading = Boolean(spec.flatShading) || !child.geometry.getAttribute('normal');
      material.transparent = false;
      material.opacity = 1;
      material.userData.authoredDayColor = material.color.clone();
      material.userData.authoredGlass = /glass|glaz|玻璃/i.test(material.name);
      if ('transmission' in material) material.transmission = 0;
      if ('clearcoat' in material) material.clearcoat = Math.min(material.clearcoat, 0.12);
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

export function createAuthoredStage({ catalog = AUTHORED_MODELS, onChange, onStatus, loadAsset, scheduleLight, prioritizeLight, showPlinth = true } = {}) {
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
    const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/libs/meshopt_decoder.module.js'),
    ]);
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    return (await loader.parseAsync(bytes, '/')).scene;
  }
  function ensure(quality, retry = false, priority = false) {
    if (disposed || !activeId) return Promise.resolve();
    const id = activeId, spec = findSpec(id), key = keyFor(id, quality);
    const previous = records.get(key);
    if (quality === 'light' && priority) prioritizeLight?.(id);
    if (previous && (!retry || previous.state !== 'error')) return previous.promise || Promise.resolve();
    const controller = new AbortController();
    const record = { id, quality, state: 'loading', controller, object: null };
    records.set(key, record); notify();
    record.promise = (async () => {
      let raw;
      try {
        const run = async () => {
          if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          // Queued time must not consume the network/parse timeout.
          const timeout = setTimeout(() => controller.abort(), 20000);
          try { return await (loadAsset || defaultLoad)(spec.assets[quality], controller.signal); }
          finally { clearTimeout(timeout); }
        };
        raw = await (quality === 'light' && scheduleLight
          ? scheduleLight(run, { key: id, signal: controller.signal, priority })
          : run());
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
      }
    })();
    return record.promise;
  }
  function release() {
    for (const record of records.values()) { record.controller.abort(); disposeObject(record.object); }
    records.clear(); activeQuality = null;
  }
  return {
    group,
    select(id, { detail = false, priority = false } = {}) {
      if (disposed || !findSpec(id)) return;
      if (activeId !== id) { release(); activeId = id; }
      group.visible = true; wantedDetail = Boolean(detail);
      const pending = ensure('light', false, priority).then(() => {
        if (!disposed && activeId === id && wantedDetail && recordFor(id, 'light')?.state === 'ready') ensure('detail');
      });
      if (wantedDetail && recordFor(id, 'light')?.state === 'ready') ensure('detail');
      syncVisible();
      return pending;
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
      ensure('light', true, true).then(() => {
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
