/**
 * Convex-hull subtraction pocket detection — operates on Body 2 only.
 *
 * Intended method (user-specified):
 *  1. Wrap the plugged body with its convex hull (closes open / broken / large cavities)
 *  2. Build that wrap as one enclosed solid
 *  3. Subtract Body 2 from the wrap:  cavities = hull − Body2
 *  4. Each resulting solid (or the single complement) is pocket volume
 *
 * A tiny outward expand is used only so the boolean does not collapse where hull
 * facets coincide with the part skin; the thin expand-band shell is discarded.
 */

import quickhull3d from '/lib/quickhull3d.bundle.js';

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

/** Hull face planes with outward normals (centroid on the negative / inside side). */
function hullPlanesFromPoints(points, faces) {
  const planes = [];
  for (const face of faces) {
    const a = points[face[0]];
    const b = points[face[1]];
    const c = points[face[2]];
    const n = normalize(cross(sub(b, a), sub(c, a)));
    planes.push({ normal: n, location: [...a], d: dot(n, a) });
  }
  const c = centroidOf(points);
  for (const p of planes) {
    if (dot(p.normal, c) - p.d > 0) {
      p.normal = [-p.normal[0], -p.normal[1], -p.normal[2]];
      p.d = -p.d;
    }
  }
  return planes;
}

function uniqueHullPlanes(planes, angTol = 0.02, distTol = 0.4) {
  const out = [];
  for (const p of planes) {
    let dup = false;
    for (const q of out) {
      if (dot(p.normal, q.normal) < 1 - angTol) continue;
      if (Math.abs(p.d - q.d) > distTol) continue;
      dup = true;
      break;
    }
    if (!dup) out.push(p);
  }
  return out;
}

function pointInConvexHull(pt, planes, tol = 0.35) {
  for (const p of planes) {
    if (dot(p.normal, pt) - p.d > tol) return false;
  }
  return true;
}

/**
 * One enclosed convex solid = padded AABB ∩ half-spaces.
 * expandMm > 0 pushes planes outward so cut(hull, body) does not vanish on
 * coincident faces; the thin outer band is filtered after the cut.
 */
function buildHullSolidFromPlanes(occt, planes, bb, expandMm) {
  const pad = Math.max(expandMm * 3, 8);
  let solid = occt.makeBoxFromCorners(
    { x: bb.xmin - pad, y: bb.ymin - pad, z: bb.zmin - pad },
    { x: bb.xmax + pad, y: bb.ymax + pad, z: bb.zmax + pad }
  );

  for (const p of planes) {
    const origin = {
      x: p.location[0] + p.normal[0] * expandMm,
      y: p.location[1] + p.normal[1] * expandMm,
      z: p.location[2] + p.normal[2] * expandMm
    };
    // halfSpace fills the side its normal points into → inward keeps the hull interior
    const inward = { x: -p.normal[0], y: -p.normal[1], z: -p.normal[2] };
    const hs = occt.halfSpace(origin, inward);
    solid = occt.common(solid, hs);
    if (occt.isNull(solid)) throw new Error('Hull half-space clip returned null');
    if (!(Math.abs(occt.getVolume(solid)) > 1e-6)) {
      throw new Error('Hull half-space clip collapsed');
    }
  }
  return solid;
}

function solidMeshPayload(occt, solid, deflection = 0.35) {
  const mesh = occt.tessellate(solid, {
    linearDeflection: deflection,
    angularDeflection: 0.35
  });
  if (!mesh?.positions?.length || !mesh?.indices?.length) return null;

  const bb = occt.getBoundingBox(solid, true);
  const dx = bb.xmax - bb.xmin;
  const dy = bb.ymax - bb.ymin;
  const dz = bb.zmax - bb.zmin;
  const sorted = [dx, dy, dz].sort((a, b) => a - b);

  let center;
  try {
    const com = occt.getCenterOfMass(solid);
    center = [com.x, com.y, com.z];
  } catch {
    center = [(bb.xmin + bb.xmax) / 2, (bb.ymin + bb.ymax) / 2, (bb.zmin + bb.zmax) / 2];
  }

  const pos =
    mesh.positions instanceof Float32Array
      ? Array.from(mesh.positions)
      : [...mesh.positions];
  const indices =
    mesh.indices instanceof Uint32Array ? Array.from(mesh.indices) : [...mesh.indices];

  return {
    volume: Math.abs(occt.getVolume(solid)),
    center,
    depth: sorted[2],
    maxBoundedSize: { width: sorted[1], length: sorted[2], diameter: null },
    plugMesh: { positions: pos, indices },
    dims: { dx, dy, dz }
  };
}

/** Fraction of sampled mesh centroids that lie inside the tight hull. */
function fractionInsideTightHull(occt, solid, planes, tol = 0.5) {
  let mesh;
  try {
    mesh = occt.tessellate(solid, { linearDeflection: 0.8, angularDeflection: 0.5 });
  } catch {
    return 0;
  }
  if (!mesh?.indices?.length) return 0;
  const pos = mesh.positions;
  const idx = mesh.indices;
  const triCount = idx.length / 3;
  const stride = Math.max(1, Math.floor(triCount / 60));
  let inside = 0;
  let n = 0;
  for (let t = 0; t < idx.length; t += 3 * stride) {
    const i0 = idx[t] * 3;
    const i1 = idx[t + 1] * 3;
    const i2 = idx[t + 2] * 3;
    const pt = [
      (pos[i0] + pos[i1] + pos[i2]) / 3,
      (pos[i0 + 1] + pos[i1 + 1] + pos[i2 + 1]) / 3,
      (pos[i0 + 2] + pos[i1 + 2] + pos[i2 + 2]) / 3
    ];
    n += 1;
    if (pointInConvexHull(pt, planes, tol)) inside += 1;
  }
  return n > 0 ? inside / n : 0;
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
  if (solidOrDims?.dims) {
    const a = normalize(axis);
    const { dx, dy, dz } = solidOrDims.dims;
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
 * @param {number} body2Shape  hole-plugged body
 * @param {{ minVolume?:number, minOpeningWidth?:number, hullDeflection?:number, hullExpandMm?:number }} params
 */
export function detectPocketsByHullSubtraction(occt, body2Shape, params = {}, onProgress = null) {
  const report = (message, percent) => {
    if (typeof onProgress === 'function') onProgress({ message, percent });
  };

  const minVolume = params.minVolume ?? 1;
  const minOpeningWidth = params.minOpeningWidth ?? 0.5;
  // UI default was 0.02 (very fine); clamp so hull build stays responsive
  const hullDeflection = Math.max(params.hullDeflection ?? 0.5, 0.15);
  // Small expand so boolean succeeds on coincident hull/part faces
  const expandMm = params.hullExpandMm ?? 0.35;

  report('Tessellating Body 2 for convex hull…', 10);
  const points = tessellateForHull(occt, body2Shape, hullDeflection);
  if (points.length < 4) throw new Error('Too few points for convex hull');

  report(`Building convex hull (${points.length} points)…`, 22);
  const hullFaceIdx = quickhull3d(points);
  if (!hullFaceIdx?.length) throw new Error('QuickHull produced no faces');

  const tightPlanes = uniqueHullPlanes(hullPlanesFromPoints(points, hullFaceIdx));
  const bb = occt.getBoundingBox(body2Shape, true);
  const bodyVol = Math.abs(occt.getVolume(body2Shape));

  report(`Building enclosed hull solid (${tightPlanes.length} planes)…`, 35);
  const hullSolid = buildHullSolidFromPlanes(occt, tightPlanes, bb, expandMm);
  const hullVol = Math.abs(occt.getVolume(hullSolid));
  if (!(hullVol > bodyVol * 0.99)) {
    throw new Error('Hull solid is not larger than Body 2 — wrap failed');
  }

  report('Subtracting Body 2 from hull wrap (cavities = hull − part)…', 55);
  let cavityCompound;
  try {
    // Removes Body2 from the wrap → leftover volume is every closed cavity
    cavityCompound = occt.cut(hullSolid, body2Shape);
  } catch (err) {
    throw new Error(`Hull − Body2 cut failed: ${err?.message ?? err}`);
  }
  if (occt.isNull(cavityCompound)) throw new Error('Hull − Body2 returned null');

  const cutVol = Math.abs(occt.getVolume(cavityCompound));
  report(
    `Cavity compound ${cutVol.toFixed(0)} mm³ (hull ${hullVol.toFixed(0)} − body ${bodyVol.toFixed(0)})…`,
    65
  );

  if (!(cutVol >= minVolume)) {
    report('No cavity volume above minimum', 100);
    return [];
  }

  // Explode into separate cavity solids when OCCT returns a compound
  let solids = [];
  try {
    solids = occt.getSubShapes(cavityCompound, 'solid') || [];
  } catch {
    solids = [];
  }
  if (!solids.length) solids = [cavityCompound];
  report(`Found ${solids.length} solid(s) in cavity compound…`, 72);

  const pockets = [];
  for (let i = 0; i < solids.length; i++) {
    const solid = solids[i];
    let vol = 0;
    try {
      vol = Math.abs(occt.getVolume(solid));
    } catch {
      continue;
    }
    if (!(vol >= minVolume)) continue;

    // Drop the thin expand-band shell (lives outside the tight hull)
    const fracInside = fractionInsideTightHull(occt, solid, tightPlanes, 0.6);
    if (fracInside < 0.35) {
      report(`Skipping shell solid ${i + 1} (${(fracInside * 100).toFixed(0)}% inside tight hull)…`, 75);
      continue;
    }

    // Mass center should sit in a cavity (inside tight wrap), not in the outer band
    try {
      const com = occt.getCenterOfMass(solid);
      if (!pointInConvexHull([com.x, com.y, com.z], tightPlanes, Math.max(expandMm, 0.75))) {
        // Allow if most of the mesh is still inside (mixed solid)
        if (fracInside < 0.6) continue;
      }
    } catch {
      /* ignore */
    }

    report(`Meshing cavity solid ${i + 1}/${solids.length} (${vol.toFixed(0)} mm³)…`, 78 + Math.round((18 * i) / solids.length));
    const info = solidMeshPayload(occt, solid, 0.35);
    if (!info?.plugMesh) continue;

    const opening = Math.min(info.dims.dx, info.dims.dy, info.dims.dz);
    if (opening < minOpeningWidth && vol < minVolume * 5) continue;

    const sorted = [info.dims.dx, info.dims.dy, info.dims.dz].sort((a, b) => b - a);
    // Ultra-thin expand crust only
    if (sorted[2] > 1e-6 && sorted[0] / sorted[2] > 20 && sorted[2] < expandMm * 3 && vol < bodyVol * 0.02) {
      continue;
    }

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
      flagged: null,
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

  // If filtering removed everything but the compound has real volume, keep it as one pocket
  if (pockets.length === 0 && cutVol >= minVolume) {
    report('Using full cavity compound as one pocket volume…', 90);
    const info = solidMeshPayload(occt, cavityCompound, 0.4);
    if (info?.plugMesh && info.volume >= minVolume) {
      let toolAxis = [0, 0, 1];
      if (info.dims.dx <= info.dims.dy && info.dims.dx <= info.dims.dz) toolAxis = [1, 0, 0];
      else if (info.dims.dy <= info.dims.dx && info.dims.dy <= info.dims.dz) toolAxis = [0, 1, 0];
      pockets.push({
        id: 'hull-all',
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
        flagged: null,
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
  }

  pockets.sort((a, b) => b.volume - a.volume);
  report(`Found ${pockets.length} cavity volume(s)`, 100);
  return pockets;
}

export function estimateMinOpeningWidth(_occt, solid, _accessFaces) {
  if (solid?.dims) return Math.min(solid.dims.dx, solid.dims.dy, solid.dims.dz);
  return 0;
}
