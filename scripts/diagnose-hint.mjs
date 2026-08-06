/**
 * Diagnostic: Body 2 + user-hinted wall walk on a STEP file.
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const root = path.resolve('src/ThreeDAnalyzer.Web/wwwroot/lib/occt-wasm');
const { OcctKernel } = await import(pathToFileURL(path.join(root, 'index.js')).href);
const occt = await OcctKernel.init({ wasm: path.join(root, 'occt-wasm.wasm') });

const jsDir = path.resolve('src/ThreeDAnalyzer.Web/wwwroot/js');
const { buildAAG, recognizeHoles, loadOcct } = await import(
  pathToFileURL(path.join(jsDir, 'brep-feature-recognition.js')).href
);
const { plugHoles, pickTargetSolid } = await import(
  pathToFileURL(path.join(jsDir, 'pocket-body-preparation.js')).href
);
const { findFloorCandidates, recognizePocketFromFloor } = await import(
  pathToFileURL(path.join(jsDir, 'brep-pocket-recognition.js')).href
);
const { detectWallsFromFloor, extrudeFloorCavity } = await import(
  pathToFileURL(path.join(jsDir, 'pocket-user-hinted.js')).href
);
const { OCCT_HASH_UPPER } = await import(pathToFileURL(path.join(jsDir, 'occt-hash.js')).href);

const stepPath =
  process.argv[2] ||
  path.resolve('SAMPLE PART/002 - HOLES_POCKET.stp');
const bytes = fs.readFileSync(stepPath);
const shape = occt.importStep(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
);
const { target: body1 } = pickTargetSolid(occt, shape);
const aag1 = await buildAAG(body1, occt);
const holes = recognizeHoles(aag1, { onProgress: null });
const { body2 } = plugHoles(occt, body1, aag1, holes, () => {});
const aag2 = await buildAAG(body2, occt);

const faces = occt.getSubShapes(body2, 'face');
const hashMap = new Map();
for (const f of faces) {
  hashMap.set(occt.hashCode(f, OCCT_HASH_UPPER), f);
}

const floors = findFloorCandidates(aag2, new Set());
console.log('holes:', holes.length, 'aag2 nodes:', aag2.nodes.length, 'floor candidates:', floors.length);

for (const fi of floors) {
  const n = aag2.nodes[fi];
  const walls = detectWallsFromFloor([fi], aag2);
  const uv = n.uv || {};
  const uw = Math.abs((uv.uMax ?? 0) - (uv.uMin ?? 0));
  const vw = Math.abs((uv.vMax ?? 0) - (uv.vMin ?? 0));
  const area = uw * vw;
  console.log(
    `floor idx=${fi} hash=${n.faceHash} area~${area.toFixed(0)} walls=${walls.length} loc=`,
    n.location
  );
  try {
    const rec = recognizePocketFromFloor(aag2, fi, occt);
    console.log('  pocket vol', rec.maxBoundedVolume?.toFixed(0), 'depth', rec.depth?.toFixed(2));
  } catch (e) {
    console.log('  pocket ERR', e.message);
  }
}

// List small planar faces (likely plugs)
const smallPlanes = [];
for (let i = 0; i < aag2.nodes.length; i++) {
  const n = aag2.nodes[i];
  if (n.surfaceType !== 'plane') continue;
  const uv = n.uv || {};
  const uw = Math.abs((uv.uMax ?? 0) - (uv.uMin ?? 0));
  const vw = Math.abs((uv.vMax ?? 0) - (uv.vMin ?? 0));
  const span = Math.max(uw, vw);
  if (span < 25) smallPlanes.push({ i, hash: n.faceHash, span });
}
console.log('small planar faces (<25mm):', smallPlanes.length);
for (const p of smallPlanes.slice(0, 5)) {
  const walls = detectWallsFromFloor([p.i], aag2);
  console.log(`  plug? idx=${p.i} hash=${p.hash} span=${p.span.toFixed(1)} walls=${walls.length}`);
}

// Test extrude on main pocket floor if found
const mainFloor = floors.find((fi) => {
  const n = aag2.nodes[fi];
  const uv = n.uv || {};
  return Math.max(Math.abs(uv.uMax - uv.uMin), Math.abs(uv.vMax - uv.vMin)) > 100;
});
if (mainFloor != null) {
  const walls = detectWallsFromFloor([mainFloor], aag2);
  const floorHandle = hashMap.get(Number(aag2.nodes[mainFloor].faceHash));
  const wallHandles = walls.map((w) => hashMap.get(Number(aag2.nodes[w].faceHash))).filter(Boolean);
  console.log('main floor', mainFloor, 'walls', walls.length, 'handles', wallHandles.length);
  if (wallHandles.length) {
    try {
      const ex = extrudeFloorCavity(occt, floorHandle, [wallHandles[0]], [0, 0, 1]);
      console.log('extrude vol', ex.volume?.toFixed(0), 'depth', ex.depth?.toFixed(2));
    } catch (e) {
      console.log('extrude ERR', e.message);
    }
  }
}

process.exit(0);
