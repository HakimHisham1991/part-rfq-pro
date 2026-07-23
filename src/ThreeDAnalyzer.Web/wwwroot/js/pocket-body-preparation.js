/**
 * Body 2 preparation — plug every detected hole on a duplicate of the part.
 *
 * Strategy (in order):
 *  1. Bulk defeature of all hole faces (fast when it works)
 *  2. Per-hole: countersink/counterdrill → cylinder faces first, heal, then cone
 *  3. Step/counterbore → fuse plugs smallest-radius stage first, then larger
 *  4. Plain holes → short fuse plug from the opening into the bore
 *  5. Last-resort per-hole defeature by face hash
 */

import { OCCT_HASH_UPPER } from './occt-hash.js?v=1.21.2';

/** Tiny overhang past each end so the plug seals the mouth without a long stub. */
const PLUG_OVERHANG_MM = 0.25;
/** Radius scale so the plug contacts the bore wall. */
const PLUG_RADIUS_SCALE = 1.01;

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
  return hashes.map((h) => byHash.get(h) ?? null).filter((f) => f != null);
}

function tryDefeature(occt, shape, faces) {
  if (!faces?.length) throw new Error('no faces to defeature');
  try {
    return occt.defeature(shape, faces, 1e-6);
  } catch {
    return occt.defeature(shape, faces, 1e-3);
  }
}

function tryHeal(occt, shape) {
  try {
    const h = occt.healSolid(shape, 1e-3);
    if (!occt.isNull(h)) return h;
  } catch {
    /* ignore */
  }
  try {
    const f = occt.fixShape(shape);
    if (!occt.isNull(f)) return f;
  } catch {
    /* ignore */
  }
  return shape;
}

function asVec3(v) {
  if (!v) return null;
  if (Array.isArray(v)) return { x: v[0], y: v[1], z: v[2] };
  return { x: v.x, y: v.y, z: v.z };
}

/**
 * Place a cylinder with its base at `origin`, extruded along `direction` for `height`.
 * (Unlike a mid-centered placement — that caused long stubs past the hole mouth.)
 */
function placeCylinderFromBase(occt, radius, height, origin, direction) {
  let solid = occt.makeCylinder(radius, height);
  const d = asVec3(direction);
  const o = asVec3(origin);
  const len = Math.hypot(d.x, d.y, d.z) || 1;
  const nx = d.x / len;
  const ny = d.y / len;
  const nz = d.z / len;

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

  // makeCylinder occupies z∈[0,height] on +Z; after rotation +Z = axis,
  // translate so the base sits at origin (opening − overhang).
  return occt.translate(solid, o.x, o.y, o.z);
}

function fusePlugSolid(occt, body, plug) {
  const fused = occt.fuse(body, plug);
  if (occt.isNull(fused)) throw new Error('fuse returned null');
  const v0 = Math.abs(occt.getVolume(body));
  const v1 = Math.abs(occt.getVolume(fused));
  if (!(v1 >= v0 - 1e-3)) throw new Error('fuse reduced body volume');
  return fused;
}

/**
 * Fuse a short plug from the hole opening into the bore.
 * `center` = opening point; `axis` points into the hole.
 */
function fusePlugAlongBore(occt, body, radius, depth, center, axis) {
  if (!(radius > 1e-4) || !(depth > 1e-4) || !center || !axis) {
    throw new Error('invalid plug parameters');
  }
  const overhang = Math.min(PLUG_OVERHANG_MM, Math.max(0.05, radius * 0.03));
  const ax = asVec3(axis);
  const len = Math.hypot(ax.x, ax.y, ax.z) || 1;
  const nx = ax.x / len;
  const ny = ax.y / len;
  const nz = ax.z / len;
  const o = asVec3(center);
  // Base slightly outside the mouth so the seal covers the rim.
  const base = {
    x: o.x - nx * overhang,
    y: o.y - ny * overhang,
    z: o.z - nz * overhang
  };
  const height = depth + 2 * overhang;
  const plug = placeCylinderFromBase(occt, radius * PLUG_RADIUS_SCALE, height, base, { x: nx, y: ny, z: nz });
  return fusePlugSolid(occt, body, plug);
}

function cylinderStages(hole) {
  return (hole.stages ?? [])
    .filter((s) => s.type === 'cylinder' && s.radius > 0)
    .slice()
    .sort((a, b) => a.radius - b.radius);
}

function coneStages(hole) {
  return (hole.stages ?? []).filter(
    (s) => (s.type === 'countersink' || s.type === 'cone') && s.faceHash != null
  );
}

function stageOpeningAndDepth(stage, holeAxis) {
  // Stage location is mid-height; axis may not match hole axis direction.
  const loc = asVec3(stage.location);
  const axis = asVec3(stage.axis) || asVec3(holeAxis);
  if (!loc || !axis) return null;
  const len = Math.hypot(axis.x, axis.y, axis.z) || 1;
  const nx = axis.x / len;
  const ny = axis.y / len;
  const nz = axis.z / len;
  const depth = stage.depth > 0 ? stage.depth : 0;
  // Prefer hole axis direction for consistent "into part" sense when available.
  const hAx = asVec3(holeAxis);
  let dir = { x: nx, y: ny, z: nz };
  if (hAx) {
    const hl = Math.hypot(hAx.x, hAx.y, hAx.z) || 1;
    const hx = hAx.x / hl;
    const hy = hAx.y / hl;
    const hz = hAx.z / hl;
    if (hx * nx + hy * ny + hz * nz < 0) {
      dir = { x: -nx, y: -ny, z: -nz };
    } else {
      dir = { x: hx, y: hy, z: hz };
    }
  }
  // Opening of this stage ≈ mid − dir*(depth/2)
  const opening = {
    x: loc.x - dir.x * (depth * 0.5),
    y: loc.y - dir.y * (depth * 0.5),
    z: loc.z - dir.z * (depth * 0.5)
  };
  return { opening, depth: depth || null, axis: dir, radius: stage.radius };
}

/**
 * Two-pass defeature for holes with cones: cylinders first → heal → cones.
 */
function defeatureCylinderThenCone(occt, body, hole, aag1, faceNodeIds) {
  const nodes = aag1.nodes;
  const cylHashes = [];
  const coneHashes = [];
  for (const idx of faceNodeIds) {
    const n = nodes[idx];
    if (!n) continue;
    if (n.surfaceType === 'cylinder') cylHashes.push(n.faceHash);
    else if (n.surfaceType === 'cone') coneHashes.push(n.faceHash);
    else if (n.surfaceType === 'plane' || n.surfaceType === 'sphere') cylHashes.push(n.faceHash); // bottom cap with walls
  }
  // Also use stage faceHashes when present
  for (const s of cylinderStages(hole)) {
    if (s.faceHash != null) cylHashes.push(s.faceHash);
  }
  for (const s of coneStages(hole)) {
    if (s.faceHash != null) coneHashes.push(s.faceHash);
  }

  const uniq = (arr) => [...new Set(arr.filter((h) => h != null))];
  const cylFaces = mapFacesByHash(occt, body, uniq(cylHashes));
  if (!cylFaces.length && !coneHashes.length) {
    throw new Error('no cylinder/cone faces for two-pass defeature');
  }

  let current = body;
  if (cylFaces.length) {
    current = tryDefeature(occt, current, cylFaces);
    if (occt.isNull(current) || !(Math.abs(occt.getVolume(current)) > 0)) {
      throw new Error('cylinder defeature produced empty shape');
    }
    current = tryHeal(occt, current);
  }

  if (coneHashes.length) {
    const coneFaces = mapFacesByHash(occt, current, uniq(coneHashes));
    if (coneFaces.length) {
      current = tryDefeature(occt, current, coneFaces);
      if (occt.isNull(current) || !(Math.abs(occt.getVolume(current)) > 0)) {
        throw new Error('cone defeature produced empty shape');
      }
      current = tryHeal(occt, current);
    }
  }
  return current;
}

/**
 * Fuse plugs for a step/counterbore: smallest radius first, then larger stages.
 */
function fuseStepStagesSmallFirst(occt, body, hole) {
  const stages = cylinderStages(hole);
  if (stages.length === 0) {
    return fusePlugAlongBore(
      occt,
      body,
      hole.radius ?? hole.diameter / 2,
      hole.depth ?? 1,
      hole.center,
      hole.axis
    );
  }

  let current = body;
  for (const stage of stages) {
    const info = stageOpeningAndDepth(stage, hole.axis);
    const radius = stage.radius;
    const depth = info?.depth || stage.depth || hole.depth || radius * 2;
    const opening = info?.opening || asVec3(hole.center);
    const axis = info?.axis || asVec3(hole.axis);
    current = fusePlugAlongBore(occt, current, radius, depth, opening, axis);
  }
  return current;
}

function holeMinRadius(hole) {
  const stages = cylinderStages(hole);
  if (stages.length) return stages[0].radius;
  return hole.radius ?? (hole.diameter != null ? hole.diameter / 2 : Infinity);
}

function hasCone(hole) {
  return (
    hole.featureType === 'countersink' ||
    hole.featureType === 'counterdrill' ||
    coneStages(hole).length > 0
  );
}

function isStepLike(hole) {
  return (
    hole.isStepHole ||
    hole.featureType === 'counterbore' ||
    hole.featureType === 'step' ||
    hole.featureType === 'counterdrill' ||
    cylinderStages(hole).length > 1
  );
}

/**
 * Plug all detected holes on a duplicate of body1.
 * Processes holes smallest-radius-first so nested step bores fill correctly.
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

  // Fast path: defeature everything at once (skips when it throws / empties).
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

  // Order: smallest bore first (fills the tip of step holes before the counterbore).
  const order = holes
    .map((h, i) => ({ i, r: holeMinRadius(h) }))
    .sort((a, b) => a.r - b.r);

  report('Plugging holes (small → large; cone after cylinder)…', 50);
  let current = occt.copy(body1);
  const skipped = [];

  for (let k = 0; k < order.length; k++) {
    const i = order[k].i;
    const hole = holes[i];
    report(
      `Plugging hole ${k + 1} / ${holes.length} (Ø${(hole.diameter ?? 0).toFixed(2)})…`,
      50 + Math.round((k / holes.length) * 15)
    );

    let done = false;

    // Countersink / counterdrill: cylinder defeature → heal → cone defeature
    if (hasCone(hole)) {
      try {
        current = defeatureCylinderThenCone(occt, current, hole, aag1, perHoleFaceIds[i]);
        done = true;
      } catch {
        /* try fuse / other paths */
      }
    }

    // Step / counterbore: fuse small cylinder stage first, then larger
    if (!done && isStepLike(hole)) {
      try {
        current = fuseStepStagesSmallFirst(occt, current, hole);
        done = true;
      } catch {
        /* continue */
      }
    }

    // Plain (or fallback): single short plug from the opening
    if (!done) {
      try {
        current = fusePlugAlongBore(
          occt,
          current,
          hole.radius ?? hole.diameter / 2,
          hole.depth ?? 1,
          hole.center,
          hole.axis
        );
        done = true;
      } catch (fuseErr) {
        // Last resort: single-pass defeature of all hole faces
        try {
          const hashes = perHoleFaceIds[i]
            .map((idx) => aag1.nodes[idx]?.faceHash)
            .filter((h) => h != null);
          const faces = mapFacesByHash(occt, current, hashes);
          if (!faces.length) throw new Error('faces not found');
          const next = tryDefeature(occt, current, faces);
          if (occt.isNull(next) || !(Math.abs(occt.getVolume(next)) > 0)) {
            throw new Error('defeature empty');
          }
          current = tryHeal(occt, next);
          done = true;
        } catch (defErr) {
          skipped.push({
            holeIndex: i,
            diameter: hole.diameter,
            reason: `fuse: ${fuseErr?.message ?? fuseErr}; defeature: ${defErr?.message ?? defErr}`
          });
        }
      }
    }
  }

  return { body2: current, skipped };
}

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
