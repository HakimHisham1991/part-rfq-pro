/**
 * Body 2 preparation — plug (defeature) every detected hole on a duplicate of
 * the part so hole bores never get reported as pseudo-cavities by any pocket
 * detection method. Body 1 (the raw part) is never used for pocket detection
 * once Body 2 exists.
 */

const HASH_UPPER = 1 << 30;

/**
 * A blind hole's bottom cap (plane/sphere) is not part of the recognized
 * wall component but must be removed together with the walls, otherwise
 * defeaturing leaves a floating disk. Include any face whose every neighbor
 * is already a hole face.
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
  for (const f of faces) byHash.set(occt.hashCode(f, HASH_UPPER), f);
  return hashes.map((h) => byHash.get(h) ?? null);
}

function tryDefeature(occt, shape, faces) {
  try {
    return occt.defeature(shape, faces, 1e-6);
  } catch {
    return occt.defeature(shape, faces, 1e-3);
  }
}

/**
 * Plug all detected holes on a duplicate of body1.
 *
 * @param {object} occt   OcctKernel
 * @param {number} body1  ShapeHandle of the raw solid
 * @param {object} aag1   AAG built on body1 (nodes carry faceHandle + faceHash)
 * @param {object[]} holes  recognizeHoles() output
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

  // Fast path: remove every hole face in a single defeaturing pass.
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
    /* fall through to per-hole plugging */
  }

  // Per-hole fallback: skip individual fragile holes (breaking into a pocket
  // wall, near a part edge) instead of aborting the whole pass. Faces must be
  // re-resolved by hash after every successful defeature because the shape
  // (and its sub-shape handles) change.
  report('Bulk plugging failed — plugging holes one at a time…', 50);
  let current = occt.copy(body1);
  const skipped = [];

  for (let i = 0; i < holes.length; i++) {
    report(`Plugging hole ${i + 1} / ${holes.length}…`, 50 + Math.round((i / holes.length) * 15));
    const hashes = perHoleFaceIds[i]
      .map((idx) => aag1.nodes[idx]?.faceHash)
      .filter((h) => h != null);
    const faces = mapFacesByHash(occt, current, hashes).filter((f) => f != null);

    if (faces.length === 0) {
      skipped.push({
        holeIndex: i,
        diameter: holes[i].diameter,
        reason: 'faces not found on working body (changed by a previous plug)'
      });
      continue;
    }

    try {
      const next = tryDefeature(occt, current, faces);
      if (occt.isNull(next) || !(Math.abs(occt.getVolume(next)) > 0)) {
        skipped.push({ holeIndex: i, diameter: holes[i].diameter, reason: 'defeaturing produced an empty shape' });
        continue;
      }
      current = next;
    } catch (err) {
      skipped.push({ holeIndex: i, diameter: holes[i].diameter, reason: String(err?.message ?? err) });
    }
  }

  return { body2: current, skipped };
}

/**
 * Pick the recognition target from a STEP import: the single solid, or the
 * largest solid of a multi-body compound.
 * @returns {{ target: number, note: string|null }}
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
