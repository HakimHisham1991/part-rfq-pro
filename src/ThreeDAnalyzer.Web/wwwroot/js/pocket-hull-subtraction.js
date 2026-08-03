/**
 * Convex-hull subtraction pocket detection — operates on Body 2 only.
 *
 * Pipeline (user-specified):
 *  1. Wrap Body 2 with one enclosed convex solid (closes open / broken / large cavities)
 *  2. Shrink the wrap by 0.2 mm along face normals (inward offset)
 *  3. cavities = shrunkHull − Body2
 *  4. Keep each leftover solid as a cavity volume (mesh for magenta fill)
 *
 * The inward shrink removes the zero-thickness contact between the hull and the
 * finished exterior so the boolean splits into separate pocket solids (e.g. 5 on
 * CNC-milling-7.stp) instead of one part-coating complement.
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

/**
 * One enclosed convex solid = padded AABB ∩ half-spaces.
 * planeOffsetMm: positive expands outward; negative shrinks inward along normals.
 */
function buildHullSolidFromPlanes(occt, planes, bb, planeOffsetMm) {
  const pad = Math.max(Math.abs(planeOffsetMm) * 3, 8);
  let solid = occt.makeBoxFromCorners(
    { x: bb.xmin - pad, y: bb.ymin - pad, z: bb.zmin - pad },
    { x: bb.xmax + pad, y: bb.ymax + pad, z: bb.zmax + pad }
  );

  for (const p of planes) {
    // Outward normal: move plane origin along normal by planeOffsetMm
    // (negative ⇒ into the solid / shrink)
    const origin = {
      x: p.location[0] + p.normal[0] * planeOffsetMm,
      y: p.location[1] + p.normal[1] * planeOffsetMm,
      z: p.location[2] + p.normal[2] * planeOffsetMm
    };
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

function shrinkHullSolid(occt, hullSolid, planes, bb, shrinkMm) {
  // Prefer exact convex shrink via inward plane offset
  try {
    const shrunk = buildHullSolidFromPlanes(occt, planes, bb, -Math.abs(shrinkMm));
    if (!occt.isNull(shrunk) && Math.abs(occt.getVolume(shrunk)) > 1e-6) {
      return shrunk;
    }
  } catch {
    /* fall through to OCCT offset */
  }

  // Fallback: BRep offset (negative distance = inward)
  const offset = occt.offset(hullSolid, -Math.abs(shrinkMm), 1e-3);
  if (occt.isNull(offset) || !(Math.abs(occt.getVolume(offset)) > 1e-6)) {
    throw new Error(`Failed to shrink hull wrap by ${shrinkMm} mm`);
  }
  return offset;
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

function pocketFromSolid(occt, solid, id) {
  const info = solidMeshPayload(occt, solid, 0.35);
  if (!info?.plugMesh) return null;

  let toolAxis = [0, 0, 1];
  if (info.dims.dx <= info.dims.dy && info.dims.dx <= info.dims.dz) toolAxis = [1, 0, 0];
  else if (info.dims.dy <= info.dims.dx && info.dims.dy <= info.dims.dz) toolAxis = [0, 1, 0];

  return {
    id,
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
  };
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
 * @param {{ minVolume?:number, minOpeningWidth?:number, hullDeflection?:number, hullShrinkMm?:number }} params
 */
export function detectPocketsByHullSubtraction(occt, body2Shape, params = {}, onProgress = null) {
  const report = (message, percent) => {
    if (typeof onProgress === 'function') onProgress({ message, percent });
  };

  const minVolume = params.minVolume ?? 1;
  const minOpeningWidth = params.minOpeningWidth ?? 0.5;
  const hullDeflection = Math.max(params.hullDeflection ?? 0.5, 0.15);
  const shrinkMm = params.hullShrinkMm ?? 0.2;

  report('Tessellating Body 2 for convex hull…', 10);
  const points = tessellateForHull(occt, body2Shape, hullDeflection);
  if (points.length < 4) throw new Error('Too few points for convex hull');

  report(`Building convex hull (${points.length} points)…`, 22);
  const hullFaceIdx = quickhull3d(points);
  if (!hullFaceIdx?.length) throw new Error('QuickHull produced no faces');

  const tightPlanes = uniqueHullPlanes(hullPlanesFromPoints(points, hullFaceIdx));
  const bb = occt.getBoundingBox(body2Shape, true);
  const bodyVol = Math.abs(occt.getVolume(body2Shape));

  // 1) One enclosed convex wrap (exact — closes open / broken / large cavities)
  report(`Building enclosed hull wrap (${tightPlanes.length} planes)…`, 35);
  const hullSolid = buildHullSolidFromPlanes(occt, tightPlanes, bb, 0);
  const hullVol = Math.abs(occt.getVolume(hullSolid));
  if (!(hullVol > bodyVol * 0.99)) {
    throw new Error('Hull wrap is not larger than Body 2 — convex wrap failed');
  }

  // 2) Shrink wrap by 0.2 mm into the surface normal (inward)
  report(`Shrinking hull wrap by ${shrinkMm} mm (inward)…`, 48);
  const shrunkHull = shrinkHullSolid(occt, hullSolid, tightPlanes, bb, shrinkMm);
  const shrunkVol = Math.abs(occt.getVolume(shrunkHull));
  if (!(shrunkVol > 1e-3)) {
    throw new Error('Shrunk hull has no volume');
  }
  report(`Shrunk hull volume ${shrunkVol.toFixed(0)} mm³ (was ${hullVol.toFixed(0)})…`, 55);

  // 3) cavities = shrunkHull − Body2
  report('Subtracting Body 2 from shrunk hull…', 62);
  let cavityCompound;
  try {
    cavityCompound = occt.cut(shrunkHull, body2Shape);
  } catch (err) {
    throw new Error(`Shrunk hull − Body2 cut failed: ${err?.message ?? err}`);
  }
  if (occt.isNull(cavityCompound)) throw new Error('Shrunk hull − Body2 returned null');

  const cutVol = Math.abs(occt.getVolume(cavityCompound));
  report(`Cavity compound ${cutVol.toFixed(0)} mm³…`, 70);
  if (!(cutVol >= minVolume)) {
    report('No cavity volume above minimum', 100);
    return [];
  }

  // 4) Keep leftover solid bodies as cavity volumes
  let solids = [];
  try {
    solids = occt.getSubShapes(cavityCompound, 'solid') || [];
  } catch {
    solids = [];
  }
  if (!solids.length) solids = [cavityCompound];
  report(`Meshing ${solids.length} cavity solid(s)…`, 78);

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

    const infoPreview = (() => {
      try {
        return occt.getBoundingBox(solid, true);
      } catch {
        return null;
      }
    })();
    if (infoPreview) {
      const dx = infoPreview.xmax - infoPreview.xmin;
      const dy = infoPreview.ymax - infoPreview.ymin;
      const dz = infoPreview.zmax - infoPreview.zmin;
      const opening = Math.min(dx, dy, dz);
      if (opening < minOpeningWidth && vol < minVolume * 5) continue;
      // Discard hairline scraps from the shrink boolean
      const sorted = [dx, dy, dz].sort((a, b) => b - a);
      if (sorted[2] > 1e-6 && sorted[0] / sorted[2] > 25 && sorted[2] < shrinkMm * 4) {
        continue;
      }
    }

    report(`Meshing cavity ${i + 1}/${solids.length} (${vol.toFixed(0)} mm³)…`, 80 + Math.round((15 * i) / solids.length));
    const pocket = pocketFromSolid(occt, solid, `hull-${i}`);
    if (pocket) pockets.push(pocket);
  }

  pockets.sort((a, b) => b.volume - a.volume);
  report(`Found ${pockets.length} cavity volume(s)`, 100);
  return pockets;
}

export function estimateMinOpeningWidth(_occt, solid, _accessFaces) {
  if (solid?.dims) return Math.min(solid.dims.dx, solid.dims.dy, solid.dims.dz);
  return 0;
}
