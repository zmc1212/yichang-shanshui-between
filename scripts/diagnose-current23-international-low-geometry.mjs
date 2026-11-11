import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
function geometryOnlyBytes(bytes){
  assert.equal(bytes.toString('ascii',0,4),'glTF');assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length);
  const length=bytes.readUInt32LE(12),document=JSON.parse(bytes.subarray(20,20+length));
  const strip=o=>{if(!o||typeof o!=='object')return;for(const key of Object.keys(o)){if(/Texture$/.test(key))delete o[key];else strip(o[key]);}};
  (document.materials||[]).forEach(strip);
  const encoded=Buffer.from(JSON.stringify(document)),padded=Buffer.alloc(Math.ceil(encoded.length/4)*4,0x20);encoded.copy(padded);
  const tail=bytes.subarray(20+length),out=Buffer.alloc(20+padded.length+tail.length);out.write('glTF',0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(padded.length,12);out.writeUInt32LE(0x4E4F534A,16);padded.copy(out,20);tail.copy(out,20+padded.length);
  return out.buffer.slice(out.byteOffset,out.byteOffset+out.byteLength);
}
const zones=[{name:'current-paving-exit-edge',x:[32.9,36.8],z:[28,30.1]},{name:'old-departure',x:[32.9,33.9],z:[23.00016418147591,25.35]},{name:'old-underlay',x:[32.9,36.8],z:[25.35,30.1]},{name:'outer-landing',x:[32.9,36.8],z:[30.1,31.5]}];
const reports=[];
for(const tier of ['light','detail']){
 const bytes=fs.readFileSync(new URL(`../public/models/current23/06/${tier}.glb`,import.meta.url));
 const scene=(await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(geometryOnlyBytes(bytes),'' )).scene;scene.updateMatrixWorld(true);
 const report={tier,sha256:createHash('sha256').update(bytes).digest('hex'),zones:zones.map(z=>({...z,materials:{}}))};
 scene.traverse(mesh=>{if(!mesh.isMesh)return;const p=mesh.geometry.attributes.position,idx=mesh.geometry.index;
 for(let i=0;i<(idx?.count||p.count);i+=3){let pts=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(p,idx?idx.getX(i+j):i+j).applyMatrix4(mesh.matrixWorld));if(pts.every(p=>p.y>1.5)||pts.every(p=>p.y<-.5))continue;
 for(const zone of report.zones){let poly=pts;for(const f of [p=>p.x-zone.x[0],p=>zone.x[1]-p.x,p=>p.z-zone.z[0],p=>zone.z[1]-p.z]){const res=[];for(let k=0;k<poly.length;k++){let a=poly[k],b=poly[(k+1)%poly.length],da=f(a),db=f(b);if(da>=0)res.push(a);if((da>=0)!==(db>=0))res.push(a.clone().lerp(b,da/(da-db)));}poly=res;}
 if(poly.length<3)continue;let area=0;for(let k=1;k<poly.length-1;k++)area+=poly[k].clone().sub(poly[0]).cross(poly[k+1].clone().sub(poly[0])).length()/2;if(area<1e-8)continue;
 const name=mesh.material.name;let rec=zone.materials[name]??={triangles:0,minY:Infinity,maxY:-Infinity,surfaceArea:0,minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity,sample:[],outerEdgeSamples:[]};rec.triangles++;rec.minY=Math.min(rec.minY,...poly.map(p=>p.y));rec.maxY=Math.max(rec.maxY,...poly.map(p=>p.y));rec.surfaceArea+=area;rec.minX=Math.min(rec.minX,...poly.map(p=>p.x));rec.maxX=Math.max(rec.maxX,...poly.map(p=>p.x));rec.minZ=Math.min(rec.minZ,...poly.map(p=>p.z));rec.maxZ=Math.max(rec.maxZ,...poly.map(p=>p.z));if(name==='Light stone paving' && poly.some(p=>p.z>27.49) && rec.outerEdgeSamples.length<20)rec.outerEdgeSamples.push(poly.map(p=>p.toArray()));if(rec.sample.length<2)rec.sample.push(poly.map(p=>p.toArray()));
 }
 }});reports.push(report);
}
for(const report of reports){const zone=report.zones.find(z=>z.name==='old-underlay');const paving=zone.materials['Light stone paving'];assert(Math.abs(paving.maxZ-27.500717184972686)<1e-7);assert(Math.abs(paving.maxY-(-.09975645499281255))<1e-7);assert(paving.minY<-.13&&paving.maxY>-.13,'Old underlay height is within new paving vertical span');assert.equal(Object.keys(report.zones.find(z=>z.name==='outer-landing').materials).length,0);const edge=paving.outerEdgeSamples.flat().filter(p=>Math.abs(p[1]-paving.maxY)<1e-8&&Math.abs(p[2]-paving.maxZ)<1e-8);assert(edge.some(p=>Math.abs(p[0]-32.9)<1e-8)&&edge.some(p=>Math.abs(p[0]-36.8)<1e-8),'Both full-width source edge endpoints exist');}
console.log(JSON.stringify({checks:'Both current LODs: actual edge endpoints, top and boundary, old underlay vertical overlap, exterior low-geometry absence',scope:'Independent current23/06 geometric diagnostic; no measured-site or walkability certification',reports},null,2));
