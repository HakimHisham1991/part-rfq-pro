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
 * Estimate local cylinder axis from a face and its neighborhood.
 * Cylindrical surfaces: normals are radial from axis → cross(normal, radial) ∥ axis.
 */
function estimateLocalCylinderAxis(center, normal, neighbors) {
  const axes = [];
  for (const nb of neighbors) {
    const radial = v3sub(nb.center, center);
    const rLen = v3len(radial);
    if (rLen < 1e-6) continue;
    const rNorm = v3scale(radial, 1 / rLen);
    const axis = v3cross(normal, rNorm);
    const aLen = v3len(axis);
    if (aLen > 1e-6) axes.push(v3scale(axis, 1 / aLen));
    // Also try neighbor normal
    const axis2 = v3cross(nb.normal, rNorm);
    const aLen2 = v3len(axis2);
    if (aLen2 > 1e-6) axes.push(v3scale(axis2, 1 / aLen2));
  }

  if (axes.length === 0) return null;

  // Average axis direction (handle sign ambiguity)
  let sum = [0, 0, 0];
  const ref = axes[0];
  for (const a of axes) {
    const aligned = v3dot(a, ref) < 0 ? v3scale(a, -1) : a;
    sum = v3add(sum, aligned);
  }
  return v3norm(sum);
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

function detectCylindricalPatches(faceCenters, faceNormals, faceKeys, options) {
  const { minRadius = 0.3, maxRadius = 500, neighborDist = null, onProgress = null } = options;
  const n = faceCenters.length;
  if (n < 6) return [];

  reportProgress(onProgress, `Analyzing curvature on ${n.toLocaleString()} faces…`, 15);

  // Compute characteristic length for neighbor search
  let avgEdge = 0;
  let edgeCount = 0;
  for (let i = 0; i < Math.min(n, 200); i++) {
    for (let j = i + 1; j < Math.min(n, 200); j++) {
      const d = v3len(v3sub(faceCenters[i], faceCenters[j]));
      if (d > 1e-6) { avgEdge += d; edgeCount++; }
    }
  }
  avgEdge = edgeCount > 0 ? avgEdge / edgeCount : 1;
  const searchDist = neighborDist ?? avgEdge * 4;

  // Build spatial hash for neighbor queries
  const cellSize = searchDist;
  const hash = new Map();
  for (let i = 0; i < n; i++) {
    const c = faceCenters[i];
    const key = `${Math.floor(c[0] / cellSize)},${Math.floor(c[1] / cellSize)},${Math.floor(c[2] / cellSize)}`;
    if (!hash.has(key)) hash.set(key, []);
    hash.get(key).push(i);
  }

  function getNeighbors(idx) {
    const c = faceCenters[idx];
    const cx = Math.floor(c[0] / cellSize);
    const cy = Math.floor(c[1] / cellSize);
    const cz = Math.floor(c[2] / cellSize);
    const result = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = `${cx + dx},${cy + dy},${cz + dz}`;
          const bucket = hash.get(key);
          if (!bucket) continue;
          for (const j of bucket) {
            if (j === idx) continue;
            const d = v3len(v3sub(faceCenters[j], c));
            if (d <= searchDist) {
              result.push({ index: j, center: faceCenters[j], normal: faceNormals[j], dist: d });
            }
          }
        }
      }
    }
    return result;
  }

  const candidates = [];
  const used = new Uint8Array(n);
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
    if (used[i]) continue;
    const neighbors = getNeighbors(i);
    if (neighbors.length < 3) continue;

    const axis = estimateLocalCylinderAxis(faceCenters[i], faceNormals[i], neighbors);
    if (!axis) continue;

    // Region grow: faces with consistent cylindrical geometry
    const patch = [i];
    const patchSet = new Set([i]);
    const queue = [i];

    while (queue.length > 0) {
      const cur = queue.shift();
      const curNeighbors = getNeighbors(cur);
      for (const nb of curNeighbors) {
        if (patchSet.has(nb.index)) continue;
        const nbAxis = estimateLocalCylinderAxis(faceCenters[nb.index], faceNormals[nb.index], getNeighbors(nb.index));
        if (!nbAxis) continue;
        // Axes should be parallel
        if (Math.abs(v3dot(axis, nbAxis)) < 0.85) continue;
        // Normals should be roughly perpendicular to axis (cylindrical wall)
        if (Math.abs(v3dot(faceNormals[nb.index], axis)) > 0.4) continue;
        patch.push(nb.index);
        patchSet.add(nb.index);
        queue.push(nb.index);
      }
    }

    if (patch.length < 6) continue;

    // Mark used
    for (const idx of patch) used[idx] = 1;

    // Collect patch points and fit cylinder
    const patchCenters = patch.map((idx) => faceCenters[idx]);
    const patchNormals = patch.map((idx) => faceNormals[idx]);

    // Find axis line: average of cross products
    let axisAcc = [0, 0, 0];
    let axisPoint = [0, 0, 0];
    for (const c of patchCenters) axisPoint = v3add(axisPoint, c);
    axisPoint = v3scale(axisPoint, 1 / patchCenters.length);

    for (let pi = 0; pi < patchCenters.length; pi++) {
      const radial = v3sub(patchCenters[pi], axisPoint);
      const proj = v3dot(radial, axis);
      const radialPlane = v3sub(radial, v3scale(axis, proj));
      const rLen = v3len(radialPlane);
      if (rLen < 1e-6) continue;
      const rNorm = v3scale(radialPlane, 1 / rLen);
      const localAxis = v3cross(patchNormals[pi], rNorm);
      const aLen = v3len(localAxis);
      if (aLen > 1e-6) {
        const a = v3scale(localAxis, 1 / aLen);
        axisAcc = v3add(axisAcc, v3dot(a, axisAcc) < 0 && v3len(axisAcc) > 1e-6 ? v3scale(a, -1) : a);
      }
    }

    const holeAxis = v3len(axisAcc) > 1e-6 ? v3norm(axisAcc) : axis;

    // Project patch centers to plane perpendicular to axis for circle fit
    const basis = planeBasis(holeAxis);
    const points2d = patchCenters.map((c) => projectToPlane2D(c, axisPoint, basis));

    const fit = fitCircleToPoints(points2d, options.method, options.ransacIterations);
    if (!fit || fit.radius < minRadius || fit.radius > maxRadius) continue;

    const quality = computeFitQuality(fit, points2d);
    if (quality < 0.3) continue;

    const center3d = plane2DTo3D(fit.cx, fit.cy, axisPoint, basis);

    candidates.push({
      center: center3d,
      axis: holeAxis,
      radius: fit.radius,
      diameter: fit.radius * 2,
      quality,
      rms: fit.rms,
      patchIndices: patch,
      faceKeys: patch.map((idx) => faceKeys[idx]),
      fitMethod: options.method
    });
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
    for (const p of pts) origin[0] += p[0]; origin[1] += p[1]; origin[2] += p[2];
    origin[0] /= pts.length; origin[1] /= pts.length; origin[2] /= pts.length;

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
  // Power iteration for smallest eigenvector
  let v = [1, 0, 0];
  for (let iter = 0; iter < 20; iter++) {
    const nv = [
      cxx * v[0] + cxy * v[1] + cxz * v[2],
      cxy * v[0] + cyy * v[1] + cyz * v[2],
      cxz * v[0] + cyz * v[1] + czz * v[2]
    ];
    const len = v3len(nv);
    if (len < 1e-12) return [0, 0, 1];
    v = v3scale(nv, 1 / len);
  }
  return v3norm(v);
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

    // Average group properties
    const best = group.reduce((a, b) => (a.quality > b.quality ? a : b));
    if (group.length > 1) {
      let cx = 0, cy = 0, cz = 0, rSum = 0, qSum = 0;
      for (const h of group) {
        cx += h.center[0]; cy += h.center[1]; cz += h.center[2];
        rSum += h.radius;
        qSum += h.quality;
      }
      best.center = [cx / group.length, cy / group.length, cz / group.length];
      best.radius = rSum / group.length;
      best.diameter = best.radius * 2;
      best.quality = qSum / group.length;
    }
    merged.push(best);
  }

  return merged;
}

function holesAreSame(a, b, tolerance) {
  const centerDist = v3len(v3sub(a.center, b.center));
  const radiusDiff = Math.abs(a.radius - b.radius);
  const axisDot = Math.abs(v3dot(v3norm(a.axis), v3norm(b.axis)));
  return centerDist < tolerance && radiusDiff < tolerance * 0.5 && axisDot > 0.9;
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
  const patchHoles = detectCylindricalPatches(faceCenters, faceNormals, faceKeys, opts);

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
