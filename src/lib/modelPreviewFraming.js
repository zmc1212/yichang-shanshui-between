// A transient hidden/collapsed host is not a new camera viewport. Derive each
// resize from the last fitted geometry envelope, never the previous frustum.
export function previewViewport(width, height) {
  if (![width, height].every(Number.isFinite) || width < 2 || height < 2) return null;
  return { width, height, aspect: width / height };
}

export function previewViewHeight(projectedWidth, projectedHeight, aspect, padding) {
  if (![projectedWidth, projectedHeight, aspect, padding].every(Number.isFinite)
    || projectedWidth < 0 || projectedHeight <= 0 || aspect <= 0 || padding < 1) return null;
  return Math.max(projectedHeight, projectedWidth / aspect, 1) * padding;
}
