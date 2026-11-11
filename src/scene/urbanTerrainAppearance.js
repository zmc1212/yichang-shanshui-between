import * as THREE from 'three';

// A visual ground treatment derived from the supplied building footprints.
// It is deliberately not a parcel, land-use, or measured paving dataset.
export function createUrbanTerrainAppearance({ data, inWater = () => false, inPark = () => false, resolution = 512 }) {
  const width = data.meta?.width || 316;
  const depth = data.meta?.depth || 290;
  const units = data.meta?.unitsPerMeter || .02;
  const size = Math.max(64, Math.min(1024, Math.round(resolution)));
  const field = new Float32Array(size * size);
  const bytes = new Uint8Array(size * size * 4);
  const sx = width / size, sz = depth / size;
  const reach = 38 * units, core = 10 * units;
  let sourceBuildings = 0, treatedPixels = 0, protectedPixels = 0;
  for (const building of data.buildings || []) {
    const ring = building.ring || building.rings?.[0];
    if (!ring?.length) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of ring) {
      if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]);
    }
    if (!Number.isFinite(x0)) continue;
    sourceBuildings++;
    const ix0 = Math.max(0, Math.floor((x0 - reach + width / 2) / sx));
    const ix1 = Math.min(size - 1, Math.ceil((x1 + reach + width / 2) / sx));
    const iz0 = Math.max(0, Math.floor((z0 - reach + depth / 2) / sz));
    const iz1 = Math.min(size - 1, Math.ceil((z1 + reach + depth / 2) / sz));
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const x = (ix + .5) * sx - width / 2, z = (iz + .5) * sz - depth / 2;
      const distance = Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
      const weight = 1 - THREE.MathUtils.smoothstep(distance, core, reach);
      field[iz * size + ix] = Math.max(field[iz * size + ix], weight);
    }
  }
  for (let iz = 0; iz < size; iz++) for (let ix = 0; ix < size; ix++) {
    const index = iz * size + ix;
    let weight = field[index];
    if (weight > 0) {
      const x = (ix + .5) * sx - width / 2, z = (iz + .5) * sz - depth / 2;
      if (inWater(x, z) || inPark(x, z)) { weight = 0; protectedPixels++; }
      else treatedPixels++;
    }
    bytes[index * 4] = Math.round(weight * 255);
    bytes[index * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false; texture.needsUpdate = true;
  const uniforms = {
    uUrbanGroundMask: { value: texture },
    uUrbanGroundSize: { value: new THREE.Vector2(width, depth) },
    uUrbanGroundPaving: { value: new THREE.Color('#d5d4c8') },
  };
  let disposed = false;
  return {
    applyToMaterial(material) {
      material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = 'varying vec2 vUrbanGroundXZ;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvUrbanGroundXZ = position.xz;');
        shader.fragmentShader = `varying vec2 vUrbanGroundXZ;
uniform sampler2D uUrbanGroundMask;
uniform vec2 uUrbanGroundSize;
uniform vec3 uUrbanGroundPaving;
` + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
vec2 urbanUv = vUrbanGroundXZ / uUrbanGroundSize + .5;
float urbanBuilt = smoothstep(.06, .82, texture2D(uUrbanGroundMask, urbanUv).r);
float urbanGrain = sin(vUrbanGroundXZ.x * 63.0) * sin(vUrbanGroundXZ.y * 71.0);
float urbanGrainFade = 1.0 - smoothstep(.015, .07, length(fwidth(vUrbanGroundXZ)));
vec3 urbanPaving = uUrbanGroundPaving * (1.0 + .014 * urbanGrain * urbanGrainFade);
diffuseColor.rgb = mix(diffuseColor.rgb, urbanPaving, urbanBuilt * .96);
`);
      };
      material.customProgramCacheKey = () => 'yichang-urban-ground-v1';
      material.needsUpdate = true;
      return material;
    },
    setEnvironment(environment = {}) {
      uniforms.uUrbanGroundPaving.value.set(environment.timeOfDay === 'night' ? '#75817a' : environment.timeOfDay === 'sunset' ? '#d8c9b5' : '#d5d4c8');
    },
    getStats() { return { source: 'building-footprint-derived-visual-treatment', sourceBuildings, treatedPixels, protectedPixels, resolution: size, textures: 1, textureBytes: bytes.byteLength, addedDrawCalls: 0 }; },
    dispose() { if (!disposed) { disposed = true; texture.dispose(); } },
  };
}
