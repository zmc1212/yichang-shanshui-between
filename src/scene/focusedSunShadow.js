import * as THREE from 'three';

const MOVING_INTERVAL_MS = 150;
const RANGE_STEP = 1.2;

function vector(value) {
  const values = Array.isArray(value) ? value : [value?.x, value?.y, value?.z];
  return values.length >= 3 && values.slice(0, 3).every(Number.isFinite)
    ? new THREE.Vector3(...values.slice(0, 3)) : null;
}

function snapClamped(value, step, low, high) {
  return THREE.MathUtils.clamp(Math.round(value / step), Math.ceil(low / step), Math.floor(high / step)) * step;
}

/**
 * Reuses the city's one directional shadow map. Call immediately before an
 * existing render; this helper never schedules frames or changes the viewer.
 * The scene must include sun.target, because Three reads its world matrix.
 */
export function createFocusedSunShadow({ sun, renderer, extent, mapSize = 2048 }) {
  if (!sun?.shadow?.camera?.isOrthographicCamera || !sun.target || !renderer?.shadowMap
    || !Number.isFinite(extent) || extent <= 0 || !Number.isFinite(mapSize) || mapSize < 1) {
    throw new TypeError('Focused sunlight requires a directional shadow, renderer and positive city extent/map size');
  }
  const resolution = Math.round(mapSize);
  const fullRadius = extent * .78;
  const minimumRadius = Math.max(.24, extent * .003);
  const worldLimit = extent * .5;
  const heightBand = extent * .12;
  const worldUp = new THREE.Vector3(0, 1, 0);
  let applied = null, updateCount = 0, deferred = false, lastUpdateAt = -Infinity;

  function overview(offset) {
    return { mode: 'overview', center: new THREE.Vector3(), offset, radius: fullRadius,
      near: 1, far: extent * 4, normalBias: .08, bias: -.0001 };
  }

  function plan({ target, camera, visibleHeight, aspect, offset }) {
    // A complete city view keeps the former coverage and clip distances.
    if (visibleHeight * Math.max(1, aspect) >= extent * .9) return overview(offset);
    const lightDirection = offset.clone().normalize();
    const lightRight = new THREE.Vector3().crossVectors(worldUp, lightDirection);
    if (lightRight.lengthSq() < 1e-8) lightRight.set(1, 0, 0);
    else lightRight.normalize();
    const lightUp = new THREE.Vector3().crossVectors(lightDirection, lightRight).normalize();
    const viewDirection = new THREE.Vector3();
    camera.getWorldDirection(viewDirection).negate();
    // A horizon-facing view has no bounded ground footprint. The finite board
    // fallback is preferable to cutting shadows across visible distant ground.
    if (viewDirection.y < .12) return overview(offset);
    const viewRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const viewUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const halfHeight = visibleHeight * .5, halfWidth = halfHeight * aspect;
    let minR = Infinity, maxR = -Infinity, minU = Infinity, maxU = -Infinity;
    let minD = Infinity, maxD = -Infinity;
    function include(point) {
      // The board is finite. Screen rays beyond it must not enlarge a close
      // neighborhood's map to cover the empty presentation floor.
      point.x = THREE.MathUtils.clamp(point.x, -worldLimit, worldLimit);
      point.z = THREE.MathUtils.clamp(point.z, -worldLimit, worldLimit);
      point.y = THREE.MathUtils.clamp(point.y, 0, heightBand);
      const r = point.dot(lightRight), u = point.dot(lightUp), d = point.dot(lightDirection);
      minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minD = Math.min(minD, d); maxD = Math.max(maxD, d);
    }
    for (const x of [-1, 1]) for (const y of [-1, 1]) {
      const point = target.clone().addScaledVector(viewRight, x * halfWidth).addScaledVector(viewUp, y * halfHeight);
      include(point.clone());
      include(point.clone().addScaledVector(viewDirection, -point.y / viewDirection.y));
    }
    const padding = Math.max(.12, visibleHeight * .045);
    const desiredRadius = Math.max(maxR - minR, maxU - minU) * .5 + padding;
    const radius = minimumRadius * RANGE_STEP ** Math.max(0, Math.ceil(Math.log(desiredRadius / minimumRadius) / Math.log(RANGE_STEP)));
    if (radius >= fullRadius * .96) return overview(offset);
    const texel = radius * 2 / resolution;
    const grid = texel * 4;
    const centerR = snapClamped((minR + maxR) * .5, grid, -fullRadius + radius, fullRadius - radius);
    const centerU = snapClamped((minU + maxU) * .5, grid, -fullRadius + radius, fullRadius - radius);
    const depthGrid = Math.max(.01, texel * 8);
    const centerD = snapClamped(target.dot(lightDirection), depthGrid, -extent, extent);
    const center = lightRight.clone().multiplyScalar(centerR)
      .addScaledVector(lightUp, centerU).addScaledVector(lightDirection, centerD);
    // A caster above a receiver shares its light-space X/Y. Reserve the full
    // city's height band along the light ray, rather than blurring every close
    // view with a city-height-sized X/Y rectangle. The lower margin includes
    // terrain, podiums and the miniature's slab.
    const casterDepth = heightBand / Math.max(.15, Math.abs(lightDirection.y));
    const depthStep = Math.max(.1, extent * .005);
    const halfDepth = Math.ceil((Math.max(Math.abs(minD - centerD), Math.abs(maxD - centerD))
      + casterDepth + extent * .04) / depthStep) * depthStep;
    const distance = offset.length();
    const near = Math.max(.1, distance - halfDepth), far = distance + halfDepth;
    return { mode: 'focused', center, offset, radius, near, far,
      normalBias: THREE.MathUtils.clamp(texel * .18, .00025, .08),
      bias: -THREE.MathUtils.clamp(texel * .08 / (far - near), .0000001, .0001) };
  }

  function same(a, b) {
    return a && a.mode === b.mode && a.center.distanceToSquared(b.center) < 1e-16
      && a.offset.distanceToSquared(b.offset) < 1e-16
      && ['radius', 'near', 'far', 'normalBias', 'bias'].every(key => Math.abs(a[key] - b[key]) < 1e-10);
  }

  return {
    update({ target, camera, visibleHeight, aspect = 1, sunOffset, settled = true, time } = {}) {
      const focus = vector(target), offset = vector(sunOffset);
      if (!focus || !offset || offset.lengthSq() < 1e-6 || !camera?.isCamera
        || !Number.isFinite(visibleHeight) || visibleHeight <= 0 || !Number.isFinite(aspect) || aspect <= 0) return false;
      const next = plan({ target: focus, camera, visibleHeight, aspect, offset });
      const lightMoved = sun.target.position.distanceToSquared(next.center) >= 1e-16
        || sun.position.distanceToSquared(next.center.clone().add(next.offset)) >= 1e-16;
      if (same(applied, next) && !lightMoved) { deferred = false; return false; }
      const now = Number.isFinite(time) ? time : performance.now();
      // An environment preset may have restored the old absolute sun position.
      // Repair that immediately, even if its direction or weather is unchanged.
      const lightChanged = !applied || applied.offset.distanceToSquared(offset) >= 1e-16
        || (same(applied, next) && lightMoved);
      if (!settled && !lightChanged && now >= lastUpdateAt && now - lastUpdateAt < MOVING_INTERVAL_MS) {
        deferred = true; return false;
      }
      const shadowCamera = sun.shadow.camera;
      sun.target.position.copy(next.center);
      sun.position.copy(next.center).add(next.offset);
      // Keep matrices valid for both the real renderer and explicit captures.
      sun.target.updateMatrixWorld(); sun.updateMatrixWorld();
      shadowCamera.left = shadowCamera.bottom = -next.radius;
      shadowCamera.right = shadowCamera.top = next.radius;
      shadowCamera.near = next.near; shadowCamera.far = next.far;
      shadowCamera.updateProjectionMatrix();
      sun.shadow.mapSize.set(resolution, resolution);
      sun.shadow.normalBias = next.normalBias; sun.shadow.bias = next.bias;
      renderer.shadowMap.needsUpdate = true;
      applied = next; lastUpdateAt = now; updateCount++; deferred = false;
      return true;
    },
    getStats() {
      return { mode: applied?.mode || 'pending', mapSize: resolution, updates: updateCount, deferred,
        radius: applied?.radius ?? null, texelWorld: applied ? applied.radius * 2 / resolution : null,
        normalBias: applied?.normalBias ?? null, bias: applied?.bias ?? null,
        near: applied?.near ?? null, far: applied?.far ?? null,
        target: applied?.center.toArray() || null, lastUpdateAt: Number.isFinite(lastUpdateAt) ? lastUpdateAt : null };
    },
  };
}
