import * as THREE from 'three';

// Illustrative facade articulation for the existing GIS extrusions. These are
// neither surveyed windows nor replacements for the 23 authored GLB models.
// The attribute survives the existing six geometry batches; no window meshes,
// textures, material groups, animation loop or additional draw calls are used.
const ATTRIBUTE = 'urbanBuilding';
const VERSION = 'yichang-urban-facades-v2';
const DEFAULT_UNITS_PER_METER = .02;

function stableSeed(value) {
  let hash = 2166136261;
  for (const character of String(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return (hash % 65521) / 65521;
}

export function urbanBuildingFrame({ base = 0, height, sourceHeight, sourceId = '' } = {}, unitsPerMeter = DEFAULT_UNITS_PER_METER) {
  if (!Number.isFinite(base) || !Number.isFinite(height) || height <= 0) return null;
  const units = Number.isFinite(unitsPerMeter) && unitsPerMeter > 0 ? unitsPerMeter : DEFAULT_UNITS_PER_METER;
  const rawHeight = Number.isFinite(sourceHeight) && sourceHeight > 0 ? sourceHeight : height;
  // Preserve the source's relative storey count when the miniature exaggerates
  // heights. Nearby registered buildings already reduce that exaggeration.
  const storeys = THREE.MathUtils.clamp(Math.round(rawHeight / (3.3 * units)), 1, 80);
  return { base, height, floorHeight: height / storeys, seed: stableSeed(sourceId), storeys };
}

const VERTEX_DECLARATIONS = `
attribute vec4 urbanBuilding;
varying vec3 vUrbanSurface;
varying vec3 vUrbanBuilding;
varying vec2 vUrbanRoofPosition;`;

const VERTEX_POSITION = `
// Extruded wall normals are flat and horizontal; their tangent gives a local
// horizontal facade axis even on oblique source polygons.
vec2 urbanTangent = vec2(normal.z, -normal.x);
urbanTangent /= max(length(urbanTangent), .0001);
vUrbanSurface = vec3(dot(position.xz, urbanTangent), position.y - urbanBuilding.x, abs(normal.y));
vUrbanBuilding = urbanBuilding.yzw;
vUrbanRoofPosition = position.xz;`;

const FRAGMENT_DECLARATIONS = `
varying vec3 vUrbanSurface;
varying vec3 vUrbanBuilding;
varying vec2 vUrbanRoofPosition;
uniform float uUrbanUnits;
uniform float uUrbanLampStrength;
uniform vec3 uUrbanGlass;
uniform vec3 uUrbanRoofShade;

float urbanRectangle(vec2 point, vec2 low, vec2 high, vec2 feather) {
  vec2 a = smoothstep(low - feather, low + feather, point);
  vec2 b = 1.0 - smoothstep(high - feather, high + feather, point);
  return a.x * a.y * b.x * b.y;
}`;

const FRAGMENT_COLOR = `
float urbanRoof = smoothstep(.55, .85, vUrbanSurface.z);
float urbanWall = 1.0 - urbanRoof;
float urbanHeight = max(vUrbanBuilding.x, .001);
float urbanFloor = max(vUrbanBuilding.y, .001);
float urbanSeed = vUrbanBuilding.z;
float urbanFamily = step(.58, urbanSeed);
vec2 urbanUv = vec2(vUrbanSurface.x / (uUrbanUnits * mix(2.7, 3.35, urbanFamily)), vUrbanSurface.y / urbanFloor);
urbanUv.x += urbanSeed * 13.0;
vec2 urbanDerivative = max(fwidth(urbanUv), vec2(.0001));
// Subpixel windows disappear into a quiet wall color, rather than producing
// distant checkerboard noise or shimmering while orbiting the whole city.
float urbanDetail = 1.0 - smoothstep(.28, .72, max(urbanDerivative.x, urbanDerivative.y));
vec2 urbanCell = fract(urbanUv);
vec2 urbanFeather = min(urbanDerivative * .7, vec2(.16));
float urbanWindows = urbanRectangle(urbanCell, vec2(mix(.20, .09, urbanFamily), .24), vec2(mix(.80, .91, urbanFamily), .78), urbanFeather);
float urbanUpperClearance = 1.0 - smoothstep(urbanHeight - urbanFloor * .24, urbanHeight - urbanFloor * .06, vUrbanSurface.y);
urbanWindows *= urbanWall * urbanDetail * urbanUpperClearance;
float urbanGlassVariation = .87 + .13 * fract(floor(urbanUv.x) * .618 + floor(urbanUv.y) * .382 + urbanSeed * 11.0);
vec3 urbanGlassColor = uUrbanGlass * urbanGlassVariation;
diffuseColor.rgb = mix(diffuseColor.rgb, urbanGlassColor, urbanWindows * .78);
float urbanJointDistance = min(urbanCell.y, 1.0 - urbanCell.y);
float urbanJoint = (1.0 - smoothstep(.015, .055 + urbanDerivative.y * .45, urbanJointDistance)) * urbanDetail * urbanWall;
diffuseColor.rgb *= 1.0 - urbanJoint * .075;
// A shallow darker base and a light top band ground the block without adding
// footprint pads, invented podiums or surfaces that could cover adjacent roads.
float urbanBaseShade = mix(.76, 1.0, smoothstep(0.0, urbanFloor * .36, vUrbanSurface.y));
diffuseColor.rgb *= mix(1.0, urbanBaseShade, urbanWall);
float urbanCornice = smoothstep(urbanHeight - urbanFloor * .13, urbanHeight - urbanFloor * .025, vUrbanSurface.y) * urbanWall;
diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * 1.025, urbanCornice * .48);
diffuseColor.rgb *= mix(vec3(1.0), uUrbanRoofShade * (.91 + .12 * urbanSeed), urbanRoof);
vec2 urbanRoofUv = vUrbanRoofPosition / (uUrbanUnits * 5.5) + urbanSeed;
vec2 urbanRoofCell = fract(urbanRoofUv);
vec2 urbanRoofDerivative = max(fwidth(urbanRoofUv), vec2(.0001));
float urbanRoofDetail = 1.0 - smoothstep(.25, .7, max(urbanRoofDerivative.x, urbanRoofDerivative.y));
float urbanRoofJoint = 1.0 - smoothstep(.015, .045 + max(urbanRoofDerivative.x, urbanRoofDerivative.y) * .5,
  min(min(urbanRoofCell.x, 1.0 - urbanRoofCell.x), min(urbanRoofCell.y, 1.0 - urbanRoofCell.y)));
diffuseColor.rgb *= 1.0 - urbanRoof * urbanRoofDetail * urbanRoofJoint * .055;
float urbanOccupied = step(.82, fract(sin(dot(floor(urbanUv) + urbanSeed * 71.0, vec2(12.9898, 78.233))) * 43758.5453));`;

export function createUrbanBuildingAppearance({ unitsPerMeter = DEFAULT_UNITS_PER_METER } = {}) {
  const units = Number.isFinite(unitsPerMeter) && unitsPerMeter > 0 ? unitsPerMeter : DEFAULT_UNITS_PER_METER;
  const uniforms = {
    uUrbanUnits: { value: units },
    uUrbanLampStrength: { value: 0 },
    uUrbanGlass: { value: new THREE.Color('#71858b') },
    uUrbanRoofShade: { value: new THREE.Vector3(.57, .63, .64) },
  };
  const materials = new Set();
  let preparedBuildings = 0, preparedVertices = 0, disposed = false;
  return {
    prepareGeometry(geometry, spec) {
      if (disposed) return false;
      const position = geometry?.getAttribute?.('position'), frame = urbanBuildingFrame(spec, units);
      if (!position || !frame) return false;
      const values = new Float32Array(position.count * 4);
      for (let i = 0; i < position.count; i++) {
        const offset = i * 4;
        values[offset] = frame.base; values[offset + 1] = frame.height;
        values[offset + 2] = frame.floorHeight; values[offset + 3] = frame.seed;
      }
      geometry.setAttribute(ATTRIBUTE, new THREE.BufferAttribute(values, 4));
      preparedBuildings++; preparedVertices += position.count;
      return true;
    },
    applyToMaterial(material) {
      if (disposed || materials.has(material)) return material;
      if (!material?.isMeshStandardMaterial) throw new TypeError('Urban building appearance requires MeshStandardMaterial.');
      const previousCompile = material.onBeforeCompile, previousCacheKey = material.customProgramCacheKey();
      material.onBeforeCompile = function (shader, renderer) {
        previousCompile.call(this, shader, renderer);
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\n${VERTEX_DECLARATIONS}`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_POSITION}`);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\n${FRAGMENT_DECLARATIONS}`)
          .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_COLOR}`)
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, .72, .38) * urbanWindows * urbanOccupied * uUrbanLampStrength;`);
      };
      material.customProgramCacheKey = () => `${previousCacheKey}:${VERSION}`;
      // Un-tonemapped white blocks clipped under the existing bright sun.
      material.toneMapped = true;
      material.needsUpdate = true;
      materials.add(material);
      return material;
    },
    setEnvironment(value = {}) {
      const time = typeof value === 'string' ? value : value.timeOfDay;
      const night = time === 'night', sunset = time === 'sunset';
      uniforms.uUrbanGlass.value.set(night ? '#405960' : sunset ? '#858b89' : '#71858b');
      uniforms.uUrbanRoofShade.value.set(...(night ? [.64, .72, .76] : sunset ? [.65, .61, .55] : [.57, .63, .64]));
      uniforms.uUrbanLampStrength.value = night ? .24 : sunset ? .055 : 0;
    },
    getStats() {
      return { shader: VERSION, preparedBuildings, preparedVertices, attributeBytes: preparedVertices * 16,
        materials: materials.size, additionalDrawCalls: 0, textures: 0, details: 'derivative-filtered illustrative facades' };
    },
    dispose() { disposed = true; materials.clear(); },
  };
}
