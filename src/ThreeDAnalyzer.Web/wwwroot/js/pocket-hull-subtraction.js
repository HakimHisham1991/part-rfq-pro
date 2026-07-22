/**
 * Convex-hull subtraction pocket detection — operates on Body 2 only.
 * Hull = QuickHull of tessellated Body 2 vertices; cavities = hull − Body 2.
 */

import quickhull3d from '/lib/quickhull3d.bundle.js';
import { sewFaces, healShape, makeTriangleFace } from './brep-sew-utils.js?v=1.21.0';

function v3(a, b, c) {
  return [a, b, c];
}

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

function tessellateForHull(occt, shape, deflection) {
  const mesh = occt.tessellate(shape, {
    linearDeflection: deflection,
    angularDeflection: 0.15
  });
  const pts = [];
  const pos = mesh.positions;
  for (let i = 0; i < pos.length; i += 3) {
    pts.push([pos[i], pos[i + 1], pos[i + 2]]);
  }
  return pts;
}

function buildHullSolid(occt, points) {
  if (points.length < 4) throw new Error('Too few points for convex hull');
  const faces = quickhull3d(points);
  if (!faces?.length) throw new Error('QuickHull produced no faces');

  const triFaces = [];
  for (const face of faces) {
    const [i, j, k] = face;
    triFaces.push(makeTriangleFace(occt, points[i], points[j], points[k]));
  }

  const solid = sewFaces(occt, triFaces, 1e-4);
  return healShape(occt, solid, 1e-4);
}

function hullPlanesFromPoints(points, faces) {
  const planes = [];
  for (const face of faces) {
    const a = points[face[0]];
    const b = points[face[1]];
    const c = points[face[2]];
    const n = normalize(cross(sub(b, a), sub(c, a)));
    planes.push({ normal: n, location: a });
  }
  return planes;
}

function classifyFaceOriginByPlaneMatch(occt, face, hullPlanes, tol = 1e-3) {
  const type = occt.surfaceType(face);
  if (type !== 'plane') return 'part';
  const uv = occt.uvBounds(face);
  const uMid = (uv.uMin + uv.uMax) / 2;
  const vMid = (uv.vMin + uv.vMax) / 2;
  const p = occt.pointOnSurface(face, uMid, vMid);
  const nRaw = occt.surfaceNormal(face, uMid, vMid);
  const n = normalize([nRaw.x, nRaw.y, nRaw.z]);
  const loc = [p.x, p.y, p.z];
  for (const hp of hullPlanes) {
    const dist = Math.abs(dot(sub(loc, hp.location), hp.normal));
    const align = Math.abs(dot(n, hp.normal));
    if (dist < tol && align > 0.98) return 'hull';
  }
  return 'part';
}

function bboxDims(bbox) {
  return {
    dx: bbox.xmax - bbox.xmin,
    dy: bbox.ymax - bbox.ymin,
    dz: bbox.zmax - bbox.zmin
  };
}

function looksLikeMergeArtifact(occt, solid) {
  const dims = bboxDims(occt.getBoundingBox(solid, true));
  const sorted = [dims.dx, dims.dy, dims.dz].sort((a, b) => b - a);
  return sorted[1] > 0 && sorted[0] / sorted[1] > 6;
}

function estimateMinOpeningWidth(occt, solid, accessFaces) {
  if (!accessFaces.length) {
    const d = bboxDims(occt.getBoundingBox(solid, true));
    return Math.min(d.dx, d.dy, d.dz);
  }
  let minW = Infinity;
  for (const f of accessFaces) {
    try {
      const bb = occt.getBoundingBox(f, true);
      const d = bboxDims(bb);
      const w = Math.min(d.dx || Infinity, d.dy || Infinity, d.dz || Infinity);
      if (w < minW) minW = w;
    } catch {
      /* skip */
    }
  }
  return Number.isFinite(minW) ? minW : 0;
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

export function computeDepthAlongAxis(occt, solid, axis) {
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

function meshFromSolid(occt, solid) {
  try {
    const mesh = occt.tessellate(solid, { linearDeflection: 0.15, angularDeflection: 0.3 });
    return {
      positions: Array.from(mesh.positions),
      indices: Array.from(mesh.indices)
    };
  } catch {
    return null;
  }
}

function analyzeCavity(occt, cavity, originOf, index) {
  const faces = occt.getSubShapes(cavity.solid, 'face');
  const accessFaces = faces.filter((f) => originOf(f) === 'hull');
  const axisGroups = groupByParallelNormal(occt, accessFaces);

  let accessType = 'multi-axis';
  if (accessFaces.length === 0) accessType = null;
  else if (axisGroups.length === 1) accessType = 'single-axis';
  else if (axisGroups.length === 2 && areOpposite(axisGroups[0], axisGroups[1])) accessType = 'through';

  const primaryAxis = axisGroups[0]?.normal ?? [0, 0, 1];
  const depth = computeDepthAlongAxis(occt, cavity.solid, primaryAxis);
  const bb = occt.getBoundingBox(cavity.solid, true);
  const dims = bboxDims(bb);
  const sorted = [dims.dx, dims.dy, dims.dz].sort((a, b) => a - b);

  return {
    id: `hull-${index}`,
    volume: cavity.volume,
    maxBoundedVolume: cavity.volume,
    maxDepth: depth,
    depth,
    toolAxis: primaryAxis,
    axis: primaryAxis,
    accessType,
    accessAxes: axisGroups.map((g) => g.normal),
    shape: null,
    isFullyEnclosed: accessFaces.length === 0,
    isThrough: accessType === 'through',
    flagged: cavity.flagged,
    detectionMethod: 'hull-subtract',
    faceIndices: null,
    wallSurfaceArea: null,
    minCornerRadius: null,
    maxBoundedSize: {
      width: sorted[1],
      length: sorted[2],
      diameter: null
    },
    center: [
      (bb.xmin + bb.xmax) / 2,
      (bb.ymin + bb.ymax) / 2,
      (bb.zmin + bb.zmax) / 2
    ],
    plugMesh: meshFromSolid(occt, cavity.solid)
  };
}

/**
 * @param {object} occt
 * @param {number} body2Shape
 * @param {{ minVolume?:number, minOpeningWidth?:number, hullDeflection?:number }} params
 * @param {function|null} onProgress
 */
export function detectPocketsByHullSubtraction(occt, body2Shape, params = {}, onProgress = null) {
  const report = (message, percent) => {
    if (typeof onProgress === 'function') onProgress({ message, percent });
  };

  const minVolume = params.minVolume ?? 1;
  const minOpeningWidth = params.minOpeningWidth ?? 0.5;
  const hullDeflection = params.hullDeflection ?? 0.02;

  report('Tessellating Body 2 for convex hull…', 20);
  const points = tessellateForHull(occt, body2Shape, hullDeflection);

  report(`Building convex hull (${points.length} points)…`, 35);
  const hullFacesIdx = quickhull3d(points);
  const hullPlanes = hullPlanesFromPoints(points, hullFacesIdx);
  const hullSolid = buildHullSolid(occt, points);

  report('Boolean cut: hull − Body 2…', 55);
  let cutResult;
  try {
    cutResult = occt.cut(hullSolid, body2Shape);
  } catch (err) {
    throw new Error(`Hull cut failed: ${err?.message ?? err}`);
  }
  if (occt.isNull(cutResult)) throw new Error('Hull cut returned null');

  const originOf = (face) => classifyFaceOriginByPlaneMatch(occt, face, hullPlanes);

  report('Splitting cavities…', 70);
  const solids = occt.getSubShapes(cutResult, 'solid');
  const list = solids.length ? solids : [cutResult];
  const cavities = [];

  for (const solid of list) {
    let volume = 0;
    try {
      volume = Math.abs(occt.getVolume(solid));
    } catch {
      continue;
    }
    if (volume < minVolume) continue;

    const faces = occt.getSubShapes(solid, 'face');
    const accessFaces = faces.filter((f) => originOf(f) === 'hull');
    const openingWidth = estimateMinOpeningWidth(occt, solid, accessFaces);
    if (openingWidth < minOpeningWidth) continue;

    cavities.push({
      solid,
      volume,
      flagged: looksLikeMergeArtifact(occt, solid) ? 'possible-merge-artifact' : null
    });
  }

  report(`Analyzing ${cavities.length} cavity(ies)…`, 85);
  return cavities.map((c, i) => analyzeCavity(occt, c, originOf, i));
}

export { estimateMinOpeningWidth };
