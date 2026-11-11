import registry from '../data/business-registry.json' with { type: 'json' };
import models from '../data/business-models.json' with { type: 'json' };
import registrations from '../data/current23-registrations.json' with { type: 'json' };
import currentModels from '../data/current23-models.json' with { type: 'json' };
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

// The source registry remains exactly 23 projects. Only the selected default
// is placed; alternative study/time-period models must never be stacked here.
export const BUSINESS_BUILDINGS=registry.rows.map(row=>{
  const previous=row.sourceSceneId==='1649136'?shouxin:models[row.sourceSceneId];
  const current=currentModels[row.sourceSceneId];
  const registration=registrations[row.sourceSceneId];
  if(!current?.assets?.light||!registration)throw new Error(`缺少沙盘接入资料 ${row.sourceSceneId}`);
  const name=registry.displayNames[row.sourceSceneId]||row.sourceName;
  const approximate=Boolean(registration.approximate);
  const holdText=[current.holds?.identity_note,current.holds?.scope_and_remaining_holds].filter(Boolean).join(' ');
  const shortStages={1:'S05',2:'S09',3:'E',4:'S01',5:'E',6:'运营入口 r3',7:'S01',8:'E',9:'J',10:'H',11:'F',12:'F',13:'I',14:'H',15:'H',16:'J',17:'I',18:'H',19:'I',20:'I',21:'F',22:'K',23:'G'};
  return {
    ...(previous||{}), ...current,
    id:previous?.id||`business-${row.sourceSceneId}`,name,business:true,
    sourceName:row.sourceName,sourceSceneId:row.sourceSceneId,
    sourceMarkerId:row.sourceMarkerId,order:row.order,
    aliases:[...new Set([row.sourceName,...row.aliases])],
    category:'商务楼宇',kind:'authored',placement:'city',previewOnly:false,
    modelStatus:'available',approximatePlacement:approximate,
    stage:`${shortStages[current.order]} · ${approximate?'近似落位':'外观候选'}`,
    sourcePeriod:row.sourcePeriod,sourceUrl:registry.sourceUrl,
    location:`宜昌 · 伍家岗区${row.sourceAddress}`,
    lon:registration.anchorLonLat[0],lat:registration.anchorLonLat[1],
    sourceMarker:{coordinateSystem:'GCJ-02',lonLat:row.sourceMarkerLonLat,sceneId:row.sourceSceneId},
    registration,
    subtitle:previous?.subtitle||'让建筑回到街区，在沙盘中查看完整候选。',
    description:previous?.description||`${name}已接入沙盘，采用最新默认外观候选。位置与展示比例的核实边界见模型说明。`,
    caveat:`${approximate?'原导图参考点附近展示，位置、朝向及高度为展示候选，并非已核准的真实楼心或测绘尺寸。':'保留原地图配准；新模型采用同一等比变换，新增裙房和入口仍需实景复核。'} ${holdText}`,
    coverage:{title:'最新默认外观候选',scope:current.stage,missing:holdText||'真实尺寸、隐藏面及拍摄时期待核',identity:current.holds?.identity?'unconfirmed':'matched'},
    inspectionPresets:!approximate,
  };
});

export const AUTHORED_MODELS=BUSINESS_BUILDINGS.filter(row=>row.kind==='authored');
export const BUSINESS_REGISTRY_INFO={count:registry.markerCount,sourceUrl:registry.sourceUrl,
  note:'原商务楼宇导图的23个项目，含多塔组团；不代表2026年全区楼宇总数。'};
