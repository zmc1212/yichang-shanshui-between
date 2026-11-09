#!/usr/bin/env python3
"""Export frozen Jiuzhou S01 to GLB, without saving or rebuilding its Blender source.

Run with the official bpy 4.5.x Python environment, for example:
  python export-jiuzhou-web.py --source /path/jiuzhou_fangyuan_s01.blend \
    --output /path/jiuzhou-s01-source.glb

The native candidate was authored/validated in Blender 4.3.2. This is a separate
4.5 export verification, not a claim of reproducing that original renderer.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct

import bpy
import numpy as np

FROZEN_SHA256 = 'c38936dcd1b7b861d918ee823685aa47ae0b1af9b6df296bf3771736932f68fe'
DISPLAY_NAMES = {
    'DISPLAY_ONLY_forecourt_paving',
    'DISPLAY_ONLY_paving_course_bands',
    'DISPLAY_ONLY_low_planting',
}
PRESERVE_NAMES = {
    'Forecourt_two_glass_cover_shells',
    'Forecourt_glass_cover_frames',
    'Source_period_bank_lettering_original_outlines',
    'Crown_continuous_thick_glass',
    'Crown_minor_grid_and_top_trim',
    'CLOSURE_HOLD_back_opposite_side_and_roof',
    'NOT_INTERIOR_front_and_side_support_substrate',
}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def bounds(points):
    return {'min': points.min(axis=0).tolist(), 'max': points.max(axis=0).tolist()}


def to_y_up(points):
    return np.column_stack((points[:, 0], points[:, 2], -points[:, 1]))


def vertex_support(points):
    # glTF splits vertices at normal/material seams. Compare geometric positions
    # independently of that indexing, at 0.00001 normalized model units.
    return {tuple(int(v) for v in row) for row in np.rint(points * 100000).astype(np.int64)}


def world_vertices(obj, mesh):
    return np.asarray([tuple(obj.matrix_world @ v.co) for v in mesh.vertices], dtype=np.float64)


def inspect_native(obj, depsgraph):
    obj.data.calc_loop_triangles()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
    try:
        mesh.calc_loop_triangles()
        points = world_vertices(evaluated, mesh)
        raw = world_vertices(obj, obj.data)
        assert len(raw) == len(points) and np.array_equal(raw, points), f'{obj.name}: changed evaluated coordinates'
        return {
            'name': obj.name, 'vertices': len(points), 'triangles': len(mesh.loop_triangles),
            'nativeBounds': bounds(points), 'gltfBounds': bounds(to_y_up(points)),
            'evidenceStatus': str(obj.get('evidence_status', 'unspecified')),
            'collections': [c.name for c in obj.users_collection],
            'rawEvaluatedCoordinatesEqualInExportRuntime': True,
            'sourceWorldPositionFloat64Sha256': hashlib.sha256(points.tobytes()).hexdigest(),
        }, to_y_up(points)
    finally:
        evaluated.to_mesh_clear()


def prepare_material(material):
    assert material.use_nodes, f'{material.name}: unsupported non-node material'
    shader = next((n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    assert shader is not None, f'{material.name}: no Principled shader'
    record = {
        'name': material.name,
        'baseColorLinear': list(shader.inputs['Base Color'].default_value),
        'metallic': float(shader.inputs['Metallic'].default_value),
        'roughness': float(shader.inputs['Roughness'].default_value),
        'transmission': float(shader.inputs['Transmission Weight'].default_value),
        'ior': float(shader.inputs['IOR'].default_value),
        'clearcoat': float(shader.inputs['Coat Weight'].default_value),
        'clearcoatRoughness': float(shader.inputs['Coat Roughness'].default_value),
        'originalNodeTypes': [n.bl_idname for n in material.node_tree.nodes],
        'approximation': None,
    }
    linked = [socket.name for socket in shader.inputs if socket.is_linked]
    if linked:
        assert material.name in {'Dark_grey_stone_original_PBR', 'CLOSURE_HOLD_neutral_taupe'}, f'Unreviewed procedural material: {material.name}'
        assert set(linked) <= {'Base Color', 'Normal'}, f'Unreviewed shader inputs: {linked}'
        ramp = material.node_tree.nodes.get('Exact_tone_ramp')
        assert ramp is not None
        record['sourceColorRamp'] = [{'position': float(e.position), 'color': list(e.color)} for e in ramp.color_ramp.elements]
        record['approximation'] = {
            'method': 'constant-source-linear-PBR-not-baked',
            'preserved': 'Authored base color, metallic, roughness and transmission; all geometry and normals unchanged.',
            'omitted': 'Object-space Noise/ColorRamp micro-variation and procedural micro-bump. The source base color is the symmetric ramp midpoint. Opaque surfaces use the exporter core glTF response (default IOR1.5 instead of native1.48).',
            'reason': 'Small-scale procedural grain is not directly portable in glTF. This explicit web approximation avoids an unlabelled white-material fallback.',
            'notClaimed': 'Cycles-identical shading, photographic color calibration or field-verified material appearance.',
        }
        for socket in [shader.inputs['Base Color'], shader.inputs['Normal']]:
            for link in list(socket.links):
                material.node_tree.links.remove(link)
        shader.inputs['Base Color'].default_value = tuple(record['baseColorLinear'])
        material['web_material_approximation'] = json.dumps(record['approximation'], ensure_ascii=False)
    return record


def read_glb(path):
    raw = Path(path).read_bytes()
    magic, version, size = struct.unpack_from('<III', raw, 0)
    assert (magic, version, size) == (0x46546C67, 2, len(raw))
    offset = 12
    document = None
    binary = b''
    while offset < len(raw):
        length, chunk_type = struct.unpack_from('<II', raw, offset)
        chunk = raw[offset + 8:offset + 8 + length]
        if chunk_type == 0x4E4F534A:
            document = json.loads(chunk)
        elif chunk_type == 0x004E4942:
            binary = chunk
        offset += 8 + length
    assert document is not None and binary
    assert not document.get('images') and not document.get('textures'), 'No invented or external photo textures'

    def accessor(index):
        a = document['accessors'][index]
        assert not a.get('sparse'), 'Unexpected sparse positions'
        view = document['bufferViews'][a['bufferView']]
        dimensions = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        dtype = {5120: '<i1', 5121: '<u1', 5122: '<i2', 5123: '<u2', 5125: '<u4', 5126: '<f4'}[a['componentType']]
        item_size = np.dtype(dtype).itemsize
        stride = view.get('byteStride', dimensions * item_size)
        start = view.get('byteOffset', 0) + a.get('byteOffset', 0)
        return np.ndarray((a['count'], dimensions), dtype=dtype, buffer=binary, offset=start, strides=(stride, item_size)).copy()

    def matrix(node):
        if 'matrix' in node:
            return np.asarray(node['matrix'], dtype=np.float64).reshape(4, 4, order='F')
        x, y, z, w = node.get('rotation', [0, 0, 0, 1])
        rotation = np.array([[1-2*y*y-2*z*z, 2*x*y-2*z*w, 2*x*z+2*y*w],
                             [2*x*y+2*z*w, 1-2*x*x-2*z*z, 2*y*z-2*x*w],
                             [2*x*z-2*y*w, 2*y*z+2*x*w, 1-2*x*x-2*y*y]], dtype=np.float64)
        result = np.eye(4)
        result[:3, :3] = rotation @ np.diag(node.get('scale', [1, 1, 1]))
        result[:3, 3] = node.get('translation', [0, 0, 0])
        return result

    actual = {}
    def visit(index, parent):
        node = document['nodes'][index]
        world = parent @ matrix(node)
        if 'mesh' in node:
            name = node['name']
            points = []
            triangle_count = 0
            for primitive in document['meshes'][node['mesh']]['primitives']:
                assert primitive.get('mode', 4) == 4
                xyz = accessor(primitive['attributes']['POSITION']).astype(np.float64)
                points.append((world @ np.column_stack((xyz, np.ones(len(xyz)))).T).T[:, :3])
                indices = accessor(primitive['indices']) if 'indices' in primitive else xyz
                triangle_count += len(indices) // 3
            assert name not in actual
            actual[name] = {'positions': np.concatenate(points), 'triangles': triangle_count}
        for child in node.get('children', []):
            visit(child, world)
    for root in document['scenes'][document.get('scene', 0)]['nodes']:
        visit(root, np.eye(4))
    return document, actual


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    assert args.output.suffix.lower() == '.glb' and args.output.resolve() != args.source.resolve()
    assert sha(args.source) == FROZEN_SHA256, 'Wrong or modified native candidate; re-read its current recovery instructions'
    args.output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=str(args.source), load_ui=False)
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    original_meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    assert len(original_meshes) == 28
    kept, excluded, native, expected = [], [], [], {}
    for obj in original_meshes:
        display = obj.name in DISPLAY_NAMES or obj.get('evidence_status') == 'DISPLAY_ONLY' or any('DISPLAY_ONLY' in c.name for c in obj.users_collection)
        visible = obj.visible_get(view_layer=bpy.context.view_layer) and not obj.hide_render
        if display or not visible:
            excluded.append({'name': obj.name, 'reason': 'DISPLAY_ONLY' if display else 'saved-default-hidden', 'visibleInSavedFile': visible})
            continue
        kept.append(obj)
        info, points = inspect_native(obj, depsgraph)
        native.append(info)
        expected[obj.name] = points
    assert len(kept) == 25 and {x['name'] for x in excluded} == DISPLAY_NAMES
    assert PRESERVE_NAMES <= set(expected)
    materials = sorted({s.material for obj in kept for s in obj.material_slots if s.material}, key=lambda m: m.name)
    material_records = [prepare_material(m) for m in materials]
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    for obj in kept:
        obj.select_set(True)
        obj['web_source_sha256'] = FROZEN_SHA256
        obj['web_source_stage'] = 'Jiuzhou Fangyuan S01 c389 native candidate; not surveyed'
    bpy.context.view_layer.objects.active = kept[0]
    result = bpy.ops.export_scene.gltf(
        filepath=str(args.output), export_format='GLB', use_selection=True,
        export_yup=True, export_apply=True, export_normals=True, export_texcoords=True,
        export_tangents=False, export_materials='EXPORT', export_extras=True,
        export_cameras=False, export_lights=False, export_animations=False,
    )
    assert result == {'FINISHED'} and args.output.is_file()
    document, actual = read_glb(args.output)
    assert set(actual) == set(expected), 'Object set changed or display/research context leaked'
    checks = []
    for item in native:
        name = item['name']
        points = actual[name]['positions']
        assert np.isfinite(points).all()
        assert actual[name]['triangles'] == item['triangles'], f'{name}: triangles lost'
        assert vertex_support(points) == vertex_support(expected[name]), f'{name}: source vertex support changed'
        expected_bounds = np.asarray([item['gltfBounds']['min'], item['gltfBounds']['max']])
        actual_bounds = np.asarray([points.min(axis=0), points.max(axis=0)])
        assert np.allclose(expected_bounds, actual_bounds, rtol=0, atol=1e-5), f'{name}: bounds changed'
        checks.append({'name': name, 'nativeVertexCount': item['vertices'], 'gltfVertexCountWithSeams': len(points), 'uniquePositionCount': len(vertex_support(points)), 'triangles': actual[name]['triangles'], 'vertexSupportEqual': True, 'maxBoundsDeviation': float(np.abs(expected_bounds-actual_bounds).max())})
    gltf_materials = {m['name']: m for m in document.get('materials', [])}
    assert set(gltf_materials) == {m['name'] for m in material_records}
    for material in material_records:
        exported = gltf_materials[material['name']]
        pbr = exported['pbrMetallicRoughness']
        extensions = exported.get('extensions', {})
        assert np.allclose(pbr.get('baseColorFactor', [1, 1, 1, 1]), material['baseColorLinear'], atol=1e-6, rtol=0), f"{material['name']}: lost authored base color"
        assert math.isclose(pbr.get('metallicFactor', 1), material['metallic'], abs_tol=1e-6)
        assert math.isclose(pbr.get('roughnessFactor', 1), material['roughness'], abs_tol=1e-6)
        assert math.isclose(extensions.get('KHR_materials_transmission', {}).get('transmissionFactor', 0), material['transmission'], abs_tol=1e-6)
        material['gltfIor'] = extensions.get('KHR_materials_ior', {}).get('ior', 1.5)
        if material['transmission'] > 0:
            assert math.isclose(material['gltfIor'], material['ior'], abs_tol=1e-6)
            coat = extensions.get('KHR_materials_clearcoat', {})
            assert math.isclose(coat.get('clearcoatFactor', 0), material['clearcoat'], abs_tol=1e-6)
            assert math.isclose(coat.get('clearcoatRoughnessFactor', 0), material['clearcoatRoughness'], abs_tol=1e-6)
        else:
            material['opaqueIorNote'] = 'Official exporter omits KHR_materials_ior for these opaque surfaces. glTF uses its default1.5 response; native is1.48. This is not Cycles-identical shading.'
    assert sha(args.source) == FROZEN_SHA256, 'Source Blender bytes changed'
    all_points = np.concatenate(list(expected.values()))
    highrise_points = all_points[all_points[:, 1] >= 15]
    report = {
        'passed': True, 'source': str(args.source), 'nativeSha256Before': FROZEN_SHA256,
        'nativeSha256After': sha(args.source), 'sourceUnchanged': True,
        'originalAuthoringRuntime': 'Blender 4.3.2', 'exportRuntime': bpy.app.version_string,
        'originalRuntimeReconstructionCertified': False,
        'output': str(args.output), 'outputBytes': args.output.stat().st_size, 'outputSha256': sha(args.output),
        'axisConversion': {'nativeUp': '+Z', 'nativeFront': '-Y', 'gltfUp': '+Y', 'gltfFront': '+Z', 'mapping': '[x,y,z] -> [x,z,-y]', 'source': 'parameters depth/2 YT=-D/2, facade at YT; saved overall-front camera at (0,-180,63)'},
        'unitDisclaimer': 'Height100 and depth18 are normalized candidate units, not measured metres.',
        'excluded': excluded, 'keptObjects': len(kept),
        'nativeVerticesRetained': sum(x['vertices'] for x in native),
        'gltfVerticesWithSeams': sum(x['gltfVertexCountWithSeams'] for x in checks),
        'triangles': sum(x['triangles'] for x in native),
        'sourceBoundsGltfYUp': bounds(all_points),
        'highriseAbove15UnitsBoundsGltfYUp': bounds(highrise_points),
        'anchorNote': 'Native tower local origin (0,0,0) retained. Forecourt covers enlarge the full AABB asymmetrically; do not mistake the full envelope for the surveyed tower footprint.',
        'nativeObjects': native, 'independentGlbReadback': checks, 'materials': material_records,
        'gltfExtensionsUsed': document.get('extensionsUsed', []),
        'nativeSavedDefaultVisibilityHonored': True,
        'preservedUnknown': 'CLOSURE_HOLD unseen rear/opposite narrow side/roof and NOT_INTERIOR optical liner remain labelled candidates.',
        'webglVerified': False, 'surveyVerified': False,
    }
    report_path = args.report or args.output.with_suffix('.report.json')
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: report[k] for k in ['passed','output','outputBytes','outputSha256','exportRuntime','keptObjects','nativeVerticesRetained','gltfVerticesWithSeams','triangles','sourceBoundsGltfYUp','sourceUnchanged','webglVerified']}, indent=2))
    print('Report:', report_path)


if __name__ == '__main__':
    main()
