import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { AUTHORED_MODELS } from '../src/scene/authoredModels.js';
import { resolveAuthoredPlacement, planAuthoredGround } from '../src/scene/authoredPlacement.js';
import { planStreetDetails } from '../src/scene/streetDetails.js';
import { trimStreetCurbs, createStreetCurbGeometry } from '../src/scene/streetSurfaceGeometry.js';

const passed = [], report = [];
const pairs = ring => ring.map((p, i) => [p, ring[(i + 1) % ring.length]]);
const turn = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function area(ring) { let result = 0; for (let i = 1; i < ring.length - 1; i++) result += turn(ring[0], ring[i], ring[i + 1]); return Math.abs(result) / 2; }
function contains(point, ring) {
  const signs = pairs(ring).map(([a, b]) => turn(a, b, point));
  return signs.every(v => v >= -1e-10) || signs.every(v => v <= 1e-10);
}
function hull(points) {
  const sorted = points.map(p => [...p]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const unique = sorted.filter((p, i) => !i || Math.hypot(p[0] - sorted[i - 1][0], p[1] - sorted[i - 1][1]) > 1e-10);
  if (unique.length < 3) return unique;
  const lower = [], upper = [];
  for (const p of unique) { while (lower.length > 1 && turn(lower.at(-2), lower.at(-1), p) <= 1e-14) lower.pop(); lower.push(p); }
  for (const p of [...unique].reverse()) { while (upper.length > 1 && turn(upper.at(-2), upper.at(-1), p) <= 1e-14) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
// Independent area oracle: collect contained vertices plus segment crossings,
// then take their convex hull. It does not call the production clipping code.
function intersectionArea(a, b) {
  const candidates = [...a.filter(p => contains(p, b)), ...b.filter(p => contains(p, a))];
  for (const [p, q] of pairs(a)) for (const [r, s] of pairs(b)) {
    const dx = q[0] - p[0], dz = q[1] - p[1], ex = s[0] - r[0], ez = s[1] - r[1];
    const divisor = dx * ez - dz * ex;
    if (Math.abs(divisor) < 1e-15) continue;
    const rx = r[0] - p[0], rz = r[1] - p[1];
    const t = (rx * ez - rz * ex) / divisor, u = (rx * dz - rz * dx) / divisor;
    if (t >= -1e-10 && t <= 1 + 1e-10 && u >= -1e-10 && u <= 1 + 1e-10) candidates.push([p[0] + dx * t, p[1] + dz * t]);
  }
  return area(hull(candidates));
}
function winding(point, ring) {
  let inside = false;
  for (const [a, b] of pairs(ring)) if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  return inside;
}

function checkCells(site, cells) {
  const connection = site.paving.filter(cell => cell.role === 'connection');
  const masksFor=curb=>[...connection.map(cell=>cell.points),...(curb.side==='building'?site.courtOpeningMasks||[]:[])];
  for (const cell of cells) {
    assert(cell.points.length >= 3 && cell.points.flat().every(Number.isFinite));
    assert(cell.points.every((p, i) => turn(p, cell.points[(i + 1) % cell.points.length], cell.points[(i + 2) % cell.points.length]) >= -1e-12), 'Every returned fragment must be convex');
    const sourceCurb=site.curbs[cell.sourceCurbIndex];
    for (const mask of masksFor(sourceCurb)) assert(intersectionArea(cell.points, mask) < 1e-11, 'Neither an entry strip nor an explicitly permitted inner court opening may retain a blocking curb');
    const source = sourceCurb.footprint;
    assert(Math.abs(intersectionArea(cell.points, source) - area(cell.points)) < 1e-10, 'Trimming cannot expand a curb beyond its source footprint');
  }
  for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
    if (cells[i].sourceCurbIndex === cells[j].sourceCurbIndex) assert(intersectionArea(cells[i].points, cells[j].points) < 1e-11, 'Fragments from one curb must not overlap');
  }
  for (const cut of cells.cutouts) {
    const sourceCurb=site.curbs[cut.sourceCurbIndex];
    for(const index of cut.connectionCellIndices){assert(Number.isInteger(index));assert.equal(site.paving[index].role,'connection');assert(intersectionArea(sourceCurb.footprint,site.paving[index].points)>1e-11,'A reported connection cut needs genuine positive-area intersection');}
    for(const index of cut.courtMaskIndices||[]){assert.equal(sourceCurb.side,'building','Court opening masks may never cut the carriageway-side curb');assert(Number.isInteger(index));assert(intersectionArea(sourceCurb.footprint,site.courtOpeningMasks[index])>1e-11,'A reported court opening needs genuine positive-area intersection');}
    assert(cut.maxPenetration <= cut.curbWidth + 1e-10, 'The opening only penetrates the original curb thickness');
    assert(cut.originalOverlapArea > 0 && cut.removedArea >= cut.originalOverlapArea - 1e-10);
    for (const mask of cut.openingMasks) for (const cell of cells.filter(c => c.sourceCurbIndex === cut.sourceCurbIndex)) assert(intersectionArea(cell.points, mask) < 1e-11, 'The complete curb thickness at an opening must be clear, including the former half-curb');
    const original = area(site.curbs[cut.sourceCurbIndex].footprint), remaining = cells.filter(c => c.sourceCurbIndex === cut.sourceCurbIndex).reduce((sum, c) => sum + area(c.points), 0);
    assert(Math.abs(original - remaining - cut.removedArea) < 1e-11, 'Opening area and surviving pieces conserve the source area');
  }
  for (let i = 0; i < site.curbs.length; i++) {
    const source = site.curbs[i].footprint;
    if (masksFor(site.curbs[i]).some(mask => intersectionArea(source, mask) > 1e-11)) continue;
    const retained = cells.filter(c => c.sourceCurbIndex === i);
    assert(Math.abs(retained.reduce((sum, c) => sum + area(c.points), 0) - area(source)) < 1e-10, 'Unaffected curbs, including the road-side edge, must remain complete');
  }
}

function checkGeometry(cells, surface, lift = 0.0035) {
  const geometry = createStreetCurbGeometry(cells, surface, lift);
  const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv'), indices = geometry.index;
  assert(p.array.every(Number.isFinite) && n.array.every(Number.isFinite) && uv.array.every(Number.isFinite));
  assert.equal(p.count, n.count); assert.equal(p.count, uv.count);
  let tops = 0, sides = 0;
  for (let i = 0; i < p.count; i++) {
    const normal = new THREE.Vector3().fromBufferAttribute(n, i);
    assert(Math.abs(normal.length() - 1) < 1e-6, 'Every vertex normal is unit length');
    const height = p.getY(i) - surface(p.getX(i), p.getZ(i));
    assert(Math.min(Math.abs(height), Math.abs(height - lift)) < 2e-7, 'Each base vertex meets the surface, and each top vertex is exactly one lift above it');
  }
  for (let i = 0; i < indices.count; i += 3) {
    const ids = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)];
    const [a, b, c] = ids.map(index => new THREE.Vector3().fromBufferAttribute(p, index));
    const face = b.clone().sub(a).cross(c.clone().sub(a));
    assert(face.lengthSq() > 1e-22, 'Rendered triangles cannot collapse after Float32 conversion');
    const declared = new THREE.Vector3().fromBufferAttribute(n, ids[0]);
    assert(face.dot(declared) > 0, 'Geometric winding agrees with the declared outward/upward normal');
    if (declared.y > 0) {
      assert(face.y > 0, 'Top faces point up'); tops++;
      const tri = [a, b, c].map(v => [v.x, v.z]);
      for (const cut of cells.cutouts) for (const mask of cut.openingMasks) assert(intersectionArea(tri, mask) < 5e-7, 'Rendered top triangles retain the opening within Float32 world precision');
    } else {
      assert(Math.abs(face.y) < 1e-10, 'Vertical wall normals remain horizontal'); sides++;
    }
  }
  assert(tops > 0 && sides > 0);
  assert(geometry.groups.length === 0, 'All curb pieces share one geometry/material draw');
  const stats = { ...geometry.userData.streetCurbs, cutouts: undefined, vertices: p.count, triangles: indices.count / 3 };
  geometry.dispose(); return stats;
}

const oblique = {
  units: 1,
  curbs: [
    { a: [-3, 0], b: [3, 0], footprint: [[-3, -0.1], [3, -0.1], [3, 0.1], [-3, 0.1]] },
    { a: [-3, 2], b: [3, 2], footprint: [[-3, 1.9], [3, 1.9], [3, 2.1], [-3, 2.1]] },
  ],
  paving: [{ role: 'connection', points: [[-1.6, -1], [-0.6, 0], [0.6, 0], [-0.4, -1]] }],
};
const beforeOblique = JSON.stringify(oblique), obliqueCells = trimStreetCurbs(oblique);
checkCells(oblique, obliqueCells);
assert.equal(obliqueCells.cutouts.length, 1);
assert(Math.abs(obliqueCells.cutouts[0].curbWidth - 0.2) < 1e-12);
assert(Math.abs(obliqueCells.cutouts[0].maxPenetration - 0.1) < 1e-12);
assert.equal(JSON.stringify(oblique), beforeOblique);
checkGeometry(obliqueCells, (x, z) => 0.2 + x * 0.015 + z * 0.025);
passed.push('Oblique entry clears the complete curb thickness, preserves the parallel road edge, conserves area and leaves the planner unchanged');

const fullCrossing = { curbs: oblique.curbs, paving: [{ role: 'connection', points: [[-0.5, -1], [0.5, -1], [0.5, 0.5], [-0.5, 0.5]] }] };
const crossingCells = trimStreetCurbs(fullCrossing); checkCells(fullCrossing, crossingCells);
assert(Math.abs(crossingCells.cutouts[0].removedArea - 0.2) < 1e-12);
assert(Math.abs(crossingCells.cutouts[0].maxPenetration) < 1e-12);
const touching = { curbs: oblique.curbs, paving: [{ role: 'connection', points: [[-1, -1], [1, -1], [1, -0.1], [-1, -0.1]] }] };
const touchingCells = trimStreetCurbs(touching); assert.equal(touchingCells.cutouts.length, 0); checkCells(touching, touchingCells);
const reversed = { curbs: oblique.curbs.map(c => ({ ...c, footprint: [...c.footprint].reverse() })), paving: oblique.paving.map(c => ({ ...c, points: [...c.points].reverse() })) };
const reversedCells = trimStreetCurbs(reversed); checkCells(reversed, reversedCells);
assert(Math.abs(reversedCells.reduce((sum, c) => sum + area(c.points), 0) - obliqueCells.reduce((sum, c) => sum + area(c.points), 0)) < 1e-11);
passed.push('Full crossings, exact boundary contact and reversed winding preserve their geometric meaning without spurious curb cuts');

const multiple = { curbs: oblique.curbs, paving: [oblique.paving[0], oblique.paving[0],
  { role: 'connection', points: [[1.1, -1], [1.1, 0], [1.6, 0], [1.6, -1]] },
  { role: 'forecourt', points: [[-3, -1], [3, -1], [3, 3], [-3, 3]] },
] };
const multipleCells = trimStreetCurbs(multiple); checkCells(multiple, multipleCells);
assert.equal(multipleCells.cutouts.length, 1);
assert.equal(multipleCells.cutouts[0].openingMasks.length, 2);
assert(Math.abs(multipleCells.cutouts[0].originalOverlapArea - obliqueCells.cutouts[0].originalOverlapArea - 0.05) < 1e-11, 'Duplicate entry masks count only once; a second disjoint entry adds its real area');
checkGeometry(multipleCells, (x, z) => 0.3 + 0.02 * x - 0.01 * z);
passed.push('Multiple entry openings remain disjoint, duplicate connection masks do not double-count area, and ordinary forecourt paving cannot remove a curb');

const cornerCourt={curbs:oblique.curbs.map((curb,index)=>({...curb,side:index===0?'building':'road'})),paving:[],
  courtOpeningMasks:[[[-.5,-.2],[.5,-.2],[.5,2.2],[-.5,2.2]]]};
const cornerCourtCells=trimStreetCurbs(cornerCourt);checkCells(cornerCourt,cornerCourtCells);
assert.equal(cornerCourtCells.cutouts.length,1);assert.equal(cornerCourtCells.cutouts[0].sourceCurbIndex,0);
assert.deepEqual(cornerCourtCells.cutouts[0].connectionCellIndices,[]);assert.deepEqual(cornerCourtCells.cutouts[0].courtMaskIndices,[0]);
assert(Math.abs(cornerCourtCells.filter(cell=>cell.sourceCurbIndex===1).reduce((sum,cell)=>sum+area(cell.points),0)-area(cornerCourt.curbs[1].footprint))<1e-12,'Even a court mask spanning both sides cannot remove any road-side curb');
checkGeometry(cornerCourtCells,(x,z)=>.2+.015*x+.025*z);
passed.push('Explicit corner court masks open only a positively intersected building-side curb; a synthetic mask spanning both sides leaves the road-side curb completely intact');

const data = JSON.parse(fs.readFileSync(new URL('../public/data/city.json', import.meta.url), 'utf8'));
const authoredModels = AUTHORED_MODELS.map(spec => resolveAuthoredPlacement(spec, data.meta)).filter(Boolean);
const authoredGround = planAuthoredGround(authoredModels, data, 3.8);
const inWater = (x, z) => data.water.some(p => winding([x, z], p.rings[0]) && !p.rings.slice(1).some(hole => winding([x, z], hole)));
const heightAt = (x, z) => 0.002 * Math.sin(x * 0.12) * Math.cos(z * 0.06);
const plan = planStreetDetails({ data, authoredModels, authoredGround, waterfrontPlan: { omittedBuildingIndices: new Set() }, inWater, heightAt });
const baseline = JSON.stringify({ plan, data, authoredModels });
const expected = new Map([['shouxin-wealth-s01', 3], ['wanda-soho-s01', 3], ['jiuzhou-s01', 2]]);
for (const id of expected.keys()) assert(plan.sites.some(site => site.id === id), `${id}: required real street site exists`);
for (const site of [...plan.sites,...(plan.links||[]),...(plan.extensions||[])]) {
  const cells = trimStreetCurbs(site); checkCells(site, cells);
  if(site.id==='zhongnan-s09'){
    assert(cells.cutouts.some(cut=>cut.courtMaskIndices?.length),'The actual oblique court opens its inner sidewalk curb');
    assert(cells.cutouts.every(cut=>site.curbs[cut.sourceCurbIndex].side==='building'),'All real Zhongnan road-side curbs remain complete');
  }
  if (expected.has(site.id)) assert.equal(cells.cutouts.length, expected.get(site.id), `${site.id}: every baseline blocked curb is opened`);
  const surface = (x, z) => heightAt(x, z) + site.groundLift(x, z);
  const geometry = checkGeometry(cells, surface);
  assert(geometry.geometryBytes < 400000, 'Each complete curb batch stays lightweight');
  const unit = site.units;
  report.push({
    id: site.id, sourceCurbs: site.curbs.length, renderedCells: cells.length, cuts: cells.cutouts.length,
    courtCuts:cells.cutouts.filter(cut=>cut.courtMaskIndices?.length).length,
    originalOverlapSquareMeters: cells.cutouts.reduce((sum, c) => sum + c.originalOverlapArea, 0) / unit ** 2,
    removedSquareMeters: cells.cutouts.reduce((sum, c) => sum + c.removedArea, 0) / unit ** 2,
    openingWidthMeters: cells.cutouts.reduce((sum, c) => sum + c.openingWidth, 0) / unit,
    maxPenetrationMeters: Math.max(0, ...cells.cutouts.map(c => c.maxPenetration)) / unit,
    geometry,
  });
}
assert.equal(JSON.stringify({ plan, data, authoredModels }), baseline, 'No planner cells, geographic inputs or model transforms were changed');
passed.push(`${plan.sites.length} real building street sites, ${(plan.links||[]).length} short links and ${(plan.extensions||[]).length} independent street extensions have zero permitted opening/curb overlap, full-thickness openings, preserved road-side edges and finite upward/outward geometry`);
const empty = createStreetCurbGeometry([], () => 0); assert.equal(empty.attributes.position.count, 0); assert.equal(empty.index.count, 0); empty.dispose();
assert.throws(() => createStreetCurbGeometry(obliqueCells, () => NaN), /non-finite/);
passed.push('Empty sites are harmless; invalid heights fail explicitly instead of emitting NaN vertices');
console.log(JSON.stringify({ passed, sites: report }, null, 2));
