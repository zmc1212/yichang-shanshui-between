import * as THREE from 'three';

// Camera subjects in the retained GLB's native frame, checked against its
// visible light geometry. These are presentation targets, never surveyed map
// coordinates or edits to the asset. Multi-tower projects use a real tower:
// Wanda's middle SOHO and International Plaza's office tower, not empty court.
const SUBJECTS = {
  'shouxin-wealth-s01': {
    facade: [0, 53.87, 11.72], entrance: [0, 6.86, 9.23], crown: [0, 94, 11.72],
  },
  'zhongnan-s09': {
    facade: [10.31, 58.61, -0.01], entrance: [10.31, 7.46, 1.20], crown: [10, 99.3, -10],
  },
  'jinjiang-s03': {
    facade: [0.34, 39.66, -0.28], entrance: [0.34, 5.05, 16.58], crown: [0.34, 67.79, -0.51],
  },
  'wanda-soho-s01': {
    facade: [0, 55.48, 7.9], entrance: [0, 7.05, 10.16], crown: [0, 98.7, 0],
  },
  'fujiang-s01': {
    facade: [0, 54.94, 8.31], entrance: [0, 6.88, 10.42], crown: [0, 93.99, 8.31],
  },
  'yichang-international-s01': {
    facade: [-31.5, 54.97, -0.39], entrance: [-36.5, 3.4, 2.6], crown: [-31.5, 94.06, -0.43],
  },
  'jiuzhou-s01': {
    facade: [-1.84, 55, 9.16], entrance: [-10.03, 3, 16.62], crown: [-1.84, 94.03, 9.16],
    // The entry's authored feature is a broad horizontal canopy. Lift the
    // inspection camera enough to reveal its glass cells and finite framing.
    entranceDirection: [0.12, 0.38, 1],
  },
};

const SPAN = { facade: 0.22, entrance: 0.16, crown: 0.18 };
const DIRECTION = {
  facade: [0.18, 0.12, 1],
  entrance: [0.12, 0.08, 1],
  crown: [0.45, 0.8, 1],
};

export function resolveBuildingInspection(spec, base, part = 'facade') {
  const subject = SUBJECTS[spec?.id];
  if (!subject || spec.kind !== 'authored' || !spec.sourceBounds || !(spec.uniformScale > 0)) return null;
  const selectedPart = Object.hasOwn(SPAN, part) ? part : 'facade';
  const sourceCenter = new THREE.Vector3(...subject[selectedPart]);
  const [min, max] = [spec.sourceBounds.min, spec.sourceBounds.max];
  const sourceSpan = (max[1] - min[1]) * SPAN[selectedPart];
  // Mirror prepareAuthoredModel's frozen source origin exactly, applying the
  // same single scalar and registered yaw. Do not use the original raw GLB
  // origin or the world AABB centre as a replacement for this conversion.
  const center = sourceCenter.clone().sub(new THREE.Vector3((min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2))
    .multiplyScalar(spec.uniformScale).applyAxisAngle(new THREE.Vector3(0, 1, 0), spec.yaw)
    .add(new THREE.Vector3(spec.x, base, spec.z));
  const direction = new THREE.Vector3(...(subject[`${selectedPart}Direction`] || DIRECTION[selectedPart]))
    .normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), spec.yaw);
  return { center, span: sourceSpan * spec.uniformScale, direction, part: selectedPart, sourceCenter, sourceSpan };
}
