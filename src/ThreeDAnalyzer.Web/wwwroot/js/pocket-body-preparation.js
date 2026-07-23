/**
 * Body 2 preparation — plug every detected hole on a duplicate of the part.
 *
 * Primary strategy: fuse a cylindrical plug into each hole bore (BRepAlgoAPI_Fuse).
 * Defeaturing (BRepAlgoAPI_Defeaturing) is tried first but often throws on
 * real milled parts; fuse-plugging is the reliable fallback.
 */

import { OCCT_HASH_UPPER } from './occt-hash.js?v=1.21.1';

/**
 * A blind hole's bottom cap (plane/sphere) is not part of the recognized
 * wall component but must be removed together with the walls when defeaturing.
 */
function holeFaceNodeIds(hole, aag) {
  const set = new Set(hole.faceIndices ?? []);
  for (const idx of [...set]) {
    for (const e of aag.adjacency[idx] ?? []) {
      if (set.has(e.to)) continue;
      const neighbors = aag.adjacency[e.to] ?? [];
      if (neighbors.length > 0 && neighbors.every((n) => set.has(n.to) || n.to === idx)) {
        set.add(e.to);
      }
    }
  }
  return [...set];
}

function mapFacesByHash(occt, shape, hashes) {
  const faces = occt.getSubShapes(shape, 'face');
  const byHash = new Map();
  for (const f of faces) byHash.set(occt.hashCode(f, OCCT_HASH_UPPER), f);
  return hashes.map((h) => byHash.get(h) ?? null);
}

function tryDefeature(occt, shape, faces) {
  try {
    return occt.defeature(shape, faces, 1e-6);
  } catch {
    return occt.defeature(shape, faces, 1e-3);
  }
}

function asVec3(v) {
  if (!v) return null;
  if (Array.isArray(v)) return { x: v[0], y: v[1], z: v[2] };
  return { x: v.x, y: v.y, z: v.z };
}

function placeCylinderAlongAxis(occt, radius, height, origin, direction) {
  let solid = occt.makeCylinder(radius, height);
  const d = asVec3(direction);
  const o = asVec3(origin);
  const len = Math.hypot(d.x, d.y, d.z) || 1;
  const nx = d.x / len;
  const ny = d.y / len;
  const nz = d.z / len;

  // Rotate +Z → axis
  const dot = nz;
  if (dot < -0.999999) {
    solid = occt.rotate(solid, { point: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, Math.PI);
  } else if (dot < 0.999999) {
    let rx = -ny;
    let ry = nx;
    let rz = 0;
    let rl = Math.hypot(rx, ry, rz);
    if (rl < 1e-12) {
      rx = 1;
      ry = 0;
      rz = 0;
      rl = 1;
    } else {
      rx /= rl;
      ry /= rl;
    }
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    solid = occt.rotate(solid, { point: { x: 0, y: 0, z: 0 }, direction: { x: rx, y: ry, z: rz } }, angle);
  }

  // makeCylinder sits on XY plane from z=0..height; put mid-height at origin
  const start = {
    x: o.x - nx * (height * 0.5),
    y: o.y - ny * (height * 0.5),
    z: o.z - nz * (height * 0.5)
  };
  return occt.translate(solid, start.x, start.y, start.z);
}

/**
 * Fill one hole bore by fusing a slightly oversized cylinder into the body.
 */
function fusePlugForHole(occt, body, hole) {
  const radius = hole.radius ?? (hole.diameter != null ? hole.diameter / 2 : 0);
  const depth = hole.depth ?? radius * 2;
  const axis = hole.axis;
  const center = hole.center;
  if (!(radius > 1e-4) || !(depth > 1e-4) || !axis || !center) {
    throw new Error('hole missing radius/depth/axis/center');
  }
  // Slightly oversized radius so the plug seals against the wall; extra height
  // so blind/through ends are covered.
  const plug = placeCylinderAlongAxis(
    occt,
    radius * 1.02,
    depth + Math.max(2, radius),
    center,
    axis
  );
  const fused = occt.fuse(body, plug);
  if (occt.isNull(fused)) throw new Error('fuse returned null');
  const v0 = Math.abs(occt.getVolume(body));
  const v1 = Math.abs(occt.getVolume(fused));
  // Volume should not shrink; a tiny increase is enough to count as a plug.
  if (!(v1 >= v0 - 1e-3)) throw new Error('fuse reduced body volume');
  return fused;
}

/**
 * Plug all detected holes on a duplicate of body1.
 *
 * @returns {{ body2: number, skipped: Array<{holeIndex:number, diameter:number, reason:string}> }}
 */
export function plugHoles(occt, body1, aag1, holes, onProgress = null) {
  const report = (message, percent) => {
    if (typeof onProgress === 'function') onProgress({ message, percent });
  };

  if (!holes || holes.length === 0) {
    report('No holes to plug — Body 2 is a copy of Body 1', 60);
    return { body2: occt.copy(body1), skipped: [] };
  }

  const perHoleFaceIds = holes.map((h) => holeFaceNodeIds(h, aag1));

  // Fast path: defeature all hole faces at once (works on some parts).
  const allFaces = [];
  for (const ids of perHoleFaceIds) {
    for (const idx of ids) {
      const handle = aag1.nodes[idx]?.faceHandle;
      if (handle != null) allFaces.push(handle);
    }
  }

  report(`Plugging ${holes.length} hole(s) (${allFaces.length} faces)…`, 45);
  try {
    const body2 = tryDefeature(occt, body1, allFaces);
    if (!occt.isNull(body2) && Math.abs(occt.getVolume(body2)) > 0) {
      return { body2, skipped: [] };
    }
  } catch {
    /* fall through */
  }

  // Preferred robust path: fuse cylindrical plugs (defeaturing is fragile on milled parts).
  report('Defeaturing unavailable — filling holes with cylindrical plugs…', 50);
  let current = occt.copy(body1);
  const skipped = [];

  for (let i = 0; i < holes.length; i++) {
    report(`Plugging hole ${i + 1} / ${holes.length}…`, 50 + Math.round((i / holes.length) * 15));
    try {
      current = fusePlugForHole(occt, current, holes[i]);
      continue;
    } catch (fuseErr) {
      // Last resort: per-hole defeature by hash
      const hashes = perHoleFaceIds[i]
        .map((idx) => aag1.nodes[idx]?.faceHash)
        .filter((h) => h != null);
      const faces = mapFacesByHash(occt, current, hashes).filter((f) => f != null);
      if (faces.length === 0) {
        skipped.push({
          holeIndex: i,
          diameter: holes[i].diameter,
          reason: `fuse failed (${fuseErr?.message ?? fuseErr}); faces not found for defeature`
        });
        continue;
      }
      try {
        const next = tryDefeature(occt, current, faces);
        if (occt.isNull(next) || !(Math.abs(occt.getVolume(next)) > 0)) {
          skipped.push({
            holeIndex: i,
            diameter: holes[i].diameter,
            reason: `fuse failed (${fuseErr?.message ?? fuseErr}); defeature empty`
          });
          continue;
        }
        current = next;
      } catch (defErr) {
        skipped.push({
          holeIndex: i,
          diameter: holes[i].diameter,
          reason: `fuse: ${fuseErr?.message ?? fuseErr}; defeature: ${defErr?.message ?? defErr}`
        });
      }
    }
  }

  return { body2: current, skipped };
}

/**
 * Pick the recognition target from a STEP import: the single solid, or the
 * largest solid of a multi-body compound.
 */
export function pickTargetSolid(occt, shape) {
  if (!occt.isCompound(shape) && !occt.isCompSolid(shape)) {
    return { target: shape, note: null };
  }
  const solids = occt.getSubShapes(shape, 'solid');
  if (solids.length === 0) return { target: shape, note: null };
  if (solids.length === 1) return { target: solids[0], note: null };

  let best = solids[0];
  let bestVol = -Infinity;
  for (const s of solids) {
    let v = 0;
    try {
      v = Math.abs(occt.getVolume(s));
    } catch {
      v = 0;
    }
    if (v > bestVol) {
      bestVol = v;
      best = s;
    }
  }
  return {
    target: best,
    note: `multi-body part: pocket detection runs on the largest of ${solids.length} solids`
  };
}
