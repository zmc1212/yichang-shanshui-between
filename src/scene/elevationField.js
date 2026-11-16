import * as THREE from 'three';

const finite = Number.isFinite;
const positive = value => finite(value) && value > 0;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Validated, source-preserving elevation grid in the city's local metric frame.
 * Grid values are source elevations in metres; vertical exaggeration is applied
 * only when constructing display geometry, never to the stored samples.
 *
 * Contract:
 * {
 *   schemaVersion: 1,
 *   coordinateSystem: 'city-local-x-east-z-south',
 *   units: 'meters',
 *   width, height, origin: [x, z], spacing: [dx, dz],
 *   noData?: number | null,
 *   values: number[] // row-major, north-to-south is source-defined by origin
 * }
 */
export function validateElevationGrid(grid) {
  const errors = [];
  if (!grid || typeof grid !== 'object') return { valid: false, errors: ['grid must be an object'] };
  if (grid.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (grid.coordinateSystem !== 'city-local-x-east-z-south') errors.push('unsupported coordinateSystem');
  if (grid.units !== 'meters') errors.push('units must be meters');
  if (!Number.isInteger(grid.width) || grid.width < 2) errors.push('width must be an integer >= 2');
  if (!Number.isInteger(grid.height) || grid.height < 2) errors.push('height must be an integer >= 2');
  if (!Array.isArray(grid.origin) || grid.origin.length !== 2 || !grid.origin.every(finite)) errors.push('origin must contain finite [x,z]');
  if (!Array.isArray(grid.spacing) || grid.spacing.length !== 2 || !grid.spacing.every(positive)) errors.push('spacing must contain positive [dx,dz]');
  if (!Array.isArray(grid.values) || grid.values.length !== grid.width * grid.height) errors.push('values length must equal width * height');
  if (Array.isArray(grid.values)) {
    const noData = grid.noData;
    if (grid.values.some(value => value !== noData && !finite(value))) errors.push('values must be finite numbers or the declared noData value');
  }
  return { valid: errors.length === 0, errors };
}

export function createElevationField(grid, { verticalScale = 1 } = {}) {
  const validation = validateElevationGrid(grid);
  if (!validation.valid) throw new TypeError(`Invalid elevation grid: ${validation.errors.join('; ')}`);
  if (!positive(verticalScale)) throw new RangeError('verticalScale must be a finite positive number');

  const { width, height, origin, spacing, values } = grid;
  const noData = grid.noData ?? null;
  const at = (x, z) => {
    if (!finite(x) || !finite(z)) return null;
    const gx = (x - origin[0]) / spacing[0], gz = (z - origin[1]) / spacing[1];
    if (gx < 0 || gz < 0 || gx > width - 1 || gz > height - 1) return null;
    const x0 = Math.floor(gx), z0 = Math.floor(gz);
    const x1 = Math.min(width - 1, x0 + 1), z1 = Math.min(height - 1, z0 + 1);
    const tx = gx - x0, tz = gz - z0;
    const samples = [
      [values[z0 * width + x0], (1 - tx) * (1 - tz)],
      [values[z0 * width + x1], tx * (1 - tz)],
      [values[z1 * width + x0], (1 - tx) * tz],
      [values[z1 * width + x1], tx * tz],
    ].filter(([value, weight]) => value !== noData && finite(value) && weight > 0);
    const weight = samples.reduce((sum, sample) => sum + sample[1], 0);
    if (!weight) return null;
    return samples.reduce((sum, sample) => sum + sample[0] * sample[1], 0) / weight;
  };

  const heightAt = (x, z) => {
    const value = at(x, z);
    return value == null ? null : value * verticalScale;
  };
  const gradientAt = (x, z) => {
    const center = at(x, z);
    if (center == null) return null;
    const left = at(x - spacing[0], z), right = at(x + spacing[0], z);
    const up = at(x, z - spacing[1]), down = at(x, z + spacing[1]);
    const dx = left != null && right != null ? (right - left) / (2 * spacing[0])
      : right != null ? (right - center) / spacing[0]
        : left != null ? (center - left) / spacing[0] : null;
    const dz = up != null && down != null ? (down - up) / (2 * spacing[1])
      : down != null ? (down - center) / spacing[1]
        : up != null ? (center - up) / spacing[1] : null;
    return dx == null || dz == null ? null : { dx: dx * verticalScale, dz: dz * verticalScale };
  };

  const validValues = values.filter(value => value !== noData && finite(value));
  return Object.freeze({
    source: grid.source || null,
    width, height, origin: [...origin], spacing: [...spacing], verticalScale,
    bounds: Object.freeze({
      minX: origin[0], maxX: origin[0] + (width - 1) * spacing[0],
      minZ: origin[1], maxZ: origin[1] + (height - 1) * spacing[1],
    }),
    sample: at, heightAt, gradientAt,
    getStats: () => ({
      width, height, sampleCount: values.length, validSampleCount: validValues.length,
      noDataCount: values.length - validValues.length,
      minElevation: validValues.length ? Math.min(...validValues) : null,
      maxElevation: validValues.length ? Math.max(...validValues) : null,
      verticalScale, source: grid.source || 'unspecified',
    }),
  });
}

/** Build an indexed terrain mesh from the same source grid; no invented fill. */
export function createElevationGeometry(field, { verticalScale = field.verticalScale, baseHeight = 0 } = {}) {
  if (!field?.width || !positive(verticalScale) || !finite(baseHeight)) throw new TypeError('A valid elevation field and finite display options are required');
  const positions = [], indices = [], { width, height, origin, spacing } = field;
  const valid = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const x = origin[0] + col * spacing[0], z = origin[1] + row * spacing[1];
    const elevation = field.sample(x, z);
    const index = row * width + col;
    valid[index] = elevation == null ? 0 : 1;
    positions.push(x, elevation == null ? baseHeight : elevation * verticalScale, z);
  }
  for (let row = 0; row < height - 1; row++) for (let col = 0; col < width - 1; col++) {
    const a = row * width + col, b = a + 1, c = a + width, d = c + 1;
    if (valid[a] && valid[b] && valid[c]) indices.push(a, c, b);
    if (valid[b] && valid[c] && valid[d]) indices.push(b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.elevation = { source: field.source, verticalScale, baseHeight, validVertices: valid.reduce((sum, value) => sum + value, 0) };
  return geometry;
}
