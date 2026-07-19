import * as THREE from '/lib/three.module.min.js';

let occtInstancePromise = null;

/** Prefer B-Rep AAG recognition; fall back to mesh curvature on failure. */
export const USE_BREP_FEATURE_RECOGNITION = true;

async function loadOcctLibrary() {
  if (occtInstancePromise) return occtInstancePromise;

  const moduleOptions = {
    locateFile: (path) => `/lib/${path}`
  };

  // Lazy OCCT/WASM — only when analyzeStepFile runs (saves mobile memory at idle)
  occtInstancePromise = (async () => {
    try {
      const initFn =
        typeof globalThis.occtimportjs === 'function' ? globalThis.occtimportjs : null;

      if (initFn) {
        return initFn(moduleOptions);
      }

      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/lib/occt-import-js.js';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load occt-import-js.js'));
        document.head.appendChild(script);
      });

      if (typeof globalThis.occtimportjs !== 'function') {
        throw new Error('occt-import-js initializer not available');
      }

      return globalThis.occtimportjs(moduleOptions);
    } catch (err) {
      occtInstancePromise = null; // allow retry after OOM / network failure
      throw err;
    }
  })();

  return occtInstancePromise;
}

function computeMeshVolume(positions, indices) {
  let total = 0;
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const cross = new THREE.Vector3();
  const triCount = indices ? indices.length / 3 : positions.length / 9;

  for (let t = 0; t < triCount; t++) {
    let i0;
    let i1;
    let i2;
    if (indices) {
      i0 = indices[t * 3];
      i1 = indices[t * 3 + 1];
      i2 = indices[t * 3 + 2];
    } else {
      i0 = t * 3;
      i1 = t * 3 + 1;
      i2 = t * 3 + 2;
    }
    v0.set(positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]);
    v1.set(positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]);
    v2.set(positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]);
    cross.crossVectors(v1, v2);
    total += v0.dot(cross) / 6;
  }
  return Math.abs(total);
}

function computePartVolume(group) {
  let total = 0;
  group.traverse((child) => {
    if (child.isMesh && child.geometry) {
      const pos = child.geometry.attributes.position.array;
      const idx = child.geometry.index ? child.geometry.index.array : null;
      total += computeMeshVolume(pos, idx);
    }
  });
  return total;
}

function computeBoundingBox(group) {
  const box = new THREE.Box3().setFromObject(group);
  const min = box.min;
  const max = box.max;
  const w = max.x - min.x;
  const h = max.y - min.y;
  const d = max.z - min.z;
  return {
    box: { min: min.clone(), max: max.clone() },
    w,
    h,
    d
  };
}

function normalizeOffsets(stockOffsets = {}) {
  return {
    px: Number(stockOffsets.px) || 0,
    nx: Number(stockOffsets.nx) || 0,
    py: Number(stockOffsets.py) || 0,
    ny: Number(stockOffsets.ny) || 0,
    pz: Number(stockOffsets.pz) || 0,
    nz: Number(stockOffsets.nz) || 0
  };
}

function computeStockVolume(box, offsets) {
  const min = box.min.clone();
  const max = box.max.clone();
  min.x -= offsets.nx;
  max.x += offsets.px;
  min.y -= offsets.ny;
  max.y += offsets.py;
  min.z -= offsets.nz;
  max.z += offsets.pz;
  const w = max.x - min.x;
  const h = max.y - min.y;
  const d = max.z - min.z;
  return { volume: w * h * d, w, h, d };
}

function disposeGroup(group) {
  group.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  });
}

function buildGroupFromMeshes(meshes) {
  const group = new THREE.Group();
  for (const meshData of meshes) {
    const geometry = new THREE.BufferGeometry();
    const rawPos = meshData.attributes.position.array;
    const posArr = rawPos instanceof Float32Array ? rawPos : new Float32Array(rawPos);
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(posArr, meshData.attributes.position.itemSize || 3)
    );
    if (meshData.index?.array) {
      const rawIdx = meshData.index.array;
      const idxArr = rawIdx instanceof Uint32Array ? rawIdx : new Uint32Array(rawIdx);
      geometry.setIndex(new THREE.BufferAttribute(idxArr, 1));
    }
    geometry.computeVertexNormals();
    const material = new THREE.MeshBasicMaterial();
    group.add(new THREE.Mesh(geometry, material));
  }
  return group;
}

/**
 * Parse a STEP/STP buffer and return bounding-box and volume metrics.
 * @param {ArrayBuffer} arrayBuffer
 * @param {object} [stockOffsets]
 * @returns {Promise<{ bboxW: number, bboxH: number, bboxD: number, partVolume: number, stockVolume: number }>}
 */
export async function analyzeStepFile(arrayBuffer, stockOffsets = {}) {
  const occt = await loadOcctLibrary();
  const result = occt.ReadStepFile(new Uint8Array(arrayBuffer), null);
  if (!result?.meshes?.length) {
    throw new Error('No meshes found in STEP file');
  }

  const group = buildGroupFromMeshes(result.meshes);
  try {
    const partVolume = computePartVolume(group);
    const bbox = computeBoundingBox(group);
    const offsets = normalizeOffsets(stockOffsets);
    const stock = computeStockVolume(bbox.box, offsets);
    return {
      bboxW: bbox.w,
      bboxH: bbox.h,
      bboxD: bbox.d,
      partVolume,
      stockVolume: stock.volume
    };
  } finally {
    disposeGroup(group);
  }
}

/**
 * Recognize drilled-hole features from exact B-Rep (AAG).
 * Falls back to mesh curvature detection when B-Rep recognition fails
 * and mesh data is provided via options.meshes.
 *
 * @param {ArrayBuffer} arrayBuffer
 * @param {object} [options]
 * @param {Array} [options.meshes] - serialized meshes for mesh-path fallback
 * @param {function} [options.onProgress]
 * @returns {Promise<{ holes: object[], source: 'brep'|'mesh' }>}
 */
export async function analyzeStepFileFeatures(arrayBuffer, options = {}) {
  const onProgress = options.onProgress ?? null;

  if (USE_BREP_FEATURE_RECOGNITION) {
    try {
      const { analyzeStepFileFeatures: analyzeBrep } = await import(
        './brep-feature-recognition.js?v=1.20.6'
      );
      const { holes, pockets } = await analyzeBrep(arrayBuffer, {
        onProgress,
        features: options.features
      });
      return { holes: holes ?? [], pockets: pockets ?? [], source: 'brep' };
    } catch (err) {
      console.warn(
        'B-Rep feature recognition failed, falling back to mesh curvature analysis',
        err
      );
      if (typeof onProgress === 'function') {
        onProgress({
          message: 'B-Rep recognition failed — falling back to mesh analysis…',
          percent: 5
        });
      }
    }
  }

  if (!options.meshes?.length) {
    throw new Error('B-Rep recognition failed and no mesh data provided for fallback');
  }

  const { detectHoles } = await import('./hole-detection.js');
  const holes = detectHoles(options.meshes, {
    method: options.method,
    ransacIterations: options.ransacIterations,
    minRadius: options.minRadius,
    maxRadius: options.maxRadius,
    mergeTolerance: options.mergeTolerance,
    selectedFaces: options.selectedFaces,
    onProgress
  });
  return { holes, pockets: [], source: 'mesh' };
}

export { normalizeOffsets };
