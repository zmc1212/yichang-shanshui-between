import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Small, hand-built exhibit models for the Yichang miniature.
 * Coordinates are world units (1 m = .02 units in the city). Architecture is
 * intentionally enlarged and simplified for recognition; these are not surveyed
 * reconstructions. Every model stands on y=0 and is centred at local x=z=0.
 */
const DAY = {
  ivory: '#f0e7d1', stone: '#d6cbb0', cream: '#fff3d7',
  red: '#a9573e', redDark: '#6d3b30', teal: '#396c5a',
  roof: '#567966', roofLight: '#6e8a67', gold: '#c8a263',
  glass: '#496e66', dark: '#3b514b', water: '#83c5c5',
  foam: '#d9edda', foliage: '#6d955d', foliageLight: '#92ad70',
  foliageDark: '#3f7357', trunk: '#82644a', road: '#c2bea8',
  cable: '#f7edd7', lantern: '#edb75a', lawn: '#a6bd7c',
};
const NIGHT = {
  ivory: '#c4c6b2', stone: '#949d90', cream: '#e1d6b7',
  red: '#895246', redDark: '#503c37', teal: '#31584e',
  roof: '#3c655b', roofLight: '#527568', gold: '#b3945e',
  glass: '#e7bb70', dark: '#344a45', water: '#559aab',
  foam: '#b2d9cf', foliage: '#507a5b', foliageLight: '#729266',
  foliageDark: '#305e4f', trunk: '#615847', road: '#8c9a91',
  cable: '#d5d7bd', lantern: '#ffd891', lawn: '#72915f',
};
const UP = new THREE.Vector3(0, 1, 0);
const TMP = new THREE.Object3D();
const clamp = THREE.MathUtils.clamp;

// Accumulate by palette role so a pavilion's many tiles, pillars and rails are
// rendered in a handful of batches instead of hundreds of individual meshes.
class ModelBuilder {
  constructor() { this.batches = new Map(); }
  add(geometry, role, x = 0, y = 0, z = 0, rotation = null, scale = null) {
    TMP.position.set(x, y, z);
    TMP.quaternion.identity();
    if (rotation instanceof THREE.Quaternion) TMP.quaternion.copy(rotation);
    else if (rotation) TMP.rotation.set(rotation[0] || 0, rotation[1] || 0, rotation[2] || 0);
    TMP.scale.set(scale?.[0] ?? 1, scale?.[1] ?? 1, scale?.[2] ?? 1);
    TMP.updateMatrix();
    const geo = geometry.index ? geometry.toNonIndexed() : geometry;
    if (geo !== geometry) geometry.dispose();
    geo.deleteAttribute('uv');
    geo.deleteAttribute('uv1');
    geo.applyMatrix4(TMP.matrix);
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    const list = this.batches.get(role) || [];
    list.push(geo);
    this.batches.set(role, list);
  }
  box(role, x, y, z, w, h, d, rot = null) {
    this.add(new THREE.BoxGeometry(w, h, d), role, x, y, z, rot);
  }
  cyl(role, x, y, z, radius, height, segments = 10, topRadius = radius) {
    this.add(new THREE.CylinderGeometry(topRadius, radius, height, segments), role, x, y, z);
  }
  rod(role, a, b, radius = .035, segments = 5) {
    const av = new THREE.Vector3(...a), bv = new THREE.Vector3(...b);
    const delta = bv.clone().sub(av), length = delta.length();
    if (length < .00001) return;
    const centre = av.clone().add(bv).multiplyScalar(.5);
    this.add(new THREE.CylinderGeometry(radius, radius, length, segments), role,
      centre.x, centre.y, centre.z, new THREE.Quaternion().setFromUnitVectors(UP, delta.normalize()));
  }
  line(role, pts, radius = .025, segments = 5) {
    for (let i = 1; i < pts.length; i++) this.rod(role, pts[i - 1], pts[i], radius, segments);
  }
  finish(group) {
    for (const [role, geometries] of this.batches) {
      const merged = mergeGeometries(geometries, false);
      geometries.forEach(g => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const material = new THREE.MeshStandardMaterial({
        color: DAY[role] || DAY.stone,
        roughness: role === 'glass' || role === 'water' ? .46 : .82,
        metalness: role === 'gold' ? .16 : 0,
        side: THREE.DoubleSide,
      });
      material.name = `landmark-${role}`;
      material.userData.paletteRole = role;
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = `${group.name} / ${role}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = {
        isLandmark: true,
        landmarkId: group.userData.landmarkId,
        pick: group.userData.pick,
      };
      group.add(mesh);
    }
    this.batches.clear();
  }
}

function trianglesGeometry(vertices, indices) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

// A hipped roof swept from a short ridge to a concave, gently lifted eave.
// The corner lift is part of the actual roof surface, not a flat roof decoration.
function hipRoof(b, { x = 0, y, z = 0, width, depth = width, height, role = 'roof', lift = .2, ridge = width * .13, ribs = true }) {
  const rings = 9, sideSamples = 10, count = sideSamples * 4;
  const vertices = [], indices = [];
  const perimeter = (i, t) => {
    const side = Math.floor(i / sideSamples), v = (i % sideSamples) / sideSamples;
    const hw = ridge + (width / 2 - ridge) * t, hd = depth / 2 * t;
    let px, pz;
    if (side === 0) { px = -hw + 2 * hw * v; pz = -hd; }
    else if (side === 1) { px = hw; pz = -hd + 2 * hd * v; }
    else if (side === 2) { px = hw - 2 * hw * v; pz = hd; }
    else { px = -hw; pz = hd - 2 * hd * v; }
    const corner = Math.pow(Math.abs(2 * v - 1), 5);
    return [x + px, y + height * Math.pow(1 - t, 1.55) + lift * Math.pow(t, 5) * corner, z + pz];
  };
  for (let r = 0; r <= rings; r++) {
    for (let i = 0; i < count; i++) vertices.push(...perimeter(i, r / rings));
  }
  for (let r = 0; r < rings; r++) for (let i = 0; i < count; i++) {
    const a = r * count + i, d = r * count + (i + 1) % count;
    const c = d + count, e = a + count;
    indices.push(a, d, e, d, c, e);
  }
  b.add(trianglesGeometry(vertices, indices), role);
  // A continuous eave border and the four rising corner seams keep the silhouette crisp.
  const border = [];
  for (let i = 0; i <= count; i++) border.push(perimeter(i % count, 1));
  b.line('gold', border, .032);
  for (let corner = 0; corner < 4; corner++) {
    const path = [];
    for (let r = 0; r <= rings; r++) path.push(perimeter(corner * sideSamples, r / rings));
    b.line('gold', path, .026);
  }
  b.rod('gold', [x - ridge - .06, y + height + .035, z], [x + ridge + .06, y + height + .035, z], .055, 8);
  for (const sign of [-1, 1]) {
    b.line('gold', [[x + sign * ridge, y + height + .04, z], [x + sign * (ridge + .13), y + height + .13, z], [x + sign * (ridge + .16), y + height + .23, z]], .035);
  }
  if (ribs) {
    // Thin raised tile seams, deliberately restrained at this miniature scale.
    for (let side = 0; side < 4; side++) for (let s = 1; s < sideSamples; s++) {
      const path = [];
      for (let r = 2; r <= rings; r++) {
        const p = perimeter(side * sideSamples + s, r / rings);
        p[1] += .016;
        path.push(p);
      }
      b.line(role === 'gold' ? 'stone' : 'roofLight', path, .012, 3);
    }
  }
}

function polygonRoof(b, { y, radius, height, sides = 8, role = 'roof', lift = .12, cx = 0, cz = 0 }) {
  const segments = sides * 4, rings = 7, vertices = [], indices = [];
  const point = (i, t) => {
    const side = Math.floor(i / 4), u = (i % 4) / 4;
    const aa = side / sides * Math.PI * 2, ab = (side + 1) / sides * Math.PI * 2;
    const r = .045 + (radius - .045) * t;
    return [cx + r * (Math.cos(aa) * (1 - u) + Math.cos(ab) * u),
      y + height * Math.pow(1 - t, 1.45) + lift * Math.pow(t, 5) * Math.pow(Math.abs(u * 2 - 1), 4),
      cz + r * (Math.sin(aa) * (1 - u) + Math.sin(ab) * u)];
  };
  for (let j = 0; j <= rings; j++) for (let i = 0; i < segments; i++) vertices.push(...point(i, j / rings));
  for (let j = 0; j < rings; j++) for (let i = 0; i < segments; i++) {
    const a = j * segments + i, c = j * segments + (i + 1) % segments;
    indices.push(a, c, a + segments, c, c + segments, a + segments);
  }
  b.add(trianglesGeometry(vertices, indices), role);
  const edge = [];
  for (let i = 0; i <= segments; i++) edge.push(point(i % segments, 1));
  b.line('gold', edge, .025);
  for (let s = 0; s < sides; s++) {
    const path = [];
    for (let j = 0; j <= rings; j++) path.push(point(s * 4, j / rings));
    b.line('gold', path, .018, 4);
  }
}

function squareRail(b, y, halfW, halfD, { cx = 0, cz = 0, gate = false, height = .34, role = 'teal' } = {}) {
  const corners = [[-halfW, -halfD], [halfW, -halfD], [halfW, halfD], [-halfW, halfD]];
  for (let edge = 0; edge < 4; edge++) {
    const a = corners[edge], end = corners[(edge + 1) % 4];
    const n = Math.ceil(Math.hypot(end[0] - a[0], end[1] - a[1]) / .34);
    for (let i = 0; i <= n; i++) {
      const t = i / n, px = cx + a[0] * (1 - t) + end[0] * t, pz = cz + a[1] * (1 - t) + end[1] * t;
      if (!(gate && edge === 2 && Math.abs(px - cx) < .46)) b.cyl(role, px, y + height / 2, pz, .028, height, 5);
    }
    for (const h of [height * .3, height]) {
      if (gate && edge === 2) {
        b.rod(role, [cx + halfW, y + h, cz + halfD], [cx + .48, y + h, cz + halfD], .025);
        b.rod(role, [cx - .48, y + h, cz + halfD], [cx - halfW, y + h, cz + halfD], .025);
      } else b.rod(role, [cx + a[0], y + h, cz + a[1]], [cx + end[0], y + h, cz + end[1]], .025);
    }
  }
}

function archWindow(b, x, y, z, width, height, angle = 0, role = 'dark') {
  const shape = new THREE.Shape();
  const r = width / 2;
  shape.moveTo(-r, 0); shape.lineTo(r, 0); shape.lineTo(r, height - r);
  shape.absarc(0, height - r, r, 0, Math.PI, false);
  shape.lineTo(-r, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: .025, bevelEnabled: false, curveSegments: 8 });
  b.add(geo, role, x, y, z, [0, angle, 0]);
}

function stoneSteps(b, z, width, top = .45, count = 5, x = 0) {
  for (let i = 0; i < count; i++) {
    const h = top * (i + 1) / count;
    b.box('ivory', x, h / 2, z - i * .16, width, h, .2);
  }
}

function pavilion(b) {
  b.box('stone', 0, .09, 0, 4.75, .18, 4.35);
  b.box('ivory', 0, .25, 0, 4.5, .16, 4.1);
  b.box('cream', 0, .41, 0, 4.1, .16, 3.72);
  stoneSteps(b, 2.68, 1.48, .49, 5);
  squareRail(b, .49, 1.99, 1.82, { gate: true });
  const tiers = [
    { y: .50, h: 1.48, w: 3.2, d: 2.85, roofW: 4.52, roofD: 4.0, roofH: .83 },
    { y: 2.52, h: 1.30, w: 2.65, d: 2.42, roofW: 3.95, roofD: 3.53, roofH: .78 },
    { y: 4.38, h: 1.13, w: 2.08, d: 1.92, roofW: 3.42, roofD: 3.05, roofH: .87 },
  ];
  tiers.forEach((t, index) => {
    b.box('redDark', 0, t.y + t.h / 2, 0, t.w * .64, t.h, t.d * .60);
    b.box('ivory', 0, t.y + .06, 0, t.w + .44, .12, t.d + .44);
    if (index) squareRail(b, t.y + .12, t.w / 2 + .15, t.d / 2 + .15, { height: .31 });
    for (const px of [-t.w / 2, 0, t.w / 2]) for (const pz of [-t.d / 2, t.d / 2]) {
      b.cyl('red', px, t.y + t.h / 2, pz, .075, t.h, 8);
      b.cyl('gold', px, t.y + .15, pz, .085, .09, 8);
      b.box('gold', px, t.y + t.h - .12, pz, .30, .10, .21);
      b.box('teal', px, t.y + t.h - .04, pz, .36, .08, .28);
    }
    for (const pz of [-t.d / 2, t.d / 2]) b.box('red', 0, t.y + t.h - .05, pz, t.w + .18, .14, .12);
    for (const px of [-t.w / 2, t.w / 2]) b.box('red', px, t.y + t.h - .05, 0, .12, .14, t.d);
    // Lattice front and back windows with visible mullions.
    for (const face of [-1, 1]) for (const px of [-.62, 0, .62]) {
      const wx = px * t.w / 3.2, wz = face * (t.d * .30 + .02), wy = t.y + .35;
      b.box('glass', wx, wy + .32, wz, .39 * t.w / 3.2, .64, .035);
      b.box('gold', wx, wy + .32, wz + face * .025, .023, .64, .023);
      b.box('gold', wx, wy + .32, wz + face * .025, .39 * t.w / 3.2, .026, .025);
    }
    // Corner lanterns, warm highlights in daylight and emissive after dark.
    if (index === 0) for (const px of [-t.w / 2, t.w / 2]) for (const pz of [-t.d / 2, t.d / 2]) {
      b.rod('gold', [px, t.y + t.h - .10, pz], [px, t.y + t.h - .33, pz], .014);
      b.cyl('lantern', px, t.y + t.h - .43, pz, .095, .19, 8);
    }
    hipRoof(b, { y: t.y + t.h, width: t.roofW, depth: t.roofD, height: t.roofH, lift: .23, role: index === 1 ? 'roof' : 'gold' });
  });
  b.cyl('gold', 0, 6.58, 0, .045, .38, 8);
  b.add(new THREE.SphereGeometry(.095, 8, 6), 'gold', 0, 6.77, 0);
  // Tiny lintel plaque reads as a sign at the centre without using a texture.
  b.box('teal', 0, 1.78, 1.44, .79, .27, .075);
  for (const dx of [-.23, 0, .23]) b.box('gold', dx, 1.78, 1.483, .08, .13, .015);
}

function pagoda(b) {
  b.cyl('stone', 0, .11, 0, 1.92, .22, 8);
  b.cyl('ivory', 0, .29, 0, 1.75, .14, 8);
  b.cyl('cream', 0, .43, 0, 1.58, .14, 8);
  const floorCount = 7, step = 1.12;
  for (let level = 0; level < floorCount; level++) {
    const y = .50 + level * step, radius = 1.32 - level * .089, wallH = .81;
    b.cyl('ivory', 0, y + wallH / 2, 0, radius, wallH, 8);
    b.cyl('stone', 0, y + .055, 0, radius + .04, .11, 8);
    b.cyl('gold', 0, y + wallH - .06, 0, radius + .07, .095, 8);
    for (let k = 0; k < 8; k++) {
      const corner = k / 8 * Math.PI * 2;
      b.cyl('red', Math.cos(corner) * radius, y + wallH / 2, Math.sin(corner) * radius, .042, wallH, 6);
      const a = corner + Math.PI / 8, rr = radius * Math.cos(Math.PI / 8) + .015;
      archWindow(b, Math.cos(a) * rr, y + .17, Math.sin(a) * rr, .26 - level * .008, .48, Math.PI / 2 - a, 'redDark');
      if (level < 5) {
        const nr = radius + .18, next = corner + Math.PI / 4;
        b.rod('teal', [Math.cos(corner) * nr, y + .16, Math.sin(corner) * nr], [Math.cos(next) * nr, y + .16, Math.sin(next) * nr], .023);
      }
    }
    polygonRoof(b, { y: y + wallH, radius: radius + .34, height: .43, lift: .13, role: level % 2 ? 'roof' : 'gold' });
  }
  const topY = .50 + (floorCount - 1) * step + 1.24;
  b.cyl('gold', 0, topY + .22, 0, .07, .5, 8);
  for (let i = 0; i < 4; i++) b.add(new THREE.SphereGeometry(.15 - i * .027, 8, 6), 'gold', 0, topY + .13 + i * .18, 0);
  b.add(new THREE.ConeGeometry(.09, .40, 8), 'gold', 0, topY + .87, 0);
  stoneSteps(b, 2.18, .90, .50, 4);
}

function endpointPoint(p) {
  if (Array.isArray(p)) return [Number(p[0]), Number(p.length > 2 ? p[2] : p[1])];
  return p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.z)) ? [Number(p.x), Number(p.z)] : null;
}
function bridgeSpan(spec) {
  const ends = spec.endpoints;
  const a = endpointPoint(Array.isArray(ends) ? ends[0] : ends?.from ?? ends?.start);
  const c = endpointPoint(Array.isArray(ends) ? ends[1] : ends?.to ?? ends?.end);
  if (a && c && a.every(Number.isFinite) && c.every(Number.isFinite)) {
    const dx = c[0] - a[0], dz = c[1] - a[1], length = Math.hypot(dx, dz);
    if (length > 1) return { length, rotation: -Math.atan2(dz, dx), source: 'endpoints' };
  }
  return { length: Number.isFinite(spec.length) && spec.length > 1 ? spec.length : 25, rotation: 0, source: 'length' };
}

function bridgeDeck(b, L, w, deckY, centralCablePlane = false) {
  const half = L / 2;
  b.box('stone', 0, deckY, 0, L, .28, w);
  b.box('road', 0, deckY + .15, 0, L, .035, w * .73);
  for (const s of [-1, 1]) {
    b.box('ivory', 0, deckY + .21, s * w * .46, L, .13, w * .10);
    b.rod('teal', [-half, deckY + .46, s * w * .49], [half, deckY + .46, s * w * .49], .025);
    for (let x = -half; x <= half; x += Math.max(.75, L / 45)) b.rod('teal', [x, deckY + .24, s * w * .49], [x, deckY + .46, s * w * .49], .021);
  }
  if (centralCablePlane) {
    b.box('ivory', 0, deckY + .21, 0, L, .08, w * .09);
    for (let x = -half + .5; x < half; x += 1.0) {
      for (const side of [-1, 1]) b.box('cream', x, deckY + .174, side * w * .25, .40, .012, .025);
    }
  } else {
    for (let x = -half + .5; x < half; x += 1.0) b.box('cream', x, deckY + .174, 0, .40, .012, .035);
  }
  for (const fraction of [-.45, .45]) {
    b.box('ivory', L * fraction, deckY / 2, 0, .45, deckY, w * .62);
    b.box('stone', L * fraction, .1, 0, .82, .2, w * .84);
  }
  // Sparse cars establish scale and leave the structural silhouette readable.
  for (const [t, side, role] of [[-.36, -1, 'red'], [-.08, 1, 'teal'], [.18, -1, 'cream'], [.38, 1, 'gold']]) {
    b.box(role, L * t, deckY + .27, side * w * .20, .31, .17, .14);
    b.box('glass', L * t + .02, deckY + .37, side * w * .20, .15, .045, .125);
  }
}

// Structural types and span proportions follow the bridge operator's published
// 2024 project notice. Height, width and decorative detail remain miniature art.
// https://www.hbbidcloud.cn/shengbenji/jyxx/004001/004001003/20240716/19fe53bc-3d2a-4920-8662-e325de050014.html
function suspensionBridge(b, L, w, deckY) {
  // Zhixi's Dajiang main bridge: 250 m + 838 m + 215 m. Do not include its
  // separate Sanjiang cable-stayed bridge or the interchanges in this span.
  const total = 250 + 838 + 215, half = L / 2;
  const towerXs = [-half + L * 250 / total, half - L * 215 / total];
  const towerH = clamp(L * .235, 6.5, 12.8), cableZ = w * .49;
  const cableTop = towerH - .13, cableLow = deckY + .78;
  const cableRadius = .040 + L * .00025;
  const hangerRadius = .015 + L * .00012;
  for (const px of towerXs) {
    b.box('stone', px, .13, 0, 1.1, .26, w + .73);
    for (const side of [-1, 1]) {
      // Two separate legs with horizontal crossbeams: a suspension tower,
      // visibly different from Yiling's merged inverted-Y legs.
      b.box('ivory', px, towerH / 2, side * cableZ, .34, towerH, .29);
      b.box('cream', px - .18, towerH / 2, side * cableZ, .035, towerH - .12, .23);
      b.box('red', px, towerH - .11, side * cableZ, .40, .17, .35);
      b.box('gold', px, towerH + .025, side * cableZ, .43, .08, .38);
    }
    b.box('ivory', px, towerH - .65, 0, .34, .24, cableZ * 2);
    b.box('ivory', px, deckY + .67, 0, .34, .20, cableZ * 2);
  }
  const centralY = t => cableLow + (cableTop - cableLow) * (2 * t - 1) ** 2;
  for (const side of [-1, 1]) {
    const z = side * cableZ;
    const curve = [];
    const count = 40;
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      curve.push([THREE.MathUtils.lerp(towerXs[0], towerXs[1], t), centralY(t), z]);
    }
    b.line('cable', curve, cableRadius, 6);
    for (let i = 1; i < 24; i++) {
      const t = i / 24, x = THREE.MathUtils.lerp(towerXs[0], towerXs[1], t);
      b.rod('cable', [x, deckY + .20, z], [x, centralY(t), z], hangerRadius, 4);
    }
    // Side-span cables run down to their concrete anchorages; their suspenders
    // are vertical too, so the bridge never reads as a fan of diagonal stays.
    for (const direction of [-1, 1]) {
      const endX = direction * (half - .12), px = towerXs[direction < 0 ? 0 : 1];
      const sideY = t => THREE.MathUtils.lerp(deckY + .36, cableTop, t) - .34 * Math.sin(Math.PI * t);
      const sideCurve = [];
      for (let i = 0; i <= 18; i++) {
        const t = i / 18;
        sideCurve.push([THREE.MathUtils.lerp(endX, px, t), sideY(t), z]);
      }
      b.line('cable', sideCurve, cableRadius, 6);
      for (let i = 1; i < 8; i++) {
        const t = i / 8, x = THREE.MathUtils.lerp(endX, px, t);
        b.rod('cable', [x, deckY + .20, z], [x, sideY(t), z], hangerRadius, 4);
      }
      b.box('stone', endX, deckY * .50, z, .74, deckY, .49);
      b.box('cream', endX, deckY + .20, z, .62, .40, .43);
    }
  }
  return { type: 'suspension', towerCount: 2, cablePlanes: 2, spanRatios: [250, 838, 215], section: 'Dajiang main bridge' };
}

function threeTowerCableBridge(b, L, w, deckY) {
  // Yiling main bridge: 120 m + 348 m + 348 m + 120 m; three inverted-Y
  // pylons and exactly one cable plane along the centre of the roadway.
  const total = 120 + 348 + 348 + 120, half = L / 2;
  const towerXs = [-half + L * 120 / total, 0, half - L * 120 / total];
  const centralHeight = clamp(L * .25, 6.6, 12.8);
  const stayRadius = .018 + L * .00018;
  towerXs.forEach((px, towerIndex) => {
    const towerH = centralHeight * (towerIndex === 1 ? 1 : .87);
    const jointY = deckY + (towerH - deckY) * .46;
    b.box('stone', px, .13, 0, .94, .26, w + .57);
    for (const side of [-1, 1]) {
      b.rod('ivory', [px, .20, side * w * .47], [px, jointY, 0], .16, 4);
      b.rod('cream', [px - .105, .23, side * w * .47], [px - .105, jointY, 0], .055, 4);
    }
    b.box('ivory', px, (jointY + towerH) / 2, 0, .28, towerH - jointY, .26);
    b.box('cream', px - .155, (jointY + towerH) / 2, 0, .035, towerH - jointY - .06, .18);
    b.box('red', px, towerH - .11, 0, .31, .14, .30);
    b.box('gold', px, towerH + .025, 0, .35, .07, .34);
    b.box('stone', px, deckY - .12, 0, .34, .16, w * .87);
    for (const direction of [-1, 1]) {
      const neighbourIndex = towerIndex + direction;
      const limit = neighbourIndex < 0 ? -half + .10 : neighbourIndex >= towerXs.length ? half - .10 : (px + towerXs[neighbourIndex]) / 2;
      const reach = Math.abs(limit - px), count = 12;
      for (let i = 1; i <= count; i++) {
        const t = i / count, endX = px + direction * reach * t;
        const startY = jointY + (towerH - jointY) * (.30 + .62 * t);
        // Both attachment ends have z=0: one central cable plane, no side arrays.
        b.rod('cable', [px, startY, 0], [endX, deckY + .27, 0], stayRadius, 4);
        b.box('gold', endX, deckY + .25, 0, .08, .08, .12);
      }
    }
  });
  return { type: 'three-tower-cable-stayed', towerCount: 3, cablePlanes: 1, spanRatios: [120, 348, 348, 120], pylon: 'inverted-Y' };
}

function genericCableBridge(b, L, w, deckY) {
  const towerH = clamp(L * .215, 5.8, 13), towerX = L * .235, half = L / 2;
  for (const px of [-towerX, towerX]) {
    b.box('stone', px, .13, 0, 1.05, .26, w + .65);
    for (const side of [-1, 1]) {
      b.rod('red', [px, .20, side * w * .48], [px, towerH, side * w * .18], .17, 4);
      b.rod('ivory', [px - .035, deckY, side * w * .46], [px - .035, towerH - .08, side * w * .18], .075, 4);
    }
    b.box('red', px, towerH - .12, 0, .36, .24, w * .45);
    b.box('gold', px, towerH + .035, 0, .44, .075, w * .52);
    b.box('red', px, deckY + .95, 0, .24, .18, w * .79);
    const count = 10;
    for (let i = 1; i <= count; i++) {
      for (const direction of [-1, 1]) {
        const endX = px + direction * (L * .24 * i / count);
        if (Math.abs(endX) >= half - .1) continue;
        for (const side of [-1, 1]) {
          b.rod('cable', [px, towerH - .35 - (count - i) * .05, side * w * .18], [endX, deckY + .23, side * w * .43], .017 + L * .00015, 4);
        }
      }
    }
  }
  return { type: 'cable-stayed', towerCount: 2, cablePlanes: 2 };
}

function bridge(b, spec, group) {
  const span = bridgeSpan(spec), L = span.length;
  const w = clamp(L * .055, 1.45, 2.65), deckY = clamp(L * .055, 1.65, 3.8);
  const type = spec.bridgeType || (/zhixi|至喜/.test(`${spec.id || ''} ${spec.name || ''}`) ? 'suspension'
    : /yiling|夷陵/.test(`${spec.id || ''} ${spec.name || ''}`) ? 'three-tower-cable-stayed' : 'cable-stayed');
  bridgeDeck(b, L, w, deckY, type === 'three-tower-cable-stayed');
  group.userData.bridgeStructure = type === 'suspension' ? suspensionBridge(b, L, w, deckY)
    : type === 'three-tower-cable-stayed' ? threeTowerCableBridge(b, L, w, deckY)
      : genericCableBridge(b, L, w, deckY);
  group.rotation.y = span.rotation;
  group.userData.span = { ...span, axis: 'local-x', units: 'world' };
}

function dam(b, spec, group) {
  const span = spec.endpoints || spec.length ? bridgeSpan(spec) : { length: 17, rotation: 0, source: 'default' };
  const L = span.length, gates = Math.round(clamp(L / 1.35, 9, 30)), gap = L / gates;
  const h = clamp(L * .14, 2.5, 4.7);
  b.box('stone', 0, .16, 0, L + .4, .32, 3.45);
  b.box('ivory', 0, h - .18, 0, L, .36, 2.3);
  for (let i = 0; i <= gates; i++) {
    const x = -L / 2 + i * gap;
    const profile = new THREE.Shape();
    profile.moveTo(-1.62, 0); profile.lineTo(1.65, 0); profile.lineTo(.75, h); profile.lineTo(-.70, h); profile.closePath();
    const g = new THREE.ExtrudeGeometry(profile, { depth: .23, bevelEnabled: false });
    // profile x becomes local z; the extrusion forms the narrow dam pier.
    b.add(g, 'ivory', x - .115, .2, 0, [0, Math.PI / 2, 0]);
    if (i < gates) {
      b.box('teal', x + gap / 2, h * .47, -.69, gap - .26, h * .70, .13);
      b.box('dark', x + gap / 2, h * .43, .73, gap - .26, h * .62, .10);
      b.box('water', x + gap / 2, .30, 1.62, gap - .30, .12, 1.22);
      for (let t = 0; t < 3; t++) b.box('foam', x + gap / 2 + (t - 1) * gap * .18, .375, 1.68 + t * .11, .045, .025, .85 - t * .13);
    }
  }
  b.box('road', 0, h + .035, 0, L, .07, 1.02);
  for (const s of [-1, 1]) {
    b.rod('teal', [-L / 2, h + .37, s * .97], [L / 2, h + .37, s * .97], .03);
    for (let x = -L / 2; x < L / 2; x += .65) b.rod('teal', [x, h, s * .97], [x, h + .37, s * .97], .023);
  }
  // Powerhouse and two travelling gantries give the dam an industrial identity.
  b.box('cream', 0, h * .59, -1.78, L * .55, h * .98, 1.5);
  b.box('roof', 0, h * 1.10, -1.78, L * .60, .18, 1.7);
  for (let i = 0; i < Math.floor(L * .55 / .52); i++) {
    const x = -L * .275 + .30 + i * .52;
    b.box('glass', x, h * .80, -2.535, .33, .49, .03);
  }
  for (const x of [-L * .26, L * .24]) {
    for (const z of [-.78, .78]) b.box('gold', x, h + .65, z, .16, 1.2, .16);
    b.box('gold', x, h + 1.25, 0, .20, .14, 1.77);
    b.box('red', x, h + 1.40, 0, .42, .20, .46);
  }
  group.rotation.y = span.rotation;
  group.userData.span = { ...span, axis: 'local-x', units: 'world' };
}

function tree(b, x, z, height, variation = 0, baseY = 0) {
  const crown = height * .34;
  b.cyl('trunk', x, baseY + height * .33, z, .055, height * .66, 6);
  b.add(new THREE.DodecahedronGeometry(crown, 0), variation % 2 ? 'foliage' : 'foliageLight', x, baseY + height * .69, z, [0, variation * .73, .08], [.86, 1.13, .88]);
  b.add(new THREE.DodecahedronGeometry(crown * .69, 0), 'foliageDark', x + crown * .36, baseY + height * .56, z - crown * .12, null, [1, 1.06, 1]);
}

function park(b) {
  b.cyl('stone', 0, .075, 0, 3.65, .15, 48);
  b.cyl('lawn', 0, .18, 0, 3.51, .13, 48);
  b.cyl('ivory', 0, .29, 0, 1.73, .10, 32);
  b.cyl('stone', 0, .40, 0, 1.29, .12, 8);
  b.cyl('cream', 0, .52, 0, 1.18, .12, 8);
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2, r = .94;
    b.cyl('red', Math.cos(a) * r, 1.34, Math.sin(a) * r, .064, 1.62, 8);
    const a2 = (k + 1) / 8 * Math.PI * 2;
    b.rod('teal', [Math.cos(a) * r, 2.10, Math.sin(a) * r], [Math.cos(a2) * r, 2.10, Math.sin(a2) * r], .07);
    if (k !== 1 && k !== 2) {
      for (const h of [.77, .98]) b.rod('teal', [Math.cos(a) * r, h, Math.sin(a) * r], [Math.cos(a2) * r, h, Math.sin(a2) * r], .034);
    }
  }
  polygonRoof(b, { y: 2.13, radius: 1.45, height: .70, role: 'roof' });
  polygonRoof(b, { y: 2.66, radius: .79, height: .55, role: 'gold', lift: .10 });
  b.cyl('gold', 0, 3.28, 0, .037, .30, 8);
  b.add(new THREE.SphereGeometry(.085, 8, 6), 'gold', 0, 3.45, 0);
  // The path is built from shallow geometry and tiny steps, with open space in front.
  for (let i = 0; i < 7; i++) b.box('ivory', .14 * Math.sin(i * .48), .27, 1.55 + i * .25, .67, .035, .20, [0, .12 * Math.sin(i), 0]);
  for (let i = 0; i < 10; i++) {
    const a = .55 + i * .51;
    if (a > 1.05 && a < 2.12) continue;
    const r = 2.65 + Math.sin(i * 2.4) * .23;
    tree(b, Math.cos(a) * r, Math.sin(a) * r, 1.40 + (i % 3) * .28, i, .245);
  }
  // Benches overlooking the river, kept readable even with a distant camera.
  for (const sx of [-1, 1]) {
    b.box('gold', sx * 2.05, .56, .65, .74, .09, .25, [0, -sx * .25, 0]);
    b.box('teal', sx * 2.05, .73, .51, .74, .24, .045, [0, -sx * .25, 0]);
    for (const dx of [-.24, .24]) b.box('teal', sx * 2.05 + dx, .405, .65, .05, .27, .18);
  }
}

function museum(b) {
  b.box('stone', 0, .10, 0, 6.25, .20, 4.6);
  b.box('ivory', 0, .26, 0, 5.86, .13, 4.23);
  stoneSteps(b, 2.80, 2.05, .33, 4);
  b.box('cream', -.92, 1.17, 0, 3.10, 1.70, 3.13);
  b.box('ivory', 1.82, 1.42, -.3, 1.65, 2.20, 2.80);
  b.box('glass', -.83, 1.10, 1.58, 2.72, 1.38, .05);
  for (let i = 0; i < 7; i++) b.box('teal', -2.12 + i * .43, 1.10, 1.62, .04, 1.38, .05);
  b.box('stone', -.83, 1.32, 1.65, 2.95, .10, .15);
  b.box('gold', 1.82, 1.43, 1.115, 1.30, 1.95, .055);
  for (let i = 0; i < 7; i++) b.box('stone', 1.25 + i * .19, 1.43, 1.15, .052, 1.97, .07);
  hipRoof(b, { x: -.92, z: 0, y: 2.02, width: 3.67, depth: 3.63, height: .46, role: 'roof', lift: .05, ridge: 1.2, ribs: false });
  hipRoof(b, { x: 1.82, z: -.30, y: 2.53, width: 2.10, depth: 3.22, height: .53, role: 'gold', lift: .06, ridge: .40, ribs: false });
  b.box('teal', -.42, 1.80, 1.96, 2.84, .14, .78);
  for (const x of [-1.63, .79]) b.box('ivory', x, 1.01, 2.15, .12, 1.54, .12);
  b.box('teal', 1.81, 1.49, 1.21, .75, .26, .04);
  for (let i = 0; i < 4; i++) b.box('cream', 1.56 + i * .17, 1.49, 1.24, .06, .10, .012);
  tree(b, -2.6, -1.62, 1.56, 3, .32);
  tree(b, 2.69, -1.70, 1.75, 2, .32);
  b.box('lawn', -2.56, .37, 1.37, .47, .10, .84);
  b.box('lawn', 2.66, .37, 1.55, .47, .10, .84);
}

/**
 * spec.length is in world units. For a bridge/dam spec.endpoints can be
 * [[x,z],[x,z]] or [{x,z},{x,z}]. The mesh is centred and oriented to those
 * endpoints, but is never translated to their centre: the caller owns placement.
 * modelScale applies uniformly after modelling; omit it for georeferenced spans.
 */
export function createLandmark(spec = {}) {
  const group = new THREE.Group();
  const kind = spec.kind || 'pavilion';
  group.name = spec.name || spec.id || kind;
  const pick = { type: 'landmark', id: spec.id || kind, name: group.name, kind,
    category: spec.category, subtitle: spec.subtitle, description: spec.description };
  group.userData = {
    isLandmark: true,
    type: 'landmark',
    id: pick.id,
    landmarkId: pick.id,
    name: group.name,
    kind,
    pick,
    landmark: { ...spec },
    representation: 'stylized-miniature',
    approximate: true,
  };
  const b = new ModelBuilder();
  if (kind === 'pagoda') pagoda(b);
  else if (kind === 'bridge') bridge(b, spec, group);
  else if (kind === 'dam') dam(b, spec, group);
  else if (kind === 'park') park(b);
  else if (kind === 'museum') museum(b);
  else pavilion(b);
  b.finish(group);
  const scale = Number.isFinite(spec.modelScale) && spec.modelScale > 0 ? spec.modelScale : 1;
  group.scale.setScalar(scale);
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  group.userData.labelHeight = bounds.max.y + .55 * scale;
  group.userData.labelAnchor = { x: 0, y: group.userData.labelHeight, z: 0 };
  group.userData.modelBounds = {
    width: bounds.max.x - bounds.min.x,
    height: bounds.max.y - bounds.min.y,
    depth: bounds.max.z - bounds.min.z,
  };
  return group;
}

/** Update material colours only; this preserves batches, placement and pick data. */
export function updateLandmarkTheme(group, night = false) {
  group.traverse(object => {
    if (!object.isMesh || !object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach(material => {
      const role = material.userData.paletteRole;
      if (!role) return;
      material.color.set((night ? NIGHT : DAY)[role]);
      const lit = night && (role === 'glass' || role === 'lantern');
      material.emissive.set(lit ? role === 'lantern' ? '#efb658' : '#d7a359' : '#000000');
      material.emissiveIntensity = lit ? role === 'lantern' ? .55 : .28 : 0;
    });
  });
  group.userData.night = !!night;
}
