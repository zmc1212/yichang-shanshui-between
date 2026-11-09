import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as LandmarkFactory from './landmarks.js';
import { planWaterfront, createWaterfront } from './waterfront.js';
import { resolveLandmarkSpec } from './landmarkPlacement.js';
import { AUTHORED_MODELS, createAuthoredStage } from './authoredModels.js';
import { BUSINESS_BUILDINGS } from './buildingCatalog.js';
import { resolveAuthoredPlacement, authoredWorldBounds, planAuthoredGround, projectWgs84 } from './authoredPlacement.js';
import { createLightLoadScheduler } from './modelLoadScheduler.js';
import { createRenderScheduler } from './renderScheduler.js';

/* Coordinates in city.json are in a local metric frame: x east, z south.
   The miniature uses the actual polygon and line data; only its materials,
   tree planting, and landmark architecture are illustrative. */

const DAY = {
  sky: '#f1efe6', floor: '#f1efe6', land: '#91ba68', landHigh: '#7ca357',
  water: '#43addd', shore: '#9cdce6', soil: '#af9166', soilLow: '#8b7557',
  rim: '#d6c3a0', road: '#f0ebd9', roadMajor: '#fff8e7', roadEdge: '#a1ad88',
  trees: ['#719b5d', '#8caa6d', '#92b77a', '#658f64', '#aac58b'], trunk: '#87765a',
  buildings: ['#fbfcf5', '#f4f7ef', '#edf3ec', '#fffdf5', '#e8eee7', '#f8f3e7'],
};
const NIGHT = {
  sky: '#1c3038', floor: '#1c3038', land: '#45645a', landHigh: '#36564a',
  water: '#277d9a', shore: '#56a4ae', soil: '#4d5649', soilLow: '#39483f',
  rim: '#748076', road: '#9ba79a', roadMajor: '#d0c9a9', roadEdge: '#4d6456',
  trees: ['#30584a', '#456d54', '#507960', '#36554e', '#5e8064'], trunk: '#696357',
  buildings: ['#a8b9b2', '#a2b5af', '#95aba4', '#bfcbc0', '#8ea79e', '#bcc3ae'],
};
const DAY_LIGHT = { hemisphere: 1.15, sun: 2.35, fill: 0.22, exposure: 1.02 };
const BUILDING_HEIGHT_EXAGGERATION = 3.8;

function randomGenerator(seed = 928371) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function polygonBounds(ring) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of ring || []) {
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]);
  }
  return { minX, maxX, minZ, maxZ };
}
function containsRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function containsPolygon(x, z, polygon) {
  const b = polygon.bounds;
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ || !containsRing(x, z, polygon.rings[0])) return false;
  for (let i = 1; i < polygon.rings.length; i++) if (containsRing(x, z, polygon.rings[i])) return false;
  return true;
}
function cleanRing(ring) {
  const points = (ring || []).filter(p => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (points.length > 1 && points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1]) return points.slice(0, -1);
  return points;
}
function makeShape(rings) {
  if (!rings?.length || rings[0].length < 3) return null;
  const outer = cleanRing(rings[0]);
  if (outer.length < 3) return null;
  const shape = new THREE.Shape(outer.map(p => new THREE.Vector2(p[0], -p[1])));
  for (let i = 1; i < rings.length; i++) {
    const hole = cleanRing(rings[i]);
    if (hole.length > 2) shape.holes.push(new THREE.Path(hole.map(p => new THREE.Vector2(p[0], -p[1]))));
  }
  return shape;
}
function normalizePolygons(values) {
  return (values || []).map(value => {
    const rings = (value.rings || (value.ring ? [value.ring] : [])).map(cleanRing).filter(r => r.length > 2);
    return rings.length ? { ...value, rings, bounds: polygonBounds(rings[0]) } : null;
  }).filter(Boolean);
}
function makeGridIndex(cellSize) {
  const cells = new Map();
  return {
    add(item, bounds) {
      if (!Number.isFinite(bounds.minX)) return;
      const x0 = Math.floor(bounds.minX / cellSize), x1 = Math.floor(bounds.maxX / cellSize);
      const z0 = Math.floor(bounds.minZ / cellSize), z1 = Math.floor(bounds.maxZ / cellSize);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const key = `${x},${z}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(item);
      }
    },
    get(x, z) { return cells.get(`${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`) || []; },
  };
}
function pointSegmentDistanceSq(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq ? THREE.MathUtils.clamp(((x - a[0]) * dx + (z - a[1]) * dz) / lengthSq, 0, 1) : 0;
  const px = x - a[0] - dx * t, pz = z - a[1] - dz * t;
  return px * px + pz * pz;
}
function mergeMeshes(geometries, material, parent, name, shadow = true) {
  if (!geometries.length) return null;
  const geometry = mergeGeometries(geometries, false);
  for (const g of geometries) g.dispose();
  if (!geometry) return null;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name; mesh.castShadow = shadow; mesh.receiveShadow = true;
  parent.add(mesh); return mesh;
}
function makeLineGeometry(positions) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return g;
}
function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

export function createCityScene({ container, data, onSelect, onCameraChange, onReady, onError, onInteraction, onModelStatus }) {
  let disposed = false;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  } catch (error) {
    onError?.('当前浏览器无法启动三维沙盘，请开启硬件加速后重试。');
    throw error;
  }
  const scene = new THREE.Scene();
  const width = Number(data.meta?.width) || 240;
  const depth = Number(data.meta?.depth) || 260;
  const extent = Math.max(width, depth);
  const city = new THREE.Group(); city.name = 'Yichang miniature'; scene.add(city);
  const layers = {};
  for (const name of ['base', 'terrain', 'water', 'parks', 'roads', 'buildings', 'trees', 'landmarks', 'waterfront', 'boats', 'nightlights']) {
    layers[name] = new THREE.Group(); layers[name].name = name; city.add(layers[name]);
  }
  const materialThemes = [];
  const makeMaterial = (day, night, options = {}) => {
    const material = new THREE.MeshStandardMaterial({ color: day, roughness: 0.94, metalness: 0, ...options });
    materialThemes.push({ material, day, night: night || day });
    return material;
  };
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = DAY_LIGHT.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // All model geometry is static. Orbiting should not rerender the shadow map.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;outline:none;';
  renderer.domElement.setAttribute('aria-label', '可旋转、缩放和探索的宜昌三维城市沙盘');
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.dataset.sceneMode = 'city';
  container.appendChild(renderer.domElement);
  const camera = new THREE.OrthographicCamera(-extent, extent, extent, -extent, 0.1, extent * 16);
  camera.position.set(extent * 0.62, extent * 0.98, extent * 0.84);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.rotateSpeed = 0.52;
  controls.zoomSpeed = 0.85;
  controls.panSpeed = 0.85;
  controls.screenSpacePanning = false;
  controls.minPolarAngle = 0.015;
  controls.maxPolarAngle = Math.PI / 2.32;
  controls.minZoom = 0.65;
  controls.maxZoom = 16;
  controls.autoRotateSpeed = 0.3;
  controls.target.set(0, 0, 0);
  controls.update();
  scene.background = new THREE.Color(DAY.sky);
  const hemi = new THREE.HemisphereLight('#f9fbff', '#8a9b76', DAY_LIGHT.hemisphere); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff4dc', DAY_LIGHT.sun);
  sun.position.set(-extent * 0.55, extent * 1.3, extent * 0.65);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -extent * 0.78; sun.shadow.camera.right = extent * 0.78;
  sun.shadow.camera.top = extent * 0.78; sun.shadow.camera.bottom = -extent * 0.78;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = extent * 4;
  sun.shadow.normalBias = 0.08; sun.shadow.bias = -0.0001;
  sun.shadow.radius = 3;
  scene.add(sun);
  const fill = new THREE.DirectionalLight('#dceeff', DAY_LIGHT.fill);
  fill.position.set(extent, extent * 0.5, -extent); scene.add(fill);

  const waterPolygons = normalizePolygons(data.water);
  const parkPolygons = normalizePolygons(data.parks);
  const waterIndex = makeGridIndex(extent / 24);
  const parkIndex = makeGridIndex(extent / 24);
  waterPolygons.forEach(p => waterIndex.add(p, p.bounds));
  parkPolygons.forEach(p => parkIndex.add(p, p.bounds));
  const inWater = (x, z) => waterIndex.get(x, z).some(p => containsPolygon(x, z, p));
  const inPark = (x, z) => parkIndex.get(x, z).some(p => containsPolygon(x, z, p));
  const landmarks = (data.landmarks || []).map(spec => resolveLandmarkSpec(spec, { roads: data.roads, inWater }));
  const authoredModels = AUTHORED_MODELS.map(spec => resolveAuthoredPlacement(spec, data.meta)).filter(Boolean);
  const authoredGround = planAuthoredGround(authoredModels, data, BUILDING_HEIGHT_EXAGGERATION);
  // Reuse these groups after measuring them; their textures are disposed with
  // the scene. Their measured bounds already include factory yaw and scaling.
  const preparedLandmarks = new Map(), modelBounds = new Map();
  for (const spec of landmarks) {
    const group = LandmarkFactory.createLandmark?.(spec) || new THREE.Group();
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    preparedLandmarks.set(spec.id, group);
    if (!box.isEmpty()) modelBounds.set(spec.id, { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z });
  }
  const terrain = data.terrain;
  const terrainValid = terrain && terrain.cols > 1 && terrain.rows > 1 && terrain.heights?.length >= terrain.cols * terrain.rows;
  const hills = !terrainValid ? landmarks.filter(l => /磨基山|白马山|东山/.test(l.name || '')).map(l => ({ x: l.x, z: l.z, height: /磨基山/.test(l.name) ? 4.8 : 2.4, radius: extent * 0.065 })) : [];
  const terrainWidth = terrain?.width || width, terrainDepth = terrain?.depth || depth;
  function rawHeight(x, z) {
    if (!terrainValid) {
      let h = 0;
      for (const hill of hills) h += hill.height * Math.exp(-((x - hill.x) ** 2 + (z - hill.z) ** 2) / (hill.radius ** 2 * 0.55));
      return h;
    }
    const fx = THREE.MathUtils.clamp((x / terrainWidth + 0.5) * (terrain.cols - 1), 0, terrain.cols - 1.001);
    const fz = THREE.MathUtils.clamp((z / terrainDepth + 0.5) * (terrain.rows - 1), 0, terrain.rows - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const a = Number(terrain.heights[iz * terrain.cols + ix]) || 0;
    const b = Number(terrain.heights[iz * terrain.cols + ix + 1]) || 0;
    const c = Number(terrain.heights[(iz + 1) * terrain.cols + ix]) || 0;
    const d = Number(terrain.heights[(iz + 1) * terrain.cols + ix + 1]) || 0;
    return THREE.MathUtils.clamp(THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), tz), 0, extent * 0.12);
  }
  function surfaceHeight(x, z) {
    if (inWater(x, z)) return 0;
    return rawHeight(x, z);
  }
  const waterfrontPlan = planWaterfront({ data, landmarks, modelBounds, inWater, heightAt: surfaceHeight });
  const baseThickness = 9.4;
  const soilMaterial = makeMaterial(DAY.soil, NIGHT.soil);
  const rimMaterial = makeMaterial(DAY.rim, NIGHT.rim);
  const lowSoilMaterial = makeMaterial(DAY.soilLow, NIGHT.soilLow);
  const landMaterial = makeMaterial(DAY.land, NIGHT.land, { vertexColors: true });
  function box(parent, name, w, h, d, y, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.name = name; mesh.position.y = y; mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  box(layers.base, 'warm earth section', width, baseThickness, depth, -baseThickness / 2 - 0.1, soilMaterial);
  box(layers.base, 'lower earth stratum', width + 0.04, 1.5, depth + 0.04, -baseThickness + 0.65, lowSoilMaterial);
  box(layers.base, 'fine cut edge', width + 0.16, 0.32, depth + 0.16, -0.17, rimMaterial);
  // A thin horizontal seam emphasizes the physical, finite model base.
  const seamMaterial = makeMaterial('#c9aa79', '#617061');
  box(layers.base, 'earth seam', width + 0.04, 0.18, depth + 0.04, -baseThickness * 0.61, seamMaterial);
  // The tabletop remains cream while directional lighting shapes the model.
  // A separate shadow catcher preserves the contact shadow without grading
  // the entire background darker when the daylight intensity is reduced.
  const floorMaterial = new THREE.MeshBasicMaterial({ color: DAY.floor, toneMapped: false });
  materialThemes.push({ material: floorMaterial, day: DAY.floor, night: NIGHT.floor });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(extent * 8, extent * 8), floorMaterial);
  floor.rotation.x = -Math.PI / 2; floor.position.y = -baseThickness - 0.13; scene.add(floor);
  const floorShadowMaterial = new THREE.ShadowMaterial({ color: '#55614c', opacity: 0.23, depthWrite: false });
  const floorShadow = new THREE.Mesh(floor.geometry, floorShadowMaterial);
  floorShadow.rotation.copy(floor.rotation); floorShadow.position.y = floor.position.y + 0.01; floorShadow.receiveShadow = true; scene.add(floorShadow);

  const subdivisions = terrainValid ? Math.min(180, Math.max(100, terrain.cols - 1)) : 120;
  const groundGeo = new THREE.PlaneGeometry(width, depth, subdivisions, subdivisions);
  groundGeo.rotateX(-Math.PI / 2);
  const groundPositions = groundGeo.getAttribute('position');
  const groundColors = new Float32Array(groundPositions.count * 3);
  const shade = new THREE.Color();
  const groundShades = new Float32Array(groundPositions.count);
  for (let i = 0; i < groundPositions.count; i++) {
    const x = groundPositions.getX(i), z = groundPositions.getZ(i);
    const h = surfaceHeight(x, z);
    groundPositions.setY(i, h);
    const variation = 0.97 + 0.025 * Math.sin(x * 0.11 + z * 0.04) + 0.018 * Math.cos(z * 0.13) - Math.min(h / extent, 0.07);
    groundShades[i] = variation;
    shade.setRGB(variation, variation, variation);
    shade.toArray(groundColors, i * 3);
  }
  groundGeo.setAttribute('color', new THREE.BufferAttribute(groundColors, 3)); groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, landMaterial); ground.receiveShadow = true; ground.name = 'green land relief'; layers.terrain.add(ground);

  const waterMaterial = makeMaterial(DAY.water, NIGHT.water, { roughness: 0.62, metalness: 0.03 });
  const shorelineMaterial = new THREE.LineBasicMaterial({ color: DAY.shore, transparent: true, opacity: 0.6 });
  materialThemes.push({ material: shorelineMaterial, day: DAY.shore, night: NIGHT.shore });
  const waterGeometries = [], shorelinePositions = [];
  for (const polygon of waterPolygons) {
    const shape = makeShape(polygon.rings); if (!shape) continue;
    const g = new THREE.ShapeGeometry(shape, 1); g.rotateX(-Math.PI / 2); g.translate(0, 0.15, 0); waterGeometries.push(g);
    for (const ring of polygon.rings) for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      shorelinePositions.push(a[0], 0.19, a[1], b[0], 0.19, b[1]);
    }
  }
  mergeMeshes(waterGeometries, waterMaterial, layers.water, 'Yangtze and waterways', false);
  if (shorelinePositions.length) layers.water.add(new THREE.LineSegments(makeLineGeometry(shorelinePositions), shorelineMaterial));
  const rippleRandom = randomGenerator(1337), ripplePositions = [];
  for (let i = 0; i < 2600; i++) {
    const x = (rippleRandom() - 0.5) * width, z = (rippleRandom() - 0.5) * depth;
    const length = 0.3 + rippleRandom() * 1.1;
    if (inWater(x, z) && inWater(x + length, z + length * 0.2)) ripplePositions.push(x, 0.2, z, x + length, 0.2, z + length * 0.2);
  }
  const rippleMaterial = new THREE.LineBasicMaterial({ color: '#d3f2ed', transparent: true, opacity: 0.18, depthWrite: false });
  if (ripplePositions.length) layers.water.add(new THREE.LineSegments(makeLineGeometry(ripplePositions), rippleMaterial));

  const parkGeometries = [[], [], []];
  const parkMaterials = [makeMaterial('#83b45f', '#416652'), makeMaterial('#8dbd67', '#466c57'), makeMaterial('#7da958', '#3f624f')];
  parkPolygons.forEach((polygon, i) => {
    // Unnamed forest coverage is clipped from a regional source. It drives
    // tree planting only, so its rectangular source edge cannot become a lawn.
    if (!polygon.name) return;
    const shape = makeShape(polygon.rings); if (!shape) return;
    const g = new THREE.ShapeGeometry(shape, 1); g.rotateX(-Math.PI / 2);
    const positions = g.getAttribute('position');
    for (let j = 0; j < positions.count; j++) positions.setY(j, surfaceHeight(positions.getX(j), positions.getZ(j)) + 0.045);
    g.computeVertexNormals(); parkGeometries[i % 3].push(g);
  });
  parkGeometries.forEach((gs, i) => mergeMeshes(gs, parkMaterials[i], layers.parks, `parks ${i}`, false));

  // Thin mitered road ribbons are merged into three quiet color layers.
  const roadIndex = makeGridIndex(5);
  const roadGeometries = [[], [], []], roadEdges = [];
  const roadMaterials = [makeMaterial(DAY.road, NIGHT.road), makeMaterial(DAY.roadMajor, NIGHT.roadMajor), makeMaterial('#e5ddc8', '#8f9a87')];
  const roadEdgeMaterial = makeMaterial(DAY.roadEdge, NIGHT.roadEdge);
  function roadGeometry(points, roadWidth, offset) {
    if (points.length < 2) return null;
    const positions = [], indices = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i], previous = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
      let dx = next[0] - previous[0], dz = next[1] - previous[1];
      const length = Math.hypot(dx, dz) || 1; dx /= length; dz /= length;
      const nx = -dz * roadWidth * 0.5, nz = dx * roadWidth * 0.5;
      const y = Math.max(surfaceHeight(p[0], p[1]) + offset, inWater(p[0], p[1]) ? 0.29 : offset);
      positions.push(p[0] + nx, y, p[1] + nz, p[0] - nx, y, p[1] - nz);
      if (i < points.length - 1) { const n = i * 2; indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3); }
    }
    const g = makeLineGeometry(positions); g.setIndex(indices); g.computeVertexNormals(); return g;
  }
  for (const road of data.roads || []) {
    const points = (road.points || []).filter(p => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (points.length < 2) continue;
    const major = /motorway|trunk|primary|secondary/.test(road.kind || '');
    const footway = /foot|path|cycle|step|pedestrian/.test(road.kind || '');
    const rw = THREE.MathUtils.clamp(Number(road.width) || (major ? 0.23 : footway ? 0.065 : 0.13), 0.035, 0.7);
    const kind = major ? 1 : footway ? 2 : 0;
    const g = roadGeometry(points, rw, 0.12); if (g) roadGeometries[kind].push(g);
    if (major) { const edge = roadGeometry(points, rw + 0.1, 0.095); if (edge) roadEdges.push(edge); }
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      roadIndex.add({ a, b, width: rw }, { minX: Math.min(a[0], b[0]) - rw - 1, maxX: Math.max(a[0], b[0]) + rw + 1, minZ: Math.min(a[1], b[1]) - rw - 1, maxZ: Math.max(a[1], b[1]) + rw + 1 });
    }
  }
  mergeMeshes(roadEdges, roadEdgeMaterial, layers.roads, 'road verges', false);
  roadGeometries.forEach((gs, i) => mergeMeshes(gs, roadMaterials[i], layers.roads, `road ribbons ${i}`, false));

  const buildingIndex = makeGridIndex(4);
  const buildingGeometries = DAY.buildings.map(() => []);
  // Keep the porcelain-like white roofs bright. Directional light and the
  // lower ambient fill still shade their walls and cast readable shadows.
  const buildingMaterials = DAY.buildings.map((color, i) => makeMaterial(color, NIGHT.buildings[i], { toneMapped: false }));
  let buildingCount = 0;
  const roofEdges = [];
  const originalBuildingCount = (data.buildings || []).length;
  const backgroundBuildings = [...(data.buildings || []), ...authoredGround.retainedBuildings];
  for (let index = 0; index < backgroundBuildings.length; index++) {
    const building = backgroundBuildings[index];
    if (index < originalBuildingCount && (waterfrontPlan.omittedBuildingIndices.has(index) || authoredGround.omittedBuildingIndices.has(index))) continue;
    const ring = cleanRing(building.ring); if (ring.length < 3) continue;
    const bounds = polygonBounds(ring);
    const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
    if (inWater(cx, cz)) continue;
    const shape = makeShape(building.rings ? building.rings.map(cleanRing) : [ring]); if (!shape) continue;
    // The restrained vertical exaggeration makes real footprints readable at
    // city scale while retaining each source building's relative height.
    const height = THREE.MathUtils.clamp((Number(building.height) || 0.24) * authoredGround.heightFactor(cx, cz), 0.24, 13.5);
    // Use one elevation for the footprint so the roof stays horizontal.
    const base = surfaceHeight(cx, cz) + Math.max(0, Number(building.base) || 0) + 0.06;
    try {
      const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1, steps: 1 });
      g.rotateX(-Math.PI / 2); g.translate(0, base, 0);
      const bucket = Math.abs(Math.floor(cx * 17 + cz * 29 + index)) % buildingMaterials.length;
      buildingGeometries[bucket].push(g); buildingCount++;
      if (height > 1.35 && index % 2 === 0) for (let j = 0; j < ring.length; j++) {
        const a = ring[j], b = ring[(j + 1) % ring.length];
        roofEdges.push(a[0], base + height + 0.005, a[1], b[0], base + height + 0.005, b[1]);
      }
      buildingIndex.add({ ring, bounds }, { minX: bounds.minX - 0.75, maxX: bounds.maxX + 0.75, minZ: bounds.minZ - 0.75, maxZ: bounds.maxZ + 0.75 });
    } catch { /* An invalid source ring is omitted without losing the scene. */ }
  }
  buildingGeometries.forEach((gs, i) => mergeMeshes(gs, buildingMaterials[i], layers.buildings, `city buildings ${i}`));
  const roofEdgeMaterial = new THREE.LineBasicMaterial({ color: '#bdc4b4', transparent: true, opacity: 0.26 });
  materialThemes.push({ material: roofEdgeMaterial, day: '#bdc4b4', night: '#647e74' });
  if (roofEdges.length) layers.buildings.add(new THREE.LineSegments(makeLineGeometry(roofEdges), roofEdgeMaterial));

  const treeRandom = randomGenerator(48229);
  const treeSpecs = [];
  const treeLimit = Math.min(3600, Math.round(width * depth / 20));
  const candidates = Math.max(28000, treeLimit * 16);
  const treeCells = new Set();
  for (let i = 0; i < candidates && treeSpecs.length < treeLimit; i++) {
    const x = (treeRandom() - 0.5) * (width - 1.8), z = (treeRandom() - 0.5) * (depth - 1.8);
    if (inWater(x, z)) continue;
    const park = inPark(x, z), h = surfaceHeight(x, z);
    const pattern = Math.sin(x * 0.16) * Math.cos(z * 0.12) + Math.sin((x + z) * 0.06);
    const chance = park ? 0.82 : h > 1.8 ? 0.55 : pattern > 0.75 ? 0.1 : 0.018;
    if (treeRandom() > chance) continue;
    const cell = `${Math.round(x / 0.9)},${Math.round(z / 0.9)}`;
    if (treeCells.has(cell) || waterfrontPlan.reserveTree(x, z) || authoredGround.reserveTree(x, z)) continue;
    if (landmarks.some(l => l.kind !== 'park' && l.kind !== 'bridge' && Math.hypot(x - l.x, z - l.z) < (l.modelScale || 1) * 3.1)) continue;
    if (buildingIndex.get(x, z).some(b => x >= b.bounds.minX - 0.5 && x <= b.bounds.maxX + 0.5 && z >= b.bounds.minZ - 0.5 && z <= b.bounds.maxZ + 0.5)) continue;
    if (roadIndex.get(x, z).some(r => pointSegmentDistanceSq(x, z, r.a, r.b) < (r.width * 0.5 + 0.45) ** 2)) continue;
    treeCells.add(cell);
    const contextScale = authoredGround.heightFactor(x, z) / BUILDING_HEIGHT_EXAGGERATION;
    treeSpecs.push({ x, z, y: h + 0.04, size: (0.6 + treeRandom() * 0.75) * contextScale, rotation: treeRandom() * Math.PI * 2, palette: Math.floor(treeRandom() * DAY.trees.length), pine: treeRandom() < 0.2 });
  }
  const dummy = new THREE.Object3D();
  const crownParts = [];
  const crownA = new THREE.IcosahedronGeometry(0.57, 0); crownA.translate(0, 1.3, 0); crownParts.push(crownA);
  const crownB = new THREE.IcosahedronGeometry(0.42, 0); crownB.translate(-0.22, 1.12, 0.12); crownParts.push(crownB);
  const crownC = new THREE.IcosahedronGeometry(0.42, 0); crownC.translate(0.2, 1.42, -0.08); crownParts.push(crownC);
  const crownGeometry = mergeGeometries(crownParts, false); crownParts.forEach(g => g.dispose());
  const pineGeometry = new THREE.ConeGeometry(0.53, 1.65, 6); pineGeometry.translate(0, 1.35, 0);
  const trunkGeometry = new THREE.CylinderGeometry(0.065, 0.085, 0.9, 5); trunkGeometry.translate(0, 0.45, 0);
  const crownMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true });
  const trunkMaterial = makeMaterial(DAY.trunk, NIGHT.trunk);
  const deciduous = treeSpecs.filter(t => !t.pine), pines = treeSpecs.filter(t => t.pine);
  const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, deciduous.length);
  const pineCrowns = new THREE.InstancedMesh(pineGeometry, crownMaterial, pines.length);
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treeSpecs.length);
  function writeInstances(mesh, specs, setColors = false, palette = DAY.trees) {
    specs.forEach((tree, i) => {
      dummy.position.set(tree.x, tree.y, tree.z); dummy.scale.setScalar(tree.size); dummy.rotation.set(0, tree.rotation, 0); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (setColors) mesh.setColorAt(i, new THREE.Color(palette[tree.palette]));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }
  writeInstances(crowns, deciduous, true); writeInstances(pineCrowns, pines, true); writeInstances(trunks, treeSpecs);
  crowns.castShadow = pineCrowns.castShadow = true;
  crowns.receiveShadow = pineCrowns.receiveShadow = true;
  crowns.name = 'deciduous tree clusters'; pineCrowns.name = 'conifer trees'; trunks.name = 'tree trunks';
  layers.trees.add(crowns, pineCrowns, trunks);

  const landmarkMap = new Map();
  const pickObjects = [];
  const ringMaterial = new THREE.MeshBasicMaterial({ color: '#e4ae55', transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false });
  const selectedRing = new THREE.Mesh(new THREE.RingGeometry(3.6, 3.72, 64), ringMaterial);
  selectedRing.rotation.x = -Math.PI / 2; selectedRing.visible = false; layers.landmarks.add(selectedRing);
  const platformMaterial = makeMaterial('#ded2b4', '#758377');
  for (const spec of landmarks) {
    const group = preparedLandmarks.get(spec.id);
    group.name = spec.name || spec.id;
    const scale = Number(group.userData.modelScaleApplied) || group.scale.x || 1;
    const base = Number.isFinite(spec.elevation) ? spec.elevation : surfaceHeight(spec.x, spec.z);
    const lift = waterfrontPlan.getSite(spec.id) ? 0.095 : 0.13;
    group.position.set(spec.x, base + lift, spec.z);
    group.userData.landmarkId = spec.id;
    group.traverse(object => {
      if (object.isMesh) {
        object.userData.landmarkId = spec.id;
        object.castShadow = !object.userData.noShadow; object.receiveShadow = !object.userData.noShadow; pickObjects.push(object);
      }
    });
    layers.landmarks.add(group);
    if (!['bridge', 'dam', 'park'].includes(spec.kind) && !waterfrontPlan.getSite(spec.id)) {
      const platform = new THREE.Mesh(new THREE.CylinderGeometry(2.7 * scale, 2.78 * scale, 0.15, 24), platformMaterial);
      platform.position.set(spec.x, base + 0.11, spec.z); platform.receiveShadow = true; layers.landmarks.add(platform);
    }
    group.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(group);
    const size = bounds.isEmpty() ? new THREE.Vector3(5, 8, 5) : bounds.getSize(new THREE.Vector3());
    const center = bounds.isEmpty() ? group.position.clone() : bounds.getCenter(new THREE.Vector3());
    const labelClearance = waterfrontPlan.getSite(spec.id) ? Math.max(0.15, size.y * 0.12) : 1;
    const anchor = new THREE.Vector3(spec.x, (bounds.isEmpty() ? base + 8 : bounds.max.y) + labelClearance, spec.z);
    landmarkMap.set(spec.id, { spec, group, base, size, center, anchor, bounds });
  }

  const waterfront = createWaterfront(waterfrontPlan, { heightAt: surfaceHeight, makeMaterial });
  layers.waterfront.add(waterfront.group); layers.boats.add(waterfront.boatGroup);

  // A small set of warm points creates a clear, readable evening layer.
  const nightPositions = [];
  const nightRandom = randomGenerator(941);
  for (const road of data.roads || []) {
    if (!/primary|secondary|trunk/.test(road.kind || '')) continue;
    const points = road.points || [];
    for (let i = 0; i < points.length; i += 3) {
      const p = points[i]; if (nightRandom() > 0.62 || inWater(p[0], p[1])) continue;
      nightPositions.push(p[0], surfaceHeight(p[0], p[1]) + 0.5 * authoredGround.heightFactor(p[0], p[1]) / BUILDING_HEIGHT_EXAGGERATION, p[1]);
    }
  }
  const nightPointMaterial = new THREE.PointsMaterial({ color: '#ffd99a', size: 2, sizeAttenuation: false, transparent: true, opacity: 0.85, depthWrite: false });
  layers.nightlights.add(new THREE.Points(makeLineGeometry(nightPositions), nightPointMaterial));
  layers.nightlights.visible = false;

  let currentTheme = 'day';
  let currentView = 'perspective';
  let selectedId = null;
  let tween = null;
  let lastTime = 0;
  let lastLabels = 0;
  let frameNumber = 0;
  let renderedFrames = 0;
  let labelsDirty = true;
  let lodDirty = true;
  let resizePending = false;
  let viewSuspended = false;
  let widthPx = 1, heightPx = 1;
  let baseHalfHeight = extent * 0.53;
  let defaultState;
  let readyCalled = false;
  let userMoved = false;
  let lastPointer = null;
  const motionMedia = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let reducedMotion = Boolean(motionMedia?.matches);
  let motionEnabled = !reducedMotion;
  let lastMotionFrame = 0;
  let motionRunning = false;
  let currentFocusOptions = { angle: 'detail', close: false };
  let managedFocus = false;
  let authoredSelection = false;
  let authoredStarted = false;
  renderer.domElement.dataset.renderFrames = '0';
  const renderScheduler = createRenderScheduler({
    onFrame: animate,
    onPause: () => { motionRunning = false; },
    onResume: ({ pausedAt, resumedAt }) => {
      // Also handle a focus requested while an overlay already has us paused.
      // It should start on resume, rather than consume hidden wall-clock time.
      if (tween) tween.started += resumedAt - Math.max(pausedAt, tween.started);
      lastTime = 0; lastMotionFrame = 0; labelsDirty = true; lodDirty = true;
    },
    onState: state => { renderer.domElement.dataset.renderState = state; },
  });
  if (document.hidden) renderScheduler.setPaused('hidden', true);
  function requestRender() {
    labelsDirty = true; lodDirty = true;
    if (renderScheduler.getState() === 'idle') lastTime = 0;
    renderScheduler.invalidate();
  }
  function renderScene() {
    renderer.render(scene, camera);
    renderer.domElement.dataset.renderFrames = String(++renderedFrames);
  }
  const defaultDirection = new THREE.Vector3(0.62, 0.98, 0.84).normalize();
  const cameraDistance = extent * 1.6;
  const getOffset = view => view === 'top' ? new THREE.Vector3(0, cameraDistance, 0.01) : defaultDirection.clone().multiplyScalar(cameraDistance);
  const cityContextBounds = new THREE.Box3().setFromObject(city);
  const lightScheduler = createLightLoadScheduler({ concurrency: 2 });
  const authoredEntries = new Map();
  for (const spec of authoredModels) {
    const controller = createAuthoredStage({
      catalog: [spec], showPlinth: false,
      scheduleLight: lightScheduler.schedule,
      prioritizeLight: lightScheduler.prioritize,
      onChange: () => { if (!disposed) { renderer.shadowMap.needsUpdate = true; requestRender(); } },
      onStatus: state => { if (!disposed) onModelStatus?.(state); },
    });
    const base = surfaceHeight(spec.x, spec.z) + 0.065;
    controller.group.position.set(spec.x, base, spec.z);
    controller.group.rotation.y = spec.yaw;
    layers.landmarks.add(controller.group);
    const bounds = authoredWorldBounds(spec, base);
    const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    const anchor = new THREE.Vector3(spec.x, bounds.max.y + Math.max(0.12, size.y * 0.08), spec.z);
    landmarkMap.set(spec.id, { spec, group: controller.group, base, size, center, bounds, anchor });
    authoredEntries.set(spec.id, { spec, controller });
    cityContextBounds.union(bounds);
  }
  // These are real source-guide points, not substitute building meshes.
  // Keep their map position searchable while native assets are being restored.
  const pendingBusiness = BUSINESS_BUILDINGS.filter(spec => spec.kind === 'business-poi');
  for (const record of pendingBusiness) {
    const [x,z]=projectWgs84([record.lon,record.lat],data.meta);
    const spec={...record,x,z};
    const base=surfaceHeight(x,z);
    const group=new THREE.Group();group.position.set(x,base,z);layers.landmarks.add(group);
    const bounds=new THREE.Box3(new THREE.Vector3(x-4,base,z-4),new THREE.Vector3(x+4,base+5,z+4));
    landmarkMap.set(spec.id,{spec,group,base,bounds,size:bounds.getSize(new THREE.Vector3()),
      center:bounds.getCenter(new THREE.Vector3()),anchor:new THREE.Vector3(x,base+.5,z)});
  }
  // Two resident light requests at a time leave bandwidth for city interaction.
  const residentQueue=[...authoredEntries.values()];
  async function loadResidentQueue() {
    while(!disposed && residentQueue.length) {
      const {spec,controller}=residentQueue.shift();
      await controller.select(spec.id,{detail:selectedId===spec.id&&currentFocusOptions.close});
    }
  }
  const selectedAuthored = () => authoredEntries.get(selectedId);
  const residentStats = () => [...authoredEntries.values()].map(({spec, controller}) => ({
    id: spec.id, lonLat: [spec.lon, spec.lat], position: controller.group.position.toArray(), yaw: spec.yaw,
    uniformScale: spec.uniformScale, displayHeight: spec.displayHeight, sourceFeatureId: spec.registration.sourceFeatureId, sourceFeatureIds: spec.registration.replaceSourceFeatureIds || [],
    ...controller.getStats(),
  }));
  function setAuthoredSelection(value) {
    const next = Boolean(value);
    authoredSelection = next;
    controls.maxPolarAngle = next ? Math.PI / 2.05 : Math.PI / 2.32;
    controls.minZoom = next ? 0.1 : 0.65;
    if (!next) for (const {controller} of authoredEntries.values()) controller.releaseDetail();
    renderer.shadowMap.needsUpdate = true; requestRender();
    renderer.domElement.setAttribute('aria-label', '可旋转、缩放和探索的宜昌三维城市沙盘');
    renderer.domElement.dataset.sceneMode = 'city';
    renderer.domElement.dataset.authoredSelection = String(next);
  }
  function focusViewport(authored, panelOptional = false) {
    const containerRect = container.getBoundingClientRect();
    const panel = container.parentElement?.querySelector('.detail-panel')?.getBoundingClientRect();
    const mobile = window.innerWidth <= 700;
    const left = mobile ? 18 : 24;
    let top = !panelOptional && authored ? (mobile ? 146 : 136) : mobile ? 68 : 84;
    if (panelOptional) {
      // Group framing can start with no selected place. Reserve the actual UI
      // only; an absent detail card must not consume half of the mobile map.
      for (const selector of ['.scene-toolbar', '.authored-note']) {
        const overlay = container.parentElement?.querySelector(selector)?.getBoundingClientRect();
        if (overlay?.height) top = Math.max(top, overlay.bottom - containerRect.top + 12);
      }
    }
    const reservePanel = !panelOptional || Boolean(panel?.width && panel?.height);
    const panelWidth = panel?.width || (window.innerWidth >= 1600 ? 318 : window.innerWidth <= 1200 ? 270 : 298);
    const rightEdge = mobile ? widthPx - 18 : reservePanel ? Math.max(left + 150, widthPx - panelWidth - 48) : widthPx - 24;
    const bottom = panelOptional
      ? Math.min(heightPx - 50, mobile && reservePanel ? panel.top - containerRect.top - 14 : Infinity)
      : mobile && reservePanel ? Math.max(top + 105, panel ? panel.top - containerRect.top - 14 : heightPx * 0.47 - 60) : Math.max(top + 150, heightPx - 50);
    return { left, top, rightEdge, bottom };
  }
  function calculateFocusState(item, options = currentFocusOptions, view = currentView) {
    const site = waterfrontPlan.getSite(item.spec.id);
    const authored = item.spec.kind === 'authored';
    const context = authored && options.angle === 'context';
    const frameBounds = item.bounds.clone();
    if (context) frameBounds.union(cityContextBounds);
    const frameCenter = frameBounds.getCenter(new THREE.Vector3());
    let direction = defaultDirection.clone();
    if (authored && !context) {
      // Presentation-only viewing direction; the registered model yaw and map
      // position stay fixed. Explicit front and city-context views retain theirs.
      direction = options.angle === 'front' ? new THREE.Vector3(0, 0.15, 1).normalize() : new THREE.Vector3(...(item.spec.defaultViewDirection || [0.72, 0.7, 1.3])).normalize();
      direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), item.spec.yaw);
    } else if (options.angle === 'river' && site) {
      // Look from the source water side, at a gentler elevation than overview.
      const n = site.shore.normal, t = site.shore.tangent;
      direction.set(-n[0] + t[0] * 0.12, 0.62, -n[1] + t[1] * 0.12).normalize();
    } else if (item.spec.id === 'tianran-pagoda' && site) {
      // Frame the pagoda from open water, above the low river angle, so its
      // neighboring towers remain behind it instead of crossing its silhouette.
      const n = site.shore.normal, t = site.shore.tangent;
      direction.set(-n[0] + t[0] * 0.35, 1.15, -n[1] + t[1] * 0.35).normalize();
    }
    if (view === 'top') direction.set(0, 1, 0.0001).normalize();
    const right = new THREE.Vector3(direction.z, 0, -direction.x).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const aspect = widthPx / heightPx;
    const { left, top, rightEdge, bottom } = focusViewport(authored);
    const fractionX = Math.min(1, (rightEdge - left) / widthPx);
    const fractionY = Math.min(1, (bottom - top) / heightPx);
    let projectedWidth = 0, projectedHeight = 0;
    for (const x of [frameBounds.min.x, frameBounds.max.x]) for (const z of [frameBounds.min.z, frameBounds.max.z]) for (const y of [frameBounds.min.y, Math.max(frameBounds.max.y, item.anchor.y)]) {
      const delta = new THREE.Vector3(x, y, z).sub(frameCenter);
      projectedWidth = Math.max(projectedWidth, Math.abs(delta.dot(right)) * 2);
      projectedHeight = Math.max(projectedHeight, Math.abs(delta.dot(up)) * 2);
    }
    const maxSize = Math.max(item.size.x, item.size.z, item.size.y);
    const wide = item.spec.kind === 'bridge' || item.spec.kind === 'dam';
    const pagoda = item.spec.id === 'tianran-pagoda';
    const minimumHeight = authored ? 2.5 : pagoda ? 7.2 : site ? 10 : 37;
    const defaultHeight = Math.max(minimumHeight, Math.min(extent * 0.43, maxSize * (authored ? 2.4 : wide ? 1.75 : pagoda ? 4 : 5.2)));
    const safetyHeight = Math.max(projectedHeight / fractionY, projectedWidth / (aspect * fractionX)) * 1.12;
    // Reserve the close-view margin before selecting either framing. The
    // narrower mobile viewport must not force both states onto the same cap.
    const framedDefaultHeight = Math.max(defaultHeight, safetyHeight * 1.4);
    const visibleHeight = context ? safetyHeight * 1.04 : framedDefaultHeight / (options.close ? 1.4 : 1);
    const zoom = THREE.MathUtils.clamp(baseHalfHeight * 2 / visibleHeight, context ? 0.1 : 1.5, focusZoomLimit());
    const actualHeight = baseHalfHeight * 2 / zoom;
    const ndcX = ((left + rightEdge) / 2 / widthPx) * 2 - 1;
    const ndcY = 1 - ((top + bottom) / 2 / heightPx) * 2;
    const target = frameCenter.clone().sub(right.multiplyScalar(ndcX * actualHeight * aspect / 2)).sub(up.multiplyScalar(ndcY * actualHeight / 2));
    return { target, position: target.clone().add(direction.multiplyScalar(cameraDistance)), zoom };
  }
  function calculateClusterState(items) {
    const direction = camera.position.clone().sub(controls.target).normalize();
    const right = new THREE.Vector3(direction.z, 0, -direction.x).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const center = new THREE.Box3().setFromPoints(items.map(item => item.anchor)).getCenter(new THREE.Vector3());
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const anchors = items.map(item => {
      const delta = item.anchor.clone().sub(center), x = delta.dot(right), y = delta.dot(up);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      return { item, x, y };
    });
    // Nearby labels are the subject of group zoom. Use model bounds only as
    // bounded padding, so a long bridge/dam cannot pull a close POI group back
    // to the city overview. Selecting that landmark still frames it in full.
    const padding = THREE.MathUtils.clamp(Math.max(maxX - minX, maxY - minY) * 0.2, 1.5, 4);
    for (const { item, x: anchorX, y: anchorY } of anchors) {
      if (item.bounds.isEmpty()) continue;
      for (const x of [item.bounds.min.x, item.bounds.max.x]) for (const y of [item.bounds.min.y, item.bounds.max.y]) for (const z of [item.bounds.min.z, item.bounds.max.z]) {
        const delta = new THREE.Vector3(x, y, z).sub(item.anchor);
        const projectedX = anchorX + THREE.MathUtils.clamp(delta.dot(right), -padding, padding);
        const projectedY = anchorY + THREE.MathUtils.clamp(delta.dot(up), -padding, padding);
        minX = Math.min(minX, projectedX); maxX = Math.max(maxX, projectedX);
        minY = Math.min(minY, projectedY); maxY = Math.max(maxY, projectedY);
      }
    }
    const { left, top, rightEdge, bottom } = focusViewport(Boolean(landmarkMap.get(selectedId)?.spec.business), true);
    if (rightEdge - left < 24 || bottom - top < 24) return null;
    const aspect = widthPx / heightPx;
    const fractionX = Math.min(1, (rightEdge - left) / widthPx);
    const fractionY = Math.min(1, (bottom - top) / heightPx);
    // An absolute world-height floor keeps coincident points at neighborhood
    // scale. Repeated group actions fit the same bounds instead of multiplying
    // zoom. Full engineering bounds remain the single-landmark focus's job.
    const visibleHeight = Math.max(12, Math.max((maxY - minY) / fractionY, (maxX - minX) / (aspect * fractionX)) * 1.18);
    const zoom = THREE.MathUtils.clamp(baseHalfHeight * 2 / visibleHeight, 0.1, focusZoomLimit());
    const actualHeight = baseHalfHeight * 2 / zoom;
    const ndcX = (left + rightEdge) / widthPx - 1;
    const ndcY = 1 - (top + bottom) / heightPx;
    const target = center.addScaledVector(right, (minX + maxX) / 2 - ndcX * actualHeight * aspect / 2)
      .addScaledVector(up, (minY + maxY) / 2 - ndcY * actualHeight / 2);
    return { target, position: target.clone().addScaledVector(direction, cameraDistance), zoom };
  }
  function showSelection(item) {
    selectedRing.geometry.dispose();
    const scale = item.spec.kind === 'business-poi' ? .32 : item.spec.modelScale || 1;
    if (item.spec.kind === 'authored') {
      const positions = [], ring = item.spec.sourceFootprint.map(([x,z]) => [x-item.spec.x,z-item.spec.z]);
      for (let i=0;i<ring.length;i++) {
        const a=ring[i],b=ring[(i+1)%ring.length],quad=[a,b,[b[0]*1.025,b[1]*1.025],[a[0]*1.025,a[1]*1.025]];
        for(const index of [0,1,2,0,2,3]) positions.push(quad[index][0],-quad[index][1],0);
      }
      selectedRing.geometry = makeLineGeometry(positions);
    } else if (waterfrontPlan.getSite(item.spec.id)) {
      const positions = [], inner = 3.6 * scale, outer = 3.72 * scale;
      for (let i = 0; i < 96; i++) {
        const a = i / 96 * Math.PI * 2, b = (i + 1) / 96 * Math.PI * 2;
        const quad = [[Math.cos(a) * inner, Math.sin(a) * inner], [Math.cos(b) * inner, Math.sin(b) * inner], [Math.cos(b) * outer, Math.sin(b) * outer], [Math.cos(a) * outer, Math.sin(a) * outer]];
        if (quad.some(p => inWater(item.spec.x + p[0], item.spec.z + p[1]))) continue;
        for (const index of [0, 1, 2, 0, 2, 3]) positions.push(quad[index][0], -quad[index][1], 0);
      }
      selectedRing.geometry = makeLineGeometry(positions);
    } else selectedRing.geometry = new THREE.RingGeometry(3.6 * scale, 3.72 * scale, 64);
    selectedRing.position.set(item.spec.x, item.base + (item.spec.kind === 'authored' ? 0.008 : waterfrontPlan.getSite(item.spec.id) ? 0.115 : 0.21), item.spec.z); selectedRing.scale.setScalar(1);
    selectedRing.visible = item.spec.kind !== 'bridge' && item.spec.kind !== 'dam';
  }
  function calculateDefaultState(view = currentView) {
    const target = new THREE.Vector3(0, 0.7, 0);
    const position = target.clone().add(getOffset(view));
    const virtualCamera = camera.clone(); virtualCamera.position.copy(position); virtualCamera.up.set(0, 1, 0); virtualCamera.lookAt(target); virtualCamera.updateMatrixWorld();
    const matrix = virtualCamera.matrixWorldInverse;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const highest = Math.max(4, ...[...landmarkMap.values()].filter(item => item.spec.kind !== 'authored').map(item => item.anchor.y));
    // The full footprint and the tallest central details remain inside the view.
    for (const x of [-width / 2, width / 2]) for (const z of [-depth / 2, depth / 2]) for (const y of [-baseThickness, Math.min(highest, 12)]) {
      const p = new THREE.Vector3(x, y, z).applyMatrix4(matrix);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const aspect = widthPx / heightPx;
    const halfHeight = Math.max((maxX - minX) / aspect, maxY - minY) * 0.535;
    const right = new THREE.Vector3().setFromMatrixColumn(virtualCamera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(virtualCamera.matrixWorld, 1);
    const shift = right.multiplyScalar((maxX + minX) / 2).add(up.multiplyScalar((maxY + minY) / 2));
    return { position: position.add(shift), target: target.add(shift), zoom: 1, halfHeight };
  }
  function focusZoomLimit() {
    // A fixed minimum visible world height keeps zoom useful on portrait
    // screens without changing the full-board overview or its camera angle.
    return Math.max(16, baseHalfHeight * 2 / 1.8);
  }
  function setFrustum() {
    controls.maxZoom = focusZoomLimit();
    const aspect = widthPx / heightPx;
    camera.left = -baseHalfHeight * aspect; camera.right = baseHalfHeight * aspect;
    camera.top = baseHalfHeight; camera.bottom = -baseHalfHeight;
    camera.updateProjectionMatrix(); labelsDirty = true;
  }
  function resize(force = false) {
    if (renderScheduler.isPaused() && force !== true) {
      // setSize clears the drawing buffer. Keep the retained city image while
      // an overlay/tab suspends it, then apply the latest dimensions on resume.
      resizePending = true; requestRender(); return;
    }
    resizePending = false;
    const rect = container.getBoundingClientRect();
    const previousHalfHeight = baseHalfHeight;
    widthPx = Math.max(1, rect.width); heightPx = Math.max(1, rect.height);
    renderer.setSize(widthPx, heightPx, false);
    defaultState = calculateDefaultState(currentView); baseHalfHeight = defaultState.halfHeight;
    if (selectedId && managedFocus) {
      const frame = calculateFocusState(landmarkMap.get(selectedId));
      tween = null; camera.position.copy(frame.position); controls.target.copy(frame.target); camera.zoom = frame.zoom;
    } else if (!userMoved && !selectedId) {
      camera.position.copy(defaultState.position); controls.target.copy(defaultState.target); camera.zoom = 1;
    } else if (previousHalfHeight) camera.zoom *= baseHalfHeight / previousHalfHeight;
    setFrustum(); controls.update(); requestRender();
  }
  function transition(target, position, zoom, duration = 1150) {
    tween = {
      started: performance.now(), duration: reducedMotion ? 0 : duration,
      startPosition: camera.position.clone(), startTarget: controls.target.clone(), startZoom: camera.zoom,
      position: position.clone(), target: target.clone(), zoom,
    };
    controls.autoRotate = false; requestRender();
  }
  const onChange = () => { requestRender(); };
  const onStart = () => {
    tween = null; userMoved = true; managedFocus = false; controls.autoRotate = false;
    onInteraction?.({ type: 'orbit' });
    requestRender();
  };
  controls.addEventListener('change', onChange); controls.addEventListener('start', onStart);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function handlePointerDown(event) { lastPointer = { x: event.clientX, y: event.clientY, time: performance.now(), button: event.button }; }
  function handlePointerUp(event) {
    if (!lastPointer || lastPointer.button !== 0 || Math.hypot(event.clientX - lastPointer.x, event.clientY - lastPointer.y) > 6 || performance.now() - lastPointer.time > 700) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const targets = layers.landmarks.visible ? [...pickObjects] : [];
    if (layers.landmarks.visible) for (const {controller} of authoredEntries.values()) targets.push(...controller.getActiveMeshes());
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (hit?.object.userData.landmarkId) onSelect?.(hit.object.userData.landmarkId);
    lastPointer = null;
  }
  function handleContextLost(event) { event.preventDefault(); renderScheduler.setPaused('context-lost', true); onError?.('三维画面连接暂时中断，请刷新页面重新载入。'); }
  renderer.domElement.addEventListener('pointerdown', handlePointerDown);
  renderer.domElement.addEventListener('pointerup', handlePointerUp);
  renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(container);
  resize();
  function publishLabels() {
    if (!onCameraChange) return;
    camera.updateMatrixWorld();
    const labels = [];
    for (const [id, item] of landmarkMap) {
      const p = item.anchor.clone().project(camera);
      const inCurrentScene = layers.landmarks.visible && (item.spec.kind !== 'authored' || Boolean(authoredEntries.get(id)?.controller.getStats().quality));
      labels.push({ id, x: (p.x * 0.5 + 0.5) * widthPx, y: (-p.y * 0.5 + 0.5) * heightPx, visible: inCurrentScene && p.z >= -1 && p.z <= 1 && Math.abs(p.x) < 1.04 && Math.abs(p.y) < 1.04, depth: p.z });
    }
    const direction = camera.position.clone().sub(controls.target);
    const heading = Math.atan2(direction.x, direction.z) * 180 / Math.PI;
    onCameraChange({ labels, heading, width: widthPx, height: heightPx, zoom: camera.zoom });
  }
  function animate(time) {
    if (disposed) return false;
    if (document.hidden) { renderScheduler.setPaused('hidden', true); return false; }
    if (resizePending) resize(true);
    const delta = Math.min(0.05, (time - (lastTime || time)) / 1000); lastTime = time;
    let animating = false;
    if (tween) {
      const t = tween.duration === 0 ? 1 : Math.min((time - tween.started) / tween.duration, 1);
      const k = ease(t);
      camera.position.lerpVectors(tween.startPosition, tween.position, k);
      controls.target.lerpVectors(tween.startTarget, tween.target, k);
      camera.zoom = THREE.MathUtils.lerp(tween.startZoom, tween.zoom, k); camera.updateProjectionMatrix();
      labelsDirty = true; lodDirty = true; animating = true;
      if (t === 1) tween = null;
    }
    const controlsMoving = controls.update(delta);
    if (!authoredStarted && frameNumber >= 2) {
      authoredStarted = true;
      // The city is interactive before its resident lightweight assets load.
      void loadResidentQueue(); void loadResidentQueue();
    }
    if (authoredStarted && !tween && lodDirty) {
      // Camera/model changes invalidate this decision. Boat-only frames and a
      // resting city must not poll seven controllers or churn their LOD state.
      lodDirty = false;
      camera.updateMatrixWorld();
      // One detailed building at a time, even where several towers fill the
      // screen. All other projects keep their resident city model.
      let detailId=null,largest=0;
      for (const {spec,controller} of authoredEntries.values()) {
        const item=landmarkMap.get(spec.id),state=controller.getStats();
        const pixels=item.size.y/(baseHalfHeight*2)*camera.zoom*heightPx;
        const screen=item.center.clone().project(camera);
        const onScreen=layers.landmarks.visible&&Math.abs(screen.x)<1.2&&Math.abs(screen.y)<1.2&&Math.abs(screen.z)<=1;
        const threshold=window.innerWidth<=700?300:430;
        const explicit=selectedId===spec.id&&managedFocus&&currentFocusOptions.close;
        const wanted=onScreen&&(explicit||pixels>threshold*(state.detailRequested ? .78 : 1));
        const score=explicit?Number.MAX_VALUE:pixels;
        if(wanted&&score>largest){detailId=spec.id;largest=score;}
      }
      for(const {spec,controller} of authoredEntries.values()) {
        if(spec.id===detailId)controller.setDetailWanted(true);else controller.releaseDetail();
      }
    }
    motionRunning = Boolean(motionEnabled && selectedId && waterfrontPlan.getSite(selectedId)?.routes.length && camera.zoom > 2 && currentView === 'perspective' && layers.boats.visible && !tween);
    let boatsMoved = false;
    if (motionRunning && time - lastMotionFrame >= 1000 / 30) {
      boatsMoved = waterfront.update(Math.min((time - (lastMotionFrame || time)) / 1000, 0.05), selectedId);
      lastMotionFrame = time;
    } else if (!motionRunning) lastMotionFrame = time;
    // Boat motion redraws at most 30 fps; resting overview remains static.
    const renderNow = labelsDirty || animating || controls.autoRotate || boatsMoved || frameNumber < 3;
    if (renderNow) {
      renderScene();
      renderer.domElement.dataset.modelQuality = selectedAuthored()?.controller.getStats().quality || (residentStats().some(record=>record.quality) ? 'light' : 'loading');
      renderer.domElement.dataset.residentModels = String(residentStats().filter(record=>record.quality).length);
      renderer.domElement.dataset.detailModels = String(residentStats().filter(record=>record.quality==='detail').length);
      renderer.domElement.dataset.businessProjects = String(BUSINESS_BUILDINGS.length);
      renderer.domElement.dataset.authoredModels = String(authoredModels.length);
      renderer.domElement.dataset.modelAnchor = selectedAuthored() ? JSON.stringify(selectedAuthored().controller.group.position.toArray()) : '';
      renderer.domElement.dataset.cityVisible = String(city.visible);
      renderer.domElement.dataset.focusAngle = selectedId ? currentFocusOptions.angle : 'overview';
      renderer.domElement.dataset.drawCalls = String(renderer.info.render.calls);
      renderer.domElement.dataset.triangles = String(renderer.info.render.triangles);
      renderer.domElement.dataset.geometries = String(renderer.info.memory.geometries);
      renderer.domElement.dataset.textures = String(renderer.info.memory.textures);
      if (labelsDirty && (time - lastLabels > 30 || animating || frameNumber < 3)) { publishLabels(); lastLabels = time; labelsDirty = false; }
      frameNumber++;
      if (!readyCalled && frameNumber >= 2) { readyCalled = true; onReady?.(); }
    }
    // Preserve the first three frames: the third starts both resident workers.
    // Afterwards the scene sleeps until a change, including an async load,
    // invalidates it. Damping/auto-rotation/boats keep their own frames alive.
    return Boolean(tween || controlsMoving || controls.autoRotate || motionRunning || labelsDirty || frameNumber < 3 || !authoredStarted);
  }
  function handleVisibility() {
    renderScheduler.setPaused('hidden', document.hidden);
  }
  function handleMotionPreference(event) {
    reducedMotion = event.matches;
    if (reducedMotion) { motionEnabled = false; motionRunning = false; }
    lastMotionFrame = 0;
    requestRender();
  }
  document.addEventListener('visibilitychange', handleVisibility);
  motionMedia?.addEventListener?.('change', handleMotionPreference);
  requestRender();

  return {
    focus(id, options = {}) {
      const item = landmarkMap.get(id); if (!item) return;
      selectedId = id; userMoved = true; managedFocus = true; currentView = 'perspective';
      currentFocusOptions = { angle: ['river', 'front', 'context'].includes(options.angle) ? options.angle : 'detail', close: options.angle !== 'context' && Boolean(options.close) };
      setAuthoredSelection(item.spec.kind === 'authored');
      for(const {spec,controller} of authoredEntries.values()) if(spec.id!==id)controller.releaseDetail();
      selectedAuthored()?.controller.select(id, { detail: currentFocusOptions.close, priority: true });
      const frame = calculateFocusState(item);
      transition(frame.target, frame.position, frame.zoom);
      showSelection(item); requestRender();
    },
    focusCluster(ids) {
      if (disposed || !Array.isArray(ids)) return false;
      const items = [...new Set(ids)].map(id => landmarkMap.get(id)).filter(Boolean);
      if (!items.length) return false;
      const frame = calculateClusterState(items);
      if (!frame) return false;
      controls.autoRotate = false; managedFocus = false; userMoved = true;
      // Drain residual orbit damping without moving the visible camera. The
      // cluster transition must retain the direction the user was looking at.
      const position = camera.position.clone(), target = controls.target.clone(), zoom = camera.zoom;
      const damping = controls.enableDamping;
      controls.enableDamping = false; controls.update();
      camera.position.copy(position); controls.target.copy(target); camera.zoom = zoom;
      camera.updateProjectionMatrix(); controls.update(); controls.enableDamping = damping;
      controls.minZoom = Math.min(controls.minZoom, frame.zoom);
      transition(frame.target, frame.position, frame.zoom, 900);
      onInteraction?.({ type: 'cluster' });
      return true;
    },
    clearSelection() {
      if (authoredSelection) { this.reset(); return; }
      selectedId = null; managedFocus = false; selectedRing.visible = false; motionRunning = false;
      currentFocusOptions = { angle: 'detail', close: false }; requestRender();
    },
    reset() {
      setAuthoredSelection(false);
      selectedId = null; userMoved = false; managedFocus = false; currentView = 'perspective'; selectedRing.visible = false; motionRunning = false;
      currentFocusOptions = { angle: 'detail', close: false };
      defaultState = calculateDefaultState('perspective'); baseHalfHeight = defaultState.halfHeight; setFrustum();
      transition(defaultState.target, defaultState.position, 1);
    },
    setMotion(enabled) {
      // Reduced motion sets the default; an explicit checkbox choice may opt in.
      motionEnabled = Boolean(enabled); lastMotionFrame = 0;
      if (!motionEnabled) motionRunning = false;
      requestRender();
      return motionEnabled;
    },
    setSuspended(value) {
      // The overlay owner pauses only scheduling, never the city scene or its
      // model residents. Motion settings and camera intent survive the pause.
      viewSuspended = Boolean(value);
      renderScheduler.setPaused('overlay', viewSuspended);
      return viewSuspended;
    },
    setTheme(theme) {
      const night = theme === 'night'; currentTheme = night ? 'night' : 'day';
      const palette = night ? NIGHT : DAY;
      scene.background.set(palette.sky);
      for (const record of materialThemes) record.material.color.set(night ? record.night : record.day);
      hemi.color.set(night ? '#abc8ec' : '#f9fbff'); hemi.groundColor.set(night ? '#355a4a' : '#8a9b76'); hemi.intensity = night ? 1.25 : DAY_LIGHT.hemisphere;
      sun.color.set(night ? '#c6dafe' : '#fff4dc'); sun.intensity = night ? 0.95 : DAY_LIGHT.sun;
      fill.intensity = night ? 0.25 : DAY_LIGHT.fill;
      renderer.toneMappingExposure = night ? 1.03 : DAY_LIGHT.exposure;
      floorShadowMaterial.color.set(night ? '#101f25' : '#55614c'); floorShadowMaterial.opacity = night ? 0.16 : 0.23;
      rippleMaterial.opacity = night ? 0.22 : 0.18;
      layers.nightlights.visible = night;
      for (const [mesh, specs] of [[crowns, deciduous], [pineCrowns, pines]]) {
        specs.forEach((tree, i) => mesh.setColorAt(i, new THREE.Color(palette.trees[tree.palette])));
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      for (const item of landmarkMap.values()) if (item.spec.kind !== 'authored') LandmarkFactory.updateLandmarkTheme?.(item.group, night);
      waterfront.setTheme(night);
      for (const {controller} of authoredEntries.values()) controller.setTheme(night);
      requestRender();
    },
    setView(view) {
      const next = view === 'top' ? 'top' : 'perspective'; if (next === currentView) return;
      currentView = next; controls.autoRotate = false; onInteraction?.({ type: 'view' });
      if (selectedId) {
        managedFocus = true;
        const frame = calculateFocusState(landmarkMap.get(selectedId));
        transition(frame.target, frame.position, frame.zoom, 950);
      } else if (userMoved) {
        const target = controls.target.clone(); transition(target, target.clone().add(getOffset(next)), camera.zoom, 950);
      } else {
        defaultState = calculateDefaultState(next);
        const oldHalfHeight = baseHalfHeight; baseHalfHeight = defaultState.halfHeight; camera.zoom *= baseHalfHeight / oldHalfHeight; setFrustum();
        transition(defaultState.target, defaultState.position, 1, 950);
      }
      requestRender();
    },
    setAutoRotate(enabled) {
      // UI also calls false after reset; that must not cancel its transition.
      if (enabled) { tween = null; userMoved = true; managedFocus = false; }
      controls.autoRotate = Boolean(enabled); requestRender();
    },
    setLayer(name, enabled) {
      const key = name === 'greenery' ? 'trees' : name;
      if (layers[key]) layers[key].visible = Boolean(enabled);
      if (key === 'trees') layers.parks.visible = true;
      renderer.shadowMap.needsUpdate = true;
      requestRender();
    },
    zoom(delta) {
      tween = null; userMoved = true; managedFocus = false; controls.autoRotate = false; onInteraction?.({ type: 'zoom' });
      camera.zoom = THREE.MathUtils.clamp(camera.zoom * Math.pow(1.27, Number(delta) || 0), controls.minZoom, controls.maxZoom);
      camera.updateProjectionMatrix(); requestRender();
    },
    getImage() {
      if (disposed) return '';
      if (resizePending && !renderScheduler.isPaused()) resize(true);
      // Saving a postcard is an explicit one-shot render, even when an overlay
      // has suspended the automatic scheduler. It does not resume animation.
      renderScene(); return renderer.domElement.toDataURL('image/png');
    },
    getStats() {
      const alignments = [...landmarkMap.values()].filter(item => !item.spec.business).map(item => {
        const spec = item.spec, group = item.group, record = spec.alignment || {};
        const delta = Math.hypot(group.position.x - spec.x, group.position.z - spec.z);
        return {
          id: spec.id, source: spec.spanSource || record.method || 'source-poi',
          anchorPolicy: record.anchorPolicy || (spec.endpoints ? 'ordered-span-midpoint' : 'fixed-source-poi'),
          sourcePointLonLat: record.sourcePointLonLat || [spec.lon, spec.lat],
          sourceFeatureIds: record.sourceFeatureIds || [], sourceFiles: record.sourceFiles || [],
          resolvedAnchor: [spec.x, spec.z], modelAnchor: [group.position.x, group.position.z],
          anchorOffset: delta, anchorOffsetMeters: delta / (data.meta.unitsPerMeter || 0.02),
          axisHeadingDeg: group.userData.axisHeadingDeg,
          frontHeadingDeg: group.userData.frontAxis ? ((180 - THREE.MathUtils.radToDeg(group.rotation.y)) % 360 + 360) % 360 : null,
          yawRadians: group.rotation.y, scale: group.scale.toArray(),
          endpoints: spec.endpoints, mainSpanEndpoints: spec.mainSpanEndpoints,
        };
      });
      return { alignments, authoredSelection, authoredModels: selectedAuthored()?.controller.getStats() || {}, authoredResidents: residentStats(), authoredReplacedBuildings: [...authoredGround.omittedBuildingIndices], authoredRetainedBackground: authoredGround.retainedBuildings.map(building => building.retainedFromSourceFeatureId), ...waterfront.stats, motionEnabled, motionRunning, motionReduced: reducedMotion, motionFpsLimit: 30, renderState: renderScheduler.getState(), renderFrames: renderedFrames, suspended: viewSuspended, hidden: Boolean(document.hidden), focusAngle: currentFocusOptions.angle, focusClose: currentFocusOptions.close, landmarkOffsets: waterfrontPlan.sites.map(s => ({ id: s.id, source: s.original, model: s.center, distance: s.shift })), buildings: buildingCount, roads: (data.roads || []).length, waterPolygons: waterPolygons.length, parks: parkPolygons.length, trees: treeSpecs.length, landmarks: landmarks.length + BUSINESS_BUILDINGS.length, businessProjects: BUSINESS_BUILDINGS.length, pendingModels: pendingBusiness.length, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, theme: currentTheme, view: currentView, cameraZoom: camera.zoom, terrain: terrainValid ? 'source-grid' : hills.length ? 'illustrative-hills' : 'flat', heightExaggeration: BUILDING_HEIGHT_EXAGGERATION, bridgeSpans: landmarks.filter(l => l.kind === 'bridge').map(l => ({ id: l.id, endpoints: l.endpoints, mainSpanEndpoints: l.mainSpanEndpoints, source: l.spanSource || 'landmark-spec' })), renderer: 'Three.js / WebGL', projection: 'orthographic' };
    },
    retryModel() { selectedAuthored()?.controller.retry(); requestRender(); },
    refitSelection() {
      if (!selectedId || !managedFocus) return;
      const frame = calculateFocusState(landmarkMap.get(selectedId));
      transition(frame.target, frame.position, frame.zoom, 550);
    },
    dispose() {
      if (disposed) return; disposed = true;
      renderScheduler.dispose(); resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility); motionMedia?.removeEventListener?.('change', handleMotionPreference);
      controls.removeEventListener('change', onChange); controls.removeEventListener('start', onStart); controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown); renderer.domElement.removeEventListener('pointerup', handlePointerUp); renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      for (const {controller} of authoredEntries.values()) controller.dispose();
      lightScheduler.dispose();
      authoredEntries.clear();
      const geometries = new Set(), materials = new Set(), textures = new Set();
      scene.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        const objectMaterials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
        for (const material of objectMaterials) { materials.add(material); for (const value of Object.values(material)) if (value?.isTexture) textures.add(value); }
      });
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
      renderer.dispose(); renderer.domElement.remove();
      landmarkMap.clear(); preparedLandmarks.clear();
    },
  };
}
