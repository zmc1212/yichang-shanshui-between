#!/usr/bin/env python3
"""Restore road tags only after exact replay of the reviewed source selection.

Uses installed GDAL/GEOS (no network required). Example on managed Linux:
  /usr/bin/python3 scripts/restore-road-metadata.py --source /path/to/source-checkout --write
  /usr/bin/python3 scripts/restore-road-metadata.py --source /path/to/source-checkout --check

The source checkout is read-only. The source SHA, the source commit recorded in
city.json, all 3,600 original road records, and every non-road city field must
match before anything is written. No missing tag is inferred from a neighbour,
road width, a map crossing or an OSM class. The export's historic kind is kept.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import math
from pathlib import Path

from osgeo import gdal, ogr


ROOT = Path(__file__).resolve().parents[1]
SOURCE_COMMIT = '38c01bf002511c01294feacd8aa85e54e6342724'
SOURCE_RELATIVE_FILE = 'dist/data/gis-yichang/roads.geojson'
SOURCE_SHA256 = '5c2241d19f315856f4bbf4c580a38285566345a94c12b680626d0d023c7c27dd'
LEGACY_BOUNDS = [111.225, 30.645, 111.355, 30.755]
LEGACY_CENTER = [111.29, 30.7]
BOUNDS = [111.225, 30.625, 111.39, 30.755]
CENTER = [111.3075, 30.69]
SCALE = .02
RADIUS = 6378137.0
X_METERS = math.pi / 180 * RADIUS * math.cos(math.radians(CENTER[1]))
LEGACY_X_METERS = math.pi / 180 * RADIUS * math.cos(math.radians(LEGACY_CENTER[1]))
Z_METERS = math.pi / 180 * RADIUS
LEGACY_ROADS = 2950
ADDITIONAL_ROADS = 650
ROAD_CLASSES = {'motorway': 0, 'trunk': 1, 'primary': 2, 'secondary': 3,
                'tertiary': 4, 'residential': 5, 'unclassified': 6,
                'living_street': 7, 'service': 8, 'pedestrian': 9,
                'footway': 10, 'cycleway': 10}
LEGACY_KEYS = ('points', 'width', 'kind', 'name')
# Same whitelist as prepare-city-data.py; original strings and numbers survive.
SOURCE_FIELDS = ('osmId', 'highway', 'bridge', 'tunnel', 'layer', 'lanes',
                 'oneway', 'lane_markings', 'widthSource', 'ref', 'access', 'service',
                 'lanes:forward', 'lanes:backward', 'lanes:both_ways', 'crossing')


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def local(lon, lat):
    return ((lon - CENTER[0]) * X_METERS * SCALE, (CENTER[1] - lat) * Z_METERS * SCALE)


def legacy_local(lon, lat):
    return ((lon - LEGACY_CENTER[0]) * LEGACY_X_METERS * SCALE,
            (LEGACY_CENTER[1] - lat) * Z_METERS * SCALE)


def move_legacy_point(point):
    lon = LEGACY_CENTER[0] + point[0] / (LEGACY_X_METERS * SCALE)
    lat = LEGACY_CENTER[1] - point[1] / (Z_METERS * SCALE)
    return [round(value, 3) for value in local(lon, lat)]


def box(min_x, min_y, max_x, max_y):
    ring = ogr.Geometry(ogr.wkbLinearRing)
    # Same exterior sequence as shapely.geometry.box used by the exporter.
    for x, y in [(max_x, min_y), (max_x, max_y), (min_x, max_y),
                 (min_x, min_y), (max_x, min_y)]:
        ring.AddPoint_2D(x, y)
    polygon = ogr.Geometry(ogr.wkbPolygon)
    polygon.AddGeometry(ring)
    return polygon


def project_geometry(geometry, project):
    result = ogr.Geometry(geometry.GetGeometryType())
    if geometry.GetGeometryName() in ('LINESTRING', 'LINEARRING', 'POINT'):
        for index in range(geometry.GetPointCount()):
            result.AddPoint_2D(*project(geometry.GetX(index), geometry.GetY(index)))
    else:
        for index in range(geometry.GetGeometryCount()):
            result.AddGeometry(project_geometry(geometry.GetGeometryRef(index), project))
    return result


def line_parts(geometry):
    if geometry.IsEmpty():
        return
    if geometry.GetGeometryName() == 'LINESTRING':
        yield geometry
    else:
        for index in range(geometry.GetGeometryCount()):
            yield from line_parts(geometry.GetGeometryRef(index))


def road_source_metadata(properties):
    metadata = {key: properties[key] for key in SOURCE_FIELDS if key in properties}
    if 'widthMeters' in properties:
        metadata['sourceWidthMeters'] = properties['widthMeters']
    return metadata


def replay_roads(features):
    """Mirror the two selection pools and GEOS operations of the original export."""
    clip = box(*BOUNDS)
    legacy_clip = box(*LEGACY_BOUNDS)
    expansion_clip = clip.Difference(legacy_clip)
    width = (BOUNDS[2] - BOUNDS[0]) * X_METERS * SCALE
    depth = (BOUNDS[3] - BOUNDS[1]) * Z_METERS * SCALE
    local_clip = box(-width / 2, -depth / 2, width / 2, depth / 2)
    legacy_width = (LEGACY_BOUNDS[2] - LEGACY_BOUNDS[0]) * LEGACY_X_METERS * SCALE
    legacy_depth = (LEGACY_BOUNDS[3] - LEGACY_BOUNDS[1]) * Z_METERS * SCALE
    legacy_local_clip = box(-legacy_width / 2, -legacy_depth / 2,
                            legacy_width / 2, legacy_depth / 2)
    legacy_roads, expansion_roads = [], []
    for feature in features:
        properties = feature['properties']
        kind = properties.get('highway', properties.get('class', '')).replace('_link', '')
        if kind not in ROAD_CLASSES or properties.get('tunnel') in ('yes', 'building_passage'):
            continue
        geometry = ogr.CreateGeometryFromJson(json.dumps(feature['geometry']))
        if not geometry.IsValid():
            geometry = geometry.MakeValid()
        if not geometry.Intersects(clip):
            continue
        for pool, region, project, project_clip in [
            (legacy_roads, legacy_clip, legacy_local, legacy_local_clip),
            (expansion_roads, expansion_clip, local, local_clip),
        ]:
            if not geometry.Intersects(region):
                continue
            projected = project_geometry(geometry.Intersection(region), project)
            projected = projected.SimplifyPreserveTopology(.065).Intersection(project_clip)
            for part in line_parts(projected):
                length = part.Length()
                if length < .16 or (kind in ('service', 'footway', 'cycleway') and length < 1.4):
                    continue
                points = [[round(part.GetX(i), 3), round(part.GetY(i), 3)]
                          for i in range(part.GetPointCount())]
                if len(points) < 2:
                    continue
                width_m = properties.get('widthMeters', {
                    'motorway': 16, 'trunk': 14, 'primary': 12,
                    'secondary': 10, 'tertiary': 8, 'residential': 6,
                }.get(kind, 4))
                road = {'points': points, 'width': round(float(width_m) * SCALE, 3),
                        'kind': 'bridge' if properties.get('bridge') == 'yes' else kind}
                if properties.get('name'):
                    road['name'] = properties['name']
                pool.append((ROAD_CLASSES[kind], -length, properties.get('osmId', ''),
                             road, road_source_metadata(properties)))
    for pool in (legacy_roads, expansion_roads):
        pool.sort(key=lambda row: (row[0], row[1], row[2]))
    chosen = []
    for row in legacy_roads[:LEGACY_ROADS]:
        road = {**row[3], 'points': [move_legacy_point(point) for point in row[3]['points']]}
        chosen.append((road, row[4]))
    chosen.extend((row[3], row[4]) for row in expansion_roads[:ADDITIONAL_ROADS])
    return chosen, len(legacy_roads) + len(expansion_roads)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--city', type=Path, default=ROOT / 'public/data/city.json')
    parser.add_argument('--report', type=Path,
                        default=ROOT / 'docs/iterations/road-source-recovery-20261110.json')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--write', action='store_true', help='Apply verified metadata and write the audit.')
    mode.add_argument('--check', action='store_true', help='Also require all restored tags already match.')
    args = parser.parse_args()
    ogr.UseExceptions()
    source_bytes = (args.source / SOURCE_RELATIVE_FILE).read_bytes()
    actual_sha = hashlib.sha256(source_bytes).hexdigest()
    if actual_sha != SOURCE_SHA256:
        raise ValueError(f'Source snapshot SHA mismatch: {actual_sha}')
    features = json.loads(source_bytes)['features']
    data = json.loads(args.city.read_text())
    meta = data['meta']
    if (meta.get('sourceSnapshotCommit') != SOURCE_COMMIT or meta.get('center') != CENTER
            or meta.get('bounds') != BOUNDS or meta.get('unitsPerMeter') != SCALE):
        raise ValueError('City projection/source identity is not the reviewed export; do not apply this recovery.')
    chosen, candidate_count = replay_roads(features)
    if len(chosen) != len(data['roads']) or len(chosen) != 3600:
        raise ValueError('The original road selection count changed.')
    original_roads = [{key: road[key] for key in LEGACY_KEYS if key in road} for road in data['roads']]
    non_road_hash = digest({key: value for key, value in data.items() if key != 'roads'})
    road_hash = digest(original_roads)
    output_roads = []
    for index, (existing, (replayed, metadata)) in enumerate(zip(data['roads'], chosen)):
        if original_roads[index] != replayed:
            raise ValueError(f'Road {index} failed exact original geometry/width/kind/name comparison; '
                             f'candidate source {metadata.get("osmId")}')
        for key in (*SOURCE_FIELDS, 'sourceWidthMeters'):
            if key in existing and key not in metadata:
                raise ValueError(f'Road {index} has unsupported source field {key}')
        for key, value in metadata.items():
            if key in existing and existing[key] != value:
                raise ValueError(f'Road {index} already has conflicting source field {key}')
            if args.check and existing.get(key) != value:
                raise ValueError(f'Road {index} is missing recovered field {key}')
        output_roads.append({**existing, **metadata})
    data['roads'] = output_roads
    if digest([{key: road[key] for key in LEGACY_KEYS if key in road} for road in output_roads]) != road_hash:
        raise AssertionError('Recovery changed a legacy road field.')
    if digest({key: value for key, value in data.items() if key != 'roads'}) != non_road_hash:
        raise AssertionError('Recovery changed a non-road field.')
    field_counts = {key: sum(key in metadata for _, metadata in chosen)
                    for key in (*SOURCE_FIELDS, 'sourceWidthMeters')}
    report = {
        'date': '2026-11-10', 'sourceSnapshotCommit': SOURCE_COMMIT,
        'sourceFile': SOURCE_RELATIVE_FILE, 'sourceSha256': actual_sha,
        'sourceFeatureCount': len(features), 'replayedCandidates': candidate_count,
        'exactlyMatchedOriginalRoadRecords': len(chosen),
        'legacyRoadCount': LEGACY_ROADS, 'expansionRoadCount': ADDITIONAL_ROADS,
        'legacyRoadFieldsPreserved': list(LEGACY_KEYS),
        'legacyRoadFieldsSha256': road_hash, 'nonRoadCityFieldsSha256': non_road_hash,
        'recoveredFieldCounts': field_counts,
        'selectedHighwayCounts': dict(sorted(collections.Counter(r['highway'] for r in output_roads).items())),
        'legacyBridgeKindCount': sum(r['kind'] == 'bridge' for r in output_roads),
        'legacyBridgeRecoveredHighwayCounts': dict(sorted(collections.Counter(
            r['highway'] for r in output_roads if r['kind'] == 'bridge').items())),
        'sourceBridgeValueCounts': dict(sorted(collections.Counter(
            r['bridge'] for r in output_roads if 'bridge' in r).items())),
        'sourceWidthSourceCounts': dict(sorted(collections.Counter(
            str(r.get('widthSource', '<absent>')) for r in output_roads).items())),
        'sourceLayerValueCounts': dict(sorted(collections.Counter(
            str(r['layer']) for r in output_roads if 'layer' in r).items())),
        'uniqueSelectedOsmIds': len({r['osmId'] for r in output_roads}),
        'geometryEngine': {'gdal': gdal.VersionInfo('--version'),
                           'geos': '.'.join(map(str, [ogr.GetGEOSVersionMajor(),
                                      ogr.GetGEOSVersionMinor(), ogr.GetGEOSVersionMicro()]))},
        'method': 'Replay original WGS84 clipping, GEOS topology-preserving simplification, '
                  'length/class/OSM-ID ordering, separate 2950+650 budgets and legacy recentering; '
                  'require exact equality of every original road record before adding source tags.',
        'limitations': [
            'Missing tags remain absent; no neighbour/class/width-based tag inference was performed.',
            'layer is a relative crossing order, not a bridge elevation in metres.',
            'lanes does not establish whether painted markings exist or where crossings and stop lines are.',
            'The recovered source has no lane_markings, crossing or original OSM node-ID topology.',
            'sourceWidthMeters includes the existing export estimates; it is not a surveyed width.',
            'Original display kind is retained for backwards compatibility; bridge=viaduct must be read independently.',
        ],
        'checks': {'sourceHashMatches': True, 'allOriginalRoadFieldsMatchExactly': True,
                   'allNonRoadCityFieldsPreserved': True, 'sourceCheckoutModified': False},
    }
    if args.write:
        args.city.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'verified': True, 'written': args.write, 'checkExistingMetadata': args.check,
                      'matchedRoads': len(chosen), 'recoveredFieldCounts': field_counts,
                      'legacyBridgeRecoveredHighwayCounts': report['legacyBridgeRecoveredHighwayCounts'],
                      'sourceBridgeValueCounts': report['sourceBridgeValueCounts'],
                      'legacyRoadFieldsSha256': road_hash}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
