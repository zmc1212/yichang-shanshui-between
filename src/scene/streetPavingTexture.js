import * as THREE from 'three';

// One shared, opaque stone atlas. The pattern is illustrative paving, not a
// claim about the materials or paving dimensions of the real building parcel.
// Mipmaps average the narrow joints away when they occupy less than a pixel.
export function createStreetPavingTexture() {
  const size = 256, tile = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const row = Math.floor(y / tile), shiftedX = (x + (row % 2) * tile / 2) % size;
    const col = Math.floor(shiftedX / tile), u = shiftedX % tile, v = y % tile;
    const edge = Math.min(u, tile - 1 - u, v, tile - 1 - v);
    const grain = ((x * 73 + y * 151 + x * y * 7) % 11) - 5;
    const panel = ((col * 7 + row * 11) % 5) * 1.5;
    const value = edge < 1 ? 187 : edge < 2 ? 223 : 247 - panel + grain * .45;
    const offset = (y * size + x) * 4;
    data[offset] = data[offset + 1] = data[offset + 2] = Math.round(value);
    data[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = 'Shared illustrative stone paving';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export function streetPavingFrame(site) {
  const court = site.paving.find(cell => cell.role === 'forecourt') || site.paving[0];
  const dx = court.points[1][0] - court.points[0][0], dz = court.points[1][1] - court.points[0][1];
  const length = Math.hypot(dx, dz) || 1;
  return { origin: site.sourceAnchor, tangent: [dx / length, dz / length], units: site.units };
}

export function streetPavingUv(point, frame) {
  const dx = point[0] - frame.origin[0], dz = point[1] - frame.origin[1], [tx, tz] = frame.tangent;
  // Four staggered courses in a repeat. Shared plane coordinates, rather
  // than per-cell UVs, keep the planner's adjoining slabs visually continuous.
  return [(dx * tx + dz * tz) / (4.8 * frame.units), (-dx * tz + dz * tx) / (2.4 * frame.units)];
}
