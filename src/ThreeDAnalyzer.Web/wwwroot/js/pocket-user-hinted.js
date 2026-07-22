/**
 * User-hinted pocket helpers — wall walk from selected floor face(s).
 * Interactive UI lives in viewer.js; this module is pure geometry.
 */

/**
 * Walk outward from user-selected floor face node indices on an AAG.
 * Same traversal idea as collectPocketFaces: concave/smooth continue,
 * convex stops. Fillet faces optional.
 *
 * @param {number[]} floorFaceIds  AAG node indices
 * @param {object} aag
 * @param {{ includeFillets?:boolean, maxDepth?:number }} opts
 * @returns {number[]} wall face node indices (excluding floors)
 */
export function detectWallsFromFloor(floorFaceIds, aag, opts = {}) {
  const includeFillets = opts.includeFillets !== false;
  const maxDepth = opts.maxDepth ?? 200;
  const { nodes, adjacency } = aag;
  const wallFaces = new Set();
  const queue = floorFaceIds.map((id) => ({ id, depth: 0 }));
  const visited = new Set(floorFaceIds);

  while (queue.length) {
    const { id: cur, depth } = queue.shift();
    if (depth >= maxDepth) continue;

    for (const { to, classification } of adjacency[cur] ?? []) {
      if (visited.has(to)) continue;
      if (classification === 'convex') continue;

      const st = nodes[to]?.surfaceType;
      const isFillet = st === 'cylinder' || st === 'torus' || st === 'cone';

      if (isFillet && !includeFillets) {
        wallFaces.add(to);
        continue;
      }

      visited.add(to);
      wallFaces.add(to);
      queue.push({ id: to, depth: depth + 1 });
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
  // Prefer projection along axis
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

  return {
    id: `hint-${Date.now()}`,
    volume,
    maxBoundedVolume: volume,
    maxDepth,
    depth: maxDepth,
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
      width: Math.max(bb.xmax - bb.xmin, bb.ymax - bb.ymin),
      length: Math.max(bb.xmax - bb.xmin, bb.ymax - bb.ymin, bb.zmax - bb.zmin),
      diameter: null
    },
    center: [
      (bb.xmin + bb.xmax) / 2,
      (bb.ymin + bb.ymax) / 2,
      (bb.zmin + bb.zmax) / 2
    ],
    plugMesh
  };
}
