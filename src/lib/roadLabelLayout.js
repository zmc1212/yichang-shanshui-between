const finite = Number.isFinite;
const intersects = (a, b, gap = 0) => a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap;
const validBox = box => box && [box.left, box.top, box.right, box.bottom].every(finite) && box.right > box.left && box.bottom > box.top;

export function readableRoadAngle(degrees) {
  if (!finite(degrees)) return 0;
  let angle = ((degrees + 180) % 360 + 360) % 360 - 180;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  return angle;
}

export function roadNameSize(name, compact = false) {
  const characters = Array.from(String(name));
  const width = characters.reduce((sum, character) => sum + (/[^\u0000-\u00ff]/.test(character) ? compact ? 10.5 : 11.5 : compact ? 6 : 6.5), 0)
    + Math.max(0, characters.length - 1) * (compact ? 1.3 : 1.7) + 12;
  return { width: Math.ceil(width), height: compact ? 20 : 22 };
}

/** Strictly subordinate to POI: obstacles are consumed after the POI layout,
 * and this function never requests that a POI move, merge, or disappear.
 * Text remains on its projected centreline; blocked candidates are omitted.
 */
export function layoutRoadLabels(candidates, {
  width, height, compact = false, obstacles = [], poiObstacles = [], previousLabels = [], selectedId = null,
} = {}) {
  if (!(width > 0 && height > 0) || !finite(width) || !finite(height)) return { labels: [], candidateCount: 0 };
  const previous = new Map((previousLabels || []).map(label => [label.id, label]));
  const priorNames = new Set((previousLabels || []).map(label => label.name));
  const blocked = [...obstacles.filter(validBox).map(box => ({ ...box, gap: 9 })), ...poiObstacles.filter(validBox).map(box => ({ ...box, gap: box.selected ? 17 : 11 }))];
  const prepared = [];
  const seen = new Set();
  for (const candidate of candidates || []) {
    if (!candidate || candidate.visible === false || !candidate.id || !candidate.name || seen.has(candidate.id)
      || ![candidate.x, candidate.y, candidate.spanPx, candidate.roadPixels].every(finite)) continue;
    seen.add(candidate.id);
    const old = previous.get(candidate.id), existed = Boolean(old), angle = readableRoadAngle(candidate.angle);
    const size = roadNameSize(candidate.name, compact);
    const textWidth = finite(candidate.width) && candidate.width > 0 ? candidate.width : size.width;
    const textHeight = finite(candidate.height) && candidate.height > 0 ? candidate.height : size.height;
    // Enter/exit thresholds differ, so small zoom/rotation changes keep a
    // previously valid name. Source text and the font size are never scaled.
    if (candidate.roadPixels < (existed ? .16 : .22) || candidate.roadPixels > (existed ? 25 : 22)
      || candidate.spanPx < textWidth * (existed ? 1.08 : 1.28) + 8 || Math.abs(angle) > (existed ? 79 : 73)) continue;
    const rad = angle * Math.PI / 180, boxWidth = Math.abs(Math.cos(rad)) * textWidth + Math.abs(Math.sin(rad)) * textHeight;
    const boxHeight = Math.abs(Math.sin(rad)) * textWidth + Math.abs(Math.cos(rad)) * textHeight;
    const box = { left: candidate.x - boxWidth / 2, right: candidate.x + boxWidth / 2, top: candidate.y - boxHeight / 2, bottom: candidate.y + boxHeight / 2 };
    if (box.left < 14 || box.top < 14 || box.right > width - 14 || box.bottom > height - 14 || blocked.some(obstacle => intersects(box, obstacle, obstacle.gap))) continue;
    const centerDistance = Math.hypot((candidate.x - width / 2) / width, (candidate.y - height / 2) / height);
    const score = (finite(candidate.priority) ? candidate.priority : 0) + Math.min(12, candidate.spanPx / 55) - centerDistance * 9
      + (existed ? 13 : priorNames.has(candidate.name) ? 4 : 0);
    prepared.push({ ...candidate, ...box, angle, width: textWidth, height: textHeight, score });
  }
  prepared.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const budget = selectedId ? compact ? 2 : 3 : compact ? 3 : 6;
  const labels = [], names = new Set();
  const separation = compact ? 52 : 76;
  for (const candidate of prepared) {
    if (names.has(candidate.name) || labels.some(label => intersects(candidate, label, separation))) continue;
    const { score, ...label } = candidate;
    labels.push(label); names.add(label.name);
    if (labels.length >= budget) break;
  }
  return { labels, candidateCount: prepared.length };
}
