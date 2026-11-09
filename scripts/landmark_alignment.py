"""Reproducible landmark registration; uses only the Python standard library."""
import hashlib
import json
import math
from pathlib import Path

ALIGNMENT_PATH = Path(__file__).with_name('landmark-alignments.json')


def apply_landmark_alignments(landmarks, project):
    """Apply source-based poses; project converts WGS84 into local east/south.

    axisHeadingDeg describes model local +X, clockwise from geographic north.
    Ordered span endpoints take precedence over an explicit axis bearing.
    """
    manifest = json.loads(ALIGNMENT_PATH.read_text())
    by_id = {item['id']: item for item in manifest['landmarks']}
    for landmark in landmarks:
        setting = by_id.get(landmark['id'])
        if not setting:
            continue
        for field in ['axisHeadingDeg', 'frontHeadingDeg']:
            if field in setting:
                landmark[field] = setting[field] % 360
        if 'modelScale' in setting:
            landmark['modelScale'] = setting['modelScale']
        if 'endpointsLonLat' in setting:
            endpoints = [[round(v, 6) for v in project(*p)] for p in setting['endpointsLonLat']]
            a, b = endpoints
            if math.dist(a, b) <= 1:
                raise ValueError(f"Invalid registered span: {landmark['id']}")
            landmark['endpoints'] = endpoints
            landmark['x'], landmark['z'] = [(a[i] + b[i]) / 2 for i in range(2)]
            landmark['lon'], landmark['lat'] = [sum(p[i] for p in setting['endpointsLonLat']) / 2 for i in range(2)]
            landmark['axisHeadingDeg'] = round(math.degrees(math.atan2(b[0] - a[0], a[1] - b[1])) % 360, 6)
            landmark['modelScale'] = 1
            landmark['spanSource'] = setting['method']
        landmark['alignment'] = {key: value for key, value in setting.items()
                                 if key not in {'id', 'axisHeadingDeg', 'frontHeadingDeg', 'modelScale', 'endpointsLonLat'}}
        landmark['alignment']['reviewedAt'] = manifest['reviewedAt']
    return manifest


def alignment_source_text(manifest):
    text = '\n地标方位校准（' + manifest['reviewedAt'] + '）\n'
    text += manifest['coordinateConvention'] + '\n' + manifest['accuracyNote'] + '\n'
    for landmark in manifest['landmarks']:
        text += landmark['id'] + '：' + landmark['note'] + '\n'
    for reference in manifest['references']:
        text += reference['name'] + '：' + reference['url'] + '\n'
    return text + '配置：scripts/landmark-alignments.json；SHA-256 ' + hashlib.sha256(ALIGNMENT_PATH.read_bytes()).hexdigest() + '\n'
