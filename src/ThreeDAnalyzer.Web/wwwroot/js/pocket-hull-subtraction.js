/**
 * Convex-hull subtraction pocket detection — operates on Body 2 only.
 *
 * OCCT boolean of a faceted hull that coincides with the part fails (near-zero
 * cut). We expand the hull slightly so the cut succeeds, then keep only mesh
 * triangles whose centroids lie inside the *tight* hull (geometric half-space
 * tests — no slow containsPoint). Connected components of those triangles are
 * the pocket cavities.
 */

import quickhull3d from '/lib/quickhull3d.bundle.js';
import { sewFaces, healShape, makeTriangleFace } from './brep-sew-utils.js?v=1.21.2';

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(a) {
  const L = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / L, a[1] / L, a[2] / L];
}

function centroidOf(points) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
    z += p[2];
  }
  const n = points.length || 1;
  return [x / n, y / n, z / n];
}

function expandPoints(points, center, mm) {
  return points.map((p) => {
    const d = sub(p, center);
    const L = Math.hypot(d[0], d[1], d[2]) || 1;
    const s = (L + mm) / L;
    return [center[0] + d[0] * s, center[1] + d[1] * s, center[2] + d[2] * s];
  });
}

function tessellateForHull(occt, shape, deflection) {
  const mesh = occt.tessellate(shape, {
    linearDeflection: deflection,
    angularDeflection: 0.2
  });
  const pts = [];
  const pos = mesh.positions;
  for (let i = 0; i < pos.length; i += 3) {
    pts.push([pos[i], pos[i + 1], pos[i + 2]]);
  }
  return pts;
}

function buildHullSolid(occt, points, faces) {
  const triFaces = [];
  for (const face of faces) {
    const [i, j, k] = face;
    triFaces.push(makeTriangleFace(occt, points[i], points[j], points[k]));
  }
  return healShape(occt, sewFaces(occt, triFaces, 1e-3), 1e-3);
}

function hullPlanesFromPoints(points, faces) {
  const planes = [];
  for (const face of faces) {
    const a = points[face[0]];
    const b = points[face[1]];
    const c = points[face[2]];
    const n = normalize(cross(sub(b, a), sub(c, a)));
    planes.push({ normal: n, location: a, d: dot(n, a) });
  }
  // Orient planes so the hull centroid is on the negative side
  const c = centroidOf(points);
  for (const p of planes) {
    if (dot(p.normal, c) - p.d > 0) {
      p.normal = [-p.normal[0], -p.normal[1], -p.normal[2]];
      p.d = -p.d;
    }
  }
  return planes;
}

/** Point inside convex hull if on the inward side of every face (tol in mm). */
function pointInConvexHull(pt, planes, tol = 0.35) {
  for (const p of planes) {
    if (dot(p.normal, pt) - p.d > tol) return false;
  }
  return true;
}

function meshVolumeAndBounds(pos, idx, triList) {
  const verts = new Set();
  for (const ti of triList) {
    verts.add(idx[ti * 3]);
    verts.add(idx[ti * 3 + 1]);
    verts.add(idx[ti * 3 + 2]);
  }
  let minx = Infinity;
  let miny = Infinity;
  let minz = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  let maxz = -Infinity;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const v of verts) {
    const x = pos[v * 3];
    const y = pos[v * 3 + 1];
    const z = pos[v * 3 + 2];
    if (x < minx) minx = x;
    if (y < miny) miny = y;
    if (z < minz) minz = z;
    if (x > maxx) maxx = x;
    if (y > maxy) maxy = y;
    if (z > maxz) maxz = z;
    cx += x;
    cy += y;
    cz += z;
  }
  const n = verts.size || 1;
  cx /= n;
  cy /= n;
  cz /= n;

  let vol = 0;
  const outPos = [];
  const outIdx = [];
  const remap = new Map();
  for (const ti of triList) {
    const tri = [];
    for (let k = 0; k < 3; k++) {
      const v = idx[ti * 3 + k];
      if (!remap.has(v)) {
        remap.set(v, outPos.length / 3);
        outPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      }
      tri.push(remap.get(v));
    }
    outIdx.push(tri[0], tri[1], tri[2]);
    const ax = pos[idx[ti * 3] * 3] - cx;
    const ay = pos[idx[ti * 3] * 3 + 1] - cy;
    const az = pos[idx[ti * 3] * 3 + 2] - cz;
    const bx = pos[idx[ti * 3 + 1] * 3] - cx;
    const by = pos[idx[ti * 3 + 1] * 3 + 1] - cy;
    const bz = pos[idx[ti * 3 + 1] * 3 + 2] - cz;
    const cx2 = pos[idx[ti * 3 + 2] * 3] - cx;
    const cy2 = pos[idx[ti * 3 + 2] * 3 + 1] - cy;
    const cz2 = pos[idx[ti * 3 + 2] * 3 + 2] - cz;
    vol += (ax * (by * cz2 - bz * cy2) - ay * (bx * cz2 - bz * cx2) + az * (bx * cy2 - by * cx2)) / 6;
  }

  const dx = maxx - minx;
  const dy = maxy - miny;
  const dz = maxz - minz;
  const sorted = [dx, dy, dz].sort((a, b) => a - b);
  return {
    volume: Math.abs(vol),
    center: [cx, cy, cz],
    depth: sorted[2],
    maxBoundedSize: { width: sorted[1], length: sorted[2], diameter: null },
    plugMesh: { positions: outPos, indices: outIdx },
    dims: { dx, dy, dz }
  };
}

function connectedTriangleComponents(idx, keepTris) {
  const parent = new Int32Array(keepTris.length);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (a) => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  const uni = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[a] = b;
  };

  const localIndex = new Map();
  keepTris.forEach((ti, i) => localIndex.set(ti, i));

  const vertToLocals = new Map();
  keepTris.forEach((ti, li) => {
    for (let k = 0; k < 3; k++) {
      const v = idx[ti * 3 + k];
      if (!vertToLocals.has(v)) vertToLocals.set(v, []);
      vertToLocals.get(v).push(li);
    }
  });
  for (const locals of vertToLocals.values()) {
    for (let i = 1; i < locals.length; i++) uni(locals[0], locals[i]);
  }

  const comps = new Map();
  keepTris.forEach((ti, li) => {
    const r = find(li);
    if (!comps.has(r)) comps.set(r, []);
    comps.get(r).push(ti);
  });
  return [...comps.values()];
}

export function groupByParallelNormal(occt, faces, tol = 0.08) {
  const groups = [];
  for (const f of faces) {
    try {
      if (occt.surfaceType(f) !== 'plane') continue;
      const uv = occt.uvBounds(f);
      const uMid = (uv.uMin + uv.uMax) / 2;
      const vMid = (uv.vMin + uv.vMax) / 2;
      const nRaw = occt.surfaceNormal(f, uMid, vMid);
      const normal = normalize([nRaw.x, nRaw.y, nRaw.z]);
      let found = false;
      for (const g of groups) {
        if (Math.abs(dot(g.normal, normal)) > 1 - tol) {
          g.faces.push(f);
          found = true;
          break;
        }
      }
      if (!found) groups.push({ normal, faces: [f] });
    } catch {
      /* skip */
    }
  }
  groups.sort((a, b) => b.faces.length - a.faces.length);
  return groups;
}

export function areOpposite(g0, g1, tol = 0.08) {
  return dot(g0.normal, g1.normal) < -(1 - tol);
}

export function computeDepthAlongAxis(_occt, solidOrDims, axis) {
  // Accept either an OCCT solid or a dims/center record from mesh cavities
  if (solidOrDims?.dims) {
    const a = normalize(axis);
    const { dx, dy, dz } = solidOrDims.dims;
    // Project AABB extent onto axis (axis-aligned approx)
    return Math.abs(a[0]) * dx + Math.abs(a[1]) * dy + Math.abs(a[2]) * dz;
  }
  const occt = _occt;
  const solid = solidOrDims;
  const bb = occt.getBoundingBox(solid, true);
  const corners = [
    [bb.xmin, bb.ymin, bb.zmin],
    [bb.xmax, bb.ymin, bb.zmin],
    [bb.xmin, bb.ymax, bb.zmin],
    [bb.xmax, bb.ymax, bb.zmin],
    [bb.xmin, bb.ymin, bb.zmax],
    [bb.xmax, bb.ymin, bb.zmax],
    [bb.xmin, bb.ymax, bb.zmax],
    [bb.xmax, bb.ymax, bb.zmax]
  ];
  const a = normalize(axis);
  let minP = Infinity;
  let maxP = -Infinity;
  for (const c of corners) {
    const p = dot(c, a);
    if (p < minP) minP = p;
    if (p > maxP) maxP = p;
  }
  return Math.max(0, maxP - minP);
}

/**
 * @param {object} occt
 * @param {number} body2Shape
 * @param {{ minVolume?:number, minOpeningWidth?:number, hullDeflection?:number, hullExpandMm?:number }} params
 */
export function detectPocketsByHullSubtraction(occt, body2Shape, params = {}, onProgress = null) {
  const report = (message, percent) => {
    if (typeof onProgress === 'function') onProgress({ message, percent });
  };

  const minVolume = params.minVolume ?? 1;
  const minOpeningWidth = params.minOpeningWidth ?? 0.5;
  const hullDeflection = params.hullDeflection ?? 0.5;
  const expandMm = params.hullExpandMm ?? 1.2;

  report('Tessellating Body 2 for convex hull…', 15);
  const points = tessellateForHull(occt, body2Shape, hullDeflection);
  if (points.length < 4) throw new Error('Too few points for convex hull');

  report(`Building convex hull (${points.length} points)…`, 30);
  const hullFaceIdx = quickhull3d(points);
  if (!hullFaceIdx?.length) throw new Error('QuickHull produced no faces');

  const center = centroidOf(points);
  const tightPlanes = hullPlanesFromPoints(points, hullFaceIdx);
  const expandedPts = expandPoints(points, center, expandMm);

  report('Boolean cut: expanded hull − Body 2…', 45);
  let cutMesh = null;
  try {
    const hullExp = buildHullSolid(occt, expandedPts, hullFaceIdx);
    const cut = occt.cut(hullExp, body2Shape);
    if (!occt.isNull(cut)) {
      cutMesh = occt.tessellate(cut, { linearDeflection: 0.5, angularDeflection: 0.35 });
    }
  } catch (err) {
    throw new Error(`Hull cut failed: ${err?.message ?? err}`);
  }
  if (!cutMesh?.indices?.length) throw new Error('Hull cut produced empty mesh');

  report('Filtering shell padding from cavities…', 65);
  const pos = cutMesh.positions;
  const idx = cutMesh.indices;
  const keep = [];
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t] * 3;
    const i1 = idx[t + 1] * 3;
    const i2 = idx[t + 2] * 3;
    const cx = (pos[i0] + pos[i1] + pos[i2]) / 3;
    const cy = (pos[i0 + 1] + pos[i1 + 1] + pos[i2 + 1]) / 3;
    const cz = (pos[i0 + 2] + pos[i1 + 2] + pos[i2 + 2]) / 3;
    // Keep triangles well inside the tight hull (= real cavities).
    // A small negative tolerance rejects the thin expansion-band shell whose
    // centroids sit just outside / on the tight hull surface.
    if (pointInConvexHull([cx, cy, cz], tightPlanes, -0.25)) {
      keep.push(t / 3);
    }
  }

  report(`Clustering ${keep.length} cavity triangles…`, 80);
  const comps = connectedTriangleComponents(idx, keep);
  const pockets = [];

  for (let i = 0; i < comps.length; i++) {
    const info = meshVolumeAndBounds(pos, idx, comps[i]);
    if (info.volume < minVolume) continue;
    if (comps[i].length < 8) continue;
    const opening = Math.min(info.dims.dx, info.dims.dy, info.dims.dz);
    if (opening < minOpeningWidth) continue;
    const sorted = [info.dims.dx, info.dims.dy, info.dims.dz].sort((a, b) => b - a);
    // Reject thin hull-cap sheets (large extent, tiny thickness)
    if (sorted[2] > 1e-6 && sorted[0] / sorted[2] > 12 && sorted[2] < Math.max(3, minOpeningWidth * 4)) {
      continue;
    }
    const flagged = sorted[1] > 0 && sorted[0] / sorted[1] > 6 ? 'possible-merge-artifact' : null;

    // Tool axis ≈ shortest bbox axis (pocket depth direction heuristic)
    let toolAxis = [0, 0, 1];
    if (info.dims.dx <= info.dims.dy && info.dims.dx <= info.dims.dz) toolAxis = [1, 0, 0];
    else if (info.dims.dy <= info.dims.dx && info.dims.dy <= info.dims.dz) toolAxis = [0, 1, 0];

    pockets.push({
      id: `hull-${i}`,
      volume: info.volume,
      maxBoundedVolume: info.volume,
      maxDepth: info.depth,
      depth: info.depth,
      toolAxis,
      axis: toolAxis,
      accessType: 'single-axis',
      accessAxes: [toolAxis],
      shape: null,
      isFullyEnclosed: false,
      isThrough: false,
      flagged,
      detectionMethod: 'hull-subtract',
      faceIndices: null,
      wallSurfaceArea: null,
      minCornerRadius: null,
      maxBoundedSize: info.maxBoundedSize,
      center: info.center,
      plugMesh: info.plugMesh,
      dims: info.dims
    });
  }

  pockets.sort((a, b) => b.volume - a.volume);
  report(`Found ${pockets.length} cavity(ies)`, 100);
  return pockets;
}

export function estimateMinOpeningWidth(_occt, solid, _accessFaces) {
  if (solid?.dims) return Math.min(solid.dims.dx, solid.dims.dy, solid.dims.dz);
  return 0;
}
