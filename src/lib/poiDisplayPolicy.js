// Display importance is an editorial guide, never a change to map coordinates,
// model availability, registration evidence or directory membership.
const LANDMARK_PRIORITY = {
  'zhenjiang-pavilion': 150,
  'gezhouba-dam': 148,
  'yiling-bridge': 144,
  'zhixi-bridge': 142,
  'tianran-pagoda': 140,
  'mojishan-park': 136,
  'xiba-island': 130,
};
const BUILDING_PRIORITY = {
  '万达 SOHO': 90,
  '首信财富中心': 88,
  '宜昌国际广场': 86,
  '中南冶金大楼': 84,
  '锦江银座': 82,
  '福江铭座': 80,
  '九州方园大厦': 78,
};

export function poiDisplayPriority(place) {
  if (!place?.business) return LANDMARK_PRIORITY[place?.id] || 120;
  if (place.modelStatus === 'available') return BUILDING_PRIORITY[place.name] || 70;
  return place.modelStatus === 'registration-pending' ? 35 : 20;
}

export function poiDisplayName(place) {
  return place?.id === 'gezhouba-dam' ? '葛洲坝' : place?.name || '地点';
}
