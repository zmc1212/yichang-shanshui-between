import assert from 'node:assert/strict';
import { previewViewport, previewViewHeight } from '../src/lib/modelPreviewFraming.js';

// Regression for a real browser failure: alternating scrollbar/temporary
// viewport sizes used to compound the frustum and shrink a loaded facade.
const projected = { width: 4, height: 8 };
const fitAt = (w,h) => {
  const viewport=previewViewport(w,h);
  return viewport ? previewViewHeight(projected.width,projected.height,viewport.aspect,1.13) : null;
};
assert.equal(fitAt(688,395),9.04);
assert.equal(fitAt(704,395),9.04);
for(let i=0;i<100;i++) {
  assert.equal(fitAt(688,395),9.04);
  assert.equal(fitAt(0,395),null);
  assert.equal(fitAt(704,0),null);
  assert.equal(fitAt(1,1),null);
  assert.equal(fitAt(704,395),9.04);
}
const wideFacade=[8,4];
assert.equal(previewViewHeight(...wideFacade,2,1.25),5);
assert.equal(previewViewHeight(...wideFacade,.5,1.25),20);
assert.equal(previewViewHeight(...wideFacade,2,1.25),5,'Returning to landscape restores the original fit');
assert.equal(previewViewport(NaN,395),null);
assert.equal(previewViewHeight(4,8,0,1.13),null);
console.log(JSON.stringify({ok:true,checks:['100 reversible scrollbar cycles','zero-sized host ignored','portrait/landscape fit restores','invalid dimensions rejected']}));
