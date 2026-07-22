/**
 * Slicing-based (2.5D) pocket detection — Body 2 only.
 * Sections along one machining axis and tracks inner contour loops.
 */

function normalize(a) {
  const L = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / L, a[1] / L, a[2] / L];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dist2(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.hypot(dx, dy);
}

function polygonArea2d(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return Math.abs(a) * 0.5;
}

function polygonCentroid2d(pts) {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const crossZ = pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
    a += crossZ;
    cx += (pts[i][0] + pts[j][0]) * crossZ;
    cy += (pts[i][1] + pts[j][1]) * crossZ;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-12) {
    let sx = 0;
    let sy = 0;
    for (const p of pts) {
      sx += p[0];
      sy += p[1];
    }
    return [sx / pts.length, sy / pts.length];
  }
  return [cx / (6 * a), cy / (6 * a)];
}

function polygonPerimeter2d(pts) {
  let p = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    p += dist2(pts[i], pts[j]);
  }
  return p;
}

function countSignificantCorners(pts, angleThresholdDeg = 20) {
  if (pts.length < 3) return 0;
  const thr = (angleThresholdDeg * Math.PI) / 180;
  let corners = 0;
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[(i - 1 + pts.length) % pts.length];
    const cur = pts[i];
    const next = pts[(i + 1) % pts.length];
    const e1 = [cur[0] - prev[0], cur[1] - prev[1]];
    const e2 = [next[0] - cur[0], next[1] - cur[1]];
    const l1 = Math.hypot(e1[0], e1[1]) || 1;
    const l2 = Math.hypot(e2[0], e2[1]) || 1;
    const cos = (e1[0] * e2[0] + e1[1] * e2[1]) / (l1 * l2);
    const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
    if (ang > thr) corners++;
  }
  return corners;
}

function classifyContourShape(loop2d) {
  const area = polygonArea2d(loop2d);
  const perimeter = polygonPerimeter2d(loop2d);
  if (perimeter <= 0 || area <= 0) return 'irregular';
  const circularity = (4 * Math.PI * area) / (perimeter * perimeter);
  if (circularity > 0.9) return 'circular';
  const corners = countSignificantCorners(loop2d, 20);
  if (corners === 4) return 'rectangular';
  if (corners === 2 && circularity > 0.5) return 'slot';
  return 'irregular';
}

function orthonormalBasis(axis) {
  const z = normalize(axis);
  const tmp = Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const x = normalize(cross(tmp, z));
  const y = cross(z, x);
  return { x, y, z };
}

function projectToPlane(pt, origin, basis) {
  const d = [pt[0] - origin[0], pt[1] - origin[1], pt[2] - origin[2]];
  return [dot(d, basis.x), dot(d, basis.y)];
}

function axisPoint(axis, t, origin = [0, 0, 0]) {
  const a = normalize(axis);
  return [origin[0] + a[0] * t, origin[1] + a[1] * t, origin[2] + a[2] * t];
}

function pickSlicingAxis(occt, body2Shape, override) {
  if (override === 'x') return [1, 0, 0];
  if (override === 'y') return [0, 1, 0];
  if (override === 'z') return [0, 0, 1];

  const faces = occt.getSubShapes(body2Shape, 'face');
  let best = null;
  let bestArea = -1;
  for (const f of faces) {
    try {
      if (occt.surfaceType(f) !== 'plane') continue;
      const area = Math.abs(occt.getSurfaceArea(f));
      if (area > bestArea) {
        bestArea = area;
        const uv = occt.uvBounds(f);
        const n = occt.surfaceNormal(f, (uv.uMin + uv.uMax) / 2, (uv.vMin + uv.vMax) / 2);
        best = normalize([n.x, n.y, n.z]);
      }
    } catch {
      /* skip */
    }
  }
  return best ?? [0, 0, 1];
}

function extentAlongAxis(bbox, axis) {
  const a = normalize(axis);
  const corners = [
    [bbox.xmin, bbox.ymin, bbox.zmin],
    [bbox.xmax, bbox.ymin, bbox.zmin],
    [bbox.xmin, bbox.ymax, bbox.zmin],
    [bbox.xmax, bbox.ymax, bbox.zmin],
    [bbox.xmin, bbox.ymin, bbox.zmax],
    [bbox.xmax, bbox.ymin, bbox.zmax],
    [bbox.xmin, bbox.ymax, bbox.zmax],
    [bbox.xmax, bbox.ymax, bbox.zmax]
  ];
  let minP = Infinity;
  let maxP = -Infinity;
  for (const c of corners) {
    const p = dot(c, a);
    if (p < minP) minP = p;
    if (p > maxP) maxP = p;
  }
  return { min: minP, max: maxP };
}

/**
 * Section Body 2 with a plane and extract closed 2D loops.
 */
function sliceContoursAt(occt, body2Shape, axis, origin) {
  const n = normalize(axis);
  const plane = occt.halfSpace(
    { x: origin[0], y: origin[1], z: origin[2] },
    { x: n[0], y: n[1], z: n[2] }
  );
  let section;
  try {
    section = occt.section(body2Shape, plane);
  } catch {
    return [];
  }
  if (occt.isNull(section)) return [];

  const basis = orthonormalBasis(n);
  const wires = occt.getSubShapes(section, 'wire');
  const edgeSets = wires.length ? wires : occt.getSubShapes(section, 'edge');

  const loops = [];
  for (const w of edgeSets) {
    try {
      const edges = occt.getSubShapes(w, 'edge');
      const list = edges.length ? edges : [w];
      const pts3 = [];
      for (const e of list) {
        const verts = occt.getSubShapes(e, 'vertex');
        for (const v of verts) {
          const p = occt.vertexPosition(v);
          pts3.push([p.x, p.y, p.z]);
        }
      }
      // Deduplicate consecutive
      const uniq = [];
      for (const p of pts3) {
        const last = uniq[uniq.length - 1];
        if (!last || Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) > 1e-6) {
          uniq.push(p);
        }
      }
      if (uniq.length < 3) continue;
      const pts2 = uniq.map((p) => projectToPlane(p, origin, basis));
      const area = polygonArea2d(pts2);
      if (area < 1e-6) continue;
      loops.push({
        points: pts2,
        area,
        centroid: polygonCentroid2d(pts2)
      });
    } catch {
      /* skip wire */
    }
  }

  loops.sort((a, b) => b.area - a.area);
  return loops.map((loop, i) => ({ ...loop, isOuter: i === 0 }));
}

function trackLoopsAcrossSlices(sliceResults, minContourArea) {
  const tracks = [];
  sliceResults.forEach((slice, sliceIdx) => {
    const innerLoops = slice.loops.filter((l) => !l.isOuter && l.area >= minContourArea);
    for (const loop of innerLoops) {
      const candidate = tracks.find(
        (t) =>
          t.lastSliceIdx === sliceIdx - 1 &&
          dist2(t.lastCentroid, loop.centroid) < Math.sqrt(loop.area) * 0.5
      );
      if (candidate) {
        candidate.samples.push({ sliceIdx, z: slice.z, area: loop.area, loop });
        candidate.lastSliceIdx = sliceIdx;
        candidate.lastCentroid = loop.centroid;
      } else {
        tracks.push({
          samples: [{ sliceIdx, z: slice.z, area: loop.area, loop }],
          lastSliceIdx: sliceIdx,
          lastCentroid: loop.centroid,
          startedAtTop: sliceIdx === 0
        });
      }
    }
  });
  return tracks;
}

function refineFloorZ(occt, body2Shape, axis, origin0, lastPresentZ, firstAbsentZ, minContourArea, iterations = 6) {
  let lo = lastPresentZ;
  let hi = firstAbsentZ;
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    const origin = axisPoint(axis, mid, origin0);
    const loops = sliceContoursAt(occt, body2Shape, axis, origin);
    const stillPresent = loops.some((l) => !l.isOuter && l.area >= minContourArea);
    if (stillPresent) lo = mid;
    else hi = mid;
  }
  return lo;
}

function approximatePlugMesh(axis, topZ, floorZ, loop2d, origin0) {
  // Simple extruded prism from the top contour — visualization only
  if (!loop2d?.length) return null;
  const basis = orthonormalBasis(axis);
  const depth = Math.abs(topZ - floorZ);
  if (depth < 1e-6) return null;

  const ring = loop2d.map((p2) => {
    const p = [
      origin0[0] + basis.x[0] * p2[0] + basis.y[0] * p2[1] + basis.z[0] * topZ,
      origin0[1] + basis.x[1] * p2[0] + basis.y[1] * p2[1] + basis.z[1] * topZ,
      origin0[2] + basis.x[2] * p2[0] + basis.y[2] * p2[1] + basis.z[2] * topZ
    ];
    return p;
  });
  const bottom = ring.map((p) => [
    p[0] - basis.z[0] * depth,
    p[1] - basis.z[1] * depth,
    p[2] - basis.z[2] * depth
  ]);

  const positions = [];
  const indices = [];
  const n = ring.length;
  for (const p of ring) positions.push(p[0], p[1], p[2]);
  for (const p of bottom) positions.push(p[0], p[1], p[2]);
  // top fan
  for (let i = 1; i < n - 1; i++) indices.push(0, i, i + 1);
  // bottom fan (reversed)
  for (let i = 1; i < n - 1; i++) indices.push(n, n + i + 1, n + i);
  // walls
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(i, j, n + j, i, n + j, n + i);
  }
  return { positions, indices };
}

/**
 * @param {object} occt
 * @param {number} body2Shape
 * @param {{ axisOverride?:string, sliceStep?:number, minContourArea?:number }} params
 */
export function detectPocketsBySlicing(occt, body2Shape, params = {}, onProgress = null) {
  const report = (message, percent) => {
    if (typeof onProgress === 'function') onProgress({ message, percent });
  };

  const axisOverride = params.axisOverride ?? 'auto';
  const sliceStep = Math.max(0.05, params.sliceStep ?? 0.5);
  const minContourArea = params.minContourArea ?? 1;

  report('Picking slicing axis…', 15);
  const axis = pickSlicingAxis(occt, body2Shape, axisOverride);
  const bbox = occt.getBoundingBox(body2Shape, true);
  const extent = extentAlongAxis(bbox, axis);
  const origin0 = [0, 0, 0];

  const zSamples = [];
  for (let z = extent.max; z >= extent.min; z -= sliceStep) zSamples.push(z);
  if (zSamples[zSamples.length - 1] !== extent.min) zSamples.push(extent.min);

  report(`Sectioning ${zSamples.length} slice(s)…`, 25);
  const sliceResults = zSamples.map((z, i) => {
    if (i % 5 === 0) report(`Slice ${i + 1} / ${zSamples.length}…`, 25 + Math.round((i / zSamples.length) * 50));
    const origin = axisPoint(axis, z, origin0);
    return { z, loops: sliceContoursAt(occt, body2Shape, axis, origin) };
  });

  report('Tracking contours across slices…', 80);
  const tracks = trackLoopsAcrossSlices(sliceResults, minContourArea);

  return tracks.map((track, ti) => {
    const samples = track.samples.slice().sort((a, b) => b.z - a.z);
    const topZ = samples[0].z;
    const lastPresentZ = samples[samples.length - 1].z;
    const reachedBottom = lastPresentZ <= extent.min + sliceStep;

    const floorZ = reachedBottom
      ? extent.min
      : refineFloorZ(
          occt,
          body2Shape,
          axis,
          origin0,
          lastPresentZ,
          lastPresentZ - sliceStep,
          minContourArea
        );

    let volume = 0;
    for (let i = 0; i < samples.length - 1; i++) {
      volume +=
        ((samples[i].area + samples[i + 1].area) / 2) * Math.abs(samples[i].z - samples[i + 1].z);
    }
    if (!reachedBottom) {
      volume += samples[samples.length - 1].area * Math.abs(lastPresentZ - floorZ) * 0.5;
    }

    const topLoop = samples[0].loop.points;
    const shape = classifyContourShape(topLoop);
    const c2 = samples[0].loop.centroid;
    const basis = orthonormalBasis(axis);
    const center3 = [
      origin0[0] + basis.x[0] * c2[0] + basis.y[0] * c2[1] + basis.z[0] * ((topZ + floorZ) / 2),
      origin0[1] + basis.x[1] * c2[0] + basis.y[1] * c2[1] + basis.z[1] * ((topZ + floorZ) / 2),
      origin0[2] + basis.x[2] * c2[0] + basis.y[2] * c2[1] + basis.z[2] * ((topZ + floorZ) / 2)
    ];

    // Footprint size from bounding box of top loop
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of topLoop) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    const width = maxX - minX;
    const length = maxY - minY;

    return {
      id: `slice-${ti}-${Math.round(c2[0])}-${Math.round(c2[1])}`,
      volume,
      maxBoundedVolume: volume,
      maxDepth: Math.abs(topZ - floorZ),
      depth: Math.abs(topZ - floorZ),
      toolAxis: axis,
      axis,
      accessType: reachedBottom ? 'through' : 'single-axis',
      shape,
      isFullyEnclosed: false,
      isThrough: reachedBottom,
      flagged: track.startedAtTop ? null : 'sub-surface-cavity',
      detectionMethod: 'slicing',
      faceIndices: null,
      wallSurfaceArea: null,
      minCornerRadius: null,
      maxBoundedSize:
        shape === 'circular'
          ? { diameter: Math.max(width, length), width: null, length: null }
          : { width, length, diameter: null },
      center: center3,
      plugMesh: approximatePlugMesh(axis, topZ, floorZ, topLoop, origin0)
    };
  });
}
