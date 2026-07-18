/**
 * Find near-floor planar faces (broken by through-cuts) on CNC-milling-7.stp
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
const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
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
const solidNormal = (face, u, v) => v3normalize(occt.surfaceNormal(face, u, v));

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

const faces = occt.getSubShapes(shape, 'face');
const nodes = [];
const faceIdByHash = new Map();
for (let i = 0; i < faces.length; i++) {
  const face = faces[i];
  const type = occt.surfaceType(face);
  const uv = occt.uvBounds(face);
  const uMid = (uv.uMin + uv.uMax) * 0.5;
  const vMid = (uv.vMin + uv.vMax) * 0.5;
  const isReversed = occt.shapeOrientation(face) === 'reversed';
  let axis = null;
  let location = null;
  let radius = null;
  if (type === 'plane') {
    axis = solidNormal(face, uMid, vMid);
    location = occt.pointOnSurface(face, uMid, vMid);
  } else {
    location = occt.pointOnSurface(face, uMid, vMid);
    try {
      if (type === 'cylinder') radius = occt.getFaceCylinderData(face)?.radius;
    } catch {
      /* ignore */
    }
  }
  const hash = occt.hashCode(face, 1 << 30);
  nodes.push({
    faceId: i,
    faceHandle: face,
    surfaceType: type,
    axis,
    location,
    radius,
    isReversed,
    uv
  });
  faceIdByHash.set(hash, i);
}

const adjacency = nodes.map(() => []);
const edgeSeen = new Set();
for (let i = 0; i < nodes.length; i++) {
  for (const neigh of occt.adjacentFaces(shape, nodes[i].faceHandle)) {
    const j = faceIdByHash.get(occt.hashCode(neigh, 1 << 30));
    if (j == null || j <= i) continue;
    const key = `${i}|${j}`;
    if (edgeSeen.has(key)) continue;
    edgeSeen.add(key);
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

function counts(i) {
  const c = { convex: 0, concave: 0, smooth: 0 };
  for (const e of adjacency[i]) c[e.classification]++;
  return c;
}

function coplanar(a, b, tol = 1e-3) {
  if (!a.axis || !b.axis || !a.location || !b.location) return false;
  if (Math.abs(v3dot(a.axis, b.axis)) < 0.999) return false;
  const d = v3dot(
    { x: b.location.x - a.location.x, y: b.location.y - a.location.y, z: b.location.z - a.location.z },
    a.axis
  );
  return Math.abs(d) < tol;
}

// Planes with majority interior (smooth/concave) but some convex = broken floors
const planes = [];
for (let i = 0; i < nodes.length; i++) {
  if (nodes[i].surfaceType !== 'plane') continue;
  const c = counts(i);
  const total = c.convex + c.concave + c.smooth;
  if (total === 0) continue;
  const interior = c.concave + c.smooth;
  const interiorRatio = interior / total;
  const hasFillet = adjacency[i].some(
    (e) =>
      (e.classification === 'smooth' || e.classification === 'concave') &&
      nodes[e.to].surfaceType !== 'plane'
  );
  planes.push({ i, c, interiorRatio, hasFillet, n: nodes[i] });
}

planes.sort((a, b) => b.interiorRatio - a.interiorRatio || b.c.smooth - a.c.smooth);

console.log('Top planar faces by interior ratio:');
for (const p of planes.slice(0, 25)) {
  const loc = p.n.location;
  const neigh = adjacency[p.i]
    .map((e) => `${e.classification[0]}:${nodes[e.to].surfaceType[0]}${nodes[e.to].isReversed ? '*' : ''}`)
    .join(' ');
  console.log(
    `  f${p.i} ir=${p.interiorRatio.toFixed(2)} ${JSON.stringify(p.c)} fillet=${p.hasFillet}` +
      ` loc=(${loc.x.toFixed(1)},${loc.y.toFixed(1)},${loc.z.toFixed(1)})` +
      ` n=(${p.n.axis.x.toFixed(2)},${p.n.axis.y.toFixed(2)},${p.n.axis.z.toFixed(2)})` +
      `\n       ${neigh}`
  );
}

// Group coplanar near-floors (ir>=0.5, hasFillet, convex allowed)
const broken = planes.filter((p) => p.hasFillet && p.interiorRatio >= 0.45 && p.c.convex > 0);
console.log('\nBroken-floor candidates (fillet + ir>=0.45 + some convex):', broken.length);
for (const p of broken) {
  const group = broken.filter((q) => coplanar(p.n, q.n));
  console.log(
    `  f${p.i} group=[${group.map((g) => g.i).join(',')}] y=${p.n.location.y.toFixed(2)} convex=${p.c.convex}`
  );
}

process.exit(0);
