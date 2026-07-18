/**
 * Diagnostic: floor candidates + pocket walk on a STEP file (Node + occt-wasm).
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const root = path.resolve('src/ThreeDAnalyzer.Web/wwwroot/lib/occt-wasm');
const { OcctKernel } = await import(pathToFileURL(path.join(root, 'index.js')).href);
const occt = await OcctKernel.init({ wasm: path.join(root, 'occt-wasm.wasm') });

const stepPath =
  process.argv[2] ||
  'C:/Users/Public/Documents/part-rfq-pro/SAMPLE PART_V1/CNC-milling-7.stp';
const bytes = fs.readFileSync(stepPath);
const shape = occt.importStep(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
);

const SMOOTH_ANGLE_TOL = 0.02;
const MAX_POCKET_FACES = 48;
const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const v3sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const v3add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const v3scale = (a, s) => v3(a.x * s, a.y * s, a.z * s);
const v3dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const v3cross = (a, b) =>
  v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const v3len = (a) => Math.hypot(a.x, a.y, a.z);
const v3normalize = (a) => {
  const len = v3len(a);
  return len < 1e-12 ? v3(0, 0, 1) : v3scale(a, 1 / len);
};
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function solidNormal(face, u, v) {
  return v3normalize(occt.surfaceNormal(face, u, v));
}

function classifySharedEdge(solid, edge, faceA, faceB, radiusHint = 1) {
  const params = occt.curveParameters(edge);
  const midParam = (params.first + params.last) * 0.5;
  const p = occt.curvePointAtParam(edge, midParam);
  const uvA = occt.uvFromPoint(faceA, p);
  const uvB = occt.uvFromPoint(faceB, p);
  const nA = solidNormal(faceA, uvA.u, uvA.v);
  const nB = solidNormal(faceB, uvB.u, uvB.v);
  const angleBetweenNormals = Math.acos(clamp(v3dot(nA, nB), -1, 1));
  if (angleBetweenNormals < SMOOTH_ANGLE_TOL) return { classification: 'smooth' };
  const bisector = v3normalize(v3add(nA, nB));
  const probeDist = Math.max(1e-3, Math.min(0.05, radiusHint * 0.01));
  const probe = v3add(p, v3scale(bisector, probeDist));
  let inside = false;
  try {
    inside = occt.containsPoint(solid, probe, probeDist * 0.5);
  } catch {
    const t = v3normalize(occt.curveTangent(edge, midParam));
    return { classification: v3dot(v3cross(nA, nB), t) > 0 ? 'convex' : 'concave' };
  }
  const dihedral = inside ? Math.PI + angleBetweenNormals : Math.PI - angleBetweenNormals;
  if (dihedral > Math.PI + SMOOTH_ANGLE_TOL) return { classification: 'concave' };
  if (dihedral < Math.PI - SMOOTH_ANGLE_TOL) return { classification: 'convex' };
  return { classification: 'smooth' };
}

function getSurfaceInfo(face) {
  const type = occt.surfaceType(face);
  const orientation = occt.shapeOrientation(face);
  const isReversed = orientation === 'reversed';
  const uv = occt.uvBounds(face);
  const uMid = (uv.uMin + uv.uMax) * 0.5;
  const vMid = (uv.vMin + uv.vMax) * 0.5;
  const info = {
    type,
    isReversed,
    uv,
    axis: null,
    location: null,
    radius: null
  };
  if (type === 'plane') {
    info.axis = solidNormal(face, uMid, vMid);
    info.location = occt.pointOnSurface(face, uMid, vMid);
  } else if (type === 'cylinder') {
    try {
      const cyl = occt.getFaceCylinderData(face);
      info.radius = cyl?.radius ?? null;
    } catch {
      /* ignore */
    }
    info.location = occt.pointOnSurface(face, uMid, vMid);
  } else if (type === 'torus' || type === 'cone' || type === 'bspline') {
    info.location = occt.pointOnSurface(face, uMid, vMid);
  }
  return info;
}

const faces = occt.getSubShapes(shape, 'face');
const nodes = [];
const faceIdByHash = new Map();
for (let i = 0; i < faces.length; i++) {
  const face = faces[i];
  const surf = getSurfaceInfo(face);
  const hash = occt.hashCode(face, 1 << 30);
  nodes.push({
    faceId: i,
    faceHash: hash,
    faceHandle: face,
    surfaceType: surf.type,
    axis: surf.axis,
    location: surf.location,
    radius: surf.radius,
    isReversed: surf.isReversed,
    uv: surf.uv
  });
  faceIdByHash.set(hash, i);
}

const adjacency = nodes.map(() => []);
const edgeSeen = new Set();
for (let i = 0; i < nodes.length; i++) {
  const neighbors = occt.adjacentFaces(shape, nodes[i].faceHandle);
  for (const neigh of neighbors) {
    const j = faceIdByHash.get(occt.hashCode(neigh, 1 << 30));
    if (j == null || j <= i) continue;
    const pairKey = `${i}|${j}`;
    if (edgeSeen.has(pairKey)) continue;
    edgeSeen.add(pairKey);
    const shared = occt.sharedEdges(nodes[i].faceHandle, nodes[j].faceHandle);
    if (!shared.length) continue;
    const { classification } = classifySharedEdge(
      shape,
      shared[0],
      nodes[i].faceHandle,
      nodes[j].faceHandle,
      nodes[i].radius || nodes[j].radius || 1
    );
    adjacency[i].push({ to: j, classification });
    adjacency[j].push({ to: i, classification });
  }
}

const aag = { nodes, adjacency };

function isLikelyStockFace(idx) {
  if (nodes[idx].surfaceType !== 'plane') return false;
  const neighbors = adjacency[idx];
  if (!neighbors.length) return false;
  let convex = 0;
  for (const e of neighbors) if (e.classification === 'convex') convex++;
  return convex >= neighbors.length * 0.5;
}

function isFloorCandidate(idx) {
  if (nodes[idx].surfaceType !== 'plane') return false;
  const neighbors = adjacency[idx];
  if (!neighbors.length) return false;
  let hasInterior = false;
  for (const e of neighbors) {
    if (e.classification === 'convex') return false;
    if (e.classification === 'concave') hasInterior = true;
    else if (e.classification === 'smooth' && nodes[e.to].surfaceType !== 'plane') {
      hasInterior = true;
    }
  }
  return hasInterior;
}

function isPocketInteriorFace(n) {
  return ['plane', 'cylinder', 'cone', 'torus', 'bspline', 'bezier'].includes(n.surfaceType);
}

function collectPocketFaces(floorIdx) {
  const pocketFaces = new Set([floorIdx]);
  const rimEdges = [];
  const queue = [floorIdx];
  while (queue.length) {
    const cur = queue.shift();
    for (const { to, classification } of adjacency[cur]) {
      if (pocketFaces.has(to)) continue;
      if (classification === 'convex') {
        rimEdges.push({ from: cur, to });
        continue;
      }
      if (!isPocketInteriorFace(nodes[to])) continue;
      if (to !== floorIdx && isLikelyStockFace(to)) {
        rimEdges.push({ from: cur, to });
        continue;
      }
      pocketFaces.add(to);
      queue.push(to);
    }
  }
  return { faces: [...pocketFaces], rimEdges };
}

function estimateDepth(floorIdx, faces, rimEdges) {
  const floorFace = nodes[floorIdx];
  if (!floorFace?.location || !floorFace?.axis) return 0;
  const n = v3normalize(floorFace.axis);
  let maxDepth = 0;
  for (const { to } of rimEdges) {
    const rim = nodes[to];
    if (!rim?.location) continue;
    const d = Math.abs(v3dot(v3sub(rim.location, floorFace.location), n));
    if (d > maxDepth) maxDepth = d;
  }
  return maxDepth;
}

const floors = [];
for (let i = 0; i < nodes.length; i++) if (isFloorCandidate(i)) floors.push(i);
console.log('floors:', floors.length, floors);

const visited = new Set();
const pockets = [];
for (const floorIdx of floors) {
  if (visited.has(floorIdx)) continue;
  const { faces: pf, rimEdges } = collectPocketFaces(floorIdx);
  const depth = estimateDepth(floorIdx, pf, rimEdges);
  const wallPlanes = pf.filter(
    (i) => nodes[i].surfaceType === 'plane' && i !== floorIdx && !isFloorCandidate(i)
  ).length;
  const cyl = pf.filter((i) => nodes[i].surfaceType === 'cylinder').length;
  const tor = pf.filter((i) => nodes[i].surfaceType === 'torus').length;
  const reason = [];
  if (rimEdges.length === 0) reason.push('no-rim');
  if (pf.length > MAX_POCKET_FACES) reason.push(`too-many-faces:${pf.length}`);
  if (depth < 0.2) reason.push(`shallow:${depth.toFixed(3)}`);
  const loc = nodes[floorIdx].location;
  console.log(
    `floor ${floorIdx} faces=${pf.length} rims=${rimEdges.length} depth=${depth.toFixed(2)} wallsP=${wallPlanes} cyl=${cyl} tor=${tor}` +
      (reason.length ? ` REJECT(${reason.join(',')})` : ' KEEP') +
      ` loc=(${loc.x.toFixed(1)},${loc.y.toFixed(1)},${loc.z.toFixed(1)})`
  );
  if (reason.length) continue;
  for (const f of pf) visited.add(f);
  pockets.push(floorIdx);
}
console.log('accepted pockets:', pockets.length, pockets);
process.exit(0);
