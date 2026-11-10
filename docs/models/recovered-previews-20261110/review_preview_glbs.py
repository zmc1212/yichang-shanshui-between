"""Independent binary GLB review against reopened native evaluated geometry."""
import hashlib, json, math, struct
from collections import Counter
from pathlib import Path
import numpy as np

BASE=Path('/workspace/scratch/83e368053451')
OUT=BASE/'model-recovery-audit'
EX=BASE/'model-recovery-exports'
TOL=0.0001

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def read_glb(p):
    data=Path(p).read_bytes()
    assert len(data)>=20 and data[:4]==b'glTF','header'
    version,size=struct.unpack_from('<II',data,4)
    assert version==2 and size==len(data),'version/length'
    pos=12;chunks=[]
    while pos<len(data):
        n,kind=struct.unpack_from('<I4s',data,pos);pos+=8
        assert n%4==0 and pos+n<=len(data),'chunk bounds/alignment'
        chunks.append((kind,data[pos:pos+n]));pos+=n
    assert chunks[0][0]==b'JSON','first chunk'
    assert len([x for x in chunks if x[0]==b'JSON'])==1,'one JSON'
    assert len([x for x in chunks if x[0]==b'BIN\x00'])==1,'one BIN'
    doc=json.loads(chunks[0][1].rstrip(b' \x00'))
    binary=next(x[1] for x in chunks if x[0]==b'BIN\x00')
    return doc,binary

DT={5120:np.dtype('i1'),5121:np.dtype('u1'),5122:np.dtype('<i2'),5123:np.dtype('<u2'),5125:np.dtype('<u4'),5126:np.dtype('<f4')}
N={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT2':4,'MAT3':9,'MAT4':16}

def accessor(doc,binary,index):
    a=doc['accessors'][index]
    assert 'sparse' not in a,'unexpected sparse accessor'
    v=doc['bufferViews'][a['bufferView']]
    assert v.get('buffer',0)==0,'buffer index'
    dtype=DT[a['componentType']];n=N[a['type']];count=a['count']
    offset=v.get('byteOffset',0)+a.get('byteOffset',0)
    stride=v.get('byteStride',dtype.itemsize*n)
    end=offset+(count-1)*stride+dtype.itemsize*n if count else offset
    assert offset>=v.get('byteOffset',0) and end<=v.get('byteOffset',0)+v['byteLength'] and end<=len(binary),'accessor bounds'
    x=np.ndarray((count,n),dtype=dtype,buffer=binary,offset=offset,strides=(stride,dtype.itemsize))
    assert np.isfinite(x).all(),'nonfinite accessor'
    return x

def matrix(node):
    if 'matrix' in node:return np.array(node['matrix'],dtype=float).reshape(4,4).T
    x,y,z,w=node.get('rotation',[0,0,0,1]);q=np.array([x,y,z,w]);assert abs(float(q@q)-1)<0.0001,'quaternion'
    r=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
                [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
                [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
    m=np.eye(4);m[:3,:3]=r@np.diag(node.get('scale',[1,1,1]));m[:3,3]=node.get('translation',[0,0,0]);return m

def bnd(x):return {'min':np.min(x,axis=0).tolist(),'max':np.max(x,axis=0).tolist()}

def diff(a,b):return max(abs(x-y) for k in ('min','max') for x,y in zip(a[k],b[k]))

def parse_geometry(doc,binary):
    assert not any(doc.get(k) for k in ('animations','skins','cameras')),'unwanted scenes types'
    assert 'KHR_lights_punctual' not in doc.get('extensionsUsed',[]),'punctual lights'
    assert len(doc.get('buffers',[]))==1 and 'uri' not in doc['buffers'][0],'self-contained BIN'
    assert all(not im.get('uri') or im['uri'].startswith('data:') for im in doc.get('images',[])),'external image'
    assert len(doc.get('images',[]))==0,'unexpected texture image in photo-free native candidates'
    rows=[];pts=[];visited=set();accessor_deviation=0.0
    def visit(i,parent,anc):
        nonlocal accessor_deviation
        assert i not in anc,'node cycle'
        assert i not in visited,'duplicate rooted node'
        visited.add(i);node=doc['nodes'][i];world=parent@matrix(node)
        assert 'camera' not in node and 'skin' not in node,'node camera/skin'
        if 'mesh' in node:
            points=[];triangles=0;mats=set()
            for prim in doc['meshes'][node['mesh']]['primitives']:
                assert prim.get('mode',4)==4,'nontriangle primitive'
                ai=prim['attributes']['POSITION'];a=doc['accessors'][ai]
                assert a['type']=='VEC3' and a['componentType']==5126,'POSITION format'
                p=accessor(doc,binary,ai).astype(float)
                actual=bnd(p);declared={'min':a['min'],'max':a['max']}
                accessor_deviation=max(accessor_deviation,diff(actual,declared))
                assert diff(actual,declared)<TOL,'incorrect POSITION min/max'
                if 'indices' in prim:
                    ix=accessor(doc,binary,prim['indices']).reshape(-1)
                    assert len(ix)%3==0 and int(np.max(ix))<len(p),'triangle indices'
                    triangles+=len(ix)//3
                else:
                    assert len(p)%3==0,'unindexed triangle count';triangles+=len(p)//3
                wp=p@world[:3,:3].T+world[:3,3];points.append(wp)
                if 'material' in prim:mats.add(doc['materials'][prim['material']].get('name','__NONE__'))
                else:mats.add('__NONE__')
            joined=np.concatenate(points,axis=0);pts.append(joined)
            rows.append({'name':node.get('name'),'triangles':triangles,'bounds':bnd(joined),'materials':sorted(mats)})
        for ch in node.get('children',[]):visit(ch,world,anc|{i})
    scene=doc['scenes'][doc.get('scene',0)]
    for i in scene.get('nodes',[]):visit(i,np.eye(4),set())
    assert rows,'no mesh nodes'
    return {'meshNodes':rows,'bounds':bnd(np.concatenate(pts,axis=0)),'triangles':sum(x['triangles'] for x in rows),'materials':[m.get('name') for m in doc.get('materials',[])],'maxAccessorBoundsDeviation':accessor_deviation,'imageCount':len(doc.get('images',[]))}

native=json.loads((OUT/'independent-native-reference.json').read_text())
sources=json.loads((BASE/'model-recovery-sources/source-manifest.json').read_text())
exports=json.loads((EX/'export-manifest.json').read_text())
nm={int(s['sceneId']):s for s in native['models']}
sm={int(s['sourceSceneId']):s for s in sources['sources']}
em={int(s['sourceSceneId']):s for s in exports['exports']}
assert len(nm)==15 and len(sm)==15 and len(em)==15,'all 15 must be present'
report={'schema':'yichang-preview-independent-review/1','method':'Independent native reopen plus GLB BIN buffer decoding, scene matrices, and actual world vertices; no exporter summary trusted as geometry input.','axisConvention':'Blender Z-up (X,Y,Z) -> glTF Y-up (X,Z,-Y)','absoluteBoundsTolerance':TOL,'models':[],'pipelineReview':{'sourceVisibility':'active native scene: visible_get and not hide_render','presentationExclusion':'Only Display_plinth / Presentation_plinth, exact names','sourceMutations':'No native saved; no geometry/material/position changes','candidateSelection':'15 fixed native candidates from independent Git/Library crosscheck; detached later study stages not selected'}}
for scene_id,s in sm.items():
    n=nm[scene_id];e=em[scene_id];p=Path(e['exportPath'])
    row={'sceneId':scene_id,'name':s['name'],'glbPath':str(p),'failures':[]}
    try:
        current=sha(s['localPath']);assert current==s['expectedSha256']==n['nativeSha256']==e['sourceSha256']==e['sourceSha256AfterExport'],'source SHA unchanged'
        assert sha(p)==e['exportSha256'],'export SHA'
        assert p.stat().st_size==e['exportBytes'],'export size'
        doc,binary=read_glb(p);g=parse_geometry(doc,binary)
        actual_names=[x['name'] for x in g['meshNodes']];expected_names=[x['name'] for x in n['meshes']]
        assert Counter(actual_names)==Counter(expected_names),'exact mesh whitelist'
        assert set(actual_names)==set(e['geometry']['selectedMeshNames']),'manifest selection'
        assert not ({'Display_plinth','Presentation_plinth'}&set(actual_names)),'presentation included'
        assert set(n['holdObjectNames'])<=set(actual_names),'HOLD omitted'
        assert g['triangles']==n['triangles']==e['geometry']['evaluatedTriangles'],'total triangles'
        total_diff=diff(g['bounds'],n['gltfExpectedActualVertexBounds']);assert total_diff<TOL,'scene actual vertex bounds'
        nn={x['name']:x for x in n['meshes']};max_obj_diff=0;bad=[]
        for x in g['meshNodes']:
            original=nn[x['name']];d=diff(x['bounds'],original['gltfExpectedBounds']);max_obj_diff=max(max_obj_diff,d)
            if x['triangles']!=original['triangles'] or d>=TOL or set(x['materials'])!=set(original['materialNames']):bad.append({'name':x['name'],'maxBoundsDifference':d,'nativeTriangles':original['triangles'],'gltfTriangles':x['triangles'],'nativeMaterials':original['materialNames'],'gltfMaterials':x['materials']})
        assert not bad,'per-object geometry/material mismatch: '+json.dumps(bad[:8],ensure_ascii=False)
        row.update({'status':'PASS','sourceUnchanged':True,'exactMeshWhitelistMatches':True,'excludedPresentationObjects':n['excludedPresentationObjects'],'holdObjectsRetained':len(n['holdObjectNames']),'meshCount':len(actual_names),'triangles':g['triangles'],'nativeExpectedGltfBounds':n['gltfExpectedActualVertexBounds'],'actualGltfBounds':g['bounds'],'maxSceneBoundsDifference':total_diff,'maxPerObjectBoundsDifference':max_obj_diff,'perObjectTrianglesAndMaterialNamesMatch':True,'glbBytes':p.stat().st_size,'glbSha256':sha(p),'imageCount':g['imageCount'],'noExternalDependencies':True,'noDetachedExtraObjects':True})
    except Exception as err:
        row['status']='FAIL';row['failures'].append(str(err))
    report['models'].append(row)
    print('INDEPENDENT_GLB',scene_id,row['status'],row['failures'],flush=True)
report['passedCount']=sum(x['status']=='PASS' for x in report['models']);report['failedCount']=15-report['passedCount'];report['status']='PASS' if report['failedCount']==0 else 'FAIL'
report['scriptSha256']=sha(__file__)
(OUT/'independent-glb-review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps({'status':report['status'],'passed':report['passedCount'],'failed':report['failedCount']},ensure_ascii=False))
if report['failedCount']:raise SystemExit(1)
