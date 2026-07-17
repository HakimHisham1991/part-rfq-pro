/**
 * Hole Detection Engine — cylindrical hole detection via curvature / boundary analysis.
 * Circle fitting: RANSAC+Taubin (default), Taubin, Kåsa, Geometric Iterative.
 */

// ── Circle fitting methods ──────────────────────────────────────────────────

export const HOLE_FIT_METHODS = {
  'ransac-taubin': { label: 'RANSAC + Taubin (recommended)', default: true },
  taubin: { label: 'Taubin' },
  kasa: { label: 'Kåsa Least Squares' },
  'geometric-iterative': { label: 'Geometric Iterative' }
};

export const HOLE_FIT_METHOD_KEYS = Object.keys(HOLE_FIT_METHODS);
export const DEFAULT_HOLE_FIT_METHOD = 'ransac-taubin';
export const DEFAULT_RANSAC_ITERATIONS = 500;
export const HOLE_METHOD_STORAGE_KEY = 'part-rfq-pro-hole-fit-method';
export const HOLE_RANSAC_ITERATIONS_KEY = 'part-rfq-pro-hole-ransac-iterations';

// ── 2D point helpers (x, y arrays) ───────────────────────────────────────────

function dist2d(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Kåsa algebraic least-squares circle fit.
 * Returns { cx, cy, radius, rms } or null.
 */
export function kasaCircleFit(points) {
  const n = points.length;
  if (n < 3) return null;

  let sumX = 0, sumY = 0, sumX2 = 0, sumY2 = 0, sumXY = 0;
  let sumX3 = 0, sumY3 = 0, sumX2Y = 0, sumXY2 = 0;

  for (const p of points) {
    const x = p[0], y = p[1];
    const x2 = x * x, y2 = y * y;
    sumX += x; sumY += y;
    sumX2 += x2; sumY2 += y2; sumXY += x * y;
    sumX3 += x2 * x; sumY3 += y2 * y;
    sumX2Y += x2 * y; sumXY2 += x * y2;
  }

  const C = n * sumX2 - sumX * sumX;
  const D = n * sumXY - sumX * sumY;
  const E = n * sumY2 - sumY * sumY;
  const G = 0.5 * (n * sumX3 + n * sumXY2 - sumX * (sumX2 + sumY2));
  const H = 0.5 * (n * sumX2Y + n * sumY3 - sumY * (sumX2 + sumY2));

  const denom = C * E - D * D;
  if (Math.abs(denom) < 1e-12) return null;

  const cx = (G * E - D * H) / denom;
  const cy = (C * H - D * G) / denom;
  const radius = Math.sqrt(
    (sumX2 + sumY2 - 2 * cx * sumX - 2 * cy * sumY) / n + cx * cx + cy * cy
  );

  if (!Number.isFinite(radius) || radius <= 0) return null;

  let sqErr = 0;
  for (const p of points) {
    const d = dist2d(p[0], p[1], cx, cy) - radius;
    sqErr += d * d;
  }

  return { cx, cy, radius, rms: Math.sqrt(sqErr / n) };
}

/**
 * Taubin circle fit — improved algebraic fit with bias correction.
 */
export function taubinCircleFit(points) {
  const n = points.length;
  if (n < 3) return null;

  let meanX = 0, meanY = 0;
  for (const p of points) {
    meanX += p[0];
    meanY += p[1];
  }
  meanX /= n;
  meanY /= n;

  let suu = 0, suv = 0, svv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of points) {
    const u = p[0] - meanX;
    const v = p[1] - meanY;
    suu += u * u;
    suv += u * v;
    svv += v * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }

  const Auc = suu;
  const Auv = suv;
  const Avv = svv;
  const Auuu = suuu;
  const Avvv = svvv;
  const Auvv = suvv;
  const Avuu = svuu;

  const A = [
    [Auc, Auv],
    [Auv, Avv]
  ];
  const B = [0.5 * (Auuu + Auvv), 0.5 * (Avvv + Avuu)];

  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
  if (Math.abs(det) < 1e-12) return kasaCircleFit(points);

  const uc = (B[0] * A[1][1] - B[1] * A[0][1]) / det;
  const vc = (A[0][0] * B[1] - A[1][0] * B[0]) / det;

  const cx = uc + meanX;
  const cy = vc + meanY;
  const radius = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);

  if (!Number.isFinite(radius) || radius <= 0) return null;

  let sqErr = 0;
  for (const p of points) {
    const d = dist2d(p[0], p[1], cx, cy) - radius;
    sqErr += d * d;
  }

  return { cx, cy, radius, rms: Math.sqrt(sqErr / n) };
}

/**
 * Geometric iterative circle fit — minimizes radial distance.
 */
export function geometricIterativeCircleFit(points, maxIter = 50, tol = 1e-6) {
  let fit = taubinCircleFit(points) ?? kasaCircleFit(points);
  if (!fit) return null;

  let { cx, cy, radius } = fit;

  for (let iter = 0; iter < maxIter; iter++) {
    let dCx = 0, dCy = 0, dR = 0;
    let count = 0;

    for (const p of points) {
      const dx = p[0] - cx;
      const dy = p[1] - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1e-9) continue;
      const residual = dist - radius;
      dCx += residual * dx / dist;
      dCy += residual * dy / dist;
      dR += residual;
      count++;
    }

    if (count === 0) break;

    const step = 2 / count;
    const nCx = cx + step * dCx;
    const nCy = cy + step * dCy;
    const nR = radius + step * dR;

    const delta = Math.abs(nCx - cx) + Math.abs(nCy - cy) + Math.abs(nR - radius);
    cx = nCx; cy = nCy; radius = nR;
    if (delta < tol) break;
  }

  if (!Number.isFinite(radius) || radius <= 0) return null;

  let sqErr = 0;
  for (const p of points) {
    const d = dist2d(p[0], p[1], cx, cy) - radius;
    sqErr += d * d;
  }

  return { cx, cy, radius, rms: Math.sqrt(sqErr / points.length) };
}

/**
 * RANSAC circle fit with Taubin refinement.
 */
export function ransacCircleFit(points, iterations = DEFAULT_RANSAC_ITERATIONS, inlierThreshold = null) {
  const n = points.length;
  if (n < 3) return null;

  // Adaptive inlier threshold based on point spread
  if (inlierThreshold == null) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    }
    const span = Math.max(maxX - minX, maxY - minY);
    inlierThreshold = Math.max(span * 0.02, 0.05);
  }

  let bestInliers = [];
  let bestFit = null;
  const rng = mulberry32(hashPoints(points));

  for (let i = 0; i < iterations; i++) {
    const idx = pickThreeDistinct(n, rng);
    const sample = [points[idx[0]], points[idx[1]], points[idx[2]]];
    const candidate = taubinCircleFit(sample);
    if (!candidate || candidate.radius <= 0) continue;

    const inliers = [];
    for (let j = 0; j < n; j++) {
      const d = Math.abs(dist2d(points[j][0], points[j][1], candidate.cx, candidate.cy) - candidate.radius);
      if (d <= inlierThreshold) inliers.push(points[j]);
    }

    if (inliers.length > bestInliers.length) {
      bestInliers = inliers;
      bestFit = candidate;
    }
  }

  if (bestInliers.length < 3) {
    return fitCircleToPoints(points, 'taubin');
  }

  const refined = taubinCircleFit(bestInliers);
  if (!refined) return bestFit;

  let sqErr = 0;
  for (const p of bestInliers) {
    const d = dist2d(p[0], p[1], refined.cx, refined.cy) - refined.radius;
    sqErr += d * d;
  }
  refined.rms = Math.sqrt(sqErr / bestInliers.length);
  refined.inlierCount = bestInliers.length;
  refined.inlierRatio = bestInliers.length / n;
  return refined;
}

/** Unified circle fit dispatcher. */
export function fitCircleToPoints(points, method = DEFAULT_HOLE_FIT_METHOD, ransacIterations = DEFAULT_RANSAC_ITERATIONS) {
  if (!points || points.length < 3) return null;

  switch (method) {
    case 'ransac-taubin':
      return ransacCircleFit(points, ransacIterations);
    case 'taubin':
      return taubinCircleFit(points);
    case 'kasa':
      return kasaCircleFit(points);
    case 'geometric-iterative':
      return geometricIterativeCircleFit(points);
    default:
      return ransacCircleFit(points, ransacIterations);
  }
}

// ── 3D geometry helpers ───────────────────────────────────────────────────────

function vec3(x, y, z) { return [x, y, z]; }

function v3sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function v3add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function v3scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function v3dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function v3cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}
function v3len(a) { return Math.sqrt(v3dot(a, a)); }
function v3norm(a) {
  const l = v3len(a);
  return l > 1e-12 ? v3scale(a, 1 / l) : [0, 0, 1];
}

/**
 * Shared eigen helper: smallest-eigenvalue eigenvector of a 3x3 symmetric
 * matrix given by its upper triangle (xx, xy, xz, yy, yz, zz).
 *
 * Analytic approach: closed-form eigenvalues (Smith's algorithm), then the
 * eigenvector as the cross product of two rows of (M − λ_min·I) — rows of a
 * rank-2 symmetric matrix span the plane orthogonal to its null vector.
 * This stays accurate even when the two smallest eigenvalues are close
 * (e.g. narrow cylindrical arcs), where power iteration converges too
 * slowly to be usable. Falls back to shifted power iteration only in the
 * near-degenerate case where the cross products vanish.
 */
function smallestEigenvector3x3(xx, xy, xz, yy, yz, zz, iterations = 40) {
  const trace = xx + yy + zz;
  if (!(trace > 1e-12)) return [0, 0, 1];

  const [, , eMin] = symmetricEigenvalues3x3(xx, xy, xz, yy, yz, zz);

  const r0 = [xx - eMin, xy, xz];
  const r1 = [xy, yy - eMin, yz];
  const r2 = [xz, yz, zz - eMin];

  const c01 = v3cross(r0, r1);
  const c02 = v3cross(r0, r2);
  const c12 = v3cross(r1, r2);
  let best = c01;
  let bestLen = v3len(c01);
  const l02 = v3len(c02);
  if (l02 > bestLen) { best = c02; bestLen = l02; }
  const l12 = v3len(c12);
  if (l12 > bestLen) { best = c12; bestLen = l12; }

  // Relative threshold: cross products scale with the squared matrix scale.
  if (bestLen > trace * trace * 1e-12) return v3scale(best, 1 / bestLen);

  // Degenerate (repeated eigenvalue) — shifted power iteration fallback.
  const sxx = trace - xx, syy = trace - yy, szz = trace - zz;
  const sxy = -xy, sxz = -xz, syz = -yz;

  // Non-axis-aligned start vector: axis-aligned geometry produces a diagonal
  // matrix, and a start vector exactly orthogonal to the target eigenvector
  // (e.g. [1,0,0] vs a Z axis) would never converge toward it.
  let v = v3norm([0.7247, 0.5613, 0.3996]);
  for (let iter = 0; iter < iterations; iter++) {
    const nv = [
      sxx * v[0] + sxy * v[1] + sxz * v[2],
      sxy * v[0] + syy * v[1] + syz * v[2],
      sxz * v[0] + syz * v[1] + szz * v[2]
    ];
    const len = v3len(nv);
    if (len < 1e-12) return [0, 0, 1];
    v = v3scale(nv, 1 / len);
  }
  return v3norm(v);
}

/**
 * Eigenvalues of a 3x3 symmetric matrix (upper triangle), sorted descending.
 * Closed-form (Smith's algorithm) — used to gate degenerate PCA results.
 */
function symmetricEigenvalues3x3(xx, xy, xz, yy, yz, zz) {
  const p1 = xy * xy + xz * xz + yz * yz;
  const q = (xx + yy + zz) / 3;
  const p2 = (xx - q) * (xx - q) + (yy - q) * (yy - q) + (zz - q) * (zz - q) + 2 * p1;
  const p = Math.sqrt(Math.max(p2 / 6, 0));
  if (p < 1e-15) return [q, q, q];

  const bxx = (xx - q) / p, byy = (yy - q) / p, bzz = (zz - q) / p;
  const bxy = xy / p, bxz = xz / p, byz = yz / p;
  const detB =
    bxx * (byy * bzz - byz * byz) -
    bxy * (bxy * bzz - byz * bxz) +
    bxz * (bxy * byz - byy * bxz);

  const r = Math.max(-1, Math.min(1, detB / 2));
  const phi = Math.acos(r) / 3;
  const e1 = q + 2 * p * Math.cos(phi);
  const e3 = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
  const e2 = 3 * q - e1 - e3;
  return [e1, e2, e3];
}

/** Build orthonormal basis (u, v) on plane perpendicular to axis. */
function planeBasis(axis) {
  const a = v3norm(axis);
  let ref = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = v3norm(v3cross(a, ref));
  const v = v3norm(v3cross(a, u));
  return { u, v, normal: a };
}

/** Project 3D point onto plane defined by origin + normal, return 2D coords. */
function projectToPlane2D(point, origin, basis) {
  const d = v3sub(point, origin);
  return [v3dot(d, basis.u), v3dot(d, basis.v)];
}

/** Convert 2D plane coords back to 3D. */
function plane2DTo3D(uCoord, vCoord, origin, basis) {
  return v3add(v3add(origin, v3scale(basis.u, uCoord)), v3scale(basis.v, vCoord));
}

// ── Mesh extraction ───────────────────────────────────────────────────────────

/**
 * Extract triangle data from serialized mesh list.
 * @param {Array} meshes - [{ positions: Float32Array, indices: Uint32Array|null, meshIndex }]
 * @param {Set<string>|null} selectedFaces - keys "meshIndex:faceIndex"
 */
export function extractMeshTriangles(meshes, selectedFaces = null) {
  const triangles = [];
  const faceNormals = [];
  const faceCenters = [];
  const faceKeys = [];

  // Accept Set or array of face keys
  const faceFilter = selectedFaces
    ? (selectedFaces instanceof Set ? selectedFaces : new Set(selectedFaces))
    : null;

  for (const mesh of meshes) {
    const positions = mesh.positions;
    const indices = mesh.indices;
    const meshIdx = mesh.meshIndex ?? 0;
    const triCount = indices ? indices.length / 3 : positions.length / 9;

    for (let t = 0; t < triCount; t++) {
      const faceKey = `${meshIdx}:${t}`;
      if (faceFilter && !faceFilter.has(faceKey)) continue;

      let i0, i1, i2;
      if (indices) {
        i0 = indices[t * 3]; i1 = indices[t * 3 + 1]; i2 = indices[t * 3 + 2];
      } else {
        i0 = t * 3; i1 = t * 3 + 1; i2 = t * 3 + 2;
      }

      const p0 = [positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]];
      const p1 = [positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]];
      const p2 = [positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]];

      const e1 = v3sub(p1, p0);
      const e2 = v3sub(p2, p0);
      const normal = v3norm(v3cross(e1, e2));
      const center = v3scale(v3add(v3add(p0, p1), p2), 1 / 3);

      triangles.push([p0, p1, p2]);
      faceNormals.push(normal);
      faceCenters.push(center);
      faceKeys.push(faceKey);
    }
  }

  return { triangles, faceNormals, faceCenters, faceKeys };
}

// ── Curvature-based cylindrical patch detection ───────────────────────────────

/**
 * Estimate local cylinder axis from a face + its neighborhood using
 * normal-vector PCA: true cylindrical-wall normals lie in the plane
 * perpendicular to the axis, so the axis is the smallest-eigenvalue
 * eigenvector of the normal covariance matrix.
 */
function estimateLocalCylinderAxis(center, normal, neighbors) {
  if (neighbors.length < 2) return null;

  // Sign alignment isn't needed for PCA (n and -n contribute the same
  // outer product), so just accumulate n_i * n_i^T directly.
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;

  const accumulate = (n) => {
    xx += n[0] * n[0]; xy += n[0] * n[1]; xz += n[0] * n[2];
    yy += n[1] * n[1]; yz += n[1] * n[2]; zz += n[2] * n[2];
  };

  accumulate(normal);
  let included = 0;
  for (const nb of neighbors) {
    // Skip neighbors across sharp edges (e.g. from a hole wall onto the
    // surrounding flat sheet): their normals are ~90°+ away from the seed's
    // and would rotate the PCA axis into the surface plane. Same-signed dot
    // also drops the opposite wall of a tiny hole (normal flipped ~180°).
    if (v3dot(nb.normal, normal) <= 0.25) continue;
    accumulate(nb.normal);
    included++;
  }
  if (included < 2) return null;

  // Planar neighborhoods are rank-1: the smallest eigenvector is an arbitrary
  // in-plane direction, and neighboring flat faces would all agree on it,
  // letting whole planes region-grow into fake "cylinder" patches. Require
  // the normals to actually fan out (middle eigenvalue clearly nonzero).
  const [, e2] = symmetricEigenvalues3x3(xx, xy, xz, yy, yz, zz);
  const trace = xx + yy + zz;
  if (e2 < trace * 1e-4) return null;

  return smallestEigenvector3x3(xx, xy, xz, yy, yz, zz);
}

/**
 * Detect cylindrical hole candidates via curvature / normal analysis.
 */
function reportProgress(onProgress, message, percent) {
  if (typeof onProgress === 'function') {
    try {
      onProgress({ message, percent });
    } catch {
      // Never let progress callbacks break detection
    }
  }
}

/**
 * Face adjacency from shared (position-welded) vertices. Topological
 * adjacency is scale-independent: it works equally for a 1 mm rivet hole
 * and a 100 mm bore, unlike a distance-based neighbor search whose radius
 * is tuned to the average tessellation density and therefore lumps tiny
 * features in with the surrounding surface.
 */
function buildFaceAdjacency(triangles) {
  const vertexFaces = new Map();
  for (let f = 0; f < triangles.length; f++) {
    for (const p of triangles[f]) {
      const key = `${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)}`;
      let faces = vertexFaces.get(key);
      if (!faces) vertexFaces.set(key, faces = []);
      faces.push(f);
    }
  }

  const adjacency = new Array(triangles.length);
  for (let f = 0; f < triangles.length; f++) adjacency[f] = new Set();
  for (const faces of vertexFaces.values()) {
    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        adjacency[faces[i]].add(faces[j]);
        adjacency[faces[j]].add(faces[i]);
      }
    }
  }
  return adjacency.map((s) => [...s]);
}

function detectCylindricalPatches(triangles, faceCenters, faceNormals, faceKeys, options) {
  const { minRadius = 0.3, maxRadius = 500, onProgress = null } = options;
  const n = faceCenters.length;
  if (n < 6) return [];

  reportProgress(onProgress, `Analyzing curvature on ${n.toLocaleString()} faces…`, 15);

  const adjacency = buildFaceAdjacency(triangles);

  // Neighborhood for local axis estimation: the 2-ring (neighbors of
  // neighbors). The 1-ring on coarse cylinder tessellations can be a
  // near-degenerate normal fan; the 2-ring adds the next segment around
  // the circumference, stabilizing the PCA.
  function getNeighbors(idx) {
    const seen = new Set(adjacency[idx]);
    for (const j of adjacency[idx]) {
      for (const k of adjacency[j]) seen.add(k);
    }
    seen.delete(idx);
    const result = [];
    for (const j of seen) {
      result.push({ index: j, center: faceCenters[j], normal: faceNormals[j] });
    }
    return result;
  }

  // Neighbor lists and local axis estimates depend only on the face, not the
  // patch — cache them so region growing doesn't recompute per candidate.
  const neighborCache = new Array(n);
  const cachedNeighbors = (idx) => neighborCache[idx] ?? (neighborCache[idx] = getNeighbors(idx));
  const NO_AXIS = Symbol('no-axis');
  const axisCache = new Array(n);
  const cachedLocalAxis = (idx) => {
    let a = axisCache[idx];
    if (a === undefined) {
      a = estimateLocalCylinderAxis(faceCenters[idx], faceNormals[idx], cachedNeighbors(idx)) ?? NO_AXIS;
      axisCache[idx] = a;
    }
    return a === NO_AXIS ? null : a;
  };

  const candidates = [];
  // `used`: faces in an ACCEPTED patch — excluded from any further patch.
  // `seeded`: faces already grown into some patch (accepted or rejected) —
  // skipped as seeds to avoid regrowing rejected patches from every face,
  // but still allowed to join a later patch: a bad early seed (e.g. one that
  // drifted onto surrounding geometry and was rejected) must not permanently
  // consume a real hole's wall faces.
  const used = new Uint8Array(n);
  const seeded = new Uint8Array(n);
  const fragments = [];
  const progressStep = Math.max(1, Math.floor(n / 20));

  for (let i = 0; i < n; i++) {
    if (i % progressStep === 0) {
      const pct = 20 + Math.round((i / n) * 35);
      reportProgress(
        onProgress,
        `Scanning cylindrical patches… ${i.toLocaleString()} / ${n.toLocaleString()} faces (${candidates.length} candidates)`,
        pct
      );
    }
    if (used[i] || seeded[i]) continue;
    const neighbors = cachedNeighbors(i);
    if (neighbors.length < 3) continue;

    const axis = cachedLocalAxis(i);
    if (!axis) continue;

    // Region grow: faces with consistent cylindrical geometry. Only unused
    // faces may join — without this, every seed on the same surface regrows
    // a near-identical overlapping patch, yielding hundreds of duplicate
    // candidates for a single feature.
    const patch = [i];
    const patchSet = new Set([i]);
    const queue = [i];

    // Growth walks direct (1-ring) adjacency only. The 2-ring is fine for
    // axis PCA, but for growth it lets one large sheet triangle bridge two
    // unrelated features (e.g. two holes whose rims touch the same triangle),
    // chaining every coaxial hole on the part into one giant patch.
    while (queue.length > 0) {
      const cur = queue.shift();
      for (const nbIdx of adjacency[cur]) {
        if (patchSet.has(nbIdx) || used[nbIdx]) continue;
        const nbAxis = cachedLocalAxis(nbIdx);
        if (!nbAxis) continue;
        // Axes should be parallel — tightened from 0.85 (~31.7°) to 0.95 (~18.2°)
        if (Math.abs(v3dot(axis, nbAxis)) < 0.95) continue;
        // Normals should be roughly perpendicular to axis — tightened from 0.4 (~66°) to 0.25 (~75.5°)
        if (Math.abs(v3dot(faceNormals[nbIdx], axis)) > 0.25) continue;
        patch.push(nbIdx);
        patchSet.add(nbIdx);
        queue.push(nbIdx);
      }
    }

    for (const idx of patch) seeded[idx] = 1;

    if (patch.length < 6) continue;

    const result = evaluatePatch(patch);
    if (result.status === 'accept') {
      for (const idx of patch) used[idx] = 1;
      candidates.push(result.candidate);
    } else if (result.status === 'fragment') {
      fragments.push(result.fragment);
    }
  }

  /**
   * Fit + validate a grown patch as a cylindrical hole.
   * Returns { status: 'accept', candidate } for a confirmed hole,
   * { status: 'fragment', fragment } for a clean partial wall arc that only
   * failed the angular-coverage gate (candidate for obstructed-hole merging),
   * or { status: 'reject' }.
   */
  function evaluatePatch(patch) {
    const reject = { status: 'reject' };
    const patchCenters = patch.map((idx) => faceCenters[idx]);
    const patchNormals = patch.map((idx) => faceNormals[idx]);

    // Find axis via normal PCA over the whole patch (robust final estimate)
    let axisPoint = [0, 0, 0];
    for (const c of patchCenters) axisPoint = v3add(axisPoint, c);
    axisPoint = v3scale(axisPoint, 1 / patchCenters.length);

    let pxx = 0, pxy = 0, pxz = 0, pyy = 0, pyz = 0, pzz = 0;
    for (const nrm of patchNormals) {
      pxx += nrm[0] * nrm[0]; pxy += nrm[0] * nrm[1]; pxz += nrm[0] * nrm[2];
      pyy += nrm[1] * nrm[1]; pyz += nrm[1] * nrm[2]; pzz += nrm[2] * nrm[2];
    }
    let holeAxis = smallestEigenvector3x3(pxx, pxy, pxz, pyy, pyz, pzz);

    // Project patch centers to plane perpendicular to axis for circle fit
    let basis = planeBasis(holeAxis);
    let points2d = patchCenters.map((c) => projectToPlane2D(c, axisPoint, basis));

    let fit = fitCircleToPoints(points2d, options.method, options.ransacIterations);
    if (!fit || fit.radius < minRadius || fit.radius > maxRadius) return reject;

    let center3d = plane2DTo3D(fit.cx, fit.cy, axisPoint, basis);

    // Validate the cylinder hypothesis in 3D: face normals must point
    // radially INWARD toward the fitted axis line. Tessellated solids have
    // outward-facing normals, so a hole wall (concave) points at the axis
    // while a boss / outer wall (convex) points away — the signed test
    // rejects convex cylinders that are not holes at all. It also rejects
    // accidental patches on curved sheet surfaces whose normals aren't
    // radial in the first place.
    const computeRadialInliers = () => {
      const inliers = [];
      for (let pi = 0; pi < patchCenters.length; pi++) {
        const w = v3sub(patchCenters[pi], center3d);
        const radial = v3sub(w, v3scale(holeAxis, v3dot(w, holeAxis)));
        const rLen = v3len(radial);
        if (rLen < 1e-6) continue;
        const radialDir = v3scale(radial, 1 / rLen);
        if (v3dot(patchNormals[pi], radialDir) < -0.85) inliers.push(pi);
      }
      return inliers;
    };

    let radialInliers = computeRadialInliers();
    // Permissive pre-refinement gate: small through-holes drag exit-lip and
    // rim faces into the patch, diluting agreement to ~55%; the refinement
    // loop below discards those. Stricter gates re-apply afterwards.
    if (radialInliers.length < patchCenters.length * 0.5 || radialInliers.length < 6) return reject;

    // Refine using only radially-consistent faces: rim/chamfer transition
    // faces and faces of an intersecting feature bias both the axis and the
    // radius. Two rounds of (axis from inlier normals → refit circle →
    // recompute inliers) is enough to settle in practice.
    for (let round = 0; round < 2; round++) {
      // Axis from CENTERED inlier normals. Radial inliers all point inward,
      // so their signs are consistent and centering is well-defined. Why
      // center: for conical walls (and partial-coverage arcs) every normal
      // carries the same constant axial component, which biases raw-normal
      // PCA; subtracting the mean removes that component exactly, leaving
      // variance only in the radial plane — smallest eigenvector = axis.
      // Also skip strongly axial faces (fillet/chamfer rim transitions).
      const kept = [];
      let mx = 0, my = 0, mz = 0;
      for (const pi of radialInliers) {
        const nrm = patchNormals[pi];
        if (Math.abs(v3dot(nrm, holeAxis)) > 0.3) continue;
        kept.push(nrm);
        mx += nrm[0]; my += nrm[1]; mz += nrm[2];
      }
      if (kept.length < 6) break;
      mx /= kept.length; my /= kept.length; mz /= kept.length;

      let ixx = 0, ixy = 0, ixz = 0, iyy = 0, iyz = 0, izz = 0;
      for (const nrm of kept) {
        const dx = nrm[0] - mx, dy = nrm[1] - my, dz = nrm[2] - mz;
        ixx += dx * dx; ixy += dx * dy; ixz += dx * dz;
        iyy += dy * dy; iyz += dy * dz; izz += dz * dz;
      }
      const refinedAxis = smallestEigenvector3x3(ixx, ixy, ixz, iyy, iyz, izz);
      const refinedBasis = planeBasis(refinedAxis);
      const refinedPoints2d = patchCenters.map((c) => projectToPlane2D(c, axisPoint, refinedBasis));
      const inlierPts = radialInliers.map((pi) => refinedPoints2d[pi]);
      const refit = fitCircleToPoints(inlierPts, options.method, options.ransacIterations);
      if (!refit || refit.radius < minRadius || refit.radius > maxRadius) break;

      holeAxis = refinedAxis;
      basis = refinedBasis;
      points2d = refinedPoints2d;
      fit = refit;
      center3d = plane2DTo3D(fit.cx, fit.cy, axisPoint, basis);
      radialInliers = computeRadialInliers();
      if (radialInliers.length < 6) break;
    }
    if (radialInliers.length < 6) return reject;

    // Hard gate on relative fit error — the quality score's inlier bonus can
    // mask fits whose rms is a sizeable fraction of the radius.
    if ((fit.rms ?? 0) > fit.radius * 0.05) return reject;

    const inlierPoints2d = radialInliers.map((pi) => points2d[pi]);
    const quality = computeFitQuality(fit, inlierPoints2d);
    if (quality < 0.3) return reject;

    // The wall must wrap far enough around the axis to be a hole. Sheet
    // bends span ~90° and corner blends ~130°, while even a heavily
    // obstructed hole keeps most of its wall (fragments are merged before
    // this gate re-runs), so 150° separates the two populations cleanly.
    const angles = [];
    for (const pi of radialInliers) {
      const w = v3sub(patchCenters[pi], center3d);
      const radial = v3sub(w, v3scale(holeAxis, v3dot(w, holeAxis)));
      if (v3len(radial) < 1e-6) continue;
      angles.push(Math.atan2(v3dot(radial, basis.v), v3dot(radial, basis.u)));
    }
    angles.sort((a, b) => a - b);
    let maxGap = 2 * Math.PI - (angles[angles.length - 1] - angles[0]);
    for (let ai = 1; ai < angles.length; ai++) {
      maxGap = Math.max(maxGap, angles[ai] - angles[ai - 1]);
    }
    const coverage = 2 * Math.PI - maxGap;

    // Empty-interior test: a real hole is void inside — no mesh faces may
    // sit well inside the fitted cylinder within the wall's axial span.
    // Corner blends and other concave junk regions fit circles whose
    // interior slices through nearby solid geometry (pocket floors, walls).
    {
      let axMin = Infinity, axMax = -Infinity;
      for (const pi of radialInliers) {
        const t = v3dot(v3sub(patchCenters[pi], center3d), holeAxis);
        axMin = Math.min(axMin, t);
        axMax = Math.max(axMax, t);
      }
      const axPad = (axMax - axMin) * 0.2;
      const rIn = fit.radius * 0.6;
      let intruders = 0;
      for (let fi = 0; fi < n; fi++) {
        const w = v3sub(faceCenters[fi], center3d);
        const t = v3dot(w, holeAxis);
        if (t < axMin + axPad || t > axMax - axPad) continue;
        const radial = v3sub(w, v3scale(holeAxis, t));
        if (v3len(radial) < rIn) intruders++;
      }
      if (intruders > Math.max(2, radialInliers.length * 0.05)) return reject;
    }

    if (coverage < (Math.PI * 5) / 6) {
      // A clean cylindrical arc, just not wrapped enough on its own — an
      // intersecting feature may have split the hole wall into pieces.
      return {
        status: 'fragment',
        fragment: { patch, axis: holeAxis, center: center3d, radius: fit.radius }
      };
    }

    return {
      status: 'accept',
      candidate: {
        center: center3d,
        axis: holeAxis,
        radius: fit.radius,
        diameter: fit.radius * 2,
        quality,
        rms: fit.rms,
        patchIndices: patch,
        faceKeys: patch.map((idx) => faceKeys[idx]),
        fitMethod: options.method
      }
    };
  }

  // ── Obstructed-hole recovery: merge coaxial wall fragments ────────────────
  // A hole whose wall is broken up by an intersecting feature grows as
  // several disconnected arcs, each individually failing the coverage gate.
  // Group fragments lying on the same cylinder (parallel axes, coincident
  // axis lines, matching radii) and re-evaluate the union as one hole.
  const fragmentGroups = [];
  for (const frag of fragments) {
    let target = null;
    for (const group of fragmentGroups) {
      const ref = group[0];
      if (Math.abs(v3dot(frag.axis, ref.axis)) < 0.95) continue;
      const radiusRatio = frag.radius / ref.radius;
      if (radiusRatio < 0.8 || radiusRatio > 1.25) continue;
      // Distance between the two axis lines, measured perpendicular to ref axis
      const offset = v3sub(frag.center, ref.center);
      const perp = v3sub(offset, v3scale(ref.axis, v3dot(offset, ref.axis)));
      if (v3len(perp) > Math.max(frag.radius, ref.radius) * 0.35) continue;
      target = group;
      break;
    }
    if (target) target.push(frag);
    else fragmentGroups.push([frag]);
  }

  for (const group of fragmentGroups) {
    if (group.length < 2) continue;
    const combined = [];
    for (const frag of group) {
      for (const idx of frag.patch) {
        if (!used[idx]) combined.push(idx);
      }
    }
    if (combined.length < 6) continue;
    const result = evaluatePatch(combined);
    if (result.status === 'accept') {
      for (const idx of combined) used[idx] = 1;
      candidates.push(result.candidate);
    }
  }

  reportProgress(
    onProgress,
    `Curvature scan complete — ${candidates.length} cylindrical candidate(s)`,
    55
  );
  return candidates;
}

// ── Boundary loop detection ───────────────────────────────────────────────────

function buildEdgeMap(triangles, faceKeys) {
  const edgeMap = new Map(); // "v0-v1" -> [{ faceIdx, edgeIdx }]

  for (let f = 0; f < triangles.length; f++) {
    const tri = triangles[f];
    for (let e = 0; e < 3; e++) {
      const a = tri[e];
      const b = tri[(e + 1) % 3];
      const key = edgeKey(a, b);
      if (!edgeMap.has(key)) edgeMap.set(key, []);
      edgeMap.get(key).push({ faceIdx: f, edgeIdx: e, a, b });
    }
  }

  return edgeMap;
}

function edgeKey(a, b) {
  const ka = `${a[0].toFixed(4)},${a[1].toFixed(4)},${a[2].toFixed(4)}`;
  const kb = `${b[0].toFixed(4)},${b[1].toFixed(4)},${b[2].toFixed(4)}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function findBoundaryLoops(triangles) {
  const edgeMap = buildEdgeMap(triangles);
  const boundaryEdges = [];

  for (const [, entries] of edgeMap) {
    if (entries.length === 1) {
      boundaryEdges.push(entries[0]);
    }
  }

  if (boundaryEdges.length < 3) return [];

  // Chain boundary edges into loops
  const loops = [];
  const used = new Set();

  for (let start = 0; start < boundaryEdges.length; start++) {
    if (used.has(start)) continue;

    const loop = [];
    let current = boundaryEdges[start];
    let currentIdx = start;
    const startVert = current.a;

    loop.push(current.a);
    used.add(currentIdx);

    let safety = boundaryEdges.length + 1;
    let vert = current.b;

    while (safety-- > 0) {
      loop.push(vert);
      if (vertsEqual(vert, startVert) && loop.length > 3) break;

      let found = false;
      for (let j = 0; j < boundaryEdges.length; j++) {
        if (used.has(j)) continue;
        const e = boundaryEdges[j];
        if (vertsEqual(e.a, vert)) {
          used.add(j);
          vert = e.b;
          found = true;
          break;
        }
        if (vertsEqual(e.b, vert)) {
          used.add(j);
          vert = e.a;
          found = true;
          break;
        }
      }
      if (!found) break;
    }

    if (loop.length >= 6) loops.push(loop);
  }

  return loops;
}

function vertsEqual(a, b, tol = 0.01) {
  return Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol && Math.abs(a[2] - b[2]) < tol;
}

function detectBoundaryHoles(triangles, options) {
  const { minRadius = 0.3, maxRadius = 500, onProgress = null } = options;
  reportProgress(onProgress, `Finding boundary loops on ${triangles.length.toLocaleString()} triangles…`, 58);
  const loops = findBoundaryLoops(triangles);
  const holes = [];
  reportProgress(onProgress, `Fitting circles to ${loops.length} boundary loop(s)…`, 62);

  for (let li = 0; li < loops.length; li++) {
    const loop = loops[li];
    if (li % 5 === 0 || li === loops.length - 1) {
      reportProgress(
        onProgress,
        `Fitting boundary holes… ${li + 1} / ${loops.length}`,
        62 + Math.round(((li + 1) / Math.max(loops.length, 1)) * 12)
      );
    }
    // Remove duplicate closing vertex
    const pts = loop[0] && vertsEqual(loop[loop.length - 1], loop[0]) ? loop.slice(0, -1) : loop;
    if (pts.length < 6) continue;

    // Fit plane to loop points via PCA
    const origin = [0, 0, 0];
    for (const p of pts) {
      origin[0] += p[0];
      origin[1] += p[1];
      origin[2] += p[2];
    }
    origin[0] /= pts.length;
    origin[1] /= pts.length;
    origin[2] /= pts.length;

    const axis = fitPlaneNormal(pts, origin);
    if (!axis) continue;

    const basis = planeBasis(axis);
    const points2d = pts.map((p) => projectToPlane2D(p, origin, basis));
    const fit = fitCircleToPoints(points2d, options.method, options.ransacIterations);
    if (!fit || fit.radius < minRadius || fit.radius > maxRadius) continue;

    const quality = computeFitQuality(fit, points2d);
    if (quality < 0.5) continue;

    // Check planarity
    let maxPlaneDev = 0;
    for (const p of pts) {
      const dev = Math.abs(v3dot(v3sub(p, origin), axis));
      maxPlaneDev = Math.max(maxPlaneDev, dev);
    }
    if (maxPlaneDev > fit.radius * 0.15) continue;

    const center3d = plane2DTo3D(fit.cx, fit.cy, origin, basis);

    holes.push({
      center: center3d,
      axis,
      radius: fit.radius,
      diameter: fit.radius * 2,
      quality,
      rms: fit.rms,
      boundaryPoints: pts,
      fitMethod: options.method
    });
  }

  return holes;
}

function fitPlaneNormal(points, origin) {
  // PCA: smallest eigenvector of covariance matrix
  let cxx = 0, cxy = 0, cxz = 0, cyy = 0, cyz = 0, czz = 0;
  for (const p of points) {
    const dx = p[0] - origin[0];
    const dy = p[1] - origin[1];
    const dz = p[2] - origin[2];
    cxx += dx * dx; cxy += dx * dy; cxz += dx * dz;
    cyy += dy * dy; cyz += dy * dz; czz += dz * dz;
  }

  return smallestEigenvector3x3(cxx, cxy, cxz, cyy, cyz, czz);
}

function computeFitQuality(fit, points2d) {
  if (!fit || fit.radius <= 0) return 0;
  const rmsRatio = (fit.rms ?? 0) / fit.radius;
  const inlierBonus = fit.inlierRatio != null ? fit.inlierRatio * 0.3 : 0.15;
  return Math.max(0, Math.min(1, 1 - rmsRatio * 3 + inlierBonus));
}

// ── Depth estimation ──────────────────────────────────────────────────────────

/**
 * Estimate hole depth via point projection along axis + raycasting fallback.
 * @param {object} hole - { center, axis, radius }
 * @param {Array} meshes - serialized mesh data
 * @param {Array} allTriangles - all mesh triangles for raycasting
 */
export function estimateHoleDepth(hole, meshes, allTriangles) {
  const { center, axis, radius } = hole;
  const depthSamples = [];

  // Sample points around the rim
  const basis = planeBasis(axis);
  const sampleCount = 12;
  for (let i = 0; i < sampleCount; i++) {
    const angle = (2 * Math.PI * i) / sampleCount;
    const rimPoint = plane2DTo3D(
      Math.cos(angle) * radius * 0.85,
      Math.sin(angle) * radius * 0.85,
      center,
      basis
    );

    // Cast ray inward along axis from rim
    const hit = raycastAlongAxis(rimPoint, axis, allTriangles, radius * 3);
    if (hit) depthSamples.push(hit.depth);

    // Also cast from center
    const centerHit = raycastAlongAxis(center, axis, allTriangles, radius * 5);
    if (centerHit) depthSamples.push(centerHit.depth);

    // Cast opposite direction too (for through holes)
    const hitOpp = raycastAlongAxis(rimPoint, v3scale(axis, -1), allTriangles, radius * 3);
    if (hitOpp) depthSamples.push(hitOpp.depth);
  }

  // Point projection: find extent of cylindrical patch along axis
  if (hole.patchIndices && hole.faceCenters) {
    let minProj = Infinity, maxProj = -Infinity;
    for (const idx of hole.patchIndices) {
      const c = hole.faceCenters[idx];
      const proj = v3dot(v3sub(c, center), axis);
      minProj = Math.min(minProj, proj);
      maxProj = Math.max(maxProj, proj);
    }
    if (maxProj > minProj && Number.isFinite(minProj)) {
      depthSamples.push(maxProj - minProj);
    }
  }

  if (depthSamples.length === 0) {
    // Fallback: estimate from radius (typical blind hole depth ≈ 2-3× diameter)
    return radius * 2;
  }

  // Use median for robustness
  depthSamples.sort((a, b) => a - b);
  const mid = Math.floor(depthSamples.length / 2);
  const depth = depthSamples.length % 2 === 0
    ? (depthSamples[mid - 1] + depthSamples[mid]) / 2
    : depthSamples[mid];

  return Math.max(depth, radius * 0.5);
}

function raycastAlongAxis(origin, direction, triangles, maxDist) {
  const dir = v3norm(direction);
  let closest = null;

  for (const tri of triangles) {
    const t = rayTriangleIntersect(origin, dir, tri[0], tri[1], tri[2]);
    if (t == null || t < 1e-4 || t > maxDist) continue;
    if (!closest || t < closest.t) {
      closest = { t, depth: t, point: v3add(origin, v3scale(dir, t)) };
    }
  }

  return closest;
}

function rayTriangleIntersect(orig, dir, v0, v1, v2) {
  const e1 = v3sub(v1, v0);
  const e2 = v3sub(v2, v0);
  const h = v3cross(dir, e2);
  const a = v3dot(e1, h);
  if (Math.abs(a) < 1e-8) return null;

  const f = 1 / a;
  const s = v3sub(orig, v0);
  const u = f * v3dot(s, h);
  if (u < 0 || u > 1) return null;

  const q = v3cross(s, e1);
  const v = f * v3dot(dir, q);
  if (v < 0 || u + v > 1) return null;

  const t = f * v3dot(e2, q);
  return t > 1e-4 ? t : null;
}

// ── Hole merging / deduplication ──────────────────────────────────────────────

function mergeHoles(holes, tolerance = 1.0) {
  const merged = [];
  const used = new Uint8Array(holes.length);

  for (let i = 0; i < holes.length; i++) {
    if (used[i]) continue;
    const group = [holes[i]];
    used[i] = 1;

    for (let j = i + 1; j < holes.length; j++) {
      if (used[j]) continue;
      if (holesAreSame(holes[i], holes[j], tolerance)) {
        group.push(holes[j]);
        used[j] = 1;
      }
    }

    // Prefer the candidate supported by the most mesh faces (strongest
    // evidence, most reliable axis), then quality.
    const support = (h) => h.patchIndices?.length ?? h.boundaryPoints?.length ?? 0;
    const best = group.reduce((a, b) =>
      support(b) > support(a) || (support(b) === support(a) && b.quality > a.quality) ? b : a
    );
    // Keep the best candidate's own geometry: averaging with weaker duplicate
    // fits (fewer faces, worse axis) degrades the result rather than helping.
    merged.push(best);
  }

  return merged;
}

function holesAreSame(a, b, tolerance) {
  const radiusDiff = Math.abs(a.radius - b.radius);
  // Scale thresholds with hole size: a 60 mm bore detected twice can differ
  // by several mm in center/radius while still being the same feature.
  const avgRadius = (a.radius + b.radius) / 2;
  const centerTol = Math.max(tolerance, avgRadius * 0.15);
  const radiusTol = Math.max(tolerance * 0.5, avgRadius * 0.1);
  if (radiusDiff >= radiusTol) return false;

  // Split center offset into components perpendicular and parallel to the
  // axis: two fits of the same deep bore land at different heights along the
  // axis (each sits at its patch's centroid), so the axial component only
  // needs to be within the holes' combined depth, while the perpendicular
  // component must be tight for the holes to be coaxial.
  const refAxis = v3norm(a.axis);
  const offset = v3sub(b.center, a.center);
  const axial = Math.abs(v3dot(offset, refAxis));
  const perp = v3len(v3sub(offset, v3scale(refAxis, v3dot(offset, refAxis))));
  const axialTol = Math.max((a.depth ?? 0) + (b.depth ?? 0), centerTol);
  return perp < centerTol && axial < axialTol;
}

// ── Main detection entry point ────────────────────────────────────────────────

/**
 * Detect cylindrical holes in mesh data.
 * @param {Array} meshes - [{ positions, indices, meshIndex }]
 * @param {object} options
 * @returns {Array} detected holes
 */
export function detectHoles(meshes, options = {}) {
  const onProgress = options.onProgress ?? null;
  const opts = {
    method: options.method ?? DEFAULT_HOLE_FIT_METHOD,
    ransacIterations: options.ransacIterations ?? DEFAULT_RANSAC_ITERATIONS,
    minRadius: options.minRadius ?? 0.3,
    maxRadius: options.maxRadius ?? 500,
    mergeTolerance: options.mergeTolerance ?? 1.5,
    selectedFaces: options.selectedFaces ?? null,
    onProgress
  };

  reportProgress(onProgress, 'Extracting mesh triangles…', 5);
  const selectedFaces = opts.selectedFaces;
  const { triangles, faceNormals, faceCenters, faceKeys } = extractMeshTriangles(meshes, selectedFaces);

  if (triangles.length < 6) {
    reportProgress(onProgress, 'Not enough triangles for hole detection.', 100);
    return [];
  }

  reportProgress(
    onProgress,
    `Extracted ${triangles.length.toLocaleString()} triangles from ${meshes.length} mesh(es)`,
    12
  );

  // Run both detection strategies
  const patchHoles = detectCylindricalPatches(triangles, faceCenters, faceNormals, faceKeys, opts);

  // Attach faceCenters reference for depth estimation
  for (const h of patchHoles) {
    h.faceCenters = faceCenters;
  }

  const boundaryHoles = detectBoundaryHoles(triangles, opts);
  reportProgress(
    onProgress,
    `Found ${patchHoles.length} patch + ${boundaryHoles.length} boundary candidate(s)`,
    78
  );

  // Estimate depth for all candidates
  const allTriangles = triangles;
  const allCandidates = [...patchHoles, ...boundaryHoles];

  for (let hi = 0; hi < allCandidates.length; hi++) {
    const hole = allCandidates[hi];
    if (hi % 3 === 0 || hi === allCandidates.length - 1) {
      reportProgress(
        onProgress,
        `Estimating depth… ${hi + 1} / ${allCandidates.length}`,
        80 + Math.round(((hi + 1) / Math.max(allCandidates.length, 1)) * 15)
      );
    }
    hole.depth = estimateHoleDepth(hole, meshes, allTriangles);
    hole.id = `hole-${Math.random().toString(36).slice(2, 9)}`;
  }

  reportProgress(onProgress, 'Merging duplicate holes…', 96);
  const merged = mergeHoles(allCandidates, opts.mergeTolerance);
  reportProgress(onProgress, `Detection complete — ${merged.length} hole(s)`, 100);
  return merged;
}

/**
 * Serialize partGroup meshes for worker / detection.
 */
export function serializeMeshesFromGroup(meshChildren) {
  return meshChildren.map((mesh, meshIndex) => {
    const geo = mesh.geometry;
    const posAttr = geo.attributes.position;
    return {
      meshIndex,
      positions: new Float32Array(posAttr.array),
      indices: geo.index ? new Uint32Array(geo.index.array) : null
    };
  });
}

// ── localStorage helpers ──────────────────────────────────────────────────────

export function loadHoleMethodPreference() {
  try {
    const method = localStorage.getItem(HOLE_METHOD_STORAGE_KEY);
    if (method && HOLE_FIT_METHOD_KEYS.includes(method)) return method;
  } catch { /* ignore */ }
  return DEFAULT_HOLE_FIT_METHOD;
}

export function saveHoleMethodPreference(method) {
  try {
    localStorage.setItem(HOLE_METHOD_STORAGE_KEY, method);
  } catch { /* ignore */ }
}

export function loadRansacIterationsPreference() {
  try {
    const val = parseInt(localStorage.getItem(HOLE_RANSAC_ITERATIONS_KEY), 10);
    if (Number.isFinite(val) && val >= 50 && val <= 5000) return val;
  } catch { /* ignore */ }
  return DEFAULT_RANSAC_ITERATIONS;
}

export function saveRansacIterationsPreference(iterations) {
  try {
    localStorage.setItem(HOLE_RANSAC_ITERATIONS_KEY, String(iterations));
  } catch { /* ignore */ }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function pickThreeDistinct(n, rng) {
  const a = Math.floor(rng() * n);
  let b = Math.floor(rng() * (n - 1));
  if (b >= a) b++;
  let c = Math.floor(rng() * (n - 2));
  if (c >= a) c++;
  if (c >= b) c++;
  return [a, b, c];
}

function hashPoints(points) {
  let h = 0;
  for (let i = 0; i < Math.min(points.length, 20); i++) {
    h = ((h << 5) - h + Math.round(points[i][0] * 1000)) | 0;
    h = ((h << 5) - h + Math.round(points[i][1] * 1000)) | 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
