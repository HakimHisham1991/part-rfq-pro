/**
 * Pocket recognition on an Attributed Adjacency Graph (AAG).
 *
 * Floor-anchored cavities with support for:
 * - Filleted floors (smooth G1 into transition blends)
 * - Broken floors (through-cuts / openings patched for max-bounded metrics)
 * - Imperfect walls (notches) — walls are not mistaken for free-flat stock
 *
 * See THIRD_PARTY_NOTICES.md and brep-pocket-recognition-cursor-prompt.md.
 */

const MAX_POCKET_FACES = 64;
const MAX_FOOTPRINT_SPAN = 500;
const FLOOR_COPLANAR_TOL = 0.15; // mm
const FLOOR_NORMAL_DOT_MIN = 0.999;

function v3toArray(v) {
  if (!v) return null;
  if (Array.isArray(v)) return v;
  return [v.x, v.y, v.z];
}

function toVec3(v) {
  if (!v) return null;
  if (Array.isArray(v)) return { x: v[0], y: v[1], z: v[2] };
  return v;
}

function v3dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function v3sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function v3add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function v3scale(a, s) {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function v3len(a) {
  return Math.hypot(a.x, a.y, a.z);
}

function v3normalize(a) {
  const len = v3len(a);
  if (len < 1e-12) return { x: 0, y: 0, z: 1 };
  return v3scale(a, 1 / len);
}

function v3cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function edgeCounts(idx, aag) {
  const c = { convex: 0, concave: 0, smooth: 0 };
  for (const e of aag.adjacency[idx]) c[e.classification]++;
  return c;
}

function hasFilletNeighbor(idx, aag) {
  const { nodes, adjacency } = aag;
  return adjacency[idx].some(
    (e) =>
      (e.classification === 'smooth' || e.classification === 'concave') &&
      nodes[e.to]?.surfaceType !== 'plane'
  );
}

/**
 * Circular / counterbore-style floor: planar face with a torus blend and a
 * cylindrical wall (often only 1–2 neighbors).
 */
function isCircularPocketFloor(idx, aag) {
  const { nodes, adjacency } = aag;
  const neighbors = adjacency[idx];
  if (neighbors.length < 1 || neighbors.length > 4) return false;
  const c = edgeCounts(idx, aag);
  if (c.concave > 0) return false;
  if (c.smooth < 1 || c.smooth > 2) return false;
  if (c.convex > 2) return false;
  let hasTorus = false;
  let hasCyl = false;
  for (const e of neighbors) {
    const t = nodes[e.to]?.surfaceType;
    if (t === 'torus') hasTorus = true;
    if (t === 'cylinder' || t === 'cone') hasCyl = true;
  }
  return hasTorus && hasCyl;
}

/**
 * Sharp rectangular floor with through-holes: ≥3 concave links to planar
 * walls; convex cylinder/cone neighbors are hole openings (patched later).
 * Stock faces and ordinary walls must not match.
 */
function isSharpFloorWithHoleOpenings(idx, aag) {
  const { nodes, adjacency } = aag;
  const n = nodes[idx];
  if (n.surfaceType !== 'plane' || !n.axis) return false;
  if (isLikelyStockFace(idx, aag)) return false;

  const nFloor = v3normalize(n.axis);
  let planarWallConcave = 0;
  let convexOpenings = 0;
  let convexOther = 0;

  for (const e of adjacency[idx]) {
    const to = nodes[e.to];
    if (!to) continue;
    if (e.classification === 'concave' || e.classification === 'smooth') {
      if (to.surfaceType === 'plane' && to.axis) {
        if (Math.abs(v3dot(nFloor, v3normalize(to.axis))) < 0.35) {
          planarWallConcave++;
        }
      }
    } else if (e.classification === 'convex') {
      if (to.surfaceType === 'cylinder' || to.surfaceType === 'cone') {
        convexOpenings++;
      } else {
        convexOther++;
      }
    }
  }

  // Need clear rising walls; allow many hole openings; reject if convex
  // planar/other rims dominate (typical wall: 1 convex to ceiling).
  if (planarWallConcave < 3) return false;
  if (convexOther > planarWallConcave) return false;
  return convexOpenings > 0 || planarWallConcave >= 3;
}

/**
 * Filleted rectangular pocket floor: planar face with smooth G1 links into
 * corner tori (and typically cylindrical wall blends), plus convex rim edges
 * to the stock opening. Interior ratio is often ~0.45–0.55 so the broken-floor
 * heuristic rejects these; torus count is the reliable signal.
 */
function isFilletedPocketFloor(idx, aag) {
  const { nodes, adjacency } = aag;
  const n = nodes[idx];
  if (n.surfaceType !== 'plane' || !n.axis) return false;
  if (isLikelyStockFace(idx, aag)) return false;

  const c = edgeCounts(idx, aag);
  if (c.smooth < 2) return false;

  let torusBlend = 0;
  let interiorLinks = 0;
  const nFloor = v3normalize(n.axis);

  for (const e of adjacency[idx]) {
    const to = nodes[e.to];
    if (!to) continue;
    if (e.classification === 'smooth' || e.classification === 'concave') {
      if (to.surfaceType === 'torus') {
        torusBlend++;
      } else if (
        to.surfaceType === 'cylinder' ||
        to.surfaceType === 'cone' ||
        to.surfaceType === 'bspline' ||
        to.surfaceType === 'bezier'
      ) {
        interiorLinks++;
      } else if (to.surfaceType === 'plane' && to.axis) {
        if (Math.abs(v3dot(nFloor, v3normalize(to.axis))) < 0.35) {
          interiorLinks++;
        }
      }
    }
  }

  if (torusBlend < 2) return false;
  if (interiorLinks + torusBlend < 3) return false;

  if (c.convex > 0) {
    if (c.convex > c.smooth + c.concave + 4) return false;
    return true;
  }

  return c.concave > 0;
}

/**
 * Floor candidate:
 * - Closed filleted: no convex, smooth/concave into blends
 * - Sharp + hole openings: concave walls + convex cylinder through-cuts
 * - Circular: torus + cylinder neighbors
 * - Broken (patched): many transition tori + convex through-cut openings
 */
function isFloorCandidate(idx, aag) {
  const { nodes, adjacency } = aag;
  const n = nodes[idx];
  if (n.surfaceType !== 'plane') return false;
  const neighbors = adjacency[idx];
  if (!neighbors.length) return false;

  const c = edgeCounts(idx, aag);
  const total = c.convex + c.concave + c.smooth;
  if (total === 0) return false;

  const interior = c.concave + c.smooth;
  const interiorRatio = interior / total;
  const fillet = hasFilletNeighbor(idx, aag);

  // Classic closed floor
  if (c.convex === 0) {
    if (c.concave > 0) return true;
    return fillet && interior > 0;
  }

  // Sharp pocket floor perforated by holes (e.g. HOLES_POCKET.stp)
  if (isSharpFloorWithHoleOpenings(idx, aag)) return true;

  // Circular pocket / counterbore floor
  if (isCircularPocketFloor(idx, aag)) return true;

  // Filleted pocket floor (corner tori + wall blends)
  if (isFilletedPocketFloor(idx, aag)) return true;

  // Broken floor — exclude ordinary walls (1 convex rim + 2–3 corner blends)
  if (!fillet) return false;
  if (interiorRatio < 0.55) return false;
  if (c.convex > interior) return false;
  if (c.smooth < 5) return false;

  let torusN = 0;
  let openingN = 0;
  for (const e of neighbors) {
    const to = nodes[e.to];
    if (e.classification === 'smooth' || e.classification === 'concave') {
      if (to.surfaceType === 'torus') torusN++;
    }
    if (e.classification === 'convex') {
      if (
        to.surfaceType === 'cylinder' ||
        to.surfaceType === 'cone' ||
        to.surfaceType === 'plane'
      ) {
        openingN++;
      }
    }
  }
  if (torusN < 2 || openingN < 1) return false;
  return true;
}

/**
 * Free-flat / exterior stock: nearly all edges convex.
 * Pocket walls typically have only one convex rim edge + smooth/concave to
 * fillets — must NOT be treated as stock (that broke imperfect-wall pockets).
 */
function isLikelyStockFace(idx, aag) {
  const { nodes, adjacency } = aag;
  if (nodes[idx].surfaceType !== 'plane') return false;
  const neighbors = adjacency[idx];
  if (!neighbors.length) return false;
  let convex = 0;
  for (const e of neighbors) {
    if (e.classification === 'convex') convex++;
  }
  return convex >= Math.max(2, Math.ceil(neighbors.length * 0.75));
}

export function findFloorCandidates(aag, excludedFaces = null) {
  const floors = [];
  for (let i = 0; i < aag.nodes.length; i++) {
    if (excludedFaces?.has(i)) continue;
    if (isFloorCandidate(i, aag)) floors.push(i);
  }
  return floors;
}

function isPocketInteriorFace(n) {
  return (
    n.surfaceType === 'plane' ||
    n.surfaceType === 'cylinder' ||
    n.surfaceType === 'cone' ||
    n.surfaceType === 'torus' ||
    n.surfaceType === 'bspline' ||
    n.surfaceType === 'bezier'
  );
}

/**
 * Through-cut / hole bore adjacent via convex edge — patch opening, do not
 * walk into the bore as pocket wall.
 */
function isPatchOpeningNeighbor(fromIdx, toIdx, aag) {
  const { nodes, adjacency } = aag;
  const from = nodes[fromIdx];
  const to = nodes[toIdx];
  const link = adjacency[fromIdx].find((e) => e.to === toIdx);
  if (!link || link.classification !== 'convex') return false;

  if (to.surfaceType === 'cylinder' || to.surfaceType === 'cone') return true;

  if (from.surfaceType !== 'plane' || to.surfaceType !== 'plane') return false;

  // Another coplanar floor fragment across a through-cut
  if (areCoplanar(from, to)) return true;

  // Vertical wall of a through-window sitting at floor level (patch, not ceiling)
  if (!from.axis || !to.axis || !from.location || !to.location) return false;
  const nFloor = v3normalize(from.axis);
  const nWall = v3normalize(to.axis);
  if (Math.abs(v3dot(nFloor, nWall)) > 0.35) return false;
  const d = Math.abs(v3dot(v3sub(to.location, from.location), nFloor));
  return d < 2.5;
}

export function collectPocketFaces(floorIdx, aag, excludedFaces = null) {
  const { nodes, adjacency } = aag;
  const pocketFaces = new Set([floorIdx]);
  const rimEdges = [];
  const patchOpenings = [];
  const queue = [floorIdx];

  while (queue.length) {
    const cur = queue.shift();
    for (const { to, classification } of adjacency[cur]) {
      if (pocketFaces.has(to)) continue;
      if (excludedFaces?.has(to)) {
        // Recognized hole wall crossing the pocket — an opening to patch,
        // not a silent skip (otherwise rim/patch counts drop to 0 and the
        // pocket is rejected).
        patchOpenings.push({ from: cur, to });
        continue;
      }

      if (classification === 'convex') {
        if (isPatchOpeningNeighbor(cur, to, aag)) {
          patchOpenings.push({ from: cur, to });
          continue;
        }
        rimEdges.push({ from: cur, to });
        continue;
      }

      if (!isPocketInteriorFace(nodes[to])) continue;

      if (to !== floorIdx && isLikelyStockFace(to, aag)) {
        rimEdges.push({ from: cur, to });
        continue;
      }

      // Merge coplanar broken floor fragments into the same patched pocket
      if (
        nodes[to].surfaceType === 'plane' &&
        areCoplanar(nodes[floorIdx], nodes[to]) &&
        isFloorCandidate(to, aag)
      ) {
        pocketFaces.add(to);
        queue.push(to);
        continue;
      }

      pocketFaces.add(to);
      queue.push(to);
    }
  }

  return { faces: [...pocketFaces], rimEdges, patchOpenings };
}

function areCoplanar(a, b) {
  if (!a?.axis || !b?.axis || !a?.location || !b?.location) return false;
  if (Math.abs(v3dot(v3normalize(a.axis), v3normalize(b.axis))) < FLOOR_NORMAL_DOT_MIN) {
    return false;
  }
  return Math.abs(v3dot(v3sub(b.location, a.location), v3normalize(a.axis))) < FLOOR_COPLANAR_TOL;
}

function classifyPocketShape(cylindricalWalls, planarWalls) {
  if (planarWalls.length === 0 && cylindricalWalls.length >= 1) return 'circular';
  if (planarWalls.length >= 3 && planarWalls.length <= 4) return 'rectangular';
  if (planarWalls.length === 2 && cylindricalWalls.length >= 2) return 'slot';
  return 'irregular';
}

function collectFloorStages(faces, nodes, primaryFloorIdx, aag) {
  const floorIdxs = faces.filter((i) => isFloorCandidate(i, aag));
  if (!floorIdxs.includes(primaryFloorIdx)) floorIdxs.unshift(primaryFloorIdx);

  const primary = nodes[primaryFloorIdx];
  const axis = v3normalize(primary.axis || { x: 0, y: 0, z: 1 });
  return floorIdxs
    .map((i) => nodes[i])
    .sort((a, b) => v3dot(a.location, axis) - v3dot(b.location, axis))
    .map((f) => ({
      type: 'floor',
      location: v3toArray(f.location),
      normal: v3toArray(f.axis),
      faceId: f.faceId
    }));
}

function planeBasis(normal) {
  const n = v3normalize(normal);
  const tmp = Math.abs(n.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const xAxis = v3normalize(v3cross(n, tmp));
  const yAxis = v3normalize(v3cross(n, xAxis));
  return { n, xAxis, yAxis };
}

/**
 * Depth to ceiling / stock rim. Prefer planar faces parallel to the floor
 * (true ceiling). Ignore near-floor through-cut bores (patch openings).
 */
function estimatePocketDepth(floorFace, faces, nodes, rimEdges, patchOpenings = []) {
  if (!floorFace?.location || !floorFace?.axis) return 0;
  const n = v3normalize(floorFace.axis);
  const patchSet = new Set(patchOpenings.map((p) => p.to));
  let ceilingDepth = 0;
  let maxDepth = 0;

  for (const { to } of rimEdges) {
    if (patchSet.has(to)) continue;
    const rim = nodes[to];
    if (!rim?.location) continue;
    if (
      (rim.surfaceType === 'cylinder' || rim.surfaceType === 'cone') &&
      Math.abs(v3dot(v3sub(rim.location, floorFace.location), n)) < 1.5
    ) {
      continue;
    }
    const d = Math.abs(v3dot(v3sub(rim.location, floorFace.location), n));
    if (d > maxDepth) maxDepth = d;
    if (
      rim.surfaceType === 'plane' &&
      rim.axis &&
      Math.abs(v3dot(v3normalize(rim.axis), n)) > 0.85
    ) {
      if (d > ceilingDepth) ceilingDepth = d;
    }
  }

  if (ceilingDepth > 0.2) return ceilingDepth;

  if (maxDepth < 0.2) {
    for (const i of faces) {
      const f = nodes[i];
      if (f === floorFace || !f.location) continue;
      if (f.surfaceType === 'plane' && areCoplanar(floorFace, f)) continue;
      const d = Math.abs(v3dot(v3sub(f.location, floorFace.location), n));
      if (d > maxDepth) maxDepth = d;
    }
  }

  return maxDepth;
}

/**
 * NX-style plugged body: outer wire of the floor (inner holes patched) extruded
 * to the ceiling along the floor normal. Returns volume + tessellation for viz.
 */
function computePluggedBody(occt, floorNode, depth, axis) {
  if (!occt || !floorNode?.faceHandle || !(depth > 0)) return null;
  const n = v3normalize(toVec3(axis) || floorNode.axis || { x: 0, y: 0, z: 1 });
  const dx = n.x * depth;
  const dy = n.y * depth;
  const dz = n.z * depth;

  try {
    // Prefer outerWire (patches inner holes). Fall back to first face wire or
    // the floor face itself if outerWire throws.
    let profile = floorNode.faceHandle;
    try {
      const wire = occt.outerWire(floorNode.faceHandle);
      try {
        profile = occt.makeFace(wire);
      } catch {
        /* keep face */
      }
    } catch {
      try {
        const wires = occt.getSubShapes(floorNode.faceHandle, 'wire');
        if (wires.length) {
          try {
            profile = occt.makeFace(wires[0]);
          } catch {
            /* keep face */
          }
        }
      } catch {
        /* keep face */
      }
    }
    const prism = occt.extrude(profile, dx, dy, dz);
    const volume = Math.abs(occt.getVolume(prism));
    if (!(volume > 0)) return null;

    const mesh = occt.tessellate(prism, { linearDeflection: 0.4 });
    const bbox = occt.getBoundingBox(prism, true);
    const { xAxis, yAxis } = planeBasis(n);
    const corners = [
      { x: bbox.xmin, y: bbox.ymin, z: bbox.zmin },
      { x: bbox.xmax, y: bbox.ymin, z: bbox.zmin },
      { x: bbox.xmin, y: bbox.ymax, z: bbox.zmin },
      { x: bbox.xmax, y: bbox.ymax, z: bbox.zmin },
      { x: bbox.xmin, y: bbox.ymin, z: bbox.zmax },
      { x: bbox.xmax, y: bbox.ymin, z: bbox.zmax },
      { x: bbox.xmin, y: bbox.ymax, z: bbox.zmax },
      { x: bbox.xmax, y: bbox.ymax, z: bbox.zmax }
    ];
    const origin = floorNode.location || corners[0];
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const c of corners) {
      const d = v3sub(c, origin);
      const u = v3dot(d, xAxis);
      const v = v3dot(d, yAxis);
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }

    const positions =
      mesh.positions instanceof Float32Array
        ? Array.from(mesh.positions)
        : [...(mesh.positions || [])];
    const indices =
      mesh.indices instanceof Uint32Array || mesh.indices instanceof Uint16Array
        ? Array.from(mesh.indices)
        : [...(mesh.indices || [])];

    return {
      volume,
      width: Math.max(0, maxU - minU),
      length: Math.max(0, maxV - minV),
      solid: prism,
      mesh: { positions, indices },
      xAxis: v3toArray(xAxis),
      yAxis: v3toArray(yAxis)
    };
  } catch (err) {
    console.warn('Plugged-body extrude failed', err);
    return null;
  }
}

function footprintFromFloorUv(floorFace) {
  if (!floorFace?.uv) return null;
  const w = Math.abs(floorFace.uv.uMax - floorFace.uv.uMin);
  const l = Math.abs(floorFace.uv.vMax - floorFace.uv.vMin);
  if (!(w > 0.5 && l > 0.5)) return null;
  return { width: w, length: l };
}

function estimateFootprintSize(wallFaces, cylindricalWalls, planarWalls, floorFace, floorFaces = []) {
  const radii = [];
  for (const c of cylindricalWalls) {
    if (c.radius != null && c.radius > 0 && c.radius < 80) radii.push(c.radius);
  }

  if (planarWalls.length === 0 && radii.length && wallFaces.every((f) => f.surfaceType !== 'plane')) {
    const r = Math.max(...radii);
    return { width: r * 2, length: r * 2, cornerRadii: radii, cornerRadius: r };
  }

  if (!floorFace?.location || !floorFace?.axis) {
    return { width: 0, length: 0, cornerRadii: radii, cornerRadius: radii[0] || 0 };
  }

  const { n, xAxis, yAxis } = planeBasis(floorFace.axis);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const sample = (f) => {
    if (!f?.location) return;
    const d = v3sub(f.location, floorFace.location);
    // Project onto floor plane
    const onPlane = v3sub(d, v3scale(n, v3dot(d, n)));
    const u = v3dot(onPlane, xAxis);
    const v = v3dot(onPlane, yAxis);
    minX = Math.min(minX, u);
    maxX = Math.max(maxX, u);
    minY = Math.min(minY, v);
    maxY = Math.max(maxY, v);
  };

  for (const f of wallFaces) sample(f);
  for (const f of floorFaces) sample(f);

  let width = Number.isFinite(minX) ? Math.max(0, maxX - minX) : 0;
  let length = Number.isFinite(minY) ? Math.max(0, maxY - minY) : 0;

  // Floor UV span is a strong signal for trimmed pocket floors (incl. broken)
  const uvSpan = footprintFromFloorUv(floorFace);
  if (uvSpan) {
    width = Math.max(width, uvSpan.width);
    length = Math.max(length, uvSpan.length);
  }

  // Prefer smaller corner fillet radii (wall radii are often larger)
  const filletRadii = radii.filter((r) => r < Math.min(width, length) * 0.45);
  const cornerRadii = filletRadii.length ? filletRadii : radii;
  const cornerRadius =
    cornerRadii.length > 0
      ? cornerRadii.slice().sort((a, b) => a - b)[Math.floor(cornerRadii.length / 2)]
      : 0;

  return { width, length, cornerRadii, cornerRadius };
}

function computeMaxBoundedVolume(shape, width, length, depth, cornerRadius) {
  if (!(depth > 0)) return 0;
  if (shape === 'circular') {
    const dia = Math.max(width, length);
    const r = dia / 2;
    return Math.PI * r * r * depth;
  }
  const r = Math.min(cornerRadius || 0, width / 2, length / 2);
  // Rounded rectangle area
  const area = width * length - (4 - Math.PI) * r * r;
  return Math.max(0, area) * depth;
}

function isHoleBottomFalsePositive(cylindricalWalls, planarWalls, holeFaceSet) {
  if (!holeFaceSet || holeFaceSet.size === 0) return false;
  if (planarWalls.length > 0) return false;
  if (cylindricalWalls.length === 0) return false;
  return cylindricalWalls.every((w) => holeFaceSet.has(w.faceId));
}

function isImplausibleFootprint(width, length, depth) {
  const span = Math.max(width || 0, length || 0);
  if (span > MAX_FOOTPRINT_SPAN) return true;
  if (span > 200 && (depth == null || depth < 0.5)) return true;
  return false;
}

function buildPocketRecord({
  floorIdx,
  faces,
  rimEdges,
  patchOpenings,
  nodes,
  aag,
  isThrough,
  occt
}) {
  const floorFace = floorIdx != null ? nodes[floorIdx] : null;
  const floorIdSet = new Set(
    floorFace ? faces.filter((i) => isFloorCandidate(i, aag)) : []
  );
  if (floorIdx != null) floorIdSet.add(floorIdx);

  const floorFaces = faces.map((i) => nodes[i]).filter((f) => floorIdSet.has(f.faceId));
  const wallFaces = faces.map((i) => nodes[i]).filter((f) => !floorIdSet.has(f.faceId));
  const cylindricalWalls = wallFaces.filter((f) => f.surfaceType === 'cylinder');
  const planarWalls = wallFaces.filter((f) => f.surfaceType === 'plane');
  const blendWalls = wallFaces.filter(
    (f) => f.surfaceType === 'torus' || f.surfaceType === 'cylinder' || f.surfaceType === 'cone'
  );

  const circularFloor = floorIdx != null && isCircularPocketFloor(floorIdx, aag);
  let shape = classifyPocketShape(cylindricalWalls, planarWalls);
  if (circularFloor && planarWalls.length === 0) {
    shape = 'circular';
  } else if (shape === 'circular' && !circularFloor) {
    // No planar walls but not a genuine round floor (e.g. broken floors whose
    // walk only reaches blends/bores) — never square-up its dimensions.
    shape = 'irregular';
  }

  const stages =
    floorFace && aag ? collectFloorStages(faces, nodes, floorIdx, aag) : [];
  let depth = floorFace
    ? estimatePocketDepth(floorFace, faces, nodes, rimEdges, patchOpenings)
    : 0;

  // Circular pockets: wall cylinder V-span is a reliable depth when rim walk is thin
  if (depth < 0.5 && floorIdx != null && isCircularPocketFloor(floorIdx, aag)) {
    for (const e of aag.adjacency[floorIdx]) {
      const w = nodes[e.to];
      if (w?.surfaceType === 'cylinder' && (w.depth ?? 0) > depth) {
        depth = w.depth;
      }
      if (w?.location && floorFace?.location && floorFace?.axis) {
        const d = Math.abs(
          v3dot(v3sub(w.location, floorFace.location), v3normalize(floorFace.axis))
        );
        // Cylinder mid-height ≈ depth/2
        if (w.surfaceType === 'cylinder' && d * 2 > depth) depth = d * 2;
      }
    }
  }

  const footprint = estimateFootprintSize(
    wallFaces,
    cylindricalWalls.concat(blendWalls.filter((b) => b.surfaceType === 'cylinder')),
    planarWalls,
    floorFace,
    floorFaces
  );

  let center = floorFace ? { ...floorFace.location } : null;
  if (floorFaces.length > 1) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let n = 0;
    for (const f of floorFaces) {
      if (!f.location) continue;
      cx += f.location.x;
      cy += f.location.y;
      cz += f.location.z;
      n++;
    }
    if (n) center = { x: cx / n, y: cy / n, z: cz / n };
  }

  const axis = floorFace ? v3normalize(floorFace.axis) : { x: 0, y: 0, z: 1 };
  const { xAxis, yAxis } = planeBasis(axis);
  const cornerRadius = footprint.cornerRadius || 0;

  // NX-style plugged body (outer-wire extrude patches broken floors / annuli)
  const plug = floorFace
    ? computePluggedBody(occt, floorFace, depth, axis)
    : null;
  if (plug?.solid && occt) {
    try {
      occt.release(plug.solid);
    } catch {
      /* ignore */
    }
    plug.solid = null;
  }

  let width = plug?.width || footprint.width;
  let length = plug?.length || footprint.length;
  let maxBoundedVolume =
    plug?.volume ||
    computeMaxBoundedVolume(shape, width, length, depth, cornerRadius);

  // Circular: diameter from max planar extent of the plug
  if (shape === 'circular' && circularFloor) {
    const dia = Math.max(width, length);
    width = dia;
    length = dia;
  }

  const isPatched =
    (patchOpenings?.length || 0) > 0 ||
    floorFaces.length > 1 ||
    !!plug;

  return {
    id: `brep-pocket-${Math.random().toString(36).slice(2, 9)}`,
    floorFaceId: floorIdx,
    floorNormal: floorFace ? v3toArray(floorFace.axis) : null,
    floorLocation: floorFace ? v3toArray(floorFace.location) : null,
    center: center ? v3toArray(center) : null,
    axis: v3toArray(axis),
    depth,
    width,
    length,
    maxBoundedSize:
      shape === 'circular'
        ? { diameter: Math.max(width, length) }
        : { width, length },
    maxDepth: depth,
    maxBoundedVolume,
    wallFaceIndices: faces.slice(),
    faceIndices: faces.slice(),
    faceHashes: faces.map((i) => nodes[i].faceHash),
    shape,
    cornerRadii: footprint.cornerRadii.slice(),
    cornerRadius,
    isThrough: !!isThrough,
    isPatched,
    isStepped: stages.length > 1,
    stages,
    plugMesh: plug?.mesh || null,
    outline: {
      width,
      length,
      depth,
      cornerRadius,
      center: center ? v3toArray(center) : null,
      axis: v3toArray(axis),
      xAxis: plug?.xAxis || v3toArray(xAxis),
      yAxis: plug?.yAxis || v3toArray(yAxis)
    },
    quality: 1,
    method: 'brep-aag',
    source: 'brep'
  };
}

/**
 * Build a solid prism that fills a recognized pocket (for iterative AAG union).
 * Caller must occt.release() the returned handle when done.
 */
export function buildPocketFillSolid(occt, pocket, aag) {
  if (!occt || !aag || pocket?.floorFaceId == null) return null;
  const floorNode = aag.nodes[pocket.floorFaceId];
  if (!floorNode?.faceHandle) return null;
  const depth = pocket.depth ?? pocket.maxDepth ?? 0;
  if (!(depth > 0.05)) return null;
  const axis = toVec3(pocket.axis) || toVec3(pocket.floorNormal) || floorNode.axis;
  const plug = computePluggedBody(occt, floorNode, depth, axis);
  return plug?.solid ?? null;
}

/**
 * Build one pocket record from a user-selected (or auto) floor face index.
 * Uses the same AAG walk + NX-style outer-wire extrude as recognizePockets.
 */
export function recognizePocketFromFloor(aag, floorIdx, occt = null) {
  if (floorIdx == null || floorIdx < 0 || floorIdx >= aag.nodes.length) {
    throw new Error('Invalid floor face index');
  }
  const { faces, rimEdges, patchOpenings } = collectPocketFaces(floorIdx, aag, null);
  if (rimEdges.length === 0 && patchOpenings.length === 0) {
    throw new Error('No pocket rim found from the selected floor face');
  }
  const record = buildPocketRecord({
    floorIdx,
    faces,
    rimEdges,
    patchOpenings,
    nodes: aag.nodes,
    aag,
    isThrough: false,
    occt
  });
  if (!(record.depth > 0.05) || !(record.maxBoundedVolume > 0)) {
    throw new Error('Could not compute a cavity volume from the selected floor');
  }
  return record;
}

/**
 * Through-pockets — opt-in only (off by default).
 */
export function recognizeThroughPockets(aag, alreadyVisited, holeFaceSet = null) {
  return [];
}

/**
 * Recognize pockets from a shared AAG.
 */
export function recognizePockets(aag, options = {}) {
  const { nodes } = aag;
  const holeFaceSet = options.holeFaceIndices
    ? new Set(options.holeFaceIndices)
    : new Set();
  const includeThrough = options.includeThroughPockets === true;
  const occt = options.occt ?? null;
  const onProgress = options.onProgress ?? null;
  const report = (message, percent) => {
    if (typeof onProgress === 'function') onProgress({ message, percent });
  };

  report('Finding pocket floors…', 96);
  const floors = findFloorCandidates(aag, holeFaceSet);
  report(`Found ${floors.length} floor candidate(s)`, 96);
  const visited = new Set();
  const pockets = [];

  for (const floorIdx of floors) {
    if (visited.has(floorIdx) || holeFaceSet.has(floorIdx)) continue;
    const { faces, rimEdges, patchOpenings } = collectPocketFaces(
      floorIdx,
      aag,
      holeFaceSet
    );

    // Need outer rim and/or patched openings (broken floor still a pocket)
    if (rimEdges.length === 0 && patchOpenings.length === 0) continue;
    if (faces.length > MAX_POCKET_FACES) continue;

    const floorIdSet = new Set(faces.filter((i) => isFloorCandidate(i, aag)));
    floorIdSet.add(floorIdx);
    const wallFaces = faces.map((i) => nodes[i]).filter((f) => !floorIdSet.has(f.faceId));
    const cylindricalWalls = wallFaces.filter((f) => f.surfaceType === 'cylinder');
    const planarWalls = wallFaces.filter((f) => f.surfaceType === 'plane');

    // Circular floors may only touch torus + cylinder (no extra planar walls)
    const circular = isCircularPocketFloor(floorIdx, aag);
    if (isHoleBottomFalsePositive(cylindricalWalls, planarWalls, holeFaceSet) && !circular) {
      continue;
    }
    if (wallFaces.length === 0 && !circular) continue;

    const record = buildPocketRecord({
      floorIdx,
      faces,
      rimEdges,
      patchOpenings,
      nodes,
      aag,
      isThrough: false,
      occt
    });

    if (isImplausibleFootprint(record.width, record.length, record.depth)) continue;
    if (record.depth < 0.2) continue;

    for (const f of faces) visited.add(f);
    pockets.push(record);
  }

  if (includeThrough) {
    report('Finding through-pockets…', 98);
    pockets.push(...recognizeThroughPockets(aag, visited, holeFaceSet));
  }

  report(`Recognized ${pockets.length} pocket feature(s)`, 100);
  return pockets;
}
