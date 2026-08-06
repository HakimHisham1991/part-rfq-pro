/**
 * Stock-subtraction (delta-volume) pocket detection — Body 2 only.
 *
 * stockSolid = Body-2 axis-aligned bounding box, shrunk inward by a small inset
 * (default 0.2 mm) so the boolean does not leave zero-thickness contact shells
 * or exterior “leaking” slivers at the stock envelope.
 * removal = stockSolid − Body2
 */

const DEFAULT_STOCK_INSET_MM = 0.2;

function buildInsetStockBox(bb, insetMm) {
  const inset = Math.max(Number(insetMm) || 0, 0);
  const stockMin = {
    x: bb.xmin + inset,
    y: bb.ymin + inset,
    z: bb.zmin + inset
  };
  const stockMax = {
    x: bb.xmax - inset,
    y: bb.ymax - inset,
    z: bb.zmax - inset
  };
  return { stockMin, stockMax, inset };
}

/** Fast default: does this region's own bbox reach a stock envelope face? */
function openFacesByBoundingBox(sbb, stockMin, stockMax, tol) {
  const faces = {
    px: Math.abs(sbb.xmax - stockMax.x) <= tol,
    nx: Math.abs(sbb.xmin - stockMin.x) <= tol,
    py: Math.abs(sbb.ymax - stockMax.y) <= tol,
    ny: Math.abs(sbb.ymin - stockMin.y) <= tol,
    pz: Math.abs(sbb.zmax - stockMax.z) <= tol,
    nz: Math.abs(sbb.zmin - stockMin.z) <= tol
  };
  return Object.entries(faces)
    .filter(([, v]) => v)
    .map(([k]) => k);
}

/**
 * Stricter: planar face coincident with a stock plane (not just bbox corner grazing).
 */
function openFacesByExactFaceTest(occt, solid, stockMin, stockMax, tol) {
  const found = new Set();
  let faces = [];
  try {
    faces = occt.getSubShapes(solid, 'face') || [];
  } catch {
    return openFacesByBoundingBox(occt.getBoundingBox(solid, true), stockMin, stockMax, tol);
  }
  for (const f of faces) {
    try {
      if (occt.surfaceType(f) !== 'plane') continue;
      const uv = occt.uvBounds(f);
      const p = occt.pointOnSurface(f, (uv.uMin + uv.uMax) / 2, (uv.vMin + uv.vMax) / 2);
      if (Math.abs(p.x - stockMax.x) <= tol) found.add('px');
      if (Math.abs(p.x - stockMin.x) <= tol) found.add('nx');
      if (Math.abs(p.y - stockMax.y) <= tol) found.add('py');
      if (Math.abs(p.y - stockMin.y) <= tol) found.add('ny');
      if (Math.abs(p.z - stockMax.z) <= tol) found.add('pz');
      if (Math.abs(p.z - stockMin.z) <= tol) found.add('nz');
    } catch {
      /* skip unreadable face */
    }
  }
  return [...found];
}

const FACE_AXIS = {
  px: [1, 0, 0],
  nx: [-1, 0, 0],
  py: [0, 1, 0],
  ny: [0, -1, 0],
  pz: [0, 0, 1],
  nz: [0, 0, -1]
};
const OPPOSITE_FACE = { px: 'nx', nx: 'px', py: 'ny', ny: 'py', pz: 'nz', nz: 'pz' };

// TODO(operation-field-schemas): add 'multi-axis' case if accessType is switched on for cycle-time.
function buildStockSubtractionPocketRecord(occt, solid, id, openFaces, dims) {
  const mesh = occt.tessellate(solid, { linearDeflection: 0.2, angularDeflection: 0.3 });
  if (!mesh?.positions?.length || !mesh?.indices?.length) return null;

  const volume = Math.abs(occt.getVolume(solid));
  let center;
  try {
    const com = occt.getCenterOfMass(solid);
    center = [com.x, com.y, com.z];
  } catch {
    center = [0, 0, 0];
  }

  const isOpen = openFaces.length > 0;
  const isThrough = openFaces.some((f) => openFaces.includes(OPPOSITE_FACE[f]));
  const accessAxes = openFaces.map((f) => FACE_AXIS[f]);
  const primaryAxis = accessAxes[0] ?? [0, 0, 1];

  const sorted = [dims.dx, dims.dy, dims.dz].sort((a, b) => a - b);

  return {
    id,
    volume,
    maxBoundedVolume: volume,
    maxDepth: sorted[2],
    depth: sorted[2],
    toolAxis: primaryAxis,
    axis: primaryAxis,
    accessType: isThrough ? 'through' : accessAxes.length > 1 ? 'multi-axis' : 'single-axis',
    accessAxes: accessAxes.length ? accessAxes : [primaryAxis],
    shape: null,
    isFullyEnclosed: !isOpen,
    isThrough,
    flagged: isOpen ? null : 'enclosed-void-see-morphological-closing-or-voxel-flood-fill',
    detectionMethod: 'stock-subtraction',
    faceIndices: null,
    wallSurfaceArea: null,
    minCornerRadius: null,
    maxBoundedSize: { width: sorted[1], length: sorted[2], diameter: null },
    center,
    plugMesh: {
      positions:
        mesh.positions instanceof Float32Array ? Array.from(mesh.positions) : [...mesh.positions],
      indices: mesh.indices instanceof Uint32Array ? Array.from(mesh.indices) : [...mesh.indices]
    },
    dims: { dx: dims.dx, dy: dims.dy, dz: dims.dz }
  };
}

/**
 * @param {object} occt
 * @param {number} body2Shape
 * @param {{ stockInsetMm?:number, minVolume?:number, minOpeningWidth?:number, openTouchTolerance?:number, openClassifyBy?:string }} params
 */
export function detectPocketsByStockSubtraction(occt, body2Shape, params = {}, onProgress = null) {
  const report = (message, percent) => {
    if (typeof onProgress === 'function') onProgress({ message, percent });
  };

  const stockInsetMm = params.stockInsetMm ?? DEFAULT_STOCK_INSET_MM;
  const minVolume = params.minVolume ?? 1;
  const minOpeningWidth = params.minOpeningWidth ?? 0.5;
  const touchTolerance = params.openTouchTolerance ?? 0.05;
  const classifyBy = params.openClassifyBy ?? 'bbox';

  report(`Building stock solid (Body 2 bbox − ${stockInsetMm} mm per face)…`, 8);
  const bb = occt.getBoundingBox(body2Shape, true);
  const { stockMin, stockMax, inset } = buildInsetStockBox(bb, stockInsetMm);
  if (stockMax.x <= stockMin.x || stockMax.y <= stockMin.y || stockMax.z <= stockMin.z) {
    throw new Error(
      `Stock envelope collapsed after ${inset} mm inset — part bbox is too thin for this inset`
    );
  }
  const stockSolid = occt.makeBoxFromCorners(stockMin, stockMax);

  report('Cutting Body 2 from stock (removal volume)…', 25);
  let removal;
  try {
    removal = occt.cut(stockSolid, body2Shape);
  } catch (err) {
    throw new Error(`Stock − Body2 cut failed: ${err?.message ?? err}`);
  }
  if (occt.isNull(removal)) throw new Error('Stock − Body2 returned null');

  const removalVol = Math.abs(occt.getVolume(removal));
  report(`Removal volume ${removalVol.toFixed(0)} mm³…`, 40);
  if (!(removalVol >= minVolume)) {
    report('No removal volume above minimum', 100);
    return [];
  }

  report('Splitting removal volume into connected regions…', 50);
  let solids = [];
  try {
    solids = occt.getSubShapes(removal, 'solid') || [];
  } catch {
    solids = [];
  }
  if (!solids.length) solids = [removal];

  const pockets = [];
  for (let i = 0; i < solids.length; i++) {
    const solid = solids[i];
    let vol;
    try {
      vol = Math.abs(occt.getVolume(solid));
    } catch {
      continue;
    }
    if (!(vol >= minVolume)) continue;

    const sbb = occt.getBoundingBox(solid, true);
    const dx = sbb.xmax - sbb.xmin;
    const dy = sbb.ymax - sbb.ymin;
    const dz = sbb.zmax - sbb.zmin;
    const opening = Math.min(dx, dy, dz);
    if (opening < minOpeningWidth && vol < minVolume * 5) continue;

    report(
      `Classifying region ${i + 1}/${solids.length} (${vol.toFixed(0)} mm³)…`,
      55 + Math.round((30 * i) / solids.length)
    );
    const openFaces =
      classifyBy === 'exactFace'
        ? openFacesByExactFaceTest(occt, solid, stockMin, stockMax, touchTolerance)
        : openFacesByBoundingBox(sbb, stockMin, stockMax, touchTolerance);

    const pocket = buildStockSubtractionPocketRecord(occt, solid, `stock-${i}`, openFaces, {
      dx,
      dy,
      dz
    });
    if (pocket) pockets.push(pocket);
  }

  pockets.sort((a, b) => {
    if (a.isFullyEnclosed !== b.isFullyEnclosed) return a.isFullyEnclosed ? 1 : -1;
    return b.volume - a.volume;
  });

  const openCount = pockets.filter((p) => !p.isFullyEnclosed).length;
  report(
    `Found ${pockets.length} region(s): ${openCount} open, ${pockets.length - openCount} enclosed`,
    100
  );
  return pockets;
}
