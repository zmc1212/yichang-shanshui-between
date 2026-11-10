"""Independent read-only native reference for exact GLB coverage review."""
import bpy, hashlib, json, math, sys
from pathlib import Path
from mathutils import Vector

BASE=Path('/workspace/scratch/83e368053451')
SRC=BASE/'model-recovery-sources/source-manifest.json'
OUT=BASE/'model-recovery-audit/independent-native-reference.json'
EXCLUDE={'Display_plinth','Presentation_plinth'}

def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def bounds(points):
    if not points:return None
    return {'min':[min(p[i] for p in points) for i in range(3)],'max':[max(p[i] for p in points) for i in range(3)]}

def yup(p):
    return (float(p[0]),float(p[2]),-float(p[1]))

result={'method':'Independent reopened native; actual evaluated mesh vertices, not object bounding boxes. No native saved.','blenderVersion':bpy.app.version_string,'models':[]}
for s in json.loads(SRC.read_text())['sources']:
    p=Path(s['localPath']);sha_before=digest(p)
    assert sha_before==s['expectedSha256'],f'SOURCE SHA {p}'
    bpy.ops.wm.open_mainfile(filepath=str(p),load_ui=False,use_scripts=False)
    scene=bpy.context.scene;layer=bpy.context.view_layer
    visible=[o for o in scene.objects if o.type=='MESH' and o.visible_get(view_layer=layer) and not o.hide_render]
    selected=[o for o in visible if o.name not in EXCLUDE]
    excluded=sorted(o.name for o in visible if o.name in EXCLUDE)
    assert excluded==sorted(s['exportSelection']['excludeObjectNames'])
    assert len(selected)==s['exportSelection']['exportMeshCount']
    deps=bpy.context.evaluated_depsgraph_get()
    meshes=[];allpts=[];triangles=0
    for obj in selected:
        ev=obj.evaluated_get(deps);mesh=ev.to_mesh(preserve_all_data_layers=False,depsgraph=deps)
        try:
            mesh.calc_loop_triangles()
            points=[tuple(float(v) for v in (ev.matrix_world@vtx.co)) for vtx in mesh.vertices]
            assert all(math.isfinite(v) for pt in points for v in pt)
            used=set(t.material_index for t in mesh.loop_triangles)
            mats=[ev.material_slots[i].material.name if i<len(ev.material_slots) and ev.material_slots[i].material else '__NONE__' for i in sorted(used)]
            props={k:str(obj[k]) for k in obj.keys()}
            hold=('hold' in obj.name.lower() or any('hold' in n.lower() or 'unknown' in n.lower() or 'unobserved' in n.lower() for n in mats) or any('hold' in v.lower() for v in props.values()))
            meshes.append({'name':obj.name,'vertices':len(mesh.vertices),'triangles':len(mesh.loop_triangles),'blenderBounds':bounds(points),'gltfExpectedBounds':bounds([yup(x) for x in points]),'materialNames':mats,'isHoldSupportOrUnknown':hold,'modifiers':[{'name':m.name,'type':m.type,'showViewport':m.show_viewport,'showRender':m.show_render} for m in obj.modifiers]})
            allpts.extend(points);triangles+=len(mesh.loop_triangles)
        finally:ev.to_mesh_clear()
    sha_after=digest(p);assert sha_after==sha_before
    row={'sceneId':s['sourceSceneId'],'name':s['name'],'native':str(p),'nativeSha256':sha_before,'sourceUnchanged':True,'visibleMeshCount':len(visible),'selectedMeshCount':len(selected),'excludedPresentationObjects':excluded,'blenderActualVertexBounds':bounds(allpts),'gltfExpectedActualVertexBounds':bounds([yup(x) for x in allpts]),'triangles':triangles,'meshes':meshes,'holdObjectNames':[m['name'] for m in meshes if m['isHoldSupportOrUnknown']]}
    result['models'].append(row)
    OUT.write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print('INDEPENDENT_NATIVE '+str(row['sceneId'])+' '+str(len(selected))+' meshes '+str(triangles)+' triangles',flush=True)
print('INDEPENDENT_NATIVE_COMPLETE '+str(len(result['models'])),flush=True)
