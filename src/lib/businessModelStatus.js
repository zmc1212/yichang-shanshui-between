// Geometry availability and geographic placement are separate facts. A partial
// facade can be viewed without becoming a registered building in the city.
export function hasIndependentPreview(building) {
  return Boolean(building?.business && building.kind === 'business-poi' && building.assets?.light);
}

export function businessStatus(building) {
  if (building?.modelStatus === 'available') return '自建模型 · 阶段候选';
  if (building?.modelStatus === 'partial-ready') return '局部模型 · 可预览';
  if (building?.modelStatus === 'identity-review') return '研究模型 · 身份待核';
  if (building?.modelStatus === 'registration-pending') return building.assets?.light ? '独立预览 · 待配准' : '模型待配准';
  return '导览点 · 模型待恢复';
}

export function previewActionLabel(building) {
  return building?.modelStatus === 'identity-review' ? '查看研究模型'
    : building?.modelStatus === 'partial-ready' ? '查看局部模型' : '查看候选模型';
}

export function previewScopeLabel(building) {
  return building?.modelStatus === 'identity-review' ? '局部可见面 · 主体身份待核'
    : building?.modelStatus === 'partial-ready' ? '已知范围预览 · 非完整楼宇' : '独立查看 · 地图配准待核准';
}
