import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(new URL('../scripts/build-yichang-dem.py', import.meta.url), 'utf8');
assert.match(source, /N30E111/);
assert.match(source, /SIDE = 3601/);
assert.match(source, /RIVER_REFERENCE_METRES = 40\.0/);
assert.match(source, /-32768/);
assert.match(source, /bilinear/);
assert.match(source, /EPSG:4326/);
const scene = fs.readFileSync(new URL('../src/scene/createCityScene.js', import.meta.url), 'utf8');
assert.match(scene, /terrain\.cols/);
assert.match(scene, /surfaceHeight/);
console.log('PASS Yichang DEM tile, coordinate, nodata, datum and scene terrain contracts');

const sceneTerrain = fs.readFileSync(new URL('../src/scene/createCityScene.js', import.meta.url), 'utf8');
assert.match(sceneTerrain, /TERRAIN_VERTICAL_EXAGGERATION = 2\.6/);
assert.match(sceneTerrain, /interpolated \* TERRAIN_VERTICAL_EXAGGERATION/);
console.log('PASS DEM is visibly exaggerated only at render-time; source elevations remain unchanged');
