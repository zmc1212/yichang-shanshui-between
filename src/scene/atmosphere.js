import * as THREE from 'three';

export const DEFAULT_ENVIRONMENT = Object.freeze({ timeOfDay: 'day', weather: 'clear' });
const TIMES = new Set(['day', 'sunset', 'night']);
const WEATHER = new Set(['clear', 'overcast', 'mist', 'rain']);

// These are authored visual presets, not live weather or an astronomical clock.
export function normalizeEnvironment(value = {}, previous = DEFAULT_ENVIRONMENT) {
  const next = value && typeof value === 'object' ? value : {};
  return {
    timeOfDay: TIMES.has(next.timeOfDay) ? next.timeOfDay : TIMES.has(previous?.timeOfDay) ? previous.timeOfDay : 'day',
    weather: WEATHER.has(next.weather) ? next.weather : WEATHER.has(previous?.weather) ? previous.weather : 'clear',
  };
}

const LIGHT = {
  day: {
    sky: '#f0f0e7', ambient: '#f2f7fc', ground: '#829475', sunColor: '#fff3df',
    sun: 2.12, hemisphere: 1.16, fill: .28, exposure: 1.02,
    sunPosition: [-.55, 1.3, .65], shadowColor: '#586653', shadowOpacity: .22,
    water: '#519eb7', shore: '#aed9d7', treeWarmth: 0,
  },
  sunset: {
    sky: '#f1e4d5', ambient: '#f4dfce', ground: '#8c856d', sunColor: '#ffcd96',
    sun: 2.52, hemisphere: 1.02, fill: .3, exposure: 1.02,
    sunPosition: [-1.08, .58, .48], shadowColor: '#7b655a', shadowOpacity: .23,
    water: '#679ca9', shore: '#dfcfb0', treeWarmth: .065,
  },
  night: {
    sky: '#192d36', ambient: '#bed4ee', ground: '#355548', sunColor: '#cadcff',
    sun: .88, hemisphere: 1.14, fill: .27, exposure: 1.01,
    sunPosition: [-.6, 1.15, .4], shadowColor: '#101f25', shadowOpacity: .17,
    water: '#286b83', shore: '#6ca0ad', treeWarmth: 0,
  },
};
const CONDITIONS = {
  clear: { sun: 1, ambient: 1, gray: 0, shadow: 1, roughness: .44, shimmer: 1 },
  overcast: { sun: .32, ambient: 1.16, gray: .26, shadow: .55, roughness: .56, shimmer: .3 },
  mist: { sun: .62, ambient: 1.1, gray: .16, shadow: .66, roughness: .51, shimmer: .4, fog: [1.38, 3.1] },
  rain: { sun: .28, ambient: 1.08, gray: .4, shadow: .44, roughness: .32, shimmer: .45, fog: [1.32, 3.7] },
};

export function environmentProfile(value) {
  const environment = normalizeEnvironment(value);
  const light = LIGHT[environment.timeOfDay], weather = CONDITIONS[environment.weather];
  const gray = environment.timeOfDay === 'night' ? '#273b43' : '#ccd8d3';
  const sky = new THREE.Color(light.sky).lerp(new THREE.Color(gray), weather.gray);
  return {
    ...light, ...environment, sky, lamps: environment.timeOfDay !== 'day',
    sun: light.sun * weather.sun,
    hemisphere: light.hemisphere * weather.ambient,
    shadowOpacity: light.shadowOpacity * weather.shadow,
    roughness: weather.roughness, shimmer: weather.shimmer,
    fog: weather.fog || null,
  };
}

// Only shade existing relief. A flat data source stays flat and geographic
// features, model elevations and the original surface-height function survive.
export function terrainColorFactors({ x = 0, z = 0, height = 0, slope = 0, extent = 300 } = {}) {
  const elevation = THREE.MathUtils.clamp(height / Math.max(1, extent * .025), 0, 1);
  const steepness = THREE.MathUtils.clamp(slope * 1.8, 0, 1);
  const variation = Math.sin(x * .045 + z * .023) * .017 + Math.cos(z * .062 - x * .014) * .013;
  const shade = 1 + variation - elevation * .13 - steepness * .07;
  return [shade * (1 - elevation * .035), shade * (1 + elevation * .018), shade * (1 + elevation * .055)];
}

export function addRiverSurface(material) {
  const uniforms = {
    uRiverTime: { value: 0 }, uRiverShimmer: { value: 1 },
    uRiverSunset: { value: 0 }, uRiverNight: { value: 0 }, uRiverRain: { value: 0 },
  };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRiverPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRiverPosition = position.xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vRiverPosition;
        uniform float uRiverTime;
        uniform float uRiverShimmer;
        uniform float uRiverSunset;
        uniform float uRiverNight;
        uniform float uRiverRain;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 p = vRiverPosition;
        float current = sin(p.x * .071 + p.y * .039) * .035 + cos(p.y * .052) * .025;
        float waveA = sin(p.x * 2.3 + p.y * .54 + uRiverTime * .52);
        float waveB = sin(p.x * .91 - p.y * 1.31 - uRiverTime * .32);
        float fine = pow(max(0.0, waveA * .55 + waveB * .45), 10.0);
        float reflection = .32 + .68 * pow(max(0.0, sin(p.x * .024 + p.y * .011 + .8)), 3.0);
        float glint = fine * reflection * .13 * uRiverShimmer;
        vec3 reflectionColor = mix(vec3(.82, .96, .96), vec3(1.0, .78, .48), uRiverSunset);
        reflectionColor = mix(reflectionColor, vec3(.43, .72, .88), uRiverNight);
        diffuseColor.rgb *= 1.0 + current + waveA * .017 + waveB * .013;
        diffuseColor.rgb += reflectionColor * glint;
        float rainRipple = pow(max(0.0, sin(p.x * 5.1 + p.y * 4.3 - uRiverTime * 2.1)), 22.0);
        diffuseColor.rgb += vec3(.016, .023, .024) * rainRipple * uRiverRain;`);
  };
  material.customProgramCacheKey = () => 'yichang-river-surface-v1';
  material.needsUpdate = true;
  let elapsed = 0;
  return {
    setEnvironment(value) {
      const profile = environmentProfile(value);
      uniforms.uRiverShimmer.value = profile.shimmer;
      uniforms.uRiverSunset.value = profile.timeOfDay === 'sunset' ? 1 : 0;
      uniforms.uRiverNight.value = profile.timeOfDay === 'night' ? 1 : 0;
      uniforms.uRiverRain.value = profile.weather === 'rain' ? 1 : 0;
      material.roughness = profile.roughness;
    },
    update(delta) {
      elapsed += THREE.MathUtils.clamp(Number(delta) || 0, 0, .06);
      uniforms.uRiverTime.value = elapsed;
    },
    getStats() { return { time: elapsed, shader: 'procedural-river-v1', textures: 0 }; },
  };
}

function seededRandom(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

// One line batch, no sprites or textures, and no lights/shadows per raindrop.
// Rain stays on the finite miniature, with a camera-sized volume in close-ups.
export function createRainEffect({ width, depth, heightAt, count = 640 }) {
  count = THREE.MathUtils.clamp(Math.round(Number(count) || 640), 1, 900);
  const random = seededRandom(20261112);
  const seeds = Array.from({ length: count }, () => ({ x: random(), z: random(), phase: random(), length: .65 + random() * .7, ground: 0 }));
  const positions = new Float32Array(count * 6);
  const geometry = new THREE.BufferGeometry();
  const attribute = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', attribute);
  const material = new THREE.LineBasicMaterial({ color: '#e1eeeb', transparent: true, opacity: .34, depthWrite: false, toneMapped: false });
  const group = new THREE.Group(); group.name = 'atmospheric rain'; group.visible = false;
  const drops = new THREE.LineSegments(geometry, material); drops.name = 'light rain line batch'; drops.frustumCulled = false; group.add(drops);
  let environment = DEFAULT_ENVIRONMENT, elapsed = 0, viewport = null;
  let x0 = -width / 2, z0 = -depth / 2, spreadX = width, spreadZ = depth, volumeHeight = Math.max(width, depth) * .13;
  let disposed = false;
  function write() {
    for (let i = 0; i < count; i++) {
      const seed = seeds[i], offset = i * 6;
      const phase = ((seed.phase - elapsed * .48) % 1 + 1) % 1;
      const x = x0 + seed.x * spreadX, z = z0 + seed.z * spreadZ;
      const length = Math.max(.06, volumeHeight * .028 * seed.length);
      const top = seed.ground + .12 + phase * volumeHeight;
      const bottom = Math.max(seed.ground + .04, top - length);
      positions[offset] = x; positions[offset + 1] = top; positions[offset + 2] = z;
      positions[offset + 3] = Math.min(width / 2, x + (top - bottom) * .16);
      positions[offset + 4] = bottom;
      positions[offset + 5] = Math.min(depth / 2, z + (top - bottom) * .05);
    }
    attribute.needsUpdate = true;
  }
  function setViewport({ target, visibleHeight, aspect = 1 }) {
    if (disposed || !target || !Number.isFinite(visibleHeight)) return false;
    const next = [Number(target.x) || 0, Number(target.y) || 0, Number(target.z) || 0, visibleHeight, aspect];
    if (viewport && next.every((v, i) => Math.abs(v - viewport[i]) < (i < 3 ? .04 : .001))) return false;
    viewport = next;
    spreadX = Math.min(width, Math.max(.9, visibleHeight * Math.max(.5, aspect) * 1.2));
    spreadZ = Math.min(depth, Math.max(.9, visibleHeight * 1.45));
    x0 = THREE.MathUtils.clamp(target.x - spreadX / 2, -width / 2, width / 2 - spreadX);
    z0 = THREE.MathUtils.clamp(target.z - spreadZ / 2, -depth / 2, depth / 2 - spreadZ);
    volumeHeight = THREE.MathUtils.clamp(visibleHeight * .8, .6, Math.max(width, depth) * .13);
    seeds.forEach(seed => {
      seed.ground = Math.max(0, (Number(target.y) || 0) - volumeHeight * .3,
        Number(heightAt(x0 + seed.x * spreadX, z0 + seed.z * spreadZ)) || 0);
    });
    write(); return true;
  }
  setViewport({ target: { x: 0, z: 0 }, visibleHeight: Math.max(width, depth), aspect: width / depth });
  return {
    group,
    setEnvironment(value) {
      environment = normalizeEnvironment(value);
      group.visible = environment.weather === 'rain';
      material.color.set(environment.timeOfDay === 'night' ? '#88b9cb' : environment.timeOfDay === 'sunset' ? '#eddfca' : '#dcebea');
      material.opacity = environment.timeOfDay === 'night' ? .32 : .36;
    },
    setViewport,
    update(delta) {
      if (disposed || !group.visible) return false;
      elapsed += THREE.MathUtils.clamp(Number(delta) || 0, 0, .06); write(); return true;
    },
    getStats() { return { enabled: group.visible, drops: count, drawCalls: group.visible ? 1 : 0, elapsed }; },
    dispose() { disposed = true; geometry.dispose(); material.dispose(); group.removeFromParent(); },
  };
}
