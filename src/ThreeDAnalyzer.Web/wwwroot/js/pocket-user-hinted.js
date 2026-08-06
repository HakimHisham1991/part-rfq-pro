/**
 * User-hinted pocket helpers — wall walk from selected floor face(s).
 * Interactive UI lives in viewer.js; this module is pure geometry.
 *
 * Volume / cavity mesh use the same NX-style outer-wire extrude as AAG Face Walk
 * (see recognizePocketFromFloor in brep-pocket-recognition.js).
 */

import { collectPocketFaces } from './brep-pocket-recognition.js?v=1.21.19';

function norm3(a) {
  const L = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / L, a[1] / L, a[2] / L];
}

function floorPointAndNormal(occt, floorFace) {
  const uv = occt.uvBounds(floorFace);
  const u = (uv.uMin + uv.uMax) * 0.5;
  const v = (uv.vMin + uv.vMax) * 0.5;
  const loc = occt.pointOnSurface(floorFace, u, v);
  const n = occt.surfaceNormal(floorFace, u, v);
  const L = Math.hypot(n.x, n.y, n.z) || 1;
  return {
    loc: [loc.x, loc.y, loc.z],
    normal: [n.x / L, n.y / L, n.z / L],
    uv
  };
}

/**
 * Pocket depth = wall extent along the floor normal (bidirectional span).
 * Works when the UI axis sign differs from the B-Rep face normal.
 */
export function estimateDepthFromWalls(occt, floorFace, wallHandles, axis = null) {
  const { loc, normal } = floorPointAndNormal(occt, floorFace);
  const axes = [norm3(normal)];
  if (axis?.length === 3) {
    const ua = norm3(axis);
    if (Math.abs(ua[0] - axes[0][0]) > 1e-6 || Math.abs(ua[1] - axes[0][1]) > 1e-6 || Math.abs(ua[2] - axes[0][2]) > 1e-6) {
      axes.push(ua);
    }
  }

  let bestSpan = 0;
  for (const ax of axes) {
    let minD = Infinity;
    let maxD = -Infinity;
    for (const w of wallHandles ?? []) {
      try {
        const bb = occt.getBoundingBox(w, true);
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
        for (const c of corners) {
          const d =
            (c[0] - loc[0]) * ax[0] + (c[1] - loc[1]) * ax[1] + (c[2] - loc[2]) * ax[2];
          if (d < minD) minD = d;
          if (d > maxD) maxD = d;
        }
      } catch {
        /* skip */
      }
    }
    if (!Number.isFinite(minD)) continue;
    const span = maxD - minD;
    const cavitySide = Math.max(maxD > 0 ? maxD : 0, minD < 0 ? -minD : 0);
    bestSpan = Math.max(bestSpan, span, cavitySide);
  }
  return bestSpan;
}

/** Extrusion direction: floor normal flipped toward the selected wall(s). */
function extrusionAxisTowardWalls(occt, floorFace, wallHandles) {
  const { loc, normal } = floorPointAndNormal(occt, floorFace);
  const ax = norm3(normal);
  let pos = 0;
  let neg = 0;
  for (const w of wallHandles ?? []) {
    try {
      const bb = occt.getBoundingBox(w, true);
      const cx = (bb.xmin + bb.xmax) * 0.5;
      const cy = (bb.ymin + bb.ymax) * 0.5;
      const cz = (bb.zmin + bb.zmax) * 0.5;
      const d = (cx - loc[0]) * ax[0] + (cy - loc[1]) * ax[1] + (cz - loc[2]) * ax[2];
      if (d > 0) pos += d;
      else neg += -d;
    } catch {
      /* skip */
    }
  }
  if (neg > pos) return [-ax[0], -ax[1], -ax[2]];
  return ax;
}

/**
 * NX-style cavity: outer wire of the floor extruded along axis by `depth`.
 * Works with only floor + one wall (manual pick) — does not require a full AAG walk.
 */
export function extrudeFloorCavity(occt, floorFace, wallHandles, axis, depthHint = null) {
  const { loc, normal, uv } = floorPointAndNormal(occt, floorFace);
  const ax = extrusionAxisTowardWalls(occt, floorFace, wallHandles);

  let depth = depthHint != null && depthHint > 0 ? depthHint : 0;
  if (!(depth > 0.2)) {
    depth = estimateDepthFromWalls(occt, floorFace, wallHandles, axis ?? normal);
  }
  if (!(depth > 0.2)) {
    throw new Error(
      'Could not estimate pocket depth from the selected wall(s). Select a vertical pocket wall that rises from the floor.'
    );
  }

  let profile = floorFace;
  try {
    const wire = occt.outerWire(floorFace);
    try {
      profile = occt.makeFace(wire);
    } catch {
      /* keep face */
    }
  } catch {
    /* keep face */
  }

  const prism = occt.extrude(profile, ax[0] * depth, ax[1] * depth, ax[2] * depth);
  if (occt.isNull(prism) || !(Math.abs(occt.getVolume(prism)) > 0)) {
    throw new Error('Floor extrusion produced an empty solid');
  }

  const record = buildHintedPocketRecord(occt, prism, {
    axis: ax,
    faceHandles: [floorFace, ...(wallHandles ?? [])],
    flagged: 'floor-wire-extrude'
  });
  // Prefer measured extrusion depth over bbox diagonal
  record.depth = depth;
  record.maxDepth = depth;
  record.floorLocation = loc;
  record.floorNormal = normal;
  // Footprint from floor UV when available
  const uw = Math.abs(uv.uMax - uv.uMin);
  const vw = Math.abs(uv.vMax - uv.vMin);
  if (uw > 0 && vw > 0) {
    record.width = Math.min(uw, vw);
    record.length = Math.max(uw, vw);
    record.maxBoundedSize = { width: record.width, length: record.length, diameter: null };
    if (record.outline) {
      record.outline.width = record.width;
      record.outline.length = record.length;
      record.outline.depth = depth;
    }
  }
  return record;
}

/**
 * Walk outward from user-selected floor face node indices on an AAG.
 * Reuses collectPocketFaces (concave/smooth continue, convex = rim).
 *
 * @param {number[]} floorFaceIds  AAG node indices
 * @param {object} aag
 * @param {{ includeFillets?:boolean, maxDepth?:number }} opts
 * @returns {number[]} wall face node indices (excluding floors)
 */
export function detectWallsFromFloor(floorFaceIds, aag, opts = {}) {
  const includeFillets = opts.includeFillets !== false;
  const { nodes } = aag;
  const floorSet = new Set(floorFaceIds);
  const wallFaces = new Set();

  for (const floorIdx of floorFaceIds) {
    const { faces } = collectPocketFaces(floorIdx, aag, null);
    for (const i of faces) {
      if (floorSet.has(i)) continue;
      const st = nodes[i]?.surfaceType;
      const isFillet = st === 'cylinder' || st === 'torus' || st === 'cone';
      if (isFillet && !includeFillets) continue;
      wallFaces.add(i);
    }
  }

  return [...wallFaces];
}

/**
 * Suggest tool axis from floor normal (preferred) or dominant planar wall.
 */
export function suggestAxisFromFaces(occt, floorHandles, wallHandles) {
  for (const f of floorHandles) {
    try {
      if (occt.surfaceType(f) !== 'plane') continue;
      const uv = occt.uvBounds(f);
      const n = occt.surfaceNormal(f, (uv.uMin + uv.uMax) / 2, (uv.vMin + uv.vMax) / 2);
      const L = Math.hypot(n.x, n.y, n.z) || 1;
      return [n.x / L, n.y / L, n.z / L];
    } catch {
      /* next */
    }
  }
  // Fall back: average planar wall normals
  let ax = 0;
  let ay = 0;
  let az = 0;
  let n = 0;
  for (const f of wallHandles) {
    try {
      if (occt.surfaceType(f) !== 'plane') continue;
      const uv = occt.uvBounds(f);
      const nr = occt.surfaceNormal(f, (uv.uMin + uv.uMax) / 2, (uv.vMin + uv.vMax) / 2);
      ax += nr.x;
      ay += nr.y;
      az += nr.z;
      n++;
    } catch {
      /* skip */
    }
  }
  if (n === 0) return [0, 0, 1];
  const L = Math.hypot(ax, ay, az) || 1;
  return [ax / L, ay / L, az / L];
}

/**
 * Build a pocket record from an enclosed solid + metadata.
 * Kept for callers that already have a solid; prefer recognizePocketFromFloor.
 */
export function buildHintedPocketRecord(occt, solid, meta = {}) {
  const volume = Math.abs(occt.getVolume(solid));
  const axis = meta.axis ?? [0, 0, 1];
  const bb = occt.getBoundingBox(solid, true);
  const depth = Math.max(
    bb.xmax - bb.xmin,
    bb.ymax - bb.ymin,
    bb.zmax - bb.zmin
  );
  const a = axis;
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
  let minP = Infinity;
  let maxP = -Infinity;
  for (const c of corners) {
    const p = c[0] * a[0] + c[1] * a[1] + c[2] * a[2];
    if (p < minP) minP = p;
    if (p > maxP) maxP = p;
  }
  const maxDepth = Math.max(0, maxP - minP) || depth;

  let wallSurfaceArea = null;
  let minCornerRadius = null;
  const faces = meta.faceHandles ?? [];
  if (faces.length) {
    let area = 0;
    const radii = [];
    for (const f of faces) {
      try {
        area += Math.abs(occt.getSurfaceArea(f));
        const st = occt.surfaceType(f);
        if (st === 'cylinder') {
          const d = occt.getFaceCylinderData?.(f);
          if (d?.radius > 0) radii.push(d.radius);
        }
      } catch {
        /* skip */
      }
    }
    wallSurfaceArea = area;
    if (radii.length) minCornerRadius = Math.min(...radii);
  }

  let plugMesh = null;
  try {
    const mesh = occt.tessellate(solid, { linearDeflection: 0.15, angularDeflection: 0.3 });
    plugMesh = {
      positions: Array.from(mesh.positions),
      indices: Array.from(mesh.indices)
    };
  } catch {
    plugMesh = null;
  }

  const width = Math.max(bb.xmax - bb.xmin, bb.ymax - bb.ymin);
  const length = Math.max(bb.xmax - bb.xmin, bb.ymax - bb.ymin, bb.zmax - bb.zmin);
  const center = [
    (bb.xmin + bb.xmax) / 2,
    (bb.ymin + bb.ymax) / 2,
    (bb.zmin + bb.zmax) / 2
  ];

  return {
    id: `hint-${Date.now()}`,
    volume,
    maxBoundedVolume: volume,
    maxDepth,
    depth: maxDepth,
    width,
    length,
    toolAxis: axis,
    axis,
    accessType: meta.accessType ?? 'single-axis',
    shape: null,
    isFullyEnclosed: false,
    isThrough: false,
    flagged: meta.flagged ?? null,
    detectionMethod: 'user-hinted',
    faceIndices: meta.faceIndices ?? null,
    faceHashes: meta.faceHashes ?? null,
    wallSurfaceArea,
    minCornerRadius,
    maxBoundedSize: {
      width,
      length,
      diameter: null
    },
    center,
    plugMesh,
    outline: {
      width,
      length,
      depth: maxDepth,
      center,
      axis
    }
  };
}
