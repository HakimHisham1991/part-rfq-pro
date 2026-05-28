import * as THREE from '/lib/three.module.min.js';

// ── DOM refs ────────────────────────────────────────────────────────────────
const canvas = document.getElementById('three-canvas');
const statusBar = document.getElementById('status-bar');
const propVolume = document.getElementById('prop-volume');
const propBbox = document.getElementById('prop-bbox');
const propStockVolume = document.getElementById('prop-stock-volume');
const propUtilization = document.getElementById('prop-utilization');
const measurementsList = document.getElementById('measurements-list');
const coordStatus = document.getElementById('coord-status');
const stockOffsetsEl = document.getElementById('stock-offsets');
const btnOpen = document.getElementById('btn-open');
const fileInput = document.getElementById('file-input');
const btnApplyStock = document.getElementById('btn-apply-stock');
const btnApplyCoord = document.getElementById('btn-apply-coord');
const btnPickCoord = document.getElementById('btn-pick-coord');
const btnResetMeasurements = document.getElementById('btn-reset-measurements');
const toolBtns = document.querySelectorAll('.tool-btn');

// ── SECTION A — Scene Setup ─────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080a0d);

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100000);
camera.position.set(200, 150, 300);

const grid = new THREE.GridHelper(1000, 40, 0x1a2030, 0x111820);
scene.add(grid);

scene.add(new THREE.AmbientLight(0xffffff, 0.4));

const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight1.position.set(300, 500, 200);
scene.add(dirLight1);

const dirLight2 = new THREE.DirectionalLight(0x88ccff, 0.4);
dirLight2.position.set(-200, -100, -300);
scene.add(dirLight2);

// ── SECTION B — Orbit Controls (manual) ───────────────────────────────────────
const target = new THREE.Vector3(0, 0, 0);
const spherical = { theta: Math.PI / 4, phi: Math.PI / 3, radius: 500 };

function updateCamera() {
  const { theta, phi, radius } = spherical;
  camera.position.x = target.x + radius * Math.sin(phi) * Math.sin(theta);
  camera.position.y = target.y + radius * Math.cos(phi);
  camera.position.z = target.z + radius * Math.sin(phi) * Math.cos(theta);
  camera.lookAt(target);
}

function fitCameraToModel() {
  if (!partGroup) return;
  const box = new THREE.Box3().setFromObject(partGroup);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim <= 0) return;
  spherical.radius = maxDim * 2.5;
  target.copy(center);
  updateCamera();
}

updateCamera();

let isDragging = false;
let lastMouse = { x: 0, y: 0 };

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('mousedown', (e) => {
  if (activeTool && e.button === 0) return;
  if (e.button !== 1) return;
  e.preventDefault();
  isDragging = true;
  lastMouse = { x: e.clientX, y: e.clientY };
});

canvas.addEventListener('mouseup', (e) => {
  if (e.button === 1) isDragging = false;
});

canvas.addEventListener('mouseleave', () => {
  isDragging = false;
  removeSnapSphere();
});

canvas.addEventListener('mousemove', (e) => {
  if (isDragging) {
    const dx = e.clientX - lastMouse.x;
    const dy = e.clientY - lastMouse.y;
    lastMouse = { x: e.clientX, y: e.clientY };

    if (e.shiftKey) {
      const panSpeed = spherical.radius * 0.001;
      const right = new THREE.Vector3();
      const up = new THREE.Vector3();
      right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
      target.addScaledVector(right, -dx * panSpeed);
      target.addScaledVector(up, dy * panSpeed);
      updateCamera();
    } else {
      spherical.theta -= dx * 0.005;
      spherical.phi -= dy * 0.005;
      spherical.phi = Math.max(0.05, Math.min(Math.PI - 0.05, spherical.phi));
      updateCamera();
    }
    return;
  }

  if (activeTool && isSnapPickTool(activeTool)) {
    handleSnapMouseMove(e);
  }
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  spherical.radius *= e.deltaY > 0 ? 1.1 : 0.9;
  spherical.radius = Math.max(1, spherical.radius);
  updateCamera();
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.key !== 'f' && e.key !== 'F') return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  e.preventDefault();
  fitCameraToModel();
});

// ── SECTION C — Resize Handler ──────────────────────────────────────────────
const resizeObserver = new ResizeObserver(() => {
  const parent = canvas.parentElement;
  const w = parent.clientWidth;
  const h = parent.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
});
resizeObserver.observe(canvas.parentElement);

// ── SECTION D — Render Loop ─────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();

// ── State ───────────────────────────────────────────────────────────────────
let partGroup = null;
let partBboxMesh = null;
let stockMesh = null;
let partVolumeMm3 = 0;
let partBBox = null;
let customCoordSystem = null;
let activeTool = null;
let pickPoints = [];
let pickPointMarkers = [];
let snapPoint = null;
let snapSphere = null;
let snapSphereRadius = 0;
let measurementIdCounter = 0;
const measurementVisuals = new Map();
let coordAxisGroup = null;

const MEASUREMENT_TOOLS = new Set(['distance', 'angle', 'radius']);

function getMarkerRadius() {
  if (!partGroup) return 1;
  const box = new THREE.Box3().setFromObject(partGroup);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  return Math.max(maxDim * 0.006, 0.05);
}

function createPointMarker(point, color = 0xffff00) {
  const radius = getMarkerRadius();
  const geo = new THREE.SphereGeometry(radius, 12, 12);
  const mat = new THREE.MeshBasicMaterial({
    color,
    depthTest: false,
    transparent: true,
    opacity: 0.95
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(point);
  mesh.renderOrder = 999;
  mesh.raycast = () => {};
  scene.add(mesh);
  return mesh;
}

function clearPickPointMarkers() {
  pickPointMarkers.forEach((marker) => {
    scene.remove(marker);
    marker.geometry.dispose();
    marker.material.dispose();
  });
  pickPointMarkers.length = 0;
}

function adoptPickPointMarkers(group) {
  pickPointMarkers.forEach((marker) => {
    scene.remove(marker);
    group.add(marker);
  });
  pickPointMarkers.length = 0;
}

function resetAllMeasurements() {
  measurementsList.innerHTML = '';
  measurementVisuals.forEach((visual) => {
    scene.remove(visual);
    disposeObject(visual);
  });
  measurementVisuals.clear();
  clearPickPointMarkers();
  pickPoints = [];
  removeSnapSphere();
}

function isMeasurementTool(tool) {
  return MEASUREMENT_TOOLS.has(tool);
}

function isSnapPickTool(tool) {
  return tool === 'coord' || isMeasurementTool(tool);
}

function getCoordAxisLength() {
  if (!partGroup) return 20;
  const box = new THREE.Box3().setFromObject(partGroup);
  const size = box.getSize(new THREE.Vector3());
  return Math.max(size.x, size.y, size.z) * 0.15;
}

function disposeCoordAxisGroup() {
  if (!coordAxisGroup) return;
  scene.remove(coordAxisGroup);
  disposeObject(coordAxisGroup);
  coordAxisGroup = null;
}

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function disposePartBboxMesh() {
  if (!partBboxMesh) return;
  scene.remove(partBboxMesh);
  partBboxMesh.geometry.dispose();
  partBboxMesh.material.dispose();
  partBboxMesh = null;
}

function showPartBboxWireframe(bboxData) {
  disposePartBboxMesh();
  const { box, w, h, d, coord } = bboxData;
  if (w <= 0 || h <= 0 || d <= 0) return;

  const geometry = new THREE.BoxGeometry(w, h, d);
  const material = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    wireframe: true
  });
  partBboxMesh = new THREE.Mesh(geometry, material);

  const localCenter = new THREE.Vector3().addVectors(box.min, box.max).multiplyScalar(0.5);
  if (coord) {
    partBboxMesh.position.copy(worldFromLocal(localCenter, coord));
    const rotMatrix = new THREE.Matrix4().makeBasis(coord.xAxis, coord.yAxis, coord.zAxis);
    partBboxMesh.setRotationFromMatrix(rotMatrix);
  } else {
    partBboxMesh.position.copy(localCenter);
  }

  partBboxMesh.raycast = () => {};
  scene.add(partBboxMesh);
}

function createShadedMeshWithEdges(geometry) {
  const material = new THREE.MeshStandardMaterial({
    color: 0x4488cc,
    metalness: 0.35,
    roughness: 0.55,
    side: THREE.DoubleSide,
    flatShading: false
  });
  const mesh = new THREE.Mesh(geometry, material);

  const edgesGeometry = new THREE.EdgesGeometry(geometry, 30);
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x0a0e14 });
  const edgeLines = new THREE.LineSegments(edgesGeometry, edgeMaterial);
  edgeLines.raycast = () => {};
  mesh.add(edgeLines);

  return mesh;
}

function disposePartGroup() {
  if (!partGroup) return;
  scene.remove(partGroup);
  partGroup.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  });
  partGroup = null;
}

// ── SECTION J — Status Bar ───────────────────────────────────────────────────
function setStatus(message) {
  statusBar.textContent = message;
}

// ── SECTION F — Properties Computation ────────────────────────────────────────
function computeMeshVolume(positions, indices) {
  let total = 0;
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const cross = new THREE.Vector3();

  const triCount = indices ? indices.length / 3 : positions.length / 9;
  for (let t = 0; t < triCount; t++) {
    let i0, i1, i2;
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

function formatNum(value, decimals = 3) {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function formatVolume(mm3) {
  const cm3 = mm3 / 1000;
  return `${formatNum(mm3)} mm³ (${formatNum(cm3)} cm³)`;
}

function formatBboxText(min, max, w, h, d, custom = false) {
  let text =
    `X: ${formatNum(min.x, 2)} to ${formatNum(max.x, 2)}\n` +
    `Y: ${formatNum(min.y, 2)} to ${formatNum(max.y, 2)}\n` +
    `Z: ${formatNum(min.z, 2)} to ${formatNum(max.z, 2)}\n` +
    `Overall: ${formatNum(w, 2)} × ${formatNum(h, 2)} × ${formatNum(d, 2)} mm`;
  if (custom) {
    text += '\n(Custom coordinate system)';
  }
  return text;
}

function localFromWorld(worldPoint, coord) {
  const v = worldPoint.clone().sub(coord.origin);
  return new THREE.Vector3(
    v.dot(coord.xAxis),
    v.dot(coord.yAxis),
    v.dot(coord.zAxis)
  );
}

function worldFromLocal(localPoint, coord) {
  return coord.origin.clone()
    .addScaledVector(coord.xAxis, localPoint.x)
    .addScaledVector(coord.yAxis, localPoint.y)
    .addScaledVector(coord.zAxis, localPoint.z);
}

function computeBoundingBox(group, coord = null) {
  if (!coord) {
    const box = new THREE.Box3().setFromObject(group);
    const min = box.min;
    const max = box.max;
    const w = max.x - min.x;
    const h = max.y - min.y;
    const d = max.z - min.z;
    return {
      box: { min: min.clone(), max: max.clone() },
      text: formatBboxText(min, max, w, h, d, false),
      w,
      h,
      d,
      coord: null
    };
  }

  const localMin = new THREE.Vector3(Infinity, Infinity, Infinity);
  const localMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const vertex = new THREE.Vector3();

  group.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.position) return;
    const positions = child.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i);
      child.localToWorld(vertex);
      const local = localFromWorld(vertex, coord);
      localMin.min(local);
      localMax.max(local);
    }
  });

  const w = localMax.x - localMin.x;
  const h = localMax.y - localMin.y;
  const d = localMax.z - localMin.z;
  return {
    box: { min: localMin.clone(), max: localMax.clone() },
    text: formatBboxText(localMin, localMax, w, h, d, true),
    w,
    h,
    d,
    coord
  };
}

function getOffsets() {
  const offsets = {};
  stockOffsetsEl.querySelectorAll('input[data-face]').forEach((input) => {
    offsets[input.dataset.face] = parseFloat(input.value) || 0;
  });
  return offsets;
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
  const volume = w * h * d;
  const center = new THREE.Vector3(
    (min.x + max.x) / 2,
    (min.y + max.y) / 2,
    (min.z + max.z) / 2
  );
  return { volume, min, max, center, w, h, d };
}

function updateStockDisplay() {
  if (!partBBox) {
    propStockVolume.textContent = '—';
    propUtilization.textContent = '—';
    return;
  }
  const offsets = getOffsets();
  const stock = computeStockVolume(partBBox.box, offsets);
  propStockVolume.textContent = formatVolume(stock.volume);
  if (stock.volume > 0 && partVolumeMm3 > 0) {
    const util = (partVolumeMm3 / stock.volume) * 100;
    propUtilization.textContent = `${util.toFixed(1)}%`;
  } else {
    propUtilization.textContent = '—';
  }
}

function disposeStockMesh() {
  if (!stockMesh) return;
  scene.remove(stockMesh);
  stockMesh.geometry.dispose();
  stockMesh.material.dispose();
  stockMesh = null;
}

function refreshStockBox() {
  if (!partBBox) {
    disposeStockMesh();
    updateStockDisplay();
    return;
  }

  const offsets = getOffsets();
  const stock = computeStockVolume(partBBox.box, offsets);

  disposeStockMesh();

  if (stock.w <= 0 || stock.h <= 0 || stock.d <= 0) {
    updateStockDisplay();
    return;
  }

  const geometry = new THREE.BoxGeometry(stock.w, stock.h, stock.d);
  const material = new THREE.MeshBasicMaterial({
    color: 0xff6b35,
    wireframe: true
  });
  stockMesh = new THREE.Mesh(geometry, material);

  const localCenter = new THREE.Vector3().addVectors(stock.min, stock.max).multiplyScalar(0.5);
  if (partBBox.coord) {
    stockMesh.position.copy(worldFromLocal(localCenter, partBBox.coord));
    const rotMatrix = new THREE.Matrix4().makeBasis(
      partBBox.coord.xAxis,
      partBBox.coord.yAxis,
      partBBox.coord.zAxis
    );
    stockMesh.setRotationFromMatrix(rotMatrix);
  } else {
    stockMesh.position.copy(stock.center);
  }

  stockMesh.raycast = () => {};
  scene.add(stockMesh);

  updateStockDisplay();
}

function displayProperties(group, coord = null) {
  partVolumeMm3 = computePartVolume(group);
  propVolume.textContent = formatVolume(partVolumeMm3);

  partBBox = computeBoundingBox(group, coord);
  propBbox.textContent = partBBox.text;
  showPartBboxWireframe(partBBox);
  refreshStockBox();
}

function applyCustomCoordSystem() {
  if (!customCoordSystem || !partGroup) {
    setStatus('Define a coordinate system first (3 points on model)');
    return;
  }

  partBBox = computeBoundingBox(partGroup, customCoordSystem);
  propBbox.textContent = partBBox.text;
  showPartBboxWireframe(partBBox);
  refreshStockBox();
  setStatus('Custom coordinate system applied to bounding box and stock');
}

// ── OCCT loader (occt-import-js is UMD, not a native ES module) ─────────────
let occtInstancePromise = null;

async function loadOcctLibrary() {
  if (occtInstancePromise) return occtInstancePromise;

  const moduleOptions = {
    locateFile: (path) => `/lib/${path}`
  };

  occtInstancePromise = (async () => {
    const occtModule = await import('/lib/occt-import-js.js');
    const initFn = typeof occtModule.default === 'function'
      ? occtModule.default
      : (typeof globalThis.occtimportjs === 'function' ? globalThis.occtimportjs : null);

    if (typeof initFn === 'function') {
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
  })();

  return occtInstancePromise;
}

// ── SECTION E — File Loading ────────────────────────────────────────────────
btnOpen.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const buffer = await file.arrayBuffer();
  const fileName = file.name;
  fileInput.value = '';
  await loadStepFile(buffer, fileName);
});

async function loadStepFile(arrayBuffer, fileName) {
  setStatus('Loading STEP file…');
  try {
    const occt = await loadOcctLibrary();
    const result = occt.ReadStepFile(new Uint8Array(arrayBuffer), null);

    if (!result || !result.meshes || result.meshes.length === 0) {
      setStatus('Error: no meshes found in STEP file');
      return;
    }

    if (partGroup) {
      disposePartGroup();
    }

    disposePartBboxMesh();

    if (stockMesh) {
      disposeStockMesh();
    }

    partGroup = new THREE.Group();

    for (const meshData of result.meshes) {
      const geometry = new THREE.BufferGeometry();
      const rawPos = meshData.attributes.position.array;
      const posArr = rawPos instanceof Float32Array ? rawPos : new Float32Array(rawPos);
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(posArr, meshData.attributes.position.itemSize || 3)
      );
      if (meshData.index && meshData.index.array) {
        const rawIdx = meshData.index.array;
        const idxArr = rawIdx instanceof Uint32Array ? rawIdx : new Uint32Array(rawIdx);
        geometry.setIndex(new THREE.BufferAttribute(idxArr, 1));
      }
      geometry.computeVertexNormals();

      const mesh = createShadedMeshWithEdges(geometry);
      partGroup.add(mesh);
    }

    scene.add(partGroup);

    fitCameraToModel();

    customCoordSystem = null;
    btnApplyCoord.disabled = true;
    disposeCoordAxisGroup();
    displayProperties(partGroup);
    setStatus(`Loaded ${result.meshes.length} mesh(es) from ${fileName || 'file'}`);

    pickPoints = [];
    resetAllMeasurements();
    coordStatus.textContent = 'Click 3 points on model to define';
  } catch (err) {
    setStatus(`Error loading file: ${err.message}`);
    console.error(err);
  }
}

function disposeObject(obj) {
  obj.traverse?.((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  });
  if (obj.geometry) obj.geometry.dispose();
  if (obj.material) obj.material.dispose();
}

// ── SECTION G — Measurement Tools ───────────────────────────────────────────
function deactivateAllTools() {
  activeTool = null;
  toolBtns.forEach((b) => b.classList.remove('active'));
  btnPickCoord.classList.remove('active');
  pickPoints = [];
  clearPickPointMarkers();
  removeSnapSphere();
}

function activateTool(tool, btn) {
  if (activeTool === tool) {
    deactivateAllTools();
    return;
  }
  deactivateAllTools();
  activeTool = tool;
  btn.classList.add('active');
}

toolBtns.forEach((btn) => {
  btn.addEventListener('click', () => activateTool(btn.dataset.tool, btn));
});

btnPickCoord.addEventListener('click', () => activateTool('coord', btnPickCoord));

btnResetMeasurements.addEventListener('click', () => {
  resetAllMeasurements();
  setStatus('Measurements cleared');
});

btnApplyStock.addEventListener('click', () => {
  if (!partBBox) return;
  refreshStockBox();
  setStatus('Raw stock box applied');
});

btnApplyCoord.addEventListener('click', () => {
  applyCustomCoordSystem();
});

btnApplyCoord.disabled = true;

stockOffsetsEl.querySelectorAll('input[data-face]').forEach((input) => {
  input.addEventListener('input', () => refreshStockBox());
  input.addEventListener('change', () => refreshStockBox());
});

canvas.addEventListener('click', (e) => {
  if (!activeTool || !partGroup) return;
  if (isDragging) return;

  const point = getPickPoint(e);
  if (!point) return;

  pickPoints.push(point.clone());
  if (isSnapPickTool(activeTool)) {
    pickPointMarkers.push(createPointMarker(point));
  }

  if (activeTool === 'distance' && pickPoints.length === 2) {
    completeDistance(pickPoints[0], pickPoints[1]);
    pickPoints = [];
  } else if (activeTool === 'angle' && pickPoints.length === 3) {
    completeAngle(pickPoints[0], pickPoints[1], pickPoints[2]);
    pickPoints = [];
  } else if (activeTool === 'radius' && pickPoints.length === 3) {
    completeRadius(pickPoints[0], pickPoints[1], pickPoints[2]);
    pickPoints = [];
  } else if (activeTool === 'coord' && pickPoints.length === 3) {
    completeCoord(pickPoints[0], pickPoints[1], pickPoints[2]);
    pickPoints = [];
    deactivateAllTools();
  }
});

function getPickPoint(e) {
  if (snapPoint) return snapPoint.clone();

  const rect = canvas.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObject(partGroup, true);
  if (hits.length === 0) return null;
  return hits[0].point.clone();
}

// ── SECTION H — Snap Behavior ───────────────────────────────────────────────
function handleSnapMouseMove(e) {
  if (!partGroup) {
    removeSnapSphere();
    return;
  }

  const rect = canvas.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObject(partGroup, true);

  if (hits.length === 0) {
    snapPoint = null;
    removeSnapSphere();
    return;
  }

  const hit = hits[0];
  const face = hit.face;
  const mesh = hit.object;
  if (!face) {
    snapPoint = null;
    removeSnapSphere();
    return;
  }

  const posAttr = mesh.geometry.attributes.position;
  const idxA = face.a;
  const idxB = face.b;
  const idxC = face.c;

  const verts = [
    new THREE.Vector3().fromBufferAttribute(posAttr, idxA),
    new THREE.Vector3().fromBufferAttribute(posAttr, idxB),
    new THREE.Vector3().fromBufferAttribute(posAttr, idxC)
  ];

  mesh.localToWorld(verts[0]);
  mesh.localToWorld(verts[1]);
  mesh.localToWorld(verts[2]);

  let closest = verts[0];
  let closestDist = Infinity;
  for (const v of verts) {
    const projected = v.clone().project(camera);
    const sx = (projected.x * 0.5 + 0.5) * rect.width;
    const sy = (-projected.y * 0.5 + 0.5) * rect.height;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const dist = Math.hypot(sx - px, sy - py);
    if (dist < closestDist) {
      closestDist = dist;
      closest = v;
    }
  }

  if (closestDist <= 8) {
    snapPoint = closest.clone();
    showSnapSphere(snapPoint);
  } else {
    snapPoint = hit.point.clone();
    showSnapSphere(snapPoint);
  }
}

function showSnapSphere(point) {
  const radius = getMarkerRadius() * 1.15;
  if (!snapSphere) {
    const geo = new THREE.SphereGeometry(radius, 12, 12);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      depthTest: false,
      transparent: true,
      opacity: 0.55
    });
    snapSphere = new THREE.Mesh(geo, mat);
    snapSphere.renderOrder = 998;
    snapSphere.raycast = () => {};
    scene.add(snapSphere);
    snapSphereRadius = radius;
  } else if (Math.abs(snapSphereRadius - radius) > radius * 0.05) {
    snapSphere.geometry.dispose();
    snapSphere.geometry = new THREE.SphereGeometry(radius, 12, 12);
    snapSphereRadius = radius;
  }
  snapSphere.position.copy(point);
  snapSphere.visible = true;
}

function removeSnapSphere() {
  snapPoint = null;
  if (snapSphere) {
    snapSphere.visible = false;
  }
}

// ── SECTION I — Measurement List Display ────────────────────────────────────
function addMeasurement(type, valueText, visual) {
  const id = ++measurementIdCounter;
  const entry = document.createElement('div');
  entry.className = 'measurement-entry';
  entry.dataset.id = String(id);

  const typeSpan = document.createElement('span');
  typeSpan.className = 'm-type';
  typeSpan.textContent = type;

  const valueDiv = document.createElement('div');
  valueDiv.textContent = valueText;

  const removeBtn = document.createElement('button');
  removeBtn.className = 'm-remove';
  removeBtn.type = 'button';
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', () => {
    entry.remove();
    const vis = measurementVisuals.get(id);
    if (vis) {
      scene.remove(vis);
      disposeObject(vis);
      measurementVisuals.delete(id);
    }
  });

  entry.appendChild(typeSpan);
  entry.appendChild(valueDiv);
  entry.appendChild(removeBtn);
  measurementsList.appendChild(entry);

  if (visual) {
    measurementVisuals.set(id, visual);
  }
}

function createLine(p1, p2, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
  const mat = new THREE.LineBasicMaterial({ color });
  return new THREE.Line(geo, mat);
}

function completeDistance(p1, p2) {
  const dist = p1.distanceTo(p2);
  const group = new THREE.Group();
  group.add(createLine(p1, p2, 0x00e5ff));
  adoptPickPointMarkers(group);
  scene.add(group);
  addMeasurement('Distance', `Distance: ${formatNum(dist)} mm`, group);
}

function completeAngle(p1, p2, p3) {
  const a = new THREE.Vector3().subVectors(p1, p2);
  const b = new THREE.Vector3().subVectors(p3, p2);
  const denom = a.length() * b.length();
  let angle = 0;
  if (denom > 0) {
    angle = Math.acos(Math.max(-1, Math.min(1, a.dot(b) / denom))) * 180 / Math.PI;
  }
  const group = new THREE.Group();
  group.add(createLine(p1, p2, 0x00e5ff));
  group.add(createLine(p2, p3, 0x00e5ff));
  adoptPickPointMarkers(group);
  scene.add(group);
  addMeasurement('Angle', `Angle: ${formatNum(angle)} degrees`, group);
}

function completeRadius(p1, p2, p3) {
  const a = p1.distanceTo(p2);
  const b = p2.distanceTo(p3);
  const c = p3.distanceTo(p1);
  const ab = new THREE.Vector3().subVectors(p2, p1);
  const ac = new THREE.Vector3().subVectors(p3, p1);
  const area = ab.cross(ac).length() / 2;
  let radius = 0;
  if (area > 0) {
    radius = (a * b * c) / (4 * area);
  }
  const group = new THREE.Group();
  adoptPickPointMarkers(group);
  scene.add(group);
  addMeasurement('Radius', `Radius: ${formatNum(radius)} mm`, group);
}

function completeCoord(p1, p2, p3) {
  clearPickPointMarkers();

  const origin = p1.clone();
  const xAxis = new THREE.Vector3().subVectors(p2, p1).normalize();
  const zAxis = new THREE.Vector3().crossVectors(xAxis, new THREE.Vector3().subVectors(p3, p1)).normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

  customCoordSystem = { origin, xAxis, yAxis, zAxis };
  btnApplyCoord.disabled = false;

  const fmt = (v) => `(${formatNum(v.x, 3)}, ${formatNum(v.y, 3)}, ${formatNum(v.z, 3)})`;
  coordStatus.innerHTML =
    `Origin: ${fmt(origin)}<br>` +
    `X: ${fmt(xAxis)}<br>` +
    `Y: ${fmt(yAxis)}<br>` +
    `Z: ${fmt(zAxis)}`;

  disposeCoordAxisGroup();

  const len = getCoordAxisLength();
  coordAxisGroup = new THREE.Group();
  coordAxisGroup.add(createLine(origin, origin.clone().addScaledVector(xAxis, len), 0xff0000));
  coordAxisGroup.add(createLine(origin, origin.clone().addScaledVector(yAxis, len), 0x00ff00));
  coordAxisGroup.add(createLine(origin, origin.clone().addScaledVector(zAxis, len), 0x0000ff));
  scene.add(coordAxisGroup);

  setStatus('Coordinate system defined — click Apply to update bounding box and stock');
}
