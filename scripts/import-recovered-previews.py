"""Create web-only preview derivatives from the 15 verified native exports.

Source Blender files stay in their source archive. This script does not assign
map coordinates, change city footprints, or complete unknown building surfaces.
Run with --sources source-manifest.json --coverage preview-coverage.json
  --exports /path/to/raw-glbs --tools /path/to/gltf-tools.
"""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--sources', required=True, type=Path)
parser.add_argument('--coverage', required=True, type=Path)
parser.add_argument('--exports', required=True, type=Path)
parser.add_argument('--tools', required=True, type=Path)
parser.add_argument('--reuse-optimized', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
sources = json.loads(args.sources.read_text())['sources']
coverage = json.loads(args.coverage.read_text())
export_records = {str(item['sourceSceneId']): item for item in json.loads((args.exports / 'export-manifest.json').read_text())['exports']}
models_path = root / 'src/data/business-models.json'
models = json.loads(models_path.read_text())
records = []
sha256 = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()

for source in sources:
    scene_id = str(source['sourceSceneId'])
    note = coverage[scene_id]
    native = Path(source['localPath'])
    assert sha256(native) == source['actualSha256'], f'{scene_id}: original changed'
    raw = args.exports / f'{scene_id}.glb'
    assert raw.is_file(), f'{scene_id}: verified raw export required'
    exported = export_records[scene_id]
    assert exported['status'] == 'exported'
    assert exported['sourceSha256'] == exported['sourceSha256AfterExport'] == source['actualSha256']
    assert exported['exportSha256'] == sha256(raw), f'{scene_id}: mismatched raw export'
    folder = root / 'public/models' / f'preview-{scene_id}'
    if not args.reuse_optimized:
        subprocess.run([
            'node', str(root / 'scripts/optimize-building-models.mjs'),
            '--tools', str(args.tools), '--input', str(raw), '--output', str(folder),
            '--id', f'business-{scene_id}', '--ratio', '.65', '--error', '.0001',
        ], check=True, cwd=root)
    web = json.loads((folder / 'web-manifest.json').read_text())
    assert web['sourceSha256'] == sha256(raw)
    light, detail = web['tiers']['light'], web['tiers']['detail']
    single_asset = bool(web.get('singlePreviewAsset')) or (detail['bytes'] <= light['bytes'] and (
        detail['triangles'] < 20000 or light['triangles'] / detail['triangles'] > .9))
    if single_asset and not web.get('singlePreviewAsset'):
        # Source normals compress better than regenerated flat normals for these
        # small facades. Use the complete geometry once when a second tier has
        # no useful GPU saving; do not offer a redundant quality switch.
        full_bytes = (folder / 'detail.glb').read_bytes()
        (folder / 'light.glb').write_bytes(full_bytes)
        (folder / 'detail.glb').unlink()
        web['tiers']['light'] = dict(detail)
        web['singlePreviewAsset'] = True
        web['previewPolicy'] = 'One compressed full-geometry derivative; source triangles and source normals retained. Both quality references share this file.'
        (folder / 'web-manifest.json').write_text(json.dumps(web, ensure_ascii=False, indent=2) + '\n')
    source_url = ('https://github.com/zmc1212/china-landmarks-hubei/blob/'
                  + note['sourceCommit'] + '/' + note['sourceGitPath'])
    scope = {
        'type': 'partial',
        'identity': 'unconfirmed' if source['identityHold'] else 'candidate',
        'title': note['previewTitle'], 'scope': note['scope'],
        'missing': note['missingScope'],
        'isWholeBuildingValidated': False,
        'isHistoricalOriginalRecovered': False,
        'unitsAreMeasuredMeters': False,
    }
    if note.get('identityNote'):
        scope['identityNote'] = note['identityNote']
    caveat = ('本次接入的是新建可见范围候选，历史完整原稿仍待恢复。'
              '未核实的背衬或技术厚度保留源模型状态，不代表实际墙体、楼体进深或测绘尺寸。'
              '占地与地理朝向尚未配准，地图继续显示原导览参考点。')
    if source['identityHold']:
        caveat = note['identityNote'] + ' ' + caveat
    model = {
        # Preserve pre-existing tour/deep-link IDs for all formerly pending rows.
        'id': f'business-{scene_id}',
        'stage': source['sourceStage'].split('：', 1)[-1],
        'front': '+Z', 'previewOnly': True,
        'previewDefaultAngle': note['defaultView'],
        'subtitle': note['previewTitle'],
        'description': note['scope'] + ' ' + note['missingScope'],
        'caveat': caveat, 'coverage': scope,
        'sourceBounds': web['sourceBounds'], 'displayHeight': 8,
        'flatShading': False,
        'assets': {tier: f'/models/preview-{scene_id}/{"light" if single_asset else tier}.glb?v={web["tiers"][tier]["sha256"][:12]}'
                   for tier in ['light', 'detail']},
        'modelNotesUrl': f'/models/preview-{scene_id}/README.txt',
        'sourceModelSha256': source['actualSha256'],
        'sourceNativeSha256': source['actualSha256'],
        'sourceNativeFilename': source['nativeFilename'],
        'sourceModelUrl': source_url,
        'webBudget': {tier: {key: web['tiers'][tier][key]
                            for key in ['bytes', 'triangles', 'primitives', 'estimatedTextureBytesRGBA8WithMipmaps']}
                      for tier in ['light', 'detail']},
    }
    models[scene_id] = model
    readme = '\n'.join([
        note['previewTitle'], '', '模型性质：' + ('身份待核研究模型' if source['identityHold'] else '局部可见范围候选'),
        '已建范围：' + note['scope'], '尚缺部分：' + note['missingScope'],
        note.get('identityNote', ''), '', caveat, '',
        '原生文件：' + source['nativeFilename'], '原生 SHA256：' + source['actualSha256'],
        '固定来源：' + source_url, '模型阶段：' + note['sourceStage'], '',
        '网页转换：默认可见网格；仅剔除明确展示底座；不自动拼装分离研究件；不补建未知面。',
        ('几何保持三轴等比。使用单份已合批压缩的完整源几何，保留源导出的三角形数量。' if single_asset else
         '几何保持三轴等比。轻量层使用受限简化；细节层保留源导出的三角形数量。'),
        '网页材质沿用源基础色，透明玻璃按不透明微缩风格处理；不代表材质实测。',
        '此网页派生资源不修改原生文件，不解除模型身份、完整性、绝对尺度或地理配准待核项。',
        '', '原模型范围说明：', *source['sourceLimitations'], '',
    ])
    (folder / 'README.txt').write_text(readme)
    records.append({
        'sceneId': scene_id, 'name': source['name'], 'id': model['id'],
        'coverage': scope, 'sourceNativeFilename': source['nativeFilename'],
        'sourceNativeSha256': source['actualSha256'], 'sourceUrl': source_url,
        'rawExportSha256': web['sourceSha256'],
        'selectedMeshCount': source['exportSelection']['exportMeshCount'],
        'excludedPresentationObjects': source['exportSelection']['excludeObjectNames'],
        'sourceBounds': web['sourceBounds'], 'sourceTriangles': web['sourceTriangles'],
        'webBudget': model['webBudget'], 'assets': model['assets'],
        'newCityPlacement': False,
    })
    print(json.dumps({'sceneId': scene_id, 'name': source['name'], 'webBytes': web['tiers']['light']['bytes'] if single_asset else sum(t['bytes'] for t in web['tiers'].values())}, ensure_ascii=False), flush=True)

assert len(records) == 15
models_path.write_text(json.dumps(models, ensure_ascii=False, indent=2) + '\n')
record = {'date': '2026-11-10', 'count': len(records),
          'partialCandidates': 14, 'identityReview': 1, 'newCityPlacements': 0,
          'historicalCompleteSourcesRecovered': 0, 'records': records}
archive = root / 'docs/models/recovered-previews-20261110'
archive.mkdir(parents=True, exist_ok=True)
(archive / 'integration-records.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
(root / 'public/data/recovered-model-previews.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
print('Imported all 15 preview-only records; city registrations unchanged.', flush=True)
