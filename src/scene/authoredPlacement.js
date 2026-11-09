import * as THREE from 'three';

// See docs/models/shouxin-geographic-registration-20261109.md. The original
// tour marker is GCJ-02; the anchor below is the matched WGS84 footprint centre,
// not the marker itself and not a surveyed building control point.
export const SHOUXIN_REGISTRATION = {
  label: '已按地图轮廓落位 · 非实测配准',
  method: 'tour-gcj02-poi-and-source-footprint-match',
  coordinateSystem: 'WGS84',
  anchorLonLat: [111.3168215, 30.669877],
  sourceMarker: { coordinateSystem: 'GCJ-02', lonLat: [111.322369, 30.667704], sceneId: '1649136' },
  convertedMarkerApproxLonLat: [111.3166341065, 30.6701041776],
  sourceFeatureId: '809fc574-f994-4778-9992-3c3435682f32',
  sourceSnapshotCommit: '38c01bf002511c01294feacd8aa85e54e6342724',
  sourceFile: 'dist/data/gis-yichang/buildings/b_05_02.geojson',
  footprintLonLat: [[111.316902,30.669673],[111.316576,30.669921],[111.316741,30.670081],[111.317067,30.669833]],
  frontBearingDeg: 221.5001184,
  orientationMethod: 'footprint-long-axis-and-documented-river-facing-positive-z',
  footprintInsetMeters: 0.25,
  sourceHeightMeters: 96,
  sourceHeightMethod: 'map-tag-not-survey',
  scaleMethod: 'one-scalar-inscribed-in-mapped-footprint',
  contextHeight: { innerMeters: 120, outerMeters: 300, nearFactor: 1 },
  uncertainty: '楼体身份由原导图、门牌与底图匹配；轮廓细节、绝对尺寸与精确真北方位仍待实测复核。',
};

export function projectWgs84([lon, lat], meta) {
  const [centerLon, centerLat] = meta.center;
  const metresPerDegree = Math.PI / 180 * 6378137;
  return [(lon - centerLon) * metresPerDegree * Math.cos(centerLat * Math.PI / 180) * meta.unitsPerMeter,
    (centerLat - lat) * metresPerDegree * meta.unitsPerMeter];
}

export function resolveAuthoredPlacement(spec, meta) {
  const registration = spec.registration;
  if (spec.placement !== 'city' || registration?.coordinateSystem !== 'WGS84') return null;
  const [x, z] = projectWgs84(registration.anchorLonLat, meta);
  const yaw = THREE.MathUtils.degToRad(180 - registration.frontBearingDeg);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const sourceFootprint = registration.footprintLonLat.map(point => projectWgs84(point, meta));
  const local = sourceFootprint.map(([px, pz]) => [(px - x) * c - (pz - z) * s, (px - x) * s + (pz - z) * c]);
  // Insets include the source footprint rounding tolerance. Fit both axes with
  // ONE scale; the whole building keeps its authored aspect ratio.
  const inset = registration.footprintInsetMeters * meta.unitsPerMeter;
  const halfWidth = Math.min(...local.map(p => Math.abs(p[0]))) - inset;
  const halfDepth = Math.min(...local.map(p => Math.abs(p[1]))) - inset;
  const sourceSize = new THREE.Vector3(...spec.sourceBounds.max).sub(new THREE.Vector3(...spec.sourceBounds.min));
  const uniformScale = Math.min(halfWidth * 2 / sourceSize.x, halfDepth * 2 / sourceSize.z);
  if (!(uniformScale > 0) || !Number.isFinite(uniformScale)) throw new Error(`${spec.name}缺少有效的地图轮廓比例`);
  const displayHeight = sourceSize.y * uniformScale;
  const size = sourceSize.multiplyScalar(uniformScale);
  const footprint = [[-size.x/2,-size.z/2],[size.x/2,-size.z/2],[size.x/2,size.z/2],[-size.x/2,size.z/2]]
    .map(([px,pz]) => [x + px * c + pz * s, z - px * s + pz * c]);
  return { ...spec, x, z, lon: registration.anchorLonLat[0], lat: registration.anchorLonLat[1], yaw,
    uniformScale, displayHeight, scalePolicy: 'uniform-mapped-footprint-fit-not-survey',
    footprint, sourceFootprint, localSize: size, unitsPerMeter: meta.unitsPerMeter };
}

export function authoredWorldBounds(spec, base) {
  const { localSize: size } = spec;
  const bounds = new THREE.Box3(new THREE.Vector3(-size.x/2, 0, -size.z/2), new THREE.Vector3(size.x/2, size.y, size.z/2));
  const transform = new THREE.Matrix4().makeRotationY(spec.yaw);
  transform.setPosition(spec.x, base, spec.z);
  return bounds.applyMatrix4(transform);
}

function inside(point, ring) {
  let hit = false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if ((a[1]>point[1]) !== (b[1]>point[1]) && point[0] < (b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0]) hit=!hit;
  }
  return hit;
}

export function footprintsOverlap(a, b) {
  if (a.some(p=>inside(p,b)) || b.some(p=>inside(p,a))) return true;
  const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
  for (let i=0;i<a.length;i++) for (let j=0;j<b.length;j++) {
    const a0=a[i],a1=a[(i+1)%a.length],b0=b[j],b1=b[(j+1)%b.length];
    if(cross(a0,a1,b0)*cross(a0,a1,b1)<-1e-14 && cross(b0,b1,a0)*cross(b0,b1,a1)<-1e-14) return true;
  }
  return false;
}

export function planAuthoredGround(models, data, farHeightFactor) {
  const omittedBuildingIndices = new Set();
  for (let i=0;i<(data.buildings||[]).length;i++) {
    if (models.some(model=>footprintsOverlap(model.footprint,data.buildings[i].ring))) omittedBuildingIndices.add(i);
  }
  return {
    omittedBuildingIndices,
    heightFactor(x,z) {
      let factor=farHeightFactor;
      for (const model of models) {
        const policy=model.registration.contextHeight;
        const distance=Math.hypot(x-model.x,z-model.z)/model.unitsPerMeter;
        const t=THREE.MathUtils.clamp((distance-policy.innerMeters)/(policy.outerMeters-policy.innerMeters),0,1);
        factor=Math.min(factor,policy.nearFactor+(farHeightFactor-policy.nearFactor)*t*t*(3-2*t));
      }
      return factor;
    },
    reserveTree(x,z) {
      return models.some(model=>{
        const c=Math.cos(model.yaw),s=Math.sin(model.yaw),dx=x-model.x,dz=z-model.z;
        return Math.abs(dx*c-dz*s)<model.localSize.x/2+0.16 && Math.abs(dx*s+dz*c)<model.localSize.z/2+0.16;
      });
    },
  };
}
