#!/usr/bin/env python3
"""Read-only .blend -> GLB preview export for the recovered Yichang candidate models.

Example (Blender 4.3.2):
blender --background --factory-startup --disable-autoexec -t 2 \
  -P export-preview-models.py -- \
  --manifest /absolute/path/source-manifest.json \
  --output-dir /absolute/path/model-recovery-exports

Use --scene-id ID (repeatable) for a subset. --resume reuses only a recorded
output whose file SHA and source SHA still match. --overwrite explicitly
replaces earlier derived GLB files. Source .blend files are never saved.
"""
import argparse
import datetime
import hashlib
import json
import math
import os
import pathlib
import struct
import sys
import time
import traceback

import bpy
from mathutils import Matrix, Quaternion, Vector

EXCLUDED_PRESENTATION_OBJECTS = {"Display_plinth", "Presentation_plinth"}
EXPORT_SCHEMA = "yichang-native-preview-export/1"
ALL_RECORDS = {}


def file_sha256(path):
    digest = hashlib.sha256()
    with pathlib.Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def write_json_atomic(path, value):
    path = pathlib.Path(path)
    temporary = path.with_name(path.name + ".writing")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def finite_vector(values):
    return all(math.isfinite(float(x)) for x in values)


def vector_bounds(points):
    points = list(points)
    if not points:
        return None
    lo = [min(float(p[i]) for p in points) for i in range(3)]
    hi = [max(float(p[i]) for p in points) for i in range(3)]
    if not finite_vector(lo + hi):
        raise ValueError("Non-finite geometry bounds")
    return {"min": lo, "max": hi, "size": [hi[i] - lo[i] for i in range(3)]}


def rna_export_options(filepath):
    requested = {
        "filepath": str(filepath),
        "export_format": "GLB",
        "use_selection": True,
        "export_apply": True,
        "export_yup": True,
        "export_animations": False,
        "export_cameras": False,
        "export_lights": False,
        "export_materials": "EXPORT",
        "export_image_format": "AUTO",
        "export_texcoords": True,
        "export_normals": True,
        "export_tangents": False,
        "export_skins": False,
        "export_morph": False,
        "export_extras": False,
    }
    available = bpy.ops.export_scene.gltf.get_rna_type().properties
    missing = [key for key in requested if key not in available]
    if missing:
        raise RuntimeError("Required GLTF exporter options unavailable: " + ", ".join(missing))
    return requested


def read_glb(path):
    payload = pathlib.Path(path).read_bytes()
    if len(payload) < 20 or payload[:4] != b"glTF":
        raise ValueError("Invalid GLB header")
    magic, version, file_length = struct.unpack_from("<4sII", payload, 0)
    if version != 2 or file_length != len(payload):
        raise ValueError("GLB version or declared length mismatch")
    offset = 12
    document = None
    while offset + 8 <= len(payload):
        chunk_length, chunk_kind = struct.unpack_from("<I4s", payload, offset)
        offset += 8
        if offset + chunk_length > len(payload):
            raise ValueError("GLB chunk extends beyond file")
        if chunk_kind == b"JSON":
            document = json.loads(payload[offset:offset + chunk_length].rstrip(b" \0"))
        offset += chunk_length
    if offset != len(payload) or document is None:
        raise ValueError("GLB is missing JSON or has invalid chunk alignment")
    return document


def gltf_local_matrix(node):
    if "matrix" in node:
        a = node["matrix"]
        return Matrix([[a[col * 4 + row] for col in range(4)] for row in range(4)])
    translation = Matrix.Translation(Vector(node.get("translation", [0, 0, 0])))
    q = node.get("rotation", [0, 0, 0, 1])
    rotation = Quaternion((q[3], q[0], q[1], q[2])).to_matrix().to_4x4()
    scale = node.get("scale", [1, 1, 1])
    return translation @ rotation @ Matrix.Diagonal(Vector((*scale, 1.0)))


def gltf_geometry_summary(document):
    for name in ("animations", "cameras", "skins"):
        if document.get(name):
            raise ValueError("Unexpected " + name + " in mesh-only preview GLB")
    if "KHR_lights_punctual" in document.get("extensionsUsed", []):
        raise ValueError("Unexpected punctual lights in preview GLB")
    if any("camera" in node for node in document.get("nodes", [])):
        raise ValueError("Unexpected camera node in preview GLB")
    for image in document.get("images", []):
        if image.get("uri") and not image["uri"].startswith("data:"):
            raise ValueError("External image URI in self-contained preview GLB")
    for buffer in document.get("buffers", []):
        if buffer.get("uri") and not buffer["uri"].startswith("data:"):
            raise ValueError("External buffer URI in self-contained preview GLB")

    nodes = document.get("nodes", [])
    meshes = document.get("meshes", [])
    accessors = document.get("accessors", [])
    scene_index = document.get("scene", 0)
    scenes = document.get("scenes", [])
    if not scenes:
        raise ValueError("GLB has no scene")
    corners = []
    mesh_nodes = 0
    primitive_count = 0
    triangle_count = 0
    position_count = 0

    def visit(node_index, parent_world, ancestors):
        nonlocal mesh_nodes, primitive_count, triangle_count, position_count
        if node_index in ancestors:
            raise ValueError("Cycle in GLTF node hierarchy")
        node = nodes[node_index]
        world = parent_world @ gltf_local_matrix(node)
        if "mesh" in node:
            mesh_nodes += 1
            for primitive in meshes[node["mesh"]].get("primitives", []):
                primitive_count += 1
                mode = primitive.get("mode", 4)
                if mode != 4:
                    raise ValueError("Unexpected non-triangle GLTF primitive")
                position_accessor = accessors[primitive["attributes"]["POSITION"]]
                position_count += position_accessor["count"]
                count = accessors[primitive["indices"]]["count"] if "indices" in primitive else position_accessor["count"]
                if count % 3:
                    raise ValueError("GLTF triangle primitive has non-multiple-of-three index count")
                triangle_count += count // 3
                if "min" not in position_accessor or "max" not in position_accessor:
                    raise ValueError("Position accessor is missing min/max")
                lo, hi = position_accessor["min"], position_accessor["max"]
                for x in (lo[0], hi[0]):
                    for y in (lo[1], hi[1]):
                        for z in (lo[2], hi[2]):
                            corners.append(world @ Vector((x, y, z)))
        for child in node.get("children", []):
            visit(child, world, ancestors | {node_index})

    for root in scenes[scene_index].get("nodes", []):
        visit(root, Matrix.Identity(4), set())

    bounds = vector_bounds(corners)
    if not bounds or triangle_count == 0:
        raise ValueError("Export contains no nonempty triangle geometry")
    material_summary = []
    for material in document.get("materials", []):
        pbr = material.get("pbrMetallicRoughness", {})
        material_summary.append({
            "name": material.get("name"),
            "baseColorFactor": pbr.get("baseColorFactor", [1, 1, 1, 1]),
            "metallicFactor": pbr.get("metallicFactor", 1),
            "roughnessFactor": pbr.get("roughnessFactor", 1),
            "alphaMode": material.get("alphaMode", "OPAQUE"),
            "doubleSided": material.get("doubleSided", False),
        })
    return {
        "coordinateConvention": "glTF Y-up; original Blender transforms and proportions preserved",
        "boundsMethod": "scene-world AABB of transformed POSITION accessor min/max",
        "bounds": bounds,
        "meshNodes": mesh_nodes,
        "meshes": len(meshes),
        "primitives": primitive_count,
        "triangles": triangle_count,
        "positionsAcrossPrimitives": position_count,
        "materials": material_summary,
        "imageCount": len(document.get("images", [])),
        "extensionsUsed": document.get("extensionsUsed", []),
        "animations": 0,
        "cameras": 0,
        "lights": 0,
        "skins": 0,
    }


def inspect_selected(objects):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    triangles = 0
    vertices = 0
    bounds_points = []
    modifiers = {}
    for original in objects:
        if original.modifiers:
            modifiers[original.name] = [{"name": m.name, "type": m.type,
                                        "showViewport": m.show_viewport,
                                        "showRender": m.show_render}
                                       for m in original.modifiers]
        evaluated = original.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh(preserve_all_data_layers=False, depsgraph=depsgraph)
        try:
            mesh.calc_loop_triangles()
            triangles += len(mesh.loop_triangles)
            vertices += len(mesh.vertices)
            # Evaluated local AABBs include enabled source modifiers.
            bounds_points.extend(evaluated.matrix_world @ Vector(corner) for corner in evaluated.bound_box)
        finally:
            evaluated.to_mesh_clear()
    return {
        "selectedMeshCount": len(objects),
        "selectedMeshNames": [o.name for o in objects],
        "evaluatedTriangles": triangles,
        "evaluatedVertices": vertices,
        "blenderZUpBounds": vector_bounds(bounds_points),
        "sourceModifiers": modifiers,
        "modifiersAppliedByExporter": True,
    }


def export_one(source, output_dir, overwrite=False):
    scene_id = int(source["sourceSceneId"])
    source_path = pathlib.Path(source["localPath"]).resolve()
    expected_sha = source["expectedSha256"]
    started = time.monotonic()
    if source_path.suffix.lower() != ".blend":
        raise ValueError("Expected a native .blend source")
    initial_sha = file_sha256(source_path)
    if initial_sha != expected_sha:
        raise ValueError("Source SHA mismatch before opening: " + str(source_path))
    if source_path.stat().st_size != source["expectedBytes"]:
        raise ValueError("Source size mismatch before opening")
    destination = output_dir / (str(scene_id) + ".glb")
    temporary = output_dir / (str(scene_id) + ".exporting.glb")
    if destination.exists() and not overwrite:
        raise FileExistsError("Derived GLB exists; use --resume or --overwrite: " + str(destination))

    bpy.ops.wm.open_mainfile(filepath=str(source_path), load_ui=False, use_scripts=False)
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")

    # Do not alter source transforms, geometry, material nodes, or visibility.
    visible_meshes = [o for o in bpy.context.scene.objects
                      if o.type == "MESH" and o.visible_get() and not o.hide_render]
    excluded = [o.name for o in visible_meshes if o.name in EXCLUDED_PRESENTATION_OBJECTS]
    selected = [o for o in visible_meshes if o.name not in EXCLUDED_PRESENTATION_OBJECTS]
    manifest_exclusions = set(source.get("exportSelection", {}).get("excludeObjectNames", []))
    if set(excluded) != manifest_exclusions:
        raise ValueError("Native presentation objects differ from inspected manifest")
    expected_count = source.get("exportSelection", {}).get("exportMeshCount")
    if expected_count is not None and len(selected) != expected_count:
        raise ValueError("Visible mesh count differs from inspected manifest")
    if not selected:
        raise ValueError("No visible model meshes selected")

    for obj in bpy.context.view_layer.objects:
        obj.select_set(False)
    for obj in selected:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = selected[0]
    if set(bpy.context.selected_objects) != set(selected):
        raise ValueError("Blender selection differs from intended mesh selection")

    source_geometry = inspect_selected(selected)
    options = rna_export_options(temporary)
    result = bpy.ops.export_scene.gltf(**options)
    if "FINISHED" not in result or not temporary.is_file():
        raise RuntimeError("Blender GLTF export did not finish")
    gltf = gltf_geometry_summary(read_glb(temporary))
    if gltf["meshNodes"] != len(selected):
        raise ValueError("GLTF mesh-node count does not match selected mesh count")
    if gltf["triangles"] != source_geometry["evaluatedTriangles"]:
        raise ValueError("GLTF triangle count does not match evaluated source triangle count")
    final_source_sha = file_sha256(source_path)
    if final_source_sha != initial_sha:
        raise RuntimeError("Source .blend changed during read-only export")
    export_sha = file_sha256(temporary)
    output_bytes = temporary.stat().st_size
    temporary.replace(destination)

    return {
        "schema": EXPORT_SCHEMA,
        "sourceSceneId": scene_id,
        "name": source["name"],
        "status": "exported",
        "sourcePath": str(source_path),
        "sourceSha256": initial_sha,
        "sourceSha256AfterExport": final_source_sha,
        "sourceBytes": source_path.stat().st_size,
        "sourceLibraryFileId": source["library_file_id"],
        "sourceVersionId": source["version_id"],
        "sourceGitCommit": source["gitCommit"],
        "sourceGitStagePath": source["gitStagePath"],
        "identityHold": source["identityHold"],
        "sourceStage": source["sourceStage"],
        "visibleScopeType": source.get("visibleScopeType"),
        "isWholeBuildingValidated": False,
        "isHistoricalOriginalRecovered": False,
        "modelUnitsAreMeasuredMeters": False,
        "excludedPresentationObjects": excluded,
        "geometry": source_geometry,
        "gltf": gltf,
        "exportPath": str(destination),
        "exportSha256": export_sha,
        "exportBytes": output_bytes,
        "blenderVersion": bpy.app.version_string,
        "exportOptions": {key: value for key, value in options.items() if key != "filepath"},
        "materialPolicy": "Blender glTF PBR export; source material nodes and base colors not modified",
        "geometryPolicy": "Selected default-visible mesh objects with source modifiers applied; no remodeling, shell thickening, transforms, or inferred geometry",
        "completedAt": utc_now(),
        "durationSeconds": round(time.monotonic() - started, 3),
    }


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--scene-id", type=int, action="append")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args(argv)
    manifest_path = pathlib.Path(args.manifest).resolve()
    output_dir = pathlib.Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    export_manifest_path = output_dir / "export-manifest.json"
    source_manifest = json.loads(manifest_path.read_text())
    requested_ids = set(args.scene_id or [])
    sources = [s for s in source_manifest["sources"]
               if not requested_ids or int(s["sourceSceneId"]) in requested_ids]
    if requested_ids - {int(s["sourceSceneId"]) for s in sources}:
        raise ValueError("Unknown requested scene IDs")
    prior = {}
    if export_manifest_path.exists():
        prior_document = json.loads(export_manifest_path.read_text())
        prior = {int(x["sourceSceneId"]): x for x in prior_document.get("exports", [])}
    records = dict(prior)
    failures = []

    def persist():
        ordered = [records[int(s["sourceSceneId"])]
                   for s in source_manifest["sources"] if int(s["sourceSceneId"]) in records]
        write_json_atomic(export_manifest_path, {
            "schema": EXPORT_SCHEMA,
            "sourceManifest": str(manifest_path),
            "script": str(pathlib.Path(__file__).resolve()),
            "scriptSha256": file_sha256(__file__),
            "blenderVersion": bpy.app.version_string,
            "updatedAt": utc_now(),
            "exports": ordered,
            "failures": failures,
            "exportedCount": sum(x.get("status") == "exported" for x in ordered),
        })

    for source in sources:
        scene_id = int(source["sourceSceneId"])
        old = prior.get(scene_id)
        if args.resume and old and old.get("status") == "exported":
            output = pathlib.Path(old["exportPath"])
            if (output.is_file()
                    and file_sha256(output) == old["exportSha256"]
                    and file_sha256(source["localPath"]) == source["expectedSha256"]
                    and old["sourceSha256"] == source["expectedSha256"]):
                print("EXPORT_RESUME_VERIFIED " + str(scene_id), flush=True)
                continue
        try:
            record = export_one(source, output_dir, overwrite=args.overwrite)
            records[scene_id] = record
            persist()
            print("EXPORT_COMPLETE " + json.dumps({
                "sourceSceneId": scene_id,
                "path": record["exportPath"],
                "bytes": record["exportBytes"],
                "sha256": record["exportSha256"],
                "meshes": record["geometry"]["selectedMeshCount"],
                "triangles": record["geometry"]["evaluatedTriangles"],
            }, ensure_ascii=False), flush=True)
        except Exception as error:
            failure = {"sourceSceneId": scene_id, "name": source["name"],
                       "error": str(error), "traceback": traceback.format_exc()}
            failures.append(failure)
            persist()
            print("EXPORT_FAILED " + json.dumps(failure, ensure_ascii=False), flush=True)
    persist()
    if failures:
        raise SystemExit(1)
    print("EXPORT_BATCH_COMPLETE " + str(len(sources)), flush=True)


if __name__ == "__main__":
    main()

