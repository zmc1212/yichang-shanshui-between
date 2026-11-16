import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createElevationField, createElevationGeometry, validateElevationGrid } from '../src/scene/elevationField.js';

const grid = {
  schemaVersion: 1, coordinateSystem: 'city-local-x-east-z-south', units: 'meters',
  width: 3, height: 3, origin: [-10, -20], spacing: [10, 10],
  noData: -9999, source: 'synthetic-fixture-only',
  values: [100, 110, 120, 110, 120, 130, 120, 130, 140],
};
let passed = 0;
const check = (name, run) => { run(); passed++; console.log(`PASS ${name}`); };

check('validates the explicit local-metric grid contract', () => {
  assert.equal(validateElevationGrid(grid).valid, true);
  assert.equal(validateElevationGrid({ ...grid, spacing: [0, 10] }).valid, false);
  assert.equal(validateElevationGrid({ ...grid, values: [1] }).valid, false);
});
check('bilinear sampling preserves metre elevations and bounds', () => {
  const field = createElevationField(grid);
  assert.equal(field.sample(-10, -20), 100);
  assert.equal(field.sample(-5, -15), 110);
  assert.equal(field.sample(0, 0), 130);
  assert.equal(field.sample(1, 0), null);
  assert.deepEqual(field.bounds, { minX: -10, maxX: 10, minZ: -20, maxZ: 0 });
});
check('nodata is not silently converted into zero elevation', () => {
  const field = createElevationField({ ...grid, values: [100, -9999, 120, 110, 120, 130, 120, 130, 140] });
  assert.equal(field.sample(-10, -20), 100);
  assert.equal(field.sample(10, -20), 120);
  assert.equal(field.sample(-5, -20), 100);
  assert.equal(field.getStats().noDataCount, 1);
});
check('gradient uses source spacing and applies display scale only on request', () => {
  const field = createElevationField(grid, { verticalScale: 2 });
  assert.deepEqual(field.gradientAt(-5, -10), { dx: 1, dz: 1 });
  assert.equal(field.heightAt(-5, -15), 220);
  assert.equal(field.sample(-5, -15), 110);
});
check('terrain geometry is finite, indexed, and omits triangles touching nodata', () => {
  const field = createElevationField({ ...grid, values: [100, 110, 120, 110, -9999, 130, 120, 130, 140] });
  const geometry = createElevationGeometry(field);
  const positions = geometry.getAttribute('position');
  assert.equal(positions.count, 9);
  assert(positions.array.every(Number.isFinite));
  assert.equal(geometry.index.count, 3);
  assert(geometry.getAttribute('normal').array.every(Number.isFinite));
  assert.equal(geometry.userData.elevation.validVertices, 8);
  geometry.dispose();
});
console.log(`\n${passed} elevation-field checks passed.`);
