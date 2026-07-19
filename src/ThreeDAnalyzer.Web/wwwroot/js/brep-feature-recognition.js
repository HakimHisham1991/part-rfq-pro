/**
 * True B-Rep hole feature recognition via an Attributed Adjacency Graph (AAG).
 *
 * Architecture mirrors Analysis Situs (asiAlgo_AAG / asiAlgo_RecognizeDrilledHoles):
 * build a face-adjacency graph from exact B-Rep, classify shared edges by dihedral
 * vexity, then collect connected cylindrical/conical hole-wall components and
 * classify plain / counterbore / countersink / step features from analytic
 * surface parameters — no mesh curvature estimation or circle fitting.
 *
 * See THIRD_PARTY_NOTICES.md for Analysis Situs BSD-3-Clause attribution.
 */

const SMOOTH_ANGLE_TOL = 0.02; // rad — |angle - π| below this ⇒ smooth
const AXIS_DIR_DOT_MIN = 0.999; // ~2.5° — coaxial direction agreement
const AXIS_LINE_TOL = 1e-4; // mm — perpendicular distance for coincident axes
const MIN_HOLE_RADIUS = 0.05;
const MAX_HOLE_RADIUS = 500;
/** Drilled hole walls are (near) full revolutions. Pocket-corner fillets are ~90°. */
const MIN_HOLE_U_SPAN = (Math.PI * 5) / 3; // 300°
/** Degenerate "cones" with semi-angle ≈ π/2 are flat disks, not countersinks. */
const MIN_COUNTERSINK_SEMI = 0.08; // ~4.5°
const MAX_COUNTERSINK_SEMI = Math.PI / 2 - 0.08; // reject ~90° flats
const MIN_HOLE_DEPTH = 1e-3;

let occtPromise = null;

/**
 * Lazy-load the full OCCT WASM kernel used for B-Rep feature recognition.
 * Rendering still uses occt-import-js; this kernel is recognition-only.
 * Dynamic import keeps the ~22 MB WASM off pages that only need mesh metrics.
 */
export async function loadOcct(options = {}) {
  if (!occtPromise) {
    occtPromise = (async () => {
      const { OcctKernel } = await import('/lib/occt-wasm/index.js');
      return OcctKernel.init({
        wasm: options.wasm ?? '/lib/occt-wasm/occt-wasm.wasm'
      });
    })().catch((err) => {
      occtPromise = null;
      throw err;
    });
  }
  return occtPromise;
}

// ── Vector helpers ──────────────────────────────────────────────────────────

function v3(x = 0, y = 0, z = 0) {
  return { x, y, z };
}

function v3sub(a, b) {
  return v3(a.x - b.x, a.y - b.y, a.z - b.z);
}

function v3add(a, b) {
  return v3(a.x + b.x, a.y + b.y, a.z + b.z);
}

function v3scale(a, s) {
  return v3(a.x * s, a.y * s, a.z * s);
}

function v3dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function v3cross(a, b) {
  return v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

function v3len(a) {
  return Math.hypot(a.x, a.y, a.z);
}

function v3normalize(a) {
  const len = v3len(a);
  if (len < 1e-12) return v3(0, 0, 1);
  return v3scale(a, 1 / len);
}

function v3toArray(a) {
  return [a.x, a.y, a.z];
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * occt-wasm's surfaceNormal is already face-orientation-aware (matches the
 * solid's outward normal). Do not flip again by shapeOrientation.
 */
function solidNormal(occt, face, u, v) {
  return v3normalize(occt.surfaceNormal(face, u, v));
}

// ── Surface parameter extraction ────────────────────────────────────────────

/**
 * Recover the cylinder axis point from three surface samples + exact radius.
 * Avoids surfaceNormal orientation ambiguity (occt-wasm normals are face-oriented,
 * so p − r·n is wrong for reversed hole walls).
 */
function cylinderAxisLocation(occt, face, radius, axis, uv) {
  const vMid = (uv.vMin + uv.vMax) * 0.5;
  const uSpan = uv.uMax - uv.uMin;
  const u0 = uv.uMin + uSpan * 0.1;
  const u1 = uv.uMin + uSpan * 0.45;
  const u2 = uv.uMin + uSpan * 0.8;
  const a = occt.pointOnSurface(face, u0, vMid);
  const b = occt.pointOnSurface(face, u1, vMid);
  const c = occt.pointOnSurface(face, u2, vMid);

  const mid = v3scale(v3add(a, b), 0.5);
  const chord = v3sub(b, a);
  const half = v3len(chord) * 0.5;
  if (half < 1e-12 || half > radius) {
    // Degenerate chord — fall back to radial from finite-difference frame
    const du = Math.max(uSpan * 0.01, 1e-4);
    const tu = v3normalize(v3sub(
      occt.pointOnSurface(face, u1 + du, vMid),
      occt.pointOnSurface(face, u1 - du, vMid)
    ));
    const radial = v3normalize(v3cross(axis, tu));
    const p = occt.pointOnSurface(face, u1, vMid);
    const c1 = v3sub(p, v3scale(radial, radius));
    const c2 = v3add(p, v3scale(radial, radius));
    return Math.abs(v3len(v3sub(c1, a)) - radius) <= Math.abs(v3len(v3sub(c2, a)) - radius)
      ? c1
      : c2;
  }

  const h = Math.sqrt(Math.max(0, radius * radius - half * half));
  const radial = v3normalize(v3cross(axis, chord));
  const cand1 = v3add(mid, v3scale(radial, h));
  const cand2 = v3sub(mid, v3scale(radial, h));
  const err1 = Math.abs(v3len(v3sub(cand1, c)) - radius);
  const err2 = Math.abs(v3len(v3sub(cand2, c)) - radius);
  return err1 <= err2 ? cand1 : cand2;
}

/**
 * Derive analytic params from occt-wasm's surface query API.
 * Radius comes from getFaceCylinderData (true B-Rep). Axis direction from the
 * V parametrization; axis location from chord geometry (not oriented normals).
 */
function getSurfaceInfo(occt, face) {
  const type = occt.surfaceType(face);
  const orientation = occt.shapeOrientation(face);
  const isReversed = orientation === 'reversed';
  const uv = occt.uvBounds(face);
  const uMid = (uv.uMin + uv.uMax) * 0.5;
  const vMid = (uv.vMin + uv.vMax) * 0.5;
  const vSpan = Math.abs(uv.vMax - uv.vMin);

  const info = {
    type,
    isReversed,
    orientation,
    uv,
    axis: null,
    location: null,
    radius: null,
    semiAngle: null,
    depth: null,
    faceHandle: face
  };

  if (type === 'cylinder') {
    const cyl = occt.getFaceCylinderData(face);
    if (!cyl || !(cyl.radius > 0)) return info;
    info.radius = cyl.radius;

    const p0 = occt.pointOnSurface(face, uMid, uv.vMin);
    const p1 = occt.pointOnSurface(face, uMid, uv.vMax);
    const axis = v3normalize(v3sub(p1, p0));
    info.axis = axis;
    info.location = cylinderAxisLocation(occt, face, cyl.radius, axis, uv);
    info.depth = vSpan;
    return info;
  }

  if (type === 'cone') {
    // No getFaceConeData in occt-wasm — recover axis from cross of dU samples,
    // local radius from principal curvature, semi-angle from generator vs axis.
    const du = Math.max((uv.uMax - uv.uMin) * 0.05, 1e-4);
    const pU0 = occt.pointOnSurface(face, uMid - du, vMid);
    const pU1 = occt.pointOnSurface(face, uMid + du, vMid);
    const pV0 = occt.pointOnSurface(face, uMid, uv.vMin);
    const pV1 = occt.pointOnSurface(face, uMid, uv.vMax);
    const tu = v3normalize(v3sub(pU1, pU0));
    const gen = v3normalize(v3sub(pV1, pV0));

    // Circumferential tangents at two V heights → axis ≈ tu1 × tu2
    const vA = uv.vMin + vSpan * 0.25;
    const vB = uv.vMin + vSpan * 0.75;
    const tuA = v3normalize(v3sub(
      occt.pointOnSurface(face, uMid + du, vA),
      occt.pointOnSurface(face, uMid - du, vA)
    ));
    const tuB = v3normalize(v3sub(
      occt.pointOnSurface(face, uMid + du, vB),
      occt.pointOnSurface(face, uMid - du, vB)
    ));
    let axis = v3normalize(v3cross(tuA, tuB));
    if (v3len(v3cross(tuA, tuB)) < 1e-9) {
      // Axis lies in the plane spanned by generator and radial; use tu × gen ⊥
      axis = v3normalize(v3cross(tu, gen));
    }

    const curv = occt.surfaceCurvature(face, uMid, vMid);
    const k = Math.max(Math.abs(curv.max), Math.abs(curv.min));
    const localRadius = k > 1e-9 ? 1 / k : null;

    const pMid = occt.pointOnSurface(face, uMid, vMid);
    let location = pMid;
    if (localRadius != null) {
      location = cylinderAxisLocation(occt, face, localRadius, axis, {
        uMin: uv.uMin,
        uMax: uv.uMax,
        vMin: vMid,
        vMax: vMid
      });
    }

    const cosA = clamp(Math.abs(v3dot(gen, axis)), 0, 1);
    const semiAngle = Math.acos(cosA);

    info.axis = axis;
    info.location = location;
    info.radius = localRadius;
    info.semiAngle = semiAngle;
    info.depth = vSpan * Math.cos(semiAngle);
    return info;
  }

  if (type === 'plane') {
    const nGeom = occt.surfaceNormal(face, uMid, vMid);
    // surfaceNormal is already face-orientation-aware in occt-wasm
    info.axis = v3normalize(nGeom);
    info.location = occt.pointOnSurface(face, uMid, vMid);
    return info;
  }

  return info;
}

// ── Dihedral / vexity classification ────────────────────────────────────────

/**
 * Classify the shared edge between two faces as convex / concave / smooth.
 * Uses outward solid normals (orientation-aware) and a material-side probe
 * via containsPoint — the AAG vexity signal Analysis Situs relies on.
 */
function classifySharedEdge(occt, solid, edge, faceA, faceB, radiusHint = 1) {
  const params = occt.curveParameters(edge);
  const midParam = (params.first + params.last) * 0.5;
  const p = occt.curvePointAtParam(edge, midParam);

  const uvA = occt.uvFromPoint(faceA, p);
  const uvB = occt.uvFromPoint(faceB, p);
  const nA = solidNormal(occt, faceA, uvA.u, uvA.v);
  const nB = solidNormal(occt, faceB, uvB.u, uvB.v);

  const normalDot = clamp(v3dot(nA, nB), -1, 1);
  const angleBetweenNormals = Math.acos(normalDot);

  // Smooth / tangent-continuous: normals nearly parallel
  if (angleBetweenNormals < SMOOTH_ANGLE_TOL) {
    return { classification: 'smooth', angle: Math.PI };
  }

  // Probe along the outward-normal bisector. For a convex edge the bisector
  // leaves the solid; for a concave (re-entrant) edge it enters the solid.
  const bisector = v3normalize(v3add(nA, nB));
  const probeDist = Math.max(1e-3, Math.min(0.05, radiusHint * 0.01));
  const probe = v3add(p, v3scale(bisector, probeDist));

  let inside = false;
  try {
    inside = occt.containsPoint(solid, probe, probeDist * 0.5);
  } catch {
    // Fallback: interior dihedral from cross·tangent sign
    const t = v3normalize(occt.curveTangent(edge, midParam));
    const convexity = v3dot(v3cross(nA, nB), t);
    return {
      classification: convexity > 0 ? 'convex' : 'concave',
      angle: Math.PI + (convexity > 0 ? -angleBetweenNormals : angleBetweenNormals)
    };
  }

  // Map to the prompt's angle convention: > π+tol concave, < π−tol convex
  const dihedral = inside ? Math.PI + angleBetweenNormals : Math.PI - angleBetweenNormals;
  let classification = 'smooth';
  if (dihedral > Math.PI + SMOOTH_ANGLE_TOL) classification = 'concave';
  else if (dihedral < Math.PI - SMOOTH_ANGLE_TOL) classification = 'convex';

  return { classification, angle: dihedral };
}

// ── AAG construction ────────────────────────────────────────────────────────

/**
 * Build an Attributed Adjacency Graph from a loaded B-Rep shape:
 * - one node per face, tagged with exact surface type + parameters
 * - one adjacency arc per shared topological edge, tagged convex/concave/smooth
 */
export async function buildAAG(shapeHandle, occt, onProgress = null) {
  const report = (message, percent) => {
    if (typeof onProgress === 'function') onProgress({ message, percent });
  };

  report('Enumerating faces…', 10);
  const faces = occt.getSubShapes(shapeHandle, 'face');
  const nodes = [];
  const faceIdByHash = new Map();

  for (let i = 0; i < faces.length; i++) {
    if (i % 20 === 0) {
      report(`Reading face surfaces… ${i + 1} / ${faces.length}`, 10 + Math.round((i / Math.max(faces.length, 1)) * 35));
    }
    const face = faces[i];
    const surf = getSurfaceInfo(occt, face);
    const hash = occt.hashCode(face, 1 << 30);
    nodes.push({
      faceId: i,
      faceHash: hash,
      faceHandle: face,
      surfaceType: surf.type,
      axis: surf.axis,
      location: surf.location,
      radius: surf.radius,
      semiAngle: surf.semiAngle,
      depth: surf.depth,
      isReversed: surf.isReversed,
      uv: surf.uv
    });
    faceIdByHash.set(hash, i);
  }

  report('Building face adjacency…', 50);
  const adjacency = nodes.map(() => []);
  const edgeSeen = new Set();

  // Use adjacentFaces (reliable). edgeToFaceMap packing is [edgeHash, count, ...faceHashes]
  // but adjacentFaces already gives the manifold neighborhood we need for AAG vexity.
  for (let i = 0; i < nodes.length; i++) {
    if (i % 10 === 0) {
      report(
        `Classifying adjacency… ${i + 1} / ${nodes.length}`,
        50 + Math.round((i / Math.max(nodes.length, 1)) * 40)
      );
    }
    const neighbors = occt.adjacentFaces(shapeHandle, nodes[i].faceHandle);
    for (const neigh of neighbors) {
      const j = faceIdByHash.get(occt.hashCode(neigh, 1 << 30));
      if (j == null || j <= i) continue;
      const pairKey = `${i}|${j}`;
      if (edgeSeen.has(pairKey)) continue;
      edgeSeen.add(pairKey);

      const shared = occt.sharedEdges(nodes[i].faceHandle, nodes[j].faceHandle);
      if (!shared.length) continue;
      const edge = shared[0];
      const eHash = occt.hashCode(edge, 1 << 30);
      const { classification, angle } = classifySharedEdge(
        occt,
        shapeHandle,
        edge,
        nodes[i].faceHandle,
        nodes[j].faceHandle,
        nodes[i].radius || nodes[j].radius || 1
      );
      adjacency[i].push({ to: j, classification, angle, edgeHash: eHash });
      adjacency[j].push({ to: i, classification, angle, edgeHash: eHash });
    }
  }

  report('AAG complete', 95);
  return { nodes, adjacency, shapeHandle };
}

// ── Hole recognition ────────────────────────────────────────────────────────

function faceUSpan(n) {
  if (!n?.uv) return 0;
  return Math.abs(n.uv.uMax - n.uv.uMin);
}

/** True countersink cone — excludes degenerate flat disks (semi ≈ π/2, depth ≈ 0). */
function isValidCountersinkCone(n) {
  if (n.surfaceType !== 'cone' || !n.isReversed) return false;
  if (n.axis == null || n.location == null) return false;
  const semi = n.semiAngle;
  if (semi == null || semi < MIN_COUNTERSINK_SEMI || semi > MAX_COUNTERSINK_SEMI) return false;
  if ((n.depth ?? 0) < MIN_HOLE_DEPTH) return false;
  if (n.radius != null && (n.radius < MIN_HOLE_RADIUS || n.radius > MAX_HOLE_RADIUS)) return false;
  if (faceUSpan(n) < MIN_HOLE_U_SPAN) return false;
  return true;
}

/**
 * Seed hole walls from near-full reversed cylinders only.
 * Pocket-corner fillets (~90° U-span) and standalone cones never seed a feature.
 */
function isHoleCandidateFace(n) {
  if (n.surfaceType !== 'cylinder') return false;
  if (!n.isReversed) return false;
  if (n.radius == null || n.radius < MIN_HOLE_RADIUS || n.radius > MAX_HOLE_RADIUS) return false;
  if (faceUSpan(n) < MIN_HOLE_U_SPAN) return false;
  if ((n.depth ?? 0) < MIN_HOLE_DEPTH) return false;
  return n.axis != null && n.location != null;
}

function axesCoincident(a, b) {
  if (!a?.axis || !b?.axis || !a?.location || !b?.location) return false;
  const dirDot = Math.abs(v3dot(v3normalize(a.axis), v3normalize(b.axis)));
  if (dirDot < AXIS_DIR_DOT_MIN) return false;
  const delta = v3sub(b.location, a.location);
  const axis = v3normalize(a.axis);
  const axial = v3scale(axis, v3dot(delta, axis));
  const perp = v3sub(delta, axial);
  const tol = Math.max(AXIS_LINE_TOL, 1e-3) * Math.max(1, a.radius || 1, b.radius || 1);
  return v3len(perp) <= tol;
}

/** Canonical axis sense so opposite-oriented hole walls share one parameter. */
function canonicalAxis(axis) {
  const a = v3normalize(axis);
  if (Math.abs(a.y) >= Math.abs(a.x) && Math.abs(a.y) >= Math.abs(a.z)) {
    return a.y < 0 ? v3scale(a, -1) : a;
  }
  if (Math.abs(a.z) >= Math.abs(a.x)) {
    return a.z < 0 ? v3scale(a, -1) : a;
  }
  return a.x < 0 ? v3scale(a, -1) : a;
}

function axialRange(node, axisHint = null) {
  if (!node?.location || !node?.axis) return null;
  const axis = canonicalAxis(axisHint || node.axis);
  const t0 = v3dot(node.location, axis);
  const half = (node.depth ?? 0) * 0.5;
  return { tMin: t0 - half, tMax: t0 + half, axis };
}

function axialRangesClose(a, b) {
  const ra = axialRange(a);
  const rb = axialRange(b, ra?.axis);
  if (!ra || !rb) return false;
  // Gap between [tMin,tMax] intervals (0 if overlapping)
  const gap =
    ra.tMax < rb.tMin ? rb.tMin - ra.tMax :
    rb.tMax < ra.tMin ? ra.tMin - rb.tMax :
    0;
  const maxR = Math.max(a.radius || 0, b.radius || 0, 1);
  // Allow a fillet/torus shelf between counterbore stages
  return gap <= Math.max(maxR * 0.75, 3);
}

function componentAxis(component, nodes) {
  // Prefer the smallest-radius cylinder as the axis reference
  let best = null;
  for (const idx of component) {
    const n = nodes[idx];
    if (n.surfaceType !== 'cylinder' || n.axis == null) continue;
    if (!best || (n.radius != null && n.radius < best.radius)) best = n;
  }
  if (best) return best;
  for (const idx of component) {
    const n = nodes[idx];
    if (n.axis != null) return n;
  }
  return null;
}

/**
 * Bridge coaxial hole stages into one feature.
 * Uses exact axis-line coincidence + axial proximity (handles counterbore
 * shelves that go cylinder→torus→plane→cylinder, not only a shared plane).
 */
function bridgeCoaxialComponents(components, nodes, adjacency) {
  if (components.length < 2) return components.map((c) => [...c]);

  const parent = components.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const unite = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < components.length; i++) {
    for (let j = i + 1; j < components.length; j++) {
      const a = componentAxis(components[i], nodes);
      const b = componentAxis(components[j], nodes);
      if (!axesCoincident(a, b)) continue;
      if (!axialRangesClose(a, b)) continue;
      // Merge coaxial near-adjacent stages (handles cylinder→torus→plane→cylinder)
      unite(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < components.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(...components[i]);
  }
  return [...groups.values()];
}

/** Attach valid countersink cones that share an edge with a hole component. */
function attachAdjacentCountersinks(component, nodes, adjacency) {
  const attached = [...component];
  const seen = new Set(component);
  for (const fi of component) {
    for (const { to } of adjacency[fi]) {
      if (seen.has(to)) continue;
      if (!isValidCountersinkCone(nodes[to])) continue;
      if (!axesCoincident(nodes[fi], nodes[to])) continue;
      seen.add(to);
      attached.push(to);
    }
  }
  return attached;
}

function classifyHoleComponent(component, nodes) {
  const faces = component.map((i) => nodes[i]);
  const cylinders = faces
    .filter((f) => f.surfaceType === 'cylinder' && f.radius != null)
    .sort((a, b) => a.radius - b.radius);
  const cones = faces.filter((f) => isValidCountersinkCone(f));

  const stages = [];
  for (const c of cylinders) {
    stages.push({
      type: 'cylinder',
      radius: c.radius,
      axis: v3toArray(v3normalize(c.axis)),
      location: v3toArray(c.location),
      depth: c.depth ?? 0,
      faceId: c.faceId,
      faceHash: c.faceHash
    });
  }
  for (const cone of cones) {
    stages.push({
      type: 'countersink',
      semiAngle: cone.semiAngle,
      radius: cone.radius,
      axis: cone.axis ? v3toArray(v3normalize(cone.axis)) : null,
      location: cone.location ? v3toArray(cone.location) : null,
      depth: cone.depth ?? 0,
      faceId: cone.faceId,
      faceHash: cone.faceHash
    });
  }

  const main = cylinders[0] || cones[0] || faces[0];
  if (!main?.axis || !main?.location) {
    return null;
  }

  // Total depth: axial span of all stages. Face `location` is at V mid-height,
  // so each stage covers [t0 − depth/2, t0 + depth/2] along the shared axis.
  const axis = v3normalize(main.axis);
  let tMin = Infinity;
  let tMax = -Infinity;
  for (const f of [...cylinders, ...cones]) {
    if (!f.location || !f.axis) continue;
    const t0 = v3dot(f.location, axis);
    const half = (f.depth ?? 0) * 0.5;
    tMin = Math.min(tMin, t0 - half);
    tMax = Math.max(tMax, t0 + half);
  }
  if (!Number.isFinite(tMin) || !Number.isFinite(tMax)) {
    tMin = 0;
    tMax = main.depth ?? main.radius * 2;
  }

  const depth = Math.max(tMax - tMin, main.depth ?? 0, 0);
  // Opening: axial end nearer the largest-radius stage (counterbore / mouth)
  const largest = cylinders.length ? cylinders[cylinders.length - 1] : main;
  const largestT = v3dot(largest.location, axis);
  const openingT = Math.abs(largestT - tMin) <= Math.abs(largestT - tMax) ? tMin : tMax;
  const axisOrigin = v3sub(main.location, v3scale(axis, v3dot(main.location, axis)));
  const center = v3add(axisOrigin, v3scale(axis, openingT));

  // Axis points from opening into the hole
  const midT = (tMin + tMax) * 0.5;
  let outAxis = axis;
  if (openingT > midT) outAxis = v3scale(axis, -1);

  const radius = main.radius ?? largest.radius ?? 0;
  const isStepHole = stages.filter((s) => s.type === 'cylinder').length > 1 || cones.length > 0;

  let featureType = 'plain';
  if (cones.length > 0 && cylinders.length <= 1) featureType = 'countersink';
  else if (cylinders.length > 1 && cones.length === 0) featureType = 'counterbore';
  else if (cylinders.length > 1 && cones.length > 0) featureType = 'counterdrill';
  else if (isStepHole) featureType = 'step';

  return {
    id: `brep-hole-${Math.random().toString(36).slice(2, 9)}`,
    center: v3toArray(center),
    axis: v3toArray(outAxis),
    radius,
    diameter: radius * 2,
    depth: depth > 0 ? depth : radius * 2,
    quality: 1,
    rms: 0,
    fitMethod: 'brep-aag',
    method: 'brep-aag',
    isStepHole,
    featureType,
    stages,
    faceIndices: component.slice(),
    faceHashes: component.map((i) => nodes[i].faceHash),
    source: 'brep'
  };
}

/**
 * Two-phase hole recognition (Analysis Situs asiAlgo_RecognizeDrilledHoles):
 *   1. Connected components of reversed cylindrical/conical faces in the AAG
 *   2. Bridge coaxial steps via planar annuli, then classify stages
 */
export function recognizeHoles(aag, options = {}) {
  const { nodes, adjacency } = aag;
  const onProgress = options.onProgress ?? null;
  const report = (message, percent) => {
    if (typeof onProgress === 'function') onProgress({ message, percent });
  };

  report('Finding hole-wall components…', 96);
  const visited = new Uint8Array(nodes.length);
  const components = [];

  for (let i = 0; i < nodes.length; i++) {
    if (visited[i] || !isHoleCandidateFace(nodes[i])) continue;
    const stack = [i];
    const component = [];
    visited[i] = 1;
    while (stack.length) {
      const cur = stack.pop();
      component.push(cur);
      for (const { to, classification } of adjacency[cur]) {
        if (visited[to] || !isHoleCandidateFace(nodes[to])) continue;
        // Coaxial stages join via smooth/concave transitions, never convex rims
        if (classification === 'convex') continue;
        // Require coaxial agreement when both have axes
        if (!axesCoincident(nodes[cur], nodes[to])) continue;
        visited[to] = 1;
        stack.push(to);
      }
    }
    if (component.length > 0) components.push(component);
  }

  const merged = bridgeCoaxialComponents(components, nodes, adjacency);
  const holes = [];
  for (const component of merged) {
    const withCones = attachAdjacentCountersinks(component, nodes, adjacency);
    const hole = classifyHoleComponent(withCones, nodes);
    if (hole) holes.push(hole);
  }

  report(`Recognized ${holes.length} hole feature(s)`, 100);
  return holes;
}

/**
 * Run selected recognizer(s) on one AAG.
 * @param {'holes'|'pockets'} features
 */
async function recognizeFeaturesFromAag(aag, onProgress, features = 'holes', occt = null) {
  if (features === 'pockets') {
    const { recognizePockets } = await import('./brep-pocket-recognition.js?v=1.20.6');
    // Exclude cylindrical/conical hole *walls* only — planar hole bottoms may
    // still be circular pockets (NX plugged-body style).
    const holesForExclude = recognizeHoles(aag, { onProgress: null });
    const holeFaceIndices = new Set();
    for (const h of holesForExclude) {
      for (const idx of h.faceIndices ?? []) {
        const n = aag.nodes[idx];
        if (!n || n.surfaceType === 'plane') continue;
        // A cylinder blending smoothly into a torus fillet is a milled
        // circular-pocket wall (filleted floor), not a drilled hole wall.
        const hasFloorFillet =
          n.surfaceType === 'cylinder' &&
          aag.adjacency[idx].some(
            (e) =>
              e.classification === 'smooth' &&
              aag.nodes[e.to]?.surfaceType === 'torus'
          );
        if (hasFloorFillet) continue;
        holeFaceIndices.add(idx);
      }
    }
    const pockets = recognizePockets(aag, { onProgress, holeFaceIndices, occt });
    return { holes: [], pockets };
  }

  // Default / holes-only
  const holes = recognizeHoles(aag, { onProgress });
  return { holes, pockets: [] };
}

/**
 * End-to-end: load STEP buffer → AAG → selected features.
 * @param {ArrayBuffer|Uint8Array} arrayBuffer
 * @param {object} [options]
 * @param {'holes'|'pockets'} [options.features='holes']
 * @returns {Promise<{ holes: object[], pockets: object[] }>}
 */
export async function analyzeStepFileFeatures(arrayBuffer, options = {}) {
  const onProgress = options.onProgress ?? null;
  const features = options.features === 'pockets' ? 'pockets' : 'holes';
  const report = (message, percent) => {
    if (typeof onProgress === 'function') onProgress({ message, percent });
  };

  report('Loading OCCT B-Rep kernel…', 2);
  const occt = await loadOcct(options);
  const mark = occt.checkpoint();

  try {
    report('Importing STEP as B-Rep…', 8);
    const bytes = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
    const shape = occt.importStep(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

    if (occt.isNull(shape)) {
      throw new Error('B-Rep STEP import returned a null shape');
    }

    // Prefer a solid if the import is a compound of solids
    let target = shape;
    if (occt.isCompound(shape) || occt.isCompSolid(shape)) {
      const solids = occt.getSubShapes(shape, 'solid');
      if (solids.length === 1) {
        target = solids[0];
      } else if (solids.length > 1) {
        const allHoles = [];
        const allPockets = [];
        for (let s = 0; s < solids.length; s++) {
          report(`Analyzing solid ${s + 1} / ${solids.length}…`, 10 + Math.round((s / solids.length) * 5));
          const aag = await buildAAG(solids[s], occt, ({ message, percent }) => {
            const scaled = 15 + Math.round((percent / 100) * 80);
            report(`[solid ${s + 1}] ${message}`, scaled);
          });
          const { holes, pockets } = await recognizeFeaturesFromAag(
            aag,
            onProgress,
            features,
            occt
          );
          allHoles.push(...holes);
          allPockets.push(...pockets);
        }
        return { holes: allHoles, pockets: allPockets };
      }
    }

    const aag = await buildAAG(target, occt, onProgress);
    // Must await: without it, finally{releaseSince} frees face handles while
    // pocket plugging (outerWire/extrude) is still running → empty plugMesh
    // and inflated footprint/volume fallbacks in the browser worker.
    return await recognizeFeaturesFromAag(aag, onProgress, features, occt);
  } finally {
    try {
      occt.releaseSince(mark);
    } catch {
      /* arena may already be clear */
    }
  }
}

export { isHoleCandidateFace, axesCoincident };
