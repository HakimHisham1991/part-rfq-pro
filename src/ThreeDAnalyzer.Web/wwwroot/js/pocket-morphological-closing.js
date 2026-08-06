/**
 * Morphological closing pocket detection — Body 2 only.
 * Dilate (outward offset) → erode (inward offset) → cavities = closed − body2.
 */

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
    detectionMethod: 'morphological-closing',
    faceIndices: null,
    wallSurfaceArea: null,
    minCornerRadius: null,
    maxBoundedSize: info.maxBoundedSize,
    center: info.center,
    plugMesh: info.plugMesh,
    dims: info.dims
  };
}

function offsetWithRetry(occt, shape, distanceMm, tolerance, retries) {
  let attempt = distanceMm;
  let lastErr;
  const sign = distanceMm < 0 ? -1 : 1;
  for (let i = 0; i <= retries; i++) {
    try {
      const result = occt.offset(shape, attempt, tolerance);
      if (!occt.isNull(result) && Math.abs(occt.getVolume(result)) > 1e-6) return result;
      lastErr = new Error('Offset collapsed to empty volume');
    } catch (err) {
      lastErr = err;
    }
    attempt = distanceMm * Math.pow(0.66, i + 1) * sign || (attempt / 2);
  }
  throw new Error(
    `Morphological offset failed after ${retries + 1} attempt(s) at ${distanceMm.toFixed(2)} mm: ` +
      `${lastErr?.message ?? lastErr}. Try Voxel Flood-Fill instead — it doesn't need a valid B-Rep offset.`
  );
}

function filterCavitySolids(occt, solids, minVolume, minOpeningWidth, hairlineRatio, hairlineMaxDim) {
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

    let bb = null;
    try {
      bb = occt.getBoundingBox(solid, true);
    } catch {
      bb = null;
    }
    if (bb) {
      const dx = bb.xmax - bb.xmin;
      const dy = bb.ymax - bb.ymin;
      const dz = bb.zmax - bb.zmin;
      const opening = Math.min(dx, dy, dz);
      if (opening < minOpeningWidth && vol < minVolume * 5) continue;
      const sorted = [dx, dy, dz].sort((a, b) => b - a);
      if (sorted[2] > 1e-6 && sorted[0] / sorted[2] > hairlineRatio && sorted[2] < hairlineMaxDim) {
        continue;
      }
    }

    const pocket = pocketFromSolid(occt, solid, `morph-${i}`);
    if (pocket) pockets.push(pocket);
  }
  return pockets;
}

/**
 * @param {object} occt
 * @param {number} body2Shape
 * @param {{ offsetMm?:number, tolerance?:number, minVolume?:number, minOpeningWidth?:number, stepDownRetries?:number }} params
 */
export function detectPocketsByMorphologicalClosing(occt, body2Shape, params = {}, onProgress = null) {
  const report = (message, percent) => {
    if (typeof onProgress === 'function') onProgress({ message, percent });
  };

  const offsetMm = Math.max(params.offsetMm ?? 1.0, 0.05);
  const tolerance = params.tolerance ?? 1e-3;
  const minVolume = params.minVolume ?? 1;
  const minOpeningWidth = params.minOpeningWidth ?? 0.5;
  const stepDownRetries = Math.max(0, params.stepDownRetries ?? 2);

  report(`Morphological dilate (+${offsetMm.toFixed(2)} mm)…`, 15);
  const dilated = offsetWithRetry(occt, body2Shape, +offsetMm, tolerance, stepDownRetries);

  report(`Morphological erode (−${offsetMm.toFixed(2)} mm)…`, 35);
  const closed = offsetWithRetry(occt, dilated, -offsetMm, tolerance, stepDownRetries);

  report('Subtracting Body 2 from closed solid…', 55);
  let cavityCompound;
  try {
    cavityCompound = occt.cut(closed, body2Shape);
  } catch (err) {
    throw new Error(`Morphological closing cut failed: ${err?.message ?? err}`);
  }
  if (occt.isNull(cavityCompound)) throw new Error('Morphological closing cut returned null');

  const cutVol = Math.abs(occt.getVolume(cavityCompound));
  report(`Cavity compound ${cutVol.toFixed(0)} mm³…`, 65);
  if (!(cutVol >= minVolume)) {
    report('No cavity volume above minimum', 100);
    return [];
  }

  let solids = [];
  try {
    solids = occt.getSubShapes(cavityCompound, 'solid') || [];
  } catch {
    solids = [];
  }
  if (!solids.length) solids = [cavityCompound];

  report(`Meshing ${solids.length} cavity solid(s)…`, 72);
  const pockets = filterCavitySolids(
    occt,
    solids,
    minVolume,
    minOpeningWidth,
    25,
    offsetMm * 4
  );

  pockets.sort((a, b) => b.volume - a.volume);
  report(`Found ${pockets.length} cavity volume(s)`, 100);
  return pockets;
}
