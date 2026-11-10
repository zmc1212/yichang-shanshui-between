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
from shapely.geometry.polygon import orient
from shapely.ops import transform, unary_union
from shapely import make_valid

LEGACY_BOUNDS = [111.225, 30.645, 111.355, 30.755]
LEGACY_CENTER = [111.29, 30.7]
BOUNDS = [111.225, 30.625, 111.39, 30.755]
CENTER = [round((BOUNDS[0]+BOUNDS[2])/2,7), round((BOUNDS[1]+BOUNDS[3])/2,7)]
SCALE = .02
RADIUS = 6378137.0
X_METERS = math.pi/180*RADIUS*math.cos(math.radians(CENTER[1]))
LEGACY_X_METERS = math.pi/180*RADIUS*math.cos(math.radians(LEGACY_CENTER[1]))
Z_METERS = math.pi/180*RADIUS
LEGACY_BUILDINGS = 13800
ADDITIONAL_BUILDINGS = 2200
LEGACY_ROADS = 2950
ADDITIONAL_ROADS = 650
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


def legacy_local(lon, lat, z=None):
    return ((lon-LEGACY_CENTER[0])*LEGACY_X_METERS*SCALE, (LEGACY_CENTER[1]-lat)*Z_METERS*SCALE)


def move_legacy_point(point):
    # Preserve the exact previous selection and simplified shape, changing only
    # its origin/projection. No enlarged-bounds area ranking can evict old blocks.
    lon = LEGACY_CENTER[0] + point[0]/(LEGACY_X_METERS*SCALE)
    lat = LEGACY_CENTER[1] - point[1]/(Z_METERS*SCALE)
    return [round(v,3) for v in local(lon,lat)]


def source_feature_id(feature, source_file):
    value = feature.get('id') or feature.get('properties',{}).get('osmId')
    if value:
        return str(value)
    # Some imported datasets omit IDs. A source-geometry hash is still stable
    # across display budgets, feature order, recentering and clipping.
    payload = json.dumps(feature['geometry'],sort_keys=True,separators=(',',':'))
    return 'geometry-sha256:' + hashlib.sha256((source_file+'\n'+payload).encode()).hexdigest()


def road_source_metadata(properties):
    """Keep original road semantics separate from the historic display kind.

    Missing OSM tags stay absent. In particular, lanes do not establish that
    painted markings exist, and layer is a relative order rather than metres.
    Keep this whitelist in sync with restore-road-metadata.py.
    """
    fields = ('osmId', 'highway', 'bridge', 'tunnel', 'layer', 'lanes',
              'oneway', 'lane_markings', 'widthSource', 'ref', 'access', 'service',
              'lanes:forward', 'lanes:backward', 'lanes:both_ways', 'crossing')
    metadata = {key: properties[key] for key in fields if key in properties}
    if 'widthMeters' in properties:
        metadata['sourceWidthMeters'] = properties['widthMeters']
    return metadata


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


def registered_footprint_sources():
    # Only the source UUIDs replaced by registered authored models receive this
    # precision refinement. Candidate-only Meilian remains ordinary background.
    root = Path(__file__).resolve().parents[1]
    registrations = json.loads((root/'src/data/business-registrations.json').read_text())
    expected = {}
    for registration in registrations.values():
        ids = set(registration.get('replaceSourceFeatureIds', []))
        records = {record['sourceFeatureId']: record for record in registration.get('sourceFootprintRecords', [])}
        if ids != set(records):
            raise ValueError('Registered replacement UUIDs and source-footprint records disagree')
        for feature_id in ids:
            if feature_id in expected:
                raise ValueError(f'Duplicate registered source UUID: {feature_id}')
            expected[feature_id] = records[feature_id]['geometry']
    shouxin = json.loads((root/'docs/models/shouxin-location-evidence/shouxin-candidate-source-feature.geojson').read_text())
    expected[shouxin['id']] = shouxin['geometry']
    if len(expected) != 16:
        raise ValueError('This reviewed precision whitelist must contain exactly 16 registered source UUIDs')
    return expected


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1]/'public/data')
    args=parser.parse_args()
    registered_sources = registered_footprint_sources()
    direct_source_rings = {}
    direct_source_files = {}
    src=args.source/'dist'
    args.output.mkdir(parents=True,exist_ok=True)
    clip=box(*BOUNDS)
    legacy_clip=box(*LEGACY_BOUNDS)
    expansion_clip=clip.difference(legacy_clip)
    width=(BOUNDS[2]-BOUNDS[0])*X_METERS*SCALE
    depth=(BOUNDS[3]-BOUNDS[1])*Z_METERS*SCALE
    local_clip=box(-width/2,-depth/2,width/2,depth/2)
    legacy_width=(LEGACY_BOUNDS[2]-LEGACY_BOUNDS[0])*LEGACY_X_METERS*SCALE
    legacy_depth=(LEGACY_BOUNDS[3]-LEGACY_BOUNDS[1])*Z_METERS*SCALE
    legacy_local_clip=box(-legacy_width/2,-legacy_depth/2,legacy_width/2,legacy_depth/2)
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
    legacy_candidates=[]
    expansion_candidates=[]
    for path in sorted((src/'data/gis-yichang/buildings').glob('*.geojson')):
        features=read_features(path)
        has_used=False
        source_file=str(path.relative_to(args.source))
        for f in features:
            g=safe_shape(f)
            if not g.intersects(clip):continue
            has_used=True
            p=f['properties']
            feature_id=source_feature_id(f,source_file)
            if feature_id in registered_sources:
                if feature_id in direct_source_rings:
                    raise ValueError(f'A registered UUID occurs in more than one source feature: {feature_id}')
                if f['geometry'] != registered_sources[feature_id]:
                    raise ValueError(f'Registered evidence differs from the original WGS84 geometry: {feature_id}')
                original = shape(f['geometry'])
                if original.geom_type != 'Polygon' or not original.is_valid or not legacy_clip.covers(original):
                    raise ValueError(f'Registered source must be one valid, uncut old-city polygon: {feature_id}')
                # Do not simplify or round in the legacy frame. Project the
                # original WGS84 exterior once, retain CCW orientation, then
                # perform the one final 0.001-world-unit quantization.
                exact = orient(transform(local, original), sign=1.0)
                direct_source_rings[feature_id] = ring_points(exact.exterior)
                direct_source_files[feature_id] = source_file
            height=p.get('heightMeters',12)
            if not isinstance(height,(int,float)) or not math.isfinite(height) or height<=0:height=12
            for pool,region,project,project_clip in [
                (legacy_candidates,legacy_clip,legacy_local,legacy_local_clip),
                (expansion_candidates,expansion_clip,local,local_clip),
            ]:
                if not g.intersects(region):continue
                projected=transform(project,g.intersection(region)).simplify(.012,preserve_topology=True).intersection(project_clip)
                for part in polygon_parts(projected):
                    if part.area < .016: continue # 40 m² (pixel-scale LOD omission).
                    ring=ring_points(part.exterior)
                    if len(ring)<3:continue
                    pool.append((part.area,str(f.get('id','')),ring,height,p.get('heightSource','default'),feature_id))
        if has_used:record(path)
    # Retain the previous 13,800 real footprint parts in their previous order.
    # Rank ONLY the added geographic region for its separate 2,200-part budget.
    # Features crossing the old border are clipped into disjoint parts, not
    # duplicated whole on both sides of the selection boundary.
    for pool in [legacy_candidates,expansion_candidates]:
        pool.sort(key=lambda b:(-b[0],b[1],b[2][0]))
    legacy_chosen=legacy_candidates[:LEGACY_BUILDINGS]
    expansion_chosen=expansion_candidates[:ADDITIONAL_BUILDINGS]
    registered_selected = [row[5] for row in legacy_chosen if row[5] in registered_sources]
    if len(registered_selected) != 16 or set(registered_selected) != set(registered_sources):
        raise ValueError('Every registered source UUID must occur once in the retained old-city selection')
    if set(direct_source_rings) != set(registered_sources) or any(row[5] in registered_sources for row in expansion_chosen):
        raise ValueError('Registered precision sources must be complete and confined to the retained selection')
    chosen=legacy_chosen+expansion_chosen
    legacy_geometry=[{'ring':r,'height':round(h*SCALE,3),'base':0} for _,_,r,h,_,_ in legacy_chosen]
    buildings=[{'ring':direct_source_rings[fid] if fid in direct_source_rings else [move_legacy_point(p) for p in r],'height':round(h*SCALE,3),'base':0,'sourceFeatureId':fid} for _,_,r,h,_,fid in legacy_chosen]
    buildings += [{'ring':r,'height':round(h*SCALE,3),'base':0,'sourceFeatureId':fid} for _,_,r,h,_,fid in expansion_chosen]
    height_counts=dict(collections.Counter(v[4] for v in chosen))
    legacy_roads=[]
    expansion_roads=[]
    bridge_paths={}
    road_classes={'motorway':0,'trunk':1,'primary':2,'secondary':3,'tertiary':4,'residential':5,'unclassified':6,'living_street':7,'service':8,'pedestrian':9,'footway':10,'cycleway':10}
    for f in read_features(roads_path):
        p=f['properties']; road_kind=p.get('highway',p.get('class',''))
        base_kind=road_kind.replace('_link','')
        if base_kind not in road_classes:continue
        if p.get('tunnel') in ['yes','building_passage']:continue
        g=safe_shape(f)
        if not g.intersects(clip):continue
        for pool,region,project,project_clip in [
            (legacy_roads,legacy_clip,legacy_local,legacy_local_clip),
            (expansion_roads,expansion_clip,local,local_clip),
        ]:
            if not g.intersects(region):continue
            projected=transform(project,g.intersection(region)).simplify(.065,preserve_topology=True).intersection(project_clip)
            for part in line_parts(projected):
                if part.length<.16:continue
                if base_kind in ['service','footway','cycleway'] and part.length<1.4:continue
                points=[[round(x,3),round(z,3)] for x,z in part.coords]
                if len(points)<2:continue
                # Widths retain the old export's OSM or class/lane-based estimates.
                wm=p.get('widthMeters', {'motorway':16,'trunk':14,'primary':12,'secondary':10,'tertiary':8,'residential':6}.get(base_kind,4))
                obj={'points':points,'width':round(float(wm)*SCALE,3),'kind':'bridge' if p.get('bridge')=='yes' else base_kind}
                if p.get('name'):obj['name']=p['name']
                # Preserve the old shape/width/kind contract while recovering
                # highway/link type, bridge and relative layer independently.
                obj.update(road_source_metadata(p))
                pool.append((road_classes[base_kind],-part.length,p.get('osmId',''),obj))
                if p.get('bridge')=='yes' and p.get('name') in ['至喜长江大桥','夷陵长江大桥']:
                    if pool is legacy_roads:
                        part=transform(lambda x,z:local(LEGACY_CENTER[0]+x/(LEGACY_X_METERS*SCALE),LEGACY_CENTER[1]-z/(Z_METERS*SCALE)),part)
                    bridge_paths.setdefault(p['name'],[]).append((part.length,part,p.get('osmId','')))
    for pool in [legacy_roads,expansion_roads]:
        pool.sort(key=lambda r:(r[0],r[1],r[2]))
    road_candidates=len(legacy_roads)+len(expansion_roads)
    # Keep the historic geometry hash independent of newly retained tags.
    legacy_road_geometry=[{key:r[3][key] for key in ('points','width','kind','name') if key in r[3]} for r in legacy_roads[:LEGACY_ROADS]]
    roads=[{**r[3],'points':[move_legacy_point(p) for p in r[3]['points']]} for r in legacy_roads[:LEGACY_ROADS]]
    roads += [r[3] for r in expansion_roads[:ADDITIONAL_ROADS]]
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
    # The reviewed Zhixi guide point is a stable geographic reference. Changing
    # the board latitude must not re-parameterize that named road midpoint by a
    # few centimetres; its actual model span still resolves from mapped roads.
    zhixi_reference=next(p for p in landmarks if p['id']=='zhixi-bridge')
    zhixi_reference['lon'],zhixi_reference['lat']=zhixi_reference['alignment']['sourcePointLonLat']
    zhixi_reference['x'],zhixi_reference['z']=[round(v,3) for v in local(zhixi_reference['lon'],zhixi_reference['lat'])]
    sources=[
      {'name':'OpenStreetMap 道路与水域','url':'https://www.openstreetmap.org/copyright','license':'ODbL-1.0','asOf':'2026-11-04'},
      {'name':'Overture Maps 建筑轮廓','url':'https://docs.overturemaps.org/guides/buildings/','license':'ODbL-1.0','release':'2026-10-21.0'},
      {'name':'Qian Shi 等，东亚建筑轮廓','url':'https://doi.org/10.5281/zenodo.8174931','license':'CC BY 4.0'},
      {'name':'Yangzi Che 等，3D-GloBFP v3 楼高估算（2020）','url':'https://doi.org/10.5281/zenodo.15459025','license':'CC BY 4.0'},
      {'name':'OpenStreetMap / Overture Maps 公园地块','url':'https://docs.overturemaps.org/attribution/','license':'ODbL-1.0'},
      {'name':'ESA WorldCover 2021 林地','url':'https://doi.org/10.5281/zenodo.7254221','license':'CC BY 4.0'}
    ]
    counts={'buildings':len(buildings),'roads':len(roads),'water':len(water),'parks':len(parks),'landmarks':len(landmarks),'buildingCandidates':len(legacy_candidates)+len(expansion_candidates),'roadCandidates':road_candidates,'heightSources':height_counts}
    coverage_expansion={
        'legacyBounds':LEGACY_BOUNDS,'legacyCenter':LEGACY_CENTER,
        'retainedBuildings':len(legacy_chosen),'addedBuildings':len(expansion_chosen),
        'retainedRoads':len(legacy_road_geometry),'addedRoads':min(len(expansion_roads),ADDITIONAL_ROADS),
        'buildingBudget':LEGACY_BUILDINGS+ADDITIONAL_BUILDINGS,'roadBudget':LEGACY_ROADS+ADDITIONAL_ROADS,
        'legacyBuildingGeometrySha256':hashlib.sha256(json.dumps(legacy_geometry,ensure_ascii=False,separators=(',',':')).encode()).hexdigest(),
        'legacyRoadGeometrySha256':hashlib.sha256(json.dumps(legacy_road_geometry,ensure_ascii=False,separators=(',',':')).encode()).hexdigest(),
        'selectionPolicy':'固定保留旧范围按旧投影及旧排序选出的13,800个建筑部件和2,950段道路；仅在新增地域按原面积/道路级别规则追加最多2,200个建筑部件和650段道路。跨旧边界要素按不相交地域拆分，均保留来源身份。',
        'sourceFeatureIdNote':'建筑保留源feature.id，缺失时用来源文件与未裁切几何SHA256；同一源要素的不同裁切部件可共用sourceFeatureId，不能将数组索引当身份。',
        'registeredFootprintProjection':{
            'count':len(direct_source_rings),
            'sourceFeatureIds':sorted(direct_source_rings),
            'sourceFiles':direct_source_files,
            'policy':'仅16个已注册模型将替换的来源轮廓，按原始WGS84外环一次投影、CCW排序、一次round3；不简化、不经过旧世界坐标取整。原选择顺序、高度与底高不变，其余13,784个旧轮廓完整保留原简化几何。',
        },
    }
    data={'meta':{'name':'宜昌 · 长江微缩城','center':CENTER,'width':round(width,3),'depth':round(depth,3),'unitsPerMeter':SCALE,'bounds':BOUNDS,'counts':counts,'sources':sources,'coordinateSystem':'WGS84 → local x east / z south; planar equirectangular centered at city board','sourceSnapshotCommit':SOURCE_COMMIT,'buildingSelection':'保留旧范围的13,800个真实轮廓部件，新增地域另选最多2,200个；不以扩范围后的统一面积排名挤掉旧街区。仅用于微缩远景LOD，非完整建筑清单。','coverageExpansion':coverage_expansion,'heightNote':'保留旧数据高度：来源标签、楼层×3m、3D-GloBFP 2020 遥感估算；缺失固定12m。均非新增实测。','parkCoverageNote':'绿地数据仅覆盖旧样板区 [111.24,30.68,111.32,30.73]，不是全城区公园目录。','terrainNote':'本数据版本采用平面微缩底板，不附加DEM网格。山体、桥梁结构与树木由场景风格化表现。','landmarkSources':landmark_sources,'bridgeStructureReferences':BRIDGE_STRUCTURE_REFERENCES},'buildings':buildings,'roads':roads,'water':water,'parks':parks,'landmarks':landmarks}
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
- 建筑：保留旧范围{LEGACY_BOUNDS}按旧投影与旧面积排序选出的{len(legacy_chosen):,}个部件，顺序、高度与底高不变。其中{len(registered_sources)}个已注册模型将替换的匹配轮廓按原始WGS84外环一次投影、CCW排序、一次round3，不简化、不经过旧世界坐标取整；其余{len(legacy_chosen)-len(registered_sources):,}个保留原0.6m简化几何并重投影到新中心。新增地域单独按面积追加{len(expansion_chosen):,}个部件，预算{ADDITIONAL_BUILDINGS:,}，不会挤掉旧街区。仅保留外环，庭院在此LOD中不细分。
- 建筑身份：每个部件保留sourceFeatureId，跨旧范围边界按不相交地域分成部件，同一源要素可出现多次。源ID缺失时使用来源文件与完整原几何的SHA256；不使用数组序号代替建筑身份。
- 建筑高度保留来源值与分类，不随机增高。来源标签/楼层/遥感高度都不属于新增实测。
  本输出高度分类：{json.dumps(height_counts,ensure_ascii=False)}。缺失值固定12m。
- 道路：完整保留旧选择{len(legacy_road_geometry):,}段，新增地域按原道路级别与长度规则追加{min(len(expansion_roads),ADDITIONAL_ROADS):,}段，预算{ADDITIONAL_ROADS:,}。优先主干路、次干路、支路和居住街道，包含部分服务道路与步道；不在地面绘制已标注隧道。宽度沿用来源标签或旧导出的道路级别/车道估算。
- 水体：只取已有水域多边形；保留岛屿与足够大的内环；简化2.5m，不以随机河道代替长江。
- 绿地：仅旧样板区公开地块，不是全城区清单；简化5m，并移除水面交叠。树木、山体与地标体量为风格化展示，不可作为真实树木清单或工程数据。
- 地形：本版使用平面微缩底板，未加载DEM，不声称复原真实高程。
- 图形坐标按0.001世界单位取整，仅为压缩，不代表测量精度。

输出数量：{json.dumps(counts,ensure_ascii=False)}

旧选择保留审计：{json.dumps(coverage_expansion,ensure_ascii=False)}

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
    source_text+='''
商务楼宇目录与模型恢复（2026-11-09）
原伍家岗楼宇导图23个项目（含多塔组团，非2026全区统计）：https://df21wknb5.wasee.com/wt/df21wknb5
目录：/data/business-buildings-directory.json
配准证据与待核项：/data/business-buildings-registration.json
本轮恢复8项模型：7项在城市中候选落位，美联1项独立候选预览；其余15项模型待恢复。所有阶段候选均不等于实景验收。
各模型原件未修改；网页派生说明：/models/<model-id>/README.txt。万达/福江仅用修正版；中南研究方案关闭，锦江未用S04。
'''
    (args.output/'sources.txt').write_text(source_text)
    print(json.dumps({'file':str(output),'bytes':output.stat().st_size,'meta':{k:data['meta'][k] for k in ['center','width','depth','bounds','counts']},'landmarks':landmarks},ensure_ascii=False,indent=2))

if __name__=='__main__':main()
