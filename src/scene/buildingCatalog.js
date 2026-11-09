import registry from '../data/business-registry.json' with { type: 'json' };
import models from '../data/business-models.json' with { type: 'json' };
import registrations from '../data/business-registrations.json' with { type: 'json' };
import { SHOUXIN_REGISTRATION } from './authoredPlacement.js';

const shouxin={
  id:'shouxin-wealth-s01',stage:'S01 外观候选',front:'+Z',
  subtitle:'一格幕墙，一座城市的细节。',
  description:'沿江大道旁，米白竖肋与青蓝幕墙勾勒出首信财富中心的轮廓。主立面面向江边，裙房、窗格与顶部冠架共同保留了这座楼的辨识度。',
  caveat:'位置与朝向依据原导图及地图轮廓配准，未作现场测绘。模型保持原形比，绝对尺寸、精确方位、背面与屋顶仍待复核；字牌保留参考时期外观。',
  sourceBounds:{min:[-20.43000030517578,0,-14.0649995803833],max:[20.43000030517578,97.94000244140625,14.065000534057617]},
  displayHeight:1.6228058571002701,flatShading:true,
  assets:{light:'/models/shouxin-s01/light.glb?v=s01-20261109-1',detail:'/models/shouxin-s01/detail.glb?v=s01-20261109-1'},
  modelNotesUrl:'/models/shouxin-s01/README.txt',registrationUrl:'/models/shouxin-s01/REGISTRATION.txt',
};

export const BUSINESS_BUILDINGS=registry.rows.map(row=>{
  const model=row.sourceSceneId==='1649136'?shouxin:models[row.sourceSceneId];
  const registration=row.sourceSceneId==='1649136'?SHOUXIN_REGISTRATION:registrations[row.sourceSceneId];
  const available=Boolean(model?.assets?.light&&registration);
  const name=registry.displayNames[row.sourceSceneId]||row.sourceName;
  const evidence=registry.recoveryEvidence[row.sourceSceneId];
  return {
    id:model?.id||`business-${row.sourceSceneId}`,name,business:true,
    sourceName:row.sourceName,sourceSceneId:row.sourceSceneId,
    sourceMarkerId:row.sourceMarkerId,order:row.order,
    aliases:[...new Set([row.sourceName,...row.aliases])],
    category:'商务楼宇',kind:available?'authored':'business-poi',
    placement:available?'city':'poi',
    modelStatus:available?'available':model?'registration-pending':'recovery-pending',
    sourcePeriod:row.sourcePeriod,
    sourceUrl:registry.sourceUrl,
    location:`宜昌 · 伍家岗区${row.sourceAddress}`,
    lon:row.convertedMarkerWgs84[0],lat:row.convertedMarkerWgs84[1],
    sourceMarker:{coordinateSystem:'GCJ-02',lonLat:row.sourceMarkerLonLat,sceneId:row.sourceSceneId},
    registration:registration||{label:'导览参考位置 · 楼体轮廓待核准',coordinateSystem:'WGS84',anchorLonLat:row.convertedMarkerWgs84},
    subtitle:model?.subtitle||'沿着城市导图，认识伍家岗的楼宇。',
    description:model?.description||`${name}是原伍家岗商务楼宇导图中的一处楼宇项目。这里先保留导览参考位置，方便在江岸与街区中查找。恢复可用模型后，将继续校准楼体轮廓和朝向。`,
    caveat:model?.caveat||`${evidence||'当前尚未恢复到可直接使用的原生模型或网页文件。'}导览点已经转换到沙盘坐标系，但不等于精确楼体中心；原导图反映历史资料，不代表当前经营状态。`,
    ...(model||{}),
  };
});

export const AUTHORED_MODELS=BUSINESS_BUILDINGS.filter(row=>row.kind==='authored');
export const BUSINESS_REGISTRY_INFO={count:registry.markerCount,sourceUrl:registry.sourceUrl,
  note:'原商务楼宇导图的23个项目，含多塔组团；不代表2026年全区楼宇总数。'};
