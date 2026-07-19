/**
 * Diagnostic: reproduce the exact browser pocket pipeline (buildAAG +
 * hole-wall exclusion + recognizePockets) and inspect plug solids.
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const root = path.resolve('src/ThreeDAnalyzer.Web/wwwroot/lib/occt-wasm');
const { OcctKernel } = await import(pathToFileURL(path.join(root, 'index.js')).href);
const occt = await OcctKernel.init({ wasm: path.join(root, 'occt-wasm.wasm') });

const jsDir = path.resolve('src/ThreeDAnalyzer.Web/wwwroot/js');
const { buildAAG, recognizeHoles } = await import(
  pathToFileURL(path.join(jsDir, 'brep-feature-recognition.js')).href
);
const { recognizePockets } = await import(
  pathToFileURL(path.join(jsDir, 'brep-pocket-recognition.js')).href
);

const stepPath =
  process.argv[2] || 'C:/Users/Public/Documents/part-rfq-pro/SAMPLE PART_V1/CNC-milling-7.stp';
const bytes = fs.readFileSync(stepPath);
const shape = occt.importStep(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
);

const aag = await buildAAG(shape, occt);

// Same exclusion as recognizeFeaturesFromAag (browser path)
const holesForExclude = recognizeHoles(aag, { onProgress: null });
const holeFaceIndices = new Set();
for (const h of holesForExclude) {
  for (const idx of h.faceIndices ?? []) {
    const n = aag.nodes[idx];
    if (n && n.surfaceType !== 'plane') holeFaceIndices.add(idx);
  }
}
console.log('holes excluded walls:', holeFaceIndices.size);

const pockets = recognizePockets(aag, { occt, holeFaceIndices });

const v3add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const v3scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });

console.log('pockets:', pockets.length);
const partBox = occt.getBoundingBox(shape, false);
console.log('part bbox:', JSON.stringify(partBox));

for (const p of pockets) {
  console.log('\n-- pocket floorFace', p.floorFaceId, 'shape', p.shape, 'patched', p.isPatched);
  console.log(
    '   size', p.width?.toFixed(2), 'x', p.length?.toFixed(2),
    'depth', p.depth?.toFixed(2), 'vol', p.maxBoundedVolume?.toFixed(1)
  );
  console.log('   center', p.center?.map((x) => +x.toFixed(1)), 'axis', p.axis?.map((x) => +x.toFixed(2)));
  if (p.center && p.axis) {
    const c = { x: p.center[0], y: p.center[1], z: p.center[2] };
    const n = { x: p.axis[0], y: p.axis[1], z: p.axis[2] };
    console.log(
      '   inside(center+n) =', occt.containsPoint(shape, v3add(c, v3scale(n, 1)), 0.01),
      ' inside(center-n) =', occt.containsPoint(shape, v3add(c, v3scale(n, -1)), 0.01)
    );
  }
  if (p.plugMesh?.positions?.length) {
    const mn = [Infinity, Infinity, Infinity];
    const mx = [-Infinity, -Infinity, -Infinity];
    const pos = p.plugMesh.positions;
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        mn[k] = Math.min(mn[k], pos[i + k]);
        mx[k] = Math.max(mx[k], pos[i + k]);
      }
    }
    console.log('   plug bbox min', mn.map((x) => +x.toFixed(1)), 'max', mx.map((x) => +x.toFixed(1)),
      'size', mx.map((x, k) => +(x - mn[k]).toFixed(1)));
  } else {
    console.log('   NO plug mesh');
  }
}
process.exit(0);
