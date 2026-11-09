import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ArrowCounterClockwise, Buildings, CircleNotch, MagnifyingGlassPlus, Mouse, WarningCircle } from '@phosphor-icons/react';
import { createAuthoredStage } from '../scene/authoredModels.js';

// A separate viewer for a recoverable candidate whose map registration is not
// ready. It never owns or alters the city's renderer, camera, or visibility.
export default function ModelPreview({ model, theme = 'day' }) {
  const hostRef = useRef(null);
  const runtimeRef = useRef(null);
  const [status, setStatus] = useState({ state: 'loading', quality: null, detailState: 'idle' });
  const [detailWanted, setDetailWanted] = useState(false);
  const [viewerError, setViewerError] = useState('');
  const [restart, setRestart] = useState(0);
  const hasDetail = Boolean(model.assets?.detail && model.assets.detail !== model.assets.light);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let renderer, controls, stage, floor, sun, observer;
    let disposed = false, frame = 0, fitted = false, aspect = 1;
    let viewHeight = 12;
    const previewScene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-8, 8, 8, -8, 0.02, 250);
    const bounds = new THREE.Box3();
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    const hemisphere = new THREE.HemisphereLight('#f9fbff', '#98a285', 1.15);
    const fill = new THREE.DirectionalLight('#dceeff', 0.24);
    const previewSpec = {
      ...model,
      displayHeight: 8,
      uniformScale: undefined,
      scalePolicy: 'uniform-candidate-preview-not-metres',
    };
    setViewerError('');
    setDetailWanted(false);
    setStatus({ state: 'loading', quality: null, detailState: 'idle' });

    function invalidate() {
      if (!disposed && !document.hidden && !frame) frame = requestAnimationFrame(render);
    }
    function render() {
      frame = 0;
      if (disposed || document.hidden) return;
      try {
        // Keep drawing while OrbitControls damping is settling, then idle.
        const changed = controls.update();
        renderer.render(previewScene, camera);
        if (changed) invalidate();
      } catch {
        failViewer('独立模型视图暂时无法绘制。可以重新打开查看器，或关闭此面板返回城市。');
      }
    }
    function updateFrustum() {
      camera.left = -viewHeight * aspect / 2;
      camera.right = viewHeight * aspect / 2;
      camera.top = viewHeight / 2;
      camera.bottom = -viewHeight / 2;
      camera.updateProjectionMatrix();
    }
    function measure() {
      bounds.makeEmpty();
      stage.group.updateMatrixWorld(true);
      for (const mesh of stage.getActiveMeshes()) bounds.expandByObject(mesh);
      if (bounds.isEmpty()) return false;
      bounds.getCenter(center);
      bounds.getSize(size);
      return [size.x, size.y, size.z].every(Number.isFinite) && size.y > 0;
    }
    function fit(angle = 'detail') {
      if (disposed || !stage || !measure()) return;
      const radius = Math.max(size.length() / 2, 1);
      const direction = angle === 'front'
        ? new THREE.Vector3(0, 0.12, 1)
        : new THREE.Vector3(0.8, 0.55, 1);
      camera.position.copy(center).addScaledVector(direction.normalize(), radius * 4 + 10);
      camera.up.set(0, 1, 0);
      camera.lookAt(center);
      camera.updateMatrixWorld(true);
      // Fit the actual visible model, including its podium or group of towers.
      // No coordinate or footprint is inferred from this independent view.
      const projected = new THREE.Box3();
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) {
            projected.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
          }
        }
      }
      const projectedSize = projected.getSize(new THREE.Vector3());
      viewHeight = Math.max(projectedSize.y, projectedSize.x / aspect, 1) * 1.25;
      camera.zoom = 1;
      camera.near = 0.02;
      camera.far = radius * 12 + 80;
      updateFrustum();
      controls.target.copy(center);
      controls.update();
      controls.saveState();
      const groundSize = Math.max(size.x, size.z, 8) * 6;
      floor.scale.set(groundSize, groundSize, 1);
      floor.position.set(center.x, bounds.min.y - 0.025, center.z);
      sun.position.copy(center).add(new THREE.Vector3(-radius * 2, radius * 4, radius * 3));
      sun.target.position.copy(center);
      sun.shadow.camera.left = -radius * 1.8;
      sun.shadow.camera.right = radius * 1.8;
      sun.shadow.camera.top = radius * 1.8;
      sun.shadow.camera.bottom = -radius * 1.8;
      sun.shadow.camera.near = 0.1;
      sun.shadow.camera.far = radius * 10 + 20;
      sun.shadow.camera.updateProjectionMatrix();
      renderer.shadowMap.needsUpdate = true;
      fitted = true;
      invalidate();
    }
    function resize() {
      if (disposed || !renderer) return;
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      const previousAspect = aspect;
      aspect = width / height;
      renderer.setSize(width, height, false);
      // Keep the inspected region visible when a phone changes orientation.
      if (fitted && aspect < previousAspect) viewHeight *= previousAspect / aspect;
      updateFrustum();
      invalidate();
    }
    function applyTheme(value) {
      if (disposed || !renderer) return;
      const night = value === 'night';
      previewScene.background = new THREE.Color(night ? '#223632' : '#f1efe6');
      floor.material.color.set(night ? '#34463e' : '#f1efe6');
      hemisphere.intensity = night ? 0.95 : 1.15;
      sun.intensity = night ? 1.65 : 2.35;
      renderer.toneMappingExposure = night ? 0.95 : 1.02;
      stage.setTheme(night);
      renderer.shadowMap.needsUpdate = true;
      invalidate();
    }
    function visibilityChanged() {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else invalidate();
    }
    function contextLost(event) {
      event.preventDefault();
      failViewer('独立模型查看器的 WebGL 连接已中断。请重新打开查看器，或关闭此面板返回城市。');
    }
    function cleanup() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener('visibilitychange', visibilityChanged);
      if (runtimeRef.current?.stage === stage) runtimeRef.current = null;
      controls?.removeEventListener('change', invalidate);
      controls?.dispose();
      stage?.dispose();
      floor?.geometry.dispose();
      floor?.material.dispose();
      sun?.shadow.map?.dispose();
      if (renderer) {
        renderer.domElement.removeEventListener('webglcontextlost', contextLost);
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      }
    }
    function failViewer(message) {
      if (disposed) return;
      setViewerError(message);
      cleanup();
    }

    try {
      if (!model.assets?.light) throw new Error('missing-model-asset');
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.shadowMap.autoUpdate = false;
      renderer.domElement.setAttribute('aria-label', `${model.name}候选模型，可拖动旋转、滚轮缩放`);
      renderer.domElement.setAttribute('role', 'img');
      renderer.domElement.dataset.previewId = model.id;
      renderer.domElement.addEventListener('webglcontextlost', contextLost);
      host.appendChild(renderer.domElement);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.12;
      controls.rotateSpeed = 0.65;
      controls.zoomSpeed = 0.85;
      controls.panSpeed = 0.65;
      controls.minZoom = 0.55;
      controls.maxZoom = 7;
      controls.maxPolarAngle = Math.PI / 2.05;
      controls.addEventListener('change', invalidate);
      camera.position.set(10, 8, 14);
      controls.target.set(0, 4, 0);
      controls.update();
      floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: '#f1efe6', roughness: 0.98 }));
      floor.rotation.x = -Math.PI / 2;
      floor.scale.set(80, 80, 1);
      floor.position.y = -0.025;
      floor.receiveShadow = true;
      sun = new THREE.DirectionalLight('#fff4dc', 2.35);
      sun.position.set(-15, 30, 20);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.bias = -0.0001;
      sun.shadow.normalBias = 0.015;
      fill.position.set(15, 10, -15);
      previewScene.add(floor, hemisphere, sun, sun.target, fill);
      stage = createAuthoredStage({
        catalog: [previewSpec],
        showPlinth: false,
        onChange: () => {
          if (disposed) return;
          renderer.shadowMap.needsUpdate = true;
          invalidate();
        },
        onStatus: next => {
          if (disposed) return;
          setStatus(next);
          renderer.domElement.dataset.modelQuality = next.quality || next.state;
          if (next.quality && !fitted) fit();
        },
      });
      previewScene.add(stage.group);
      runtimeRef.current = { stage, fit, applyTheme };
      resize();
      applyTheme(theme);
      observer = new ResizeObserver(resize);
      observer.observe(host);
      document.addEventListener('visibilitychange', visibilityChanged);
      stage.select(model.id, { detail: false });
    } catch (error) {
      failViewer(error.message === 'missing-model-asset'
        ? '这份候选模型的网页文件尚未就绪。请查看资料说明，稍后再试。'
        : '当前浏览器无法启动独立模型查看器。请使用支持 WebGL 的浏览器，或关闭此面板返回城市。');
    }
    return cleanup;
    // Theme changes update lighting below without reloading model assets.
  }, [model, restart]);

  useEffect(() => { runtimeRef.current?.applyTheme(theme); }, [theme]);

  const chooseQuality = detail => {
    setDetailWanted(detail);
    if (detail) runtimeRef.current?.stage.setDetailWanted(true);
    else runtimeRef.current?.stage.releaseDetail();
  };
  const ready = Boolean(status.quality) && !viewerError;
  const loading = !viewerError && !ready && status.state !== 'error';
  const qualityLabel = viewerError ? '查看器暂不可用'
    : status.state === 'error' ? '模型暂未载入'
    : status.detailState === 'loading' ? '正在载入近景细节 · 轻量模型仍可查看'
    : status.detailState === 'error' ? '近景细节暂未载入 · 继续显示轻量模型'
    : status.quality === 'detail' ? '近景模型已就绪'
    : status.quality === 'light' ? '轻量模型已就绪'
    : '正在载入轻量模型';

  return <div className="candidate-preview">
    <div className="candidate-preview-heading"><span>独立查看 · {model.stage || '阶段候选'}</span><span>位置与朝向待核准</span></div>
    <div className="candidate-preview-stage">
      <div className="candidate-preview-canvas" ref={hostRef}/>
      {(viewerError || loading || status.state === 'error') && <div className="candidate-preview-message" role="status">
        {viewerError || status.state === 'error' ? <WarningCircle size={25}/> : <CircleNotch className="spinner" size={25}/>}
        <strong>{viewerError ? '暂时无法开启三维查看' : status.state === 'error' ? '模型暂未载入' : '正在展开候选模型'}</strong>
        <p>{viewerError || (status.state === 'error' ? '网页模型下载或读取失败，可以重试。' : '先载入轻量模型，细节由你按需打开。')}</p>
        {viewerError ? <button onClick={()=>setRestart(value=>value+1)}>重新打开查看器</button> : status.state === 'error' && <button onClick={()=>runtimeRef.current?.stage.retry()}>重新载入模型</button>}
      </div>}
      {ready && <div className="candidate-preview-hint"><Mouse size={13}/><span>拖动旋转 · 滚轮或双指缩放</span></div>}
    </div>
    <div className="candidate-preview-controls">
      <div className="candidate-quality-controls" role="group" aria-label="候选模型精细度">
        <button className={!detailWanted?'active':''} aria-pressed={!detailWanted} disabled={!ready} onClick={()=>chooseQuality(false)}>轻量模型</button>
        {hasDetail&&<button className={detailWanted?'active':''} aria-pressed={detailWanted} disabled={!ready} onClick={()=>chooseQuality(true)}><MagnifyingGlassPlus size={14}/>近景细节</button>}
      </div>
      <div className="candidate-angle-controls"><button disabled={!ready} onClick={()=>runtimeRef.current?.fit('front')}><Buildings size={15}/>正面</button><button disabled={!ready} onClick={()=>runtimeRef.current?.fit('detail')}><ArrowCounterClockwise size={15}/>重置</button></div>
    </div>
    <div className="candidate-preview-quality" role="status"><span className={`quality-dot ${ready?'is-ready':''}`}/><span>{qualityLabel}</span>{status.detailState==='error'&&!viewerError&&<button onClick={()=>runtimeRef.current?.stage.retry()}>重试细节</button>}</div>
    <p className="candidate-preview-note">这里单独查看候选模型的外形与幕墙细节，采用三轴等比缩放。模型的占地、朝向和绝对尺寸尚未可靠配准；原城市沙盘保持原位。</p>
  </div>;
}
