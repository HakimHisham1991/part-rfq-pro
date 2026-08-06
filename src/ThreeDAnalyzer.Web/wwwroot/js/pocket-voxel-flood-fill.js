/**
 * Voxelize + flood-fill pocket detection — Body 2 only.
 * Rasterizes the solid, flood-fills exterior empty voxels, keeps unreachable
 * empty components as enclosed cavities (blocky mesh approximation).
 */

const GRID_EMPTY = 0;
const GRID_SOLID = 1;
const GRID_EXTERIOR = 2;

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function pointInTriangle(p, a, b, c) {
  const v0 = sub(c, a);
  const v1 = sub(b, a);
  const v2 = sub(p, a);
  const dot00 = dot(v0, v0);
  const dot01 = dot(v0, v1);
  const dot02 = dot(v0, v2);
  const dot11 = dot(v1, v1);
  const dot12 = dot(v1, v2);
  const denom = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denom) < 1e-18) return false;
  const inv = 1 / denom;
  const u = (dot11 * dot02 - dot01 * dot12) * inv;
  const v = (dot00 * dot12 - dot01 * dot02) * inv;
  return u >= -1e-9 && v >= -1e-9 && u + v <= 1 + 1e-9;
}

/** Intersection X on triangle plane for fixed (y, z). */
function xOnTriangleAtYZ(v0, v1, v2, y, z) {
  const e1 = sub(v1, v0);
  const e2 = sub(v2, v0);
  const n = cross(e1, e2);
  if (Math.abs(n[0]) < 1e-12) return null;
  const x = v0[0] - (n[1] * (y - v0[1]) + n[2] * (z - v0[2])) / n[0];
  const p = [x, y, z];
  if (!pointInTriangle(p, v0, v1, v2)) return null;
  return x;
}

function parseTriangles(positions, indices) {
  const tris = [];
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const i0 = indices[i];
    const i1 = indices[i + 1];
    const i2 = indices[i + 2];
    tris.push([
      [positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]],
      [positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]],
      [positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]]
    ]);
  }
  return tris;
}

function gridIndex(ix, iy, iz, nx, ny) {
  return ix + iy * nx + iz * nx * ny;
}

function computeGridDims(bb, padding, voxelSize) {
  const spanX = bb.xmax - bb.xmin + 2 * padding;
  const spanY = bb.ymax - bb.ymin + 2 * padding;
  const spanZ = bb.zmax - bb.zmin + 2 * padding;
  const nx = Math.max(2, Math.ceil(spanX / voxelSize));
  const ny = Math.max(2, Math.ceil(spanY / voxelSize));
  const nz = Math.max(2, Math.ceil(spanZ / voxelSize));
  return { nx, ny, nz, originX: bb.xmin - padding, originY: bb.ymin - padding, originZ: bb.zmin - padding };
}

function classifyGridMeshParity(grid, nx, ny, nz, originX, originY, originZ, voxelSize, triangles, report) {
  const totalCols = ny * nz;
  let col = 0;
  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      const y = originY + (iy + 0.5) * voxelSize;
      const z = originZ + (iz + 0.5) * voxelSize;
      const xs = [];
      for (const [v0, v1, v2] of triangles) {
        const ymin = Math.min(v0[1], v1[1], v2[1]);
        const ymax = Math.max(v0[1], v1[1], v2[1]);
        const zmin = Math.min(v0[2], v1[2], v2[2]);
        const zmax = Math.max(v0[2], v1[2], v2[2]);
        if (y < ymin - voxelSize || y > ymax + voxelSize) continue;
        if (z < zmin - voxelSize || z > zmax + voxelSize) continue;
        const xHit = xOnTriangleAtYZ(v0, v1, v2, y, z);
        if (xHit != null) xs.push(xHit);
      }
      xs.sort((a, b) => a - b);

      for (let ix = 0; ix < nx; ix++) {
        const x = originX + (ix + 0.5) * voxelSize;
        let crossings = 0;
        for (const xi of xs) {
          if (x > xi) crossings++;
        }
        if (crossings % 2 === 1) {
          grid[gridIndex(ix, iy, iz, nx, ny)] = GRID_SOLID;
        }
      }

      col++;
      if (col % 200 === 0) {
        report(`Mesh parity columns ${col}/${totalCols}…`, 15 + Math.round((col / totalCols) * 35));
      }
    }
  }
}

function classifyGridContainsPoint(
  occt,
  body2Shape,
  grid,
  nx,
  ny,
  nz,
  originX,
  originY,
  originZ,
  voxelSize,
  bodyBb,
  tolerance,
  report
) {
  const total = nx * ny * nz;
  let done = 0;
  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const x = originX + (ix + 0.5) * voxelSize;
        const y = originY + (iy + 0.5) * voxelSize;
        const z = originZ + (iz + 0.5) * voxelSize;
        if (
          x < bodyBb.xmin ||
          x > bodyBb.xmax ||
          y < bodyBb.ymin ||
          y > bodyBb.ymax ||
          z < bodyBb.zmin ||
          z > bodyBb.zmax
        ) {
          grid[gridIndex(ix, iy, iz, nx, ny)] = GRID_EMPTY;
        } else {
          try {
            const inside = occt.containsPoint(body2Shape, { x, y, z }, tolerance);
            grid[gridIndex(ix, iy, iz, nx, ny)] = inside ? GRID_SOLID : GRID_EMPTY;
          } catch {
            grid[gridIndex(ix, iy, iz, nx, ny)] = GRID_EMPTY;
          }
        }
        done++;
        if (done % 2000 === 0) {
          report(`B-Rep point test ${done}/${total}…`, 15 + Math.round((done / total) * 35));
        }
      }
    }
  }
}

function floodExterior(grid, nx, ny, nz) {
  const stack = [[0, 0, 0]];
  const visited = new Uint8Array(nx * ny * nz);
  const push = (ix, iy, iz) => {
    if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) return;
    const idx = gridIndex(ix, iy, iz, nx, ny);
    if (visited[idx]) return;
    if (grid[idx] !== GRID_EMPTY) return;
    visited[idx] = 1;
    stack.push([ix, iy, iz]);
  };

  while (stack.length) {
    const [ix, iy, iz] = stack.pop();
    const idx = gridIndex(ix, iy, iz, nx, ny);
    grid[idx] = GRID_EXTERIOR;
    push(ix + 1, iy, iz);
    push(ix - 1, iy, iz);
    push(ix, iy + 1, iz);
    push(ix, iy - 1, iz);
    push(ix, iy, iz + 1);
    push(ix, iy, iz - 1);
  }
}

function labelCavityComponents(grid, nx, ny, nz) {
  const labels = new Int32Array(nx * ny * nz);
  let nextLabel = 1;
  const dirs = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1]
  ];

  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const idx = gridIndex(ix, iy, iz, nx, ny);
        if (grid[idx] !== GRID_EMPTY || labels[idx] !== 0) continue;

        const label = nextLabel++;
        const stack = [[ix, iy, iz]];
        labels[idx] = label;

        while (stack.length) {
          const [cx, cy, cz] = stack.pop();
          for (const [dx, dy, dz] of dirs) {
            const nx2 = cx + dx;
            const ny2 = cy + dy;
            const nz2 = cz + dz;
            if (nx2 < 0 || ny2 < 0 || nz2 < 0 || nx2 >= nx || ny2 >= ny || nz2 >= nz) continue;
            const nidx = gridIndex(nx2, ny2, nz2, nx, ny);
            if (grid[nidx] !== GRID_EMPTY || labels[nidx] !== 0) continue;
            labels[nidx] = label;
            stack.push([nx2, ny2, nz2]);
          }
        }
      }
    }
  }
  return labels;
}

function componentTouchesExterior(labels, grid, nx, ny, nz, label) {
  const dirs = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1]
  ];
  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const idx = gridIndex(ix, iy, iz, nx, ny);
        if (labels[idx] !== label) continue;
        if (ix === 0 || iy === 0 || iz === 0 || ix === nx - 1 || iy === ny - 1 || iz === nz - 1) {
          return true;
        }
        for (const [dx, dy, dz] of dirs) {
          const nidx = gridIndex(ix + dx, iy + dy, iz + dz, nx, ny);
          if (grid[nidx] === GRID_EXTERIOR) return true;
        }
      }
    }
  }
  return false;
}

function pushFace(positions, indices, a, b, c, d) {
  const base = positions.length / 3;
  positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2]);
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** Emit boundary faces only (no internal faces between voxels in the same component). */
function buildVoxelClusterMesh(voxels, originX, originY, originZ, voxelSize, labelSet) {
  const positions = [];
  const indices = [];
  const has = (ix, iy, iz) => labelSet.has(`${ix},${iy},${iz}`);

  for (const [ix, iy, iz] of voxels) {
    const x0 = originX + ix * voxelSize;
    const y0 = originY + iy * voxelSize;
    const z0 = originZ + iz * voxelSize;
    const x1 = x0 + voxelSize;
    const y1 = y0 + voxelSize;
    const z1 = z0 + voxelSize;

    if (!has(ix + 1, iy, iz)) {
      pushFace(
        positions,
        indices,
        [x1, y0, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x1, y0, z1]
      );
    }
    if (!has(ix - 1, iy, iz)) {
      pushFace(
        positions,
        indices,
        [x0, y0, z1],
        [x0, y1, z1],
        [x0, y1, z0],
        [x0, y0, z0]
      );
    }
    if (!has(ix, iy + 1, iz)) {
      pushFace(
        positions,
        indices,
        [x0, y1, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x0, y1, z1]
      );
    }
    if (!has(ix, iy - 1, iz)) {
      pushFace(
        positions,
        indices,
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y0, z0],
        [x0, y0, z0]
      );
    }
    if (!has(ix, iy, iz + 1)) {
      pushFace(
        positions,
        indices,
        [x0, y0, z1],
        [x0, y1, z1],
        [x1, y1, z1],
        [x1, y0, z1]
      );
    }
    if (!has(ix, iy, iz - 1)) {
      pushFace(
        positions,
        indices,
        [x1, y0, z0],
        [x1, y1, z0],
        [x0, y1, z0],
        [x0, y0, z0]
      );
    }
  }

  return { positions, indices };
}

function pocketFromVoxelComponent(voxels, originX, originY, originZ, voxelSize, label, id, enclosed) {
  const voxelVol = voxelSize ** 3;
  const count = voxels.length;
  const volume = count * voxelVol;

  let minIx = Infinity;
  let minIy = Infinity;
  let minIz = Infinity;
  let maxIx = -Infinity;
  let maxIy = -Infinity;
  let maxIz = -Infinity;
  let cx = 0;
  let cy = 0;
  let cz = 0;

  const labelSet = new Set();
  for (const [ix, iy, iz] of voxels) {
    labelSet.add(`${ix},${iy},${iz}`);
    minIx = Math.min(minIx, ix);
    minIy = Math.min(minIy, iy);
    minIz = Math.min(minIz, iz);
    maxIx = Math.max(maxIx, ix);
    maxIy = Math.max(maxIy, iy);
    maxIz = Math.max(maxIz, iz);
    cx += originX + (ix + 0.5) * voxelSize;
    cy += originY + (iy + 0.5) * voxelSize;
    cz += originZ + (iz + 0.5) * voxelSize;
  }
  cx /= count;
  cy /= count;
  cz /= count;

  const dx = (maxIx - minIx + 1) * voxelSize;
  const dy = (maxIy - minIy + 1) * voxelSize;
  const dz = (maxIz - minIz + 1) * voxelSize;
  const sorted = [dx, dy, dz].sort((a, b) => a - b);

  let toolAxis = [0, 0, 1];
  if (dx <= dy && dx <= dz) toolAxis = [1, 0, 0];
  else if (dy <= dx && dy <= dz) toolAxis = [0, 1, 0];

  const plugMesh = buildVoxelClusterMesh(voxels, originX, originY, originZ, voxelSize, labelSet);
  if (!plugMesh.positions.length) return null;

  return {
    id,
    volume,
    maxBoundedVolume: volume,
    maxDepth: sorted[2],
    depth: sorted[2],
    toolAxis,
    axis: toolAxis,
    accessType: 'single-axis',
    accessAxes: [toolAxis],
    shape: null,
    isFullyEnclosed: enclosed,
    isThrough: false,
    flagged: 'voxel-approximate',
    detectionMethod: 'voxel-flood-fill',
    faceIndices: null,
    wallSurfaceArea: null,
    minCornerRadius: null,
    maxBoundedSize: { width: sorted[1], length: sorted[2], diameter: null },
    center: [cx, cy, cz],
    plugMesh,
    dims: { dx, dy, dz }
  };
}

/**
 * @param {object} occt
 * @param {number} body2Shape
 * @param {{ voxelSize?:number, paddingMm?:number, minVolume?:number, classifyBy?:string, maxVoxelCount?:number, tolerance?:number }} params
 */
export function detectPocketsByVoxelFloodFill(occt, body2Shape, params = {}, onProgress = null) {
  const report = (message, percent) => {
    if (typeof onProgress === 'function') onProgress({ message, percent });
  };

  let voxelSize = Math.max(params.voxelSize ?? 1.0, 0.05);
  const padding = params.paddingMm ?? voxelSize * 2;
  const minVolume = params.minVolume ?? 1;
  let classifyBy = params.classifyBy ?? 'meshParity';
  const maxVoxels = params.maxVoxelCount ?? 500_000;
  const tolerance = params.tolerance ?? 1e-3;

  const bb = occt.getBoundingBox(body2Shape, true);
  const bodyBb = occt.getBoundingBox(body2Shape, true);

  let { nx, ny, nz, originX, originY, originZ } = computeGridDims(bb, padding, voxelSize);
  let total = nx * ny * nz;
  if (total > maxVoxels) {
    const scale = Math.cbrt(total / maxVoxels);
    voxelSize *= scale;
    ({ nx, ny, nz, originX, originY, originZ } = computeGridDims(bb, padding, voxelSize));
    total = nx * ny * nz;
    report(
      `Grid would exceed ${maxVoxels} voxels — auto-coarsened to ${voxelSize.toFixed(2)} mm (${total} cells)`,
      8
    );
  } else {
    report(`Voxel grid ${nx}×${ny}×${nz} (${total} cells, ${voxelSize.toFixed(2)} mm)…`, 8);
  }

  const grid = new Uint8Array(nx * ny * nz);

  const runClassification = (mode) => {
    grid.fill(GRID_EMPTY);
    if (mode === 'containsPoint') {
      report('Classifying voxels (exact B-Rep point test)…', 12);
      classifyGridContainsPoint(
        occt,
        body2Shape,
        grid,
        nx,
        ny,
        nz,
        originX,
        originY,
        originZ,
        voxelSize,
        bodyBb,
        tolerance,
        report
      );
      return;
    }
    report('Tessellating Body 2 for mesh parity…', 10);
    const mesh = occt.tessellate(body2Shape, { linearDeflection: 0.15, angularDeflection: 0.35 });
    const positions =
      mesh.positions instanceof Float32Array ? mesh.positions : new Float32Array(mesh.positions);
    const indices =
      mesh.indices instanceof Uint32Array ? mesh.indices : new Uint32Array(mesh.indices);
    const triangles = parseTriangles(positions, indices);
    report(`Mesh parity classification (${triangles.length} triangles)…`, 12);
    classifyGridMeshParity(
      grid,
      nx,
      ny,
      nz,
      originX,
      originY,
      originZ,
      voxelSize,
      triangles,
      report
    );
  };

  runClassification(classifyBy);

  let solidCount = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === GRID_SOLID) solidCount++;
  }
  const solidRatio = solidCount / grid.length;
  if (classifyBy === 'meshParity' && solidRatio > 0.9) {
    report('Mesh parity >90% solid — retrying with exact B-Rep point test…', 52);
    classifyBy = 'containsPoint';
    runClassification('containsPoint');
    solidCount = 0;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] === GRID_SOLID) solidCount++;
    }
  }

  report('Flood-filling exterior empty voxels…', 55);
  floodExterior(grid, nx, ny, nz);

  report('Labeling enclosed cavity components…', 62);
  const labels = labelCavityComponents(grid, nx, ny, nz);

  const byLabel = new Map();
  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const idx = gridIndex(ix, iy, iz, nx, ny);
        if (grid[idx] !== GRID_EMPTY) continue;
        const label = labels[idx];
        if (!label) continue;
        let list = byLabel.get(label);
        if (!list) {
          list = [];
          byLabel.set(label, list);
        }
        list.push([ix, iy, iz]);
      }
    }
  }

  const voxelVol = voxelSize ** 3;
  const pockets = [];
  let pocketIdx = 0;

  report(`Building meshes for ${byLabel.size} cavity component(s)…`, 72);
  for (const [label, voxels] of byLabel) {
    const volume = voxels.length * voxelVol;
    if (volume < minVolume) continue;

    const enclosed = !componentTouchesExterior(labels, grid, nx, ny, nz, label);
    const pocket = pocketFromVoxelComponent(
      voxels,
      originX,
      originY,
      originZ,
      voxelSize,
      label,
      `voxel-${pocketIdx++}`,
      enclosed
    );
    if (pocket) pockets.push(pocket);
  }

  pockets.sort((a, b) => b.volume - a.volume);
  report(`Found ${pockets.length} enclosed cavity volume(s)`, 100);
  return pockets;
}
