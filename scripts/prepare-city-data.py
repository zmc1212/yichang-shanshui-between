#!/usr/bin/env python3
"""Prepare the miniature city's reproducible, clipped, real-source data.

Requires Python 3.10+ and Shapely 2.x (`python -m pip install shapely`).
Usage:
  python scripts/prepare-city-data.py --source /path/to/yichang-online-checkout

The source checkout is the existing 宜昌Online export, commit
38c01bf002511c01294feacd8aa85e54e6342724. Source coordinates are WGS84.
No random geometry, random height, or inferred POI coordinate is generated.
"""
from __future__ import annotations
import argparse, collections, hashlib, json, math
from pathlib import Path
from landmark_alignment import apply_landmark_alignments, alignment_source_text
from shapely.geometry import shape, box, Polygon, MultiPolygon, LineString, MultiLineString
from shapely.ops import transform, unary_union
from shapely import make_valid

BOUNDS = [111.225, 30.645, 111.355, 30.755]
CENTER = [round((BOUNDS[0]+BOUNDS[2])/2,7), round((BOUNDS[1]+BOUNDS[3])/2,7)]
SCALE = .02
RADIUS = 6378137.0
X_METERS = math.pi/180*RADIUS*math.cos(math.radians(CENTER[1]))
Z_METERS = math.pi/180*RADIUS
MAX_BUILDINGS = 13800
MAX_ROADS = 2950
SOURCE_COMMIT = '38c01bf002511c01294feacd8aa85e54e6342724'

# Visitor copy is intentionally separate from provenance / representation notes.
# These descriptions match the copy reviewed for the current Site.
VISITOR_DESCRIPTIONS = {
    'zhenjiang-pavilion': '飞檐层叠的镇江阁，背靠长江、面向东山，与屈原广场共同构成老城的滨江风景。沿着江岸慢慢走近，在楼阁与江风之间，感受宜昌的悠闲节奏。',
    'gezhouba-dam': '大坝、船闸与宽阔江面，共同构成宜昌独特的工程风景。沿江远望葛洲坝，感受长江的力量，也看看这座城市与水相伴的日常。',
    'zhixi-bridge': '弧形主缆跨过大江，桥梁把江岸与西坝岛连在一起。从江边望去，桥塔、江水和远处山色层层展开，呈现宜昌舒展的跨江风景。',
    'yiling-bridge': '三座桥塔与展开的斜拉索，勾勒出夷陵长江大桥鲜明的轮廓。沿江眺望大桥，把两岸楼群与江南山色一同收入眼底。',
    'mojishan-park': '从长江南岸走进绿意中的山路，视野随着脚步渐渐打开。登高望向江面与对岸楼群，感受宜昌山水相依的城市格局。',
    'tianran-pagoda': '古塔的层叠塔檐，与开阔江面相映成景。沿江散步时在塔旁停一停，看看绿树与水光，感受古老地标融入滨江生活的安静时刻。',
    'xiba-island': '江水环绕的西坝岛，一边是葛洲坝的工程风景，一边是江心岛的日常生活。沿岛岸慢慢走，看看水面、桥梁和两岸城区，换一个角度认识宜昌。',
}

BRIDGE_STRUCTURE_REFERENCES = [
    {
        'name': '中国中铁：宜昌至喜长江大桥通车',
        'note': '至喜大江桥为主跨838米的悬索桥；整个项目另含三江桥与引桥。',
        'url': 'https://www.crecg.com/web/xwzx61/zfgsdt39/2025021110083284204/index.html',
        'verifiedAt': '2026-11-08',
    },
    {
        'name': '湖北公共资源交易平台：桥梁运营方检查与设计项目公告',
        'note': '至喜大江桥为悬索桥，三江桥为主跨210米的高低塔中央索面斜拉桥；夷陵主桥为三塔单索面斜拉桥。',
        'url': 'https://www.hbbidcloud.cn/shengbenji/jyxx/004001/004001003/20240716/19fe53bc-3d2a-4920-8662-e325de050014.html',
        'verifiedAt': '2026-11-08',
    },
    {
        'name': '湖北省文化和旅游厅：宜昌夷陵长江大桥',
        'note': '夷陵长江大桥主桥采用三塔单索面斜拉桥桥型。',
        'url': 'https://wlt.hubei.gov.cn/bmdt/ztzl/zshb/201912/t20191226_1799512.shtml',
        'verifiedAt': '2026-11-08',
    },
    {
        'name': '湖北省住房和城乡建设厅：湖北35座长江大桥 座座身世不凡',
        'note': '夷陵长江大桥的桥塔为倒Y形，主桥为三塔斜拉桥。',
        'url': 'https://zjt.hubei.gov.cn/bmdt/ztzl/hbcjda/dayd/201910/t20191028_82017.shtml',
        'verifiedAt': '2026-11-08',
    },
]


def local(lon, lat, z=None):
    return ((lon-CENTER[0])*X_METERS*SCALE, (CENTER[1]-lat)*Z_METERS*SCALE)


def polygon_parts(g):
    if g.is_empty: return []
    if g.geom_type == 'Polygon': return [g]
    if hasattr(g, 'geoms'): return [p for part in g.geoms for p in polygon_parts(part)]
    return []


def line_parts(g):
    if g.is_empty: return []
    if g.geom_type == 'LineString': return [g]
    if hasattr(g, 'geoms'): return [p for part in g.geoms for p in line_parts(part)]
    return []


def ring_points(ring):
    # Open rings suit Three.Shape. Remove adjacent duplicates introduced by rounding.
    out=[]
    for x,z in list(ring.coords)[:-1]:
        point=[round(x,3),round(z,3)]
        if not out or out[-1] != point: out.append(point)
    if len(out)>1 and out[0]==out[-1]: out.pop()
    return out


def rings_of(poly):
    return [ring_points(poly.exterior)] + [ring_points(r) for r in poly.interiors if Polygon(r).area > .008]


def safe_shape(feature):
    g=shape(feature['geometry'])
    return g if g.is_valid else make_valid(g)


def read_features(path):
    return json.loads(path.read_text())['features']


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1]/'public/data')
    args=parser.parse_args()
    src=args.source/'dist'
    args.output.mkdir(parents=True,exist_ok=True)
    clip=box(*BOUNDS)
    width=(BOUNDS[2]-BOUNDS[0])*X_METERS*SCALE
    depth=(BOUNDS[3]-BOUNDS[1])*Z_METERS*SCALE
    local_clip=box(-width/2,-depth/2,width/2,depth/2)
    inputs=[]
    def record(path):
        inputs.append({'file':str(path.relative_to(args.source)), 'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    roads_path=src/'data/gis-yichang/roads.geojson'
    water_path=src/'data/gis-yichang/water.geojson'
    parks_path=src/'data/riverside-yichang/greenspace.geojson'
    pois_path=src/'pois.json'
    for path in [roads_path,water_path,parks_path,pois_path]: record(path)
    water=[]
    water_local=[]
    for f in read_features(water_path):
        g=safe_shape(f)
        if not polygon_parts(g) or not g.intersects(clip): continue
        g=transform(local,g.intersection(clip)).simplify(.05,preserve_topology=True).intersection(local_clip)
        for part in polygon_parts(g):
            if part.area<.015: continue
            rings=rings_of(part)
            if len(rings[0])<3:continue
            water_local.append(part)
            obj={'rings':rings}
            if f['properties'].get('name'):obj['name']=f['properties']['name']
            elif f['properties'].get('osmId')=='relation/3151691':obj['name']='长江'
            water.append(obj)
    water_union=unary_union(water_local)
    parks=[]
    for f in read_features(parks_path):
        g=safe_shape(f)
        if not g.intersects(clip): continue
        g=transform(local,g.intersection(clip)).simplify(.1,preserve_topology=True).intersection(local_clip)
        # Remove mapped water overlap so a forest render cannot obscure the river.
        if g.intersects(water_union):g=g.difference(water_union)
        for part in polygon_parts(g):
            if part.area<.06:continue
            rings=rings_of(part)
            if len(rings[0])<3:continue
            obj={'rings':rings}
            if f['properties'].get('name'):obj['name']=f['properties']['name']
            parks.append(obj)
    candidates=[]
    for path in sorted((src/'data/gis-yichang/buildings').glob('*.geojson')):
        features=read_features(path)
        has_used=False
        for f in features:
            g=safe_shape(f)
            if not g.intersects(clip):continue
            has_used=True
            p=f['properties']
            g=transform(local,g.intersection(clip)).simplify(.012,preserve_topology=True).intersection(local_clip)
            for part in polygon_parts(g):
                if part.area < .016: continue # 40 m² (pixel-scale LOD omission).
                ring=ring_points(part.exterior)
                if len(ring)<3:continue
                height=p.get('heightMeters',12)
                if not isinstance(height,(int,float)) or not math.isfinite(height) or height<=0:height=12
                candidates.append((part.area,str(f.get('id','')),ring,height,p.get('heightSource','default')))
        if has_used:record(path)
    # Actual footprints, ranked by area for a deterministic LOD. No new building is made.
    candidates.sort(key=lambda b:(-b[0],b[1],b[2][0]))
    chosen=candidates[:MAX_BUILDINGS]
    buildings=[{'ring':r,'height':round(h*SCALE,3),'base':0} for _,_,r,h,_ in chosen]
    height_counts=dict(collections.Counter(v[4] for v in chosen))
    roads=[]
    bridge_paths={}
    road_classes={'motorway':0,'trunk':1,'primary':2,'secondary':3,'tertiary':4,'residential':5,'unclassified':6,'living_street':7,'service':8,'pedestrian':9,'footway':10,'cycleway':10}
    for f in read_features(roads_path):
        p=f['properties']; road_kind=p.get('highway',p.get('class',''))
        base_kind=road_kind.replace('_link','')
        if base_kind not in road_classes:continue
        if p.get('tunnel') in ['yes','building_passage']:continue
        g=safe_shape(f)
        if not g.intersects(clip):continue
        g=transform(local,g.intersection(clip)).simplify(.065,preserve_topology=True).intersection(local_clip)
        for part in line_parts(g):
            if part.length<.16:continue
            if base_kind in ['service','footway','cycleway'] and part.length<1.4:continue
            points=[[round(x,3),round(z,3)] for x,z in part.coords]
            if len(points)<2:continue
            # Widths retain the old export's OSM or class/lane-based estimates.
            wm=p.get('widthMeters', {'motorway':16,'trunk':14,'primary':12,'secondary':10,'tertiary':8,'residential':6}.get(base_kind,4))
            obj={'points':points,'width':round(float(wm)*SCALE,3),'kind':'bridge' if p.get('bridge')=='yes' else base_kind}
            if p.get('name'):obj['name']=p['name']
            roads.append((road_classes[base_kind],-part.length,p.get('osmId',''),obj))
            if p.get('bridge')=='yes' and p.get('name') in ['至喜长江大桥','夷陵长江大桥']:
                bridge_paths.setdefault(p['name'],[]).append((part.length,part,p.get('osmId','')))
    roads.sort(key=lambda r:(r[0],r[1],r[2]))
    road_candidates=len(roads)
    roads=[r[3] for r in roads[:MAX_ROADS]]
    pois={p['id']:p for p in json.loads(pois_path.read_text())}
    # Keep fidelity / presentation notes in metadata, not in visitor copy.
    landmark_profiles={
       'zhenjiang-pavilion':('pavilion','历史文化','江岸名阁 · 老城记忆','临江楼阁与屈原广场构成老城滨江景观。地标造型为微缩展示，公开地图参考定位。'),
       'gezhouba-dam':('dam','水利工程','大国工程 · 长江枢纽','原枢纽区域POI保留在alignment.sourcePointLonLat；模型按保留的坝顶道路西侧大江主体段端点中点落位，宽度、高度与构件仍为微缩示意。'),
       'yiling-bridge':('bridge','城市桥梁','一桥两岸 · 江城连线','横跨宜昌中心城区长江河段的斜拉桥。道路走向来自 OpenStreetMap，桥塔与缆索为微缩示意。'),
       'mojishan-park':('park','山水公园','江南山色 · 俯瞰宜昌','长江南岸的山地公园。点位来自公开地图，微缩山体和树木为风格化表现。'),
       'tianran-pagoda':('pagoda','历史文化','江畔古塔 · 伍家岗','矗立江畔的古塔。点位来自公开地图，塔身层级、材质与比例以微缩示意呈现。'),
       'xiba-island':('park','山水公园','江心绿岛 · 岛岸生活','毗邻葛洲坝的长江江心岛。此参考点表示岛屿区域，并非某座公园或建筑的精确落点。')
    }
    landmarks=[]
    landmark_sources=[]
    # Six existing POIs plus the derived Zhixi reference point form the seven stops.
    for pid in ['zhenjiang-pavilion','gezhouba-dam','yiling-bridge','mojishan-park','tianran-pagoda','xiba-island']:
        p=pois[pid];kind,category,subtitle,representation_note=landmark_profiles[pid]
        lon,lat=p['longitude'],p['latitude'];x,z=local(lon,lat)
        landmarks.append({'id':pid,'name':p['name'],'kind':kind,'x':round(x,3),'z':round(z,3),'category':category,'subtitle':subtitle,'description':VISITOR_DESCRIPTIONS[pid],'lon':lon,'lat':lat})
        landmark_sources.append({'id':pid,'name':p['name'],'coordinateNote':p['coordinateNote'],'representationNote':representation_note,'urls':p['sourceUrls']})
    # Zhixi was not in the old POI list: derive a reference point from its longest
    # named, bridge-tagged OSM road segment, rather than guess a coordinate.
    length,line,osm_id=max(bridge_paths['至喜长江大桥'],key=lambda item:item[0])
    point=line.interpolate(.5,normalized=True);x,z=point.x,point.y
    lon=CENTER[0]+x/(X_METERS*SCALE);lat=CENTER[1]-z/(Z_METERS*SCALE)
    landmarks.insert(2,{'id':'zhixi-bridge','name':'至喜长江大桥','kind':'bridge','x':round(x,3),'z':round(z,3),'category':'城市桥梁','subtitle':'跨江天际线 · 西坝门户','description':VISITOR_DESCRIPTIONS['zhixi-bridge'],'lon':round(lon,7),'lat':round(lat,7)})
    landmark_sources.append({'id':'zhixi-bridge','name':'至喜长江大桥','coordinateNote':'最长同名 bridge=yes OSM 线段按长度取中点，为桥区展示参考而非测量落点。','representationNote':'实际道路几何保留；桥塔、索缆与高度为微缩示意，大江悬索桥与三江斜拉桥按官方结构参考区分。','urls':['https://www.openstreetmap.org/'+osm_id]})
    alignment_manifest = apply_landmark_alignments(landmarks, local)
    sources=[
      {'name':'OpenStreetMap 道路与水域','url':'https://www.openstreetmap.org/copyright','license':'ODbL-1.0','asOf':'2026-11-04'},
      {'name':'Overture Maps 建筑轮廓','url':'https://docs.overturemaps.org/guides/buildings/','license':'ODbL-1.0','release':'2026-10-21.0'},
      {'name':'Qian Shi 等，东亚建筑轮廓','url':'https://doi.org/10.5281/zenodo.8174931','license':'CC BY 4.0'},
      {'name':'Yangzi Che 等，3D-GloBFP v3 楼高估算（2020）','url':'https://doi.org/10.5281/zenodo.15459025','license':'CC BY 4.0'},
      {'name':'OpenStreetMap / Overture Maps 公园地块','url':'https://docs.overturemaps.org/attribution/','license':'ODbL-1.0'},
      {'name':'ESA WorldCover 2021 林地','url':'https://doi.org/10.5281/zenodo.7254221','license':'CC BY 4.0'}
    ]
    counts={'buildings':len(buildings),'roads':len(roads),'water':len(water),'parks':len(parks),'landmarks':len(landmarks),'buildingCandidates':len(candidates),'roadCandidates':road_candidates,'heightSources':height_counts}
    data={'meta':{'name':'宜昌 · 长江微缩城','center':CENTER,'width':round(width,3),'depth':round(depth,3),'unitsPerMeter':SCALE,'bounds':BOUNDS,'counts':counts,'sources':sources,'coordinateSystem':'WGS84 → local x east / z south; planar equirectangular centered at city board','sourceSnapshotCommit':SOURCE_COMMIT,'buildingSelection':'保留裁切后面积最大的 13,800 个真实轮廓部件；仅用于微缩远景 LOD，非完整建筑清单。','heightNote':'保留旧数据高度：来源标签、楼层×3m、3D-GloBFP 2020 遥感估算；缺失固定12m。均非新增实测。','parkCoverageNote':'绿地数据仅覆盖旧样板区 [111.24,30.68,111.32,30.73]，不是全城区公园目录。','terrainNote':'本数据版本采用平面微缩底板，不附加DEM网格。山体、桥梁结构与树木由场景风格化表现。','landmarkSources':landmark_sources,'bridgeStructureReferences':BRIDGE_STRUCTURE_REFERENCES},'buildings':buildings,'roads':roads,'water':water,'parks':parks,'landmarks':landmarks}
    output=args.output/'city.json'
    data['meta']['landmarkAlignment'] = {key: value for key, value in alignment_manifest.items() if key != 'landmarks'}
    output.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n')
    source_text=f'''宜昌 · 长江微缩城 — 数据来源与加工说明

范围：WGS84 {BOUNDS}
中心：{CENTER}；底板约 {width/SCALE/1000:.2f} × {depth/SCALE/1000:.2f} km。
局部坐标：东为 x 正方向，南为 z 正方向；中心 (0,0)，每米 {SCALE} 世界单位。
底板展示比例不表示建筑造型、树木和地标具有测量精度。

数据取自既有 宜昌Online 项目只读导出，源提交 {SOURCE_COMMIT}。
源 roads-water-source.json 标注获取时间 2026-11-04；Overture 版本 2026-10-21.0。
Overture 发布日期不等于影像拍摄或现场调查日期。

署名与许可
© OpenStreetMap contributors; © Overture Maps Foundation.
道路、水域、建筑及组合派生数据库按 ODbL-1.0 提供：
https://opendatacommons.org/licenses/odbl/1-0/
https://www.openstreetmap.org/copyright
https://docs.overturemaps.org/attribution/

East Asian building footprints: Qian Shi et al., A First High-quality Vector Data
of Buildings in East Asian Countries Based on a Comprehensive Large-scale Mapping
Framework. Zenodo, 22 July 2023. DOI:10.5281/zenodo.8174931, CC BY 4.0.
https://doi.org/10.5281/zenodo.8174931
https://creativecommons.org/licenses/by/4.0/

Building height estimates: Yangzi Che et al., 3D-GloBFP v3 (2020), CC BY 4.0.
https://doi.org/10.5281/zenodo.15459025
https://doi.org/10.6084/m9.figshare.28906499.v3
https://doi.org/10.5194/essd-16-5357-2024

© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021)
processed by ESA WorldCover consortium. CC BY 4.0.
https://doi.org/10.5281/zenodo.7254221
https://esa-worldcover.org/en/data-access

处理方法与展示边界
- 不生成虚构城市路网或建筑位置；地理轮廓来自已有真实公开来源。
- 先裁切地理矩形，再转换局部坐标。所有水体、公园、建筑与道路都受底板矩形约束。
- 建筑：轮廓拓扑简化0.6m，选择裁切后面积最大的{len(buildings):,}个部件，省略小型轮廓以控制远景负载；仅保留外环，庭院在此LOD中不细分。
- 建筑高度保留来源值与分类，不随机增高。来源标签/楼层/遥感高度都不属于新增实测。
  本输出高度分类：{json.dumps(height_counts,ensure_ascii=False)}。缺失值固定12m。
- 道路：优先主干路、次干路、支路和居住街道，包含部分服务道路与步道；不在地面绘制已标注隧道。宽度沿用来源标签或旧导出的道路级别/车道估算。
- 水体：只取已有水域多边形；保留岛屿与足够大的内环；简化2.5m，不以随机河道代替长江。
- 绿地：仅旧样板区公开地块，不是全城区清单；简化5m，并移除水面交叠。树木、山体与地标体量为风格化展示，不可作为真实树木清单或工程数据。
- 地形：本版使用平面微缩底板，未加载DEM，不声称复原真实高程。
- 图形坐标按0.001世界单位取整，仅为压缩，不代表测量精度。

输出数量：{json.dumps(counts,ensure_ascii=False)}

地标参考点来源
'''
    for p in landmark_sources:
        source_text+='\n'+p['name']+'\n'+p['coordinateNote']+'\n'+p['representationNote']+'\n'+'\n'.join(p['urls'])+'\n'
    source_text+='\n复现：python scripts/prepare-city-data.py --source /path/to/original-checkout\n'
    source_text+='\n输入文件 SHA-256\n'+'\n'.join(v['sha256']+'  '+v['file'] for v in inputs)+'\n'
    source_text+='\n桥梁结构参考（2026-11-08核验）\n'
    for reference in BRIDGE_STRUCTURE_REFERENCES:
        source_text+=reference['note']+'\n'+reference['name']+'：'+reference['url']+'\n'
    source_text+=alignment_source_text(alignment_manifest)
    (args.output/'sources.txt').write_text(source_text)
    print(json.dumps({'file':str(output),'bytes':output.stat().st_size,'meta':{k:data['meta'][k] for k in ['center','width','depth','bounds','counts']},'landmarks':landmarks},ensure_ascii=False,indent=2))

if __name__=='__main__':main()
