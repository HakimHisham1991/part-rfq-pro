/**
 * Shared sew / solidify / heal helpers for hull-subtract and user-hinted.
 * Adapts occt-wasm names (sewAndSolidify / healSolid / fixShape).
 */

/**
 * Sew faces into a solid, healing when needed.
 * @param {object} occt
 * @param {number[]} faces  ShapeHandles
 * @param {number} [tolerance=1e-4]
 * @returns {number} solid ShapeHandle
 */
export function sewFaces(occt, faces, tolerance = 1e-4) {
  if (!faces?.length) throw new Error('sewFaces: no faces');
  try {
    const solid = occt.sewAndSolidify(faces, tolerance);
    if (!occt.isNull(solid) && Math.abs(occt.getVolume(solid)) > 0) {
      return healShape(occt, solid, tolerance);
    }
  } catch {
    /* fall through */
  }

  const sewn = occt.sew(faces, tolerance);
  if (occt.isNull(sewn)) throw new Error('sewFaces: sew returned null');
  try {
    const solid = occt.makeSolid(sewn);
    return healShape(occt, solid, tolerance);
  } catch {
    const solid2 = occt.buildSolidFromFaces(faces, tolerance);
    if (occt.isNull(solid2)) throw new Error('sewFaces: could not build solid');
    return healShape(occt, solid2, tolerance);
  }
}

/**
 * Heal a solid (ShapeFix equivalent).
 * @param {object} occt
 * @param {number} shape
 * @param {number} [tolerance=1e-4]
 */
export function healShape(occt, shape, tolerance = 1e-4) {
  try {
    const healed = occt.healSolid(shape, tolerance);
    if (!occt.isNull(healed)) return healed;
  } catch {
    /* fall through */
  }
  try {
    const fixed = occt.fixShape(shape);
    if (!occt.isNull(fixed)) return fixed;
  } catch {
    /* fall through */
  }
  return shape;
}

/**
 * Build a planar triangular face from three points (hull facets).
 */
export function makeTriangleFace(occt, a, b, c) {
  return occt.buildTriFace(
    { x: a[0], y: a[1], z: a[2] },
    { x: b[0], y: b[1], z: b[2] },
    { x: c[0], y: c[1], z: c[2] }
  );
}
