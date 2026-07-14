import * as THREE from '/lib/three.module.min.js';
import { getPart, getPartCycleData, savePartCycleData } from './data-store.js';
import { getPartModelFile } from './part-model-store.js';
import {
  serializeMeshesFromGroup,
  loadHoleMethodPreference,
  saveHoleMethodPreference,
  loadRansacIterationsPreference,
  saveRansacIterationsPreference
} from './hole-detection.js';

// ── DOM refs ────────────────────────────────────────────────────────────────
const canvas = document.getElementById('three-canvas');
const surfaceSelectRectEl = document.getElementById('surface-select-rect');
const statusBar = document.getElementById('status-bar');
const propVolume = document.getElementById('prop-volume');
const propBbox = document.getElementById('prop-bbox');
const propStockVolume = document.getElementById('prop-stock-volume');
const propUtilization = document.getElementById('prop-utilization');
const measurementsList = document.getElementById('measurements-list');
const coordStatus = document.getElementById('coord-status');
const stockOffsetsEl = document.getElementById('stock-offsets');
const btnOpen = document.getElementById('btn-open');
const btnClose = document.getElementById('btn-close');
const partNumberEl = document.getElementById('analyzer-part-number');
const fileInput = document.getElementById('file-input');
const btnApplyStock = document.getElementById('btn-apply-stock');
const btnApplyCoord = document.getElementById('btn-apply-coord');
const btnPickCoord = document.getElementById('btn-pick-coord');
const btnResetMeasurements = document.getElementById('btn-reset-measurements');
const btnDetectHoles = document.getElementById('btn-detect-holes');
const btnToggleFloor = document.getElementById('btn-toggle-floor');
const toolBtns = document.querySelectorAll('.tool-btn');

// Hole detection DOM refs
const holeFitMethodSelect = document.getElementById('hole-fit-method');
const holeRansacIterationsInput = document.getElementById('hole-ransac-iterations');
const btnSelectSurfaces = document.getElementById('btn-select-surfaces');
const btnSelectAllBodies = document.getElementById('btn-select-all-bodies');
const btnClearSelection = document.getElementById('btn-clear-selection');
const btnDetectHolesWhole = document.getElementById('btn-detect-holes-whole');
const btnDetectHolesSelected = document.getElementById('btn-detect-holes-selected');
const surfaceSelectionStatus = document.getElementById('surface-selection-status');
const holesList = document.getElementById('holes-list');
const holeCountBadge = document.getElementById('hole-count-badge');
const btnAddHolesToCycle = document.getElementById('btn-add-holes-to-cycle');
const btnClearHoles = document.getElementById('btn-clear-holes');
const holeProgressPanel = document.getElementById('hole-progress-panel');
const holeProgressTitle = document.getElementById('hole-progress-title');
const holeProgressBar = document.getElementById('hole-progress-bar');
const holeProgressPercent = document.getElementById('hole-progress-percent');
const holeProgressLog = document.getElementById('hole-progress-log');
const btnHoleProgressHide = document.getElementById('btn-hole-progress-hide');
const btnHoleProgressShow = document.getElementById('btn-hole-progress-show');
const btnHoleProgressStop = document.getElementById('btn-hole-progress-stop');
const holeDetectionSection = document.getElementById('hole-detection-section');

// ── SECTION A — Scene Setup ─────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe8e9ed);

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100000);
camera.up.set(0, 0, 1);

// GridHelper defaults to XZ (Y-up); rotate to XY for Z-up (NX CAM style).
const grid = new THREE.GridHelper(1000, 40, 0x9ba9b8, 0xbcbcc4);
grid.rotation.x = Math.PI / 2;
grid.visible = false; // Floor tile hidden by default
scene.add(grid);

scene.add(new THREE.AmbientLight(0xffffff, 0.4));

const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight1.position.set(400, 300, 600);
scene.add(dirLight1);

const dirLight2 = new THREE.DirectionalLight(0x88ccff, 0.4);
dirLight2.position.set(-300, -400, 250);
scene.add(dirLight2);

// ── SECTION B — Orbit Controls (quaternion-based, Z-up, no gimbal lock) ─────
const target = new THREE.Vector3(0, 0, 0);
const ISOMETRIC_PHI   = Math.acos(1 / Math.sqrt(3));   // ~54.74° from +Z
const ISOMETRIC_THETA = Math.PI / 4 - Math.PI / 2;     // -45° azimuth (NX home)
let orbitRadius = 500;

// orbitQuat: encodes the camera rig orientation.
// Invariant: (0,0,1).applyQuaternion(orbitQuat) == normalised(camera.position - target)
const orbitQuat = new THREE.Quaternion();

function setOrbitFromAngles(theta, phi) {
  // qZ(θ+π/2)·qX(φ) is the unique quaternion whose local axes satisfy:
  //   (0,0,1) → camera-offset direction  (sin φ cos θ, sin φ sin θ, cos φ)
  //   (0,1,0) → camera up = worldZ projected onto view plane (-cos φ cos θ, -cos φ sin θ, sin φ)
  // Reading up directly from orbitQuat avoids the pole singularity in the
  // "worldZ − dir·dotZ" projection formula.
  const qZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), theta + Math.PI / 2);
  const qX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), phi);
  orbitQuat.copy(qZ).multiply(qX);
}
setOrbitFromAngles(ISOMETRIC_THETA, ISOMETRIC_PHI);

function updateCamera() {
  const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(orbitQuat);
  camera.position.copy(target).addScaledVector(dir, orbitRadius);
  // orbitQuat's local Y is always the correct camera up (no projection formula,
  // no pole singularity, no conditional branch).
  camera.up.copy(new THREE.Vector3(0, 1, 0).applyQuaternion(orbitQuat));
  camera.lookAt(target);
}

function snapViewToDirection(direction) {
  const dir = direction.clone().normalize();
  const phi = Math.acos(Math.max(-1, Math.min(1, dir.z)));
  // atan2(0,0) is undefined at the top/bottom poles.  Use theta = -PI/2 so that
  // setOrbitFromAngles produces orbitQuat = identity for the top face, giving
  // camera.up = world Y (X right, Y up on screen — NX top-view convention).
  const theta = (Math.abs(dir.x) < 1e-6 && Math.abs(dir.y) < 1e-6)
    ? -Math.PI / 2
    : Math.atan2(dir.y, dir.x);
  setOrbitFromAngles(theta, phi);
  updateCamera();
}

function fitCameraToModel() {
  if (!partGroup) return;
  const box = new THREE.Box3().setFromObject(partGroup);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  if (sphere.radius <= 0) return;

  setOrbitFromAngles(ISOMETRIC_THETA, ISOMETRIC_PHI);
  target.copy(center);

  const vFov = camera.fov * (Math.PI / 180);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const fov = Math.min(vFov, hFov);
  orbitRadius = (sphere.radius / Math.sin(fov / 2)) * 1.15;

  updateCamera();
}

updateCamera();

let isDragging = false;
let lastMouse = { x: 0, y: 0 };

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('mousedown', (e) => {
  if (surfaceSelectMode && e.button === 0 && partGroup) {
    e.preventDefault();
    startRectSelection(e);
    return;
  }
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
  if (isRectSelecting) cancelRectSelection();
});

canvas.addEventListener('mousemove', (e) => {
  if (isRectSelecting) {
    updateRectSelection(e);
    return;
  }

  if (isDragging) {
    const dx = e.clientX - lastMouse.x;
    const dy = e.clientY - lastMouse.y;
    lastMouse = { x: e.clientX, y: e.clientY };

    if (e.shiftKey) {
      const panSpeed = orbitRadius * 0.001;
      const right = new THREE.Vector3();
      const up = new THREE.Vector3();
      right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
      target.addScaledVector(right, -dx * panSpeed);
      target.addScaledVector(up, dy * panSpeed);
      updateCamera();
    } else {
      // Screen-space orbit: dx rotates around the camera's current up axis,
      // dy rotates around the camera's current right axis.
      //
      // For equatorial views the camera up ≈ projected world-Z, so horizontal
      // drag behaves like a Z-up turntable.  At the poles the camera has a
      // well-defined up/right pair, so the view orbits freely with no locked axis.
      const cameraUp    = new THREE.Vector3(0, 1, 0).applyQuaternion(orbitQuat);
      const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(orbitQuat);
      const rotH = new THREE.Quaternion().setFromAxisAngle(cameraUp,    -dx * 0.005);
      const rotV = new THREE.Quaternion().setFromAxisAngle(cameraRight, -dy * 0.005);
      orbitQuat.premultiply(rotH).premultiply(rotV);
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
  orbitRadius *= e.deltaY > 0 ? 1.1 : 0.9;
  orbitRadius = Math.max(1, orbitRadius);
  updateCamera();
}, { passive: false });

window.addEventListener('mouseup', (e) => {
  if (isRectSelecting && e.button === 0) {
    finishRectSelection(e);
  }
});

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

// ── SECTION D — View Gnomon (NX-style) ──────────────────────────────────────
const gnomonCanvas = document.getElementById('gnomon-canvas');
const GNOMON_WIDGET_PX = 198;
const GNOMON_CUBE_SIZE = 0.72;      // governs axis origin/length
const GNOMON_CUBE_MESH_SIZE = 1.44; // cube visual only (2× cube size)
const GNOMON_CUBE_HALF = GNOMON_CUBE_SIZE / 2;
const GNOMON_AXIS_LENGTH = GNOMON_CUBE_SIZE * 4;
const GNOMON_FACE_BASE = 0xbcbcc4;
const GNOMON_FACE_HOVER = 0xff9999;
const GNOMON_LOCAL_FACE_NORMALS = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1)
];

const gnomonRenderer = new THREE.WebGLRenderer({
  canvas: gnomonCanvas,
  alpha: true,
  antialias: true
});
gnomonRenderer.setPixelRatio(window.devicePixelRatio);
gnomonRenderer.setSize(GNOMON_WIDGET_PX, GNOMON_WIDGET_PX, false);
gnomonRenderer.setClearColor(0x000000, 0);

const gnomonScene = new THREE.Scene();
const gnomonCamera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
const gnomonTarget = new THREE.Vector3();
let gnomonCamDist = 5;      // computed by fitGnomonCamera()

gnomonScene.add(new THREE.AmbientLight(0xffffff, 0.85));
const gnomonLight = new THREE.DirectionalLight(0xffffff, 0.45);
gnomonLight.position.set(2, 1, 4);
gnomonScene.add(gnomonLight);

// Gnomon group stays WORLD-ALIGNED (identity rotation).
// The gnomon CAMERA is what moves to mirror the main camera's viewing direction.
const gnomonGroup = new THREE.Group();
gnomonScene.add(gnomonGroup);
const gnomonCubeGroup = gnomonGroup;
const gnomonAxesGroup = gnomonGroup;

const gnomonMaterials = GNOMON_LOCAL_FACE_NORMALS.map(() =>
  new THREE.MeshStandardMaterial({
    color: GNOMON_FACE_BASE,
    metalness: 0.1,
    roughness: 0.85,
    transparent: true,
    opacity: 0.92
  })
);

const gnomonCube = new THREE.Mesh(
  new THREE.BoxGeometry(GNOMON_CUBE_MESH_SIZE, GNOMON_CUBE_MESH_SIZE, GNOMON_CUBE_MESH_SIZE),
  gnomonMaterials
);
gnomonCubeGroup.add(gnomonCube);

const gnomonEdges = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(GNOMON_CUBE_MESH_SIZE, GNOMON_CUBE_MESH_SIZE, GNOMON_CUBE_MESH_SIZE)),
  new THREE.LineBasicMaterial({ color: 0x7c7c7c })
);
gnomonCubeGroup.add(gnomonEdges);

function createGnomonAxisLine(from, to, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  return new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
}

function createGnomonLabel(text, color, position) {
  const size = 256;
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = size;
  labelCanvas.height = size;
  const ctx = labelCanvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.font = 'bold 168px Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#fbfbfb';
  ctx.strokeText(text, size / 2, size / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, size / 2, size / 2);
  const texture = new THREE.CanvasTexture(labelCanvas);
  texture.needsUpdate = true;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      depthWrite: false,
      transparent: true
    })
  );
  sprite.position.copy(position);
  const labelScale = 0.55 * 2.5;
  sprite.scale.set(labelScale, labelScale, 1);
  sprite.renderOrder = 100;
  sprite.userData.labelRadius = labelScale * 0.5;
  return sprite;
}

function axisLabelPosition(origin, axisEnd, pastLine = 0.14) {
  const dir = axisEnd.clone().sub(origin);
  if (dir.lengthSq() === 0) return axisEnd.clone();
  dir.normalize();
  return axisEnd.clone().addScaledVector(dir, pastLine);
}

function fitGnomonCamera() {
  // Compute bounding sphere of the (identity-rotation) gnomon to get camera distance.
  const box = new THREE.Box3();
  gnomonGroup.traverse((child) => {
    if (child.isMesh || child.isLine || child.isLineSegments) {
      const childBox = new THREE.Box3().setFromObject(child);
      box.union(childBox);
    }
    if (child.isSprite && child.userData.labelRadius) {
      const r = child.userData.labelRadius;
      const p = child.position;
      box.expandByPoint(new THREE.Vector3(p.x + r, p.y + r, p.z + r));
      box.expandByPoint(new THREE.Vector3(p.x - r, p.y - r, p.z - r));
    }
  });

  box.getCenter(gnomonTarget);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const vFov = gnomonCamera.fov * (Math.PI / 180);
  gnomonCamDist = (sphere.radius / Math.sin(vFov / 2)) * 1.5;
}

const axisOrigin = new THREE.Vector3(-GNOMON_CUBE_HALF, -GNOMON_CUBE_HALF, -GNOMON_CUBE_HALF);
const xAxisEnd = new THREE.Vector3(
  axisOrigin.x + GNOMON_AXIS_LENGTH,
  axisOrigin.y,
  axisOrigin.z
);
const yAxisEnd = new THREE.Vector3(
  axisOrigin.x,
  axisOrigin.y + GNOMON_AXIS_LENGTH,
  axisOrigin.z
);
const zAxisEnd = new THREE.Vector3(
  axisOrigin.x,
  axisOrigin.y,
  axisOrigin.z + GNOMON_AXIS_LENGTH
);
gnomonAxesGroup.add(createGnomonAxisLine(axisOrigin, xAxisEnd, 0xff4444));
gnomonAxesGroup.add(createGnomonAxisLine(axisOrigin, yAxisEnd, 0x44cc44));
gnomonAxesGroup.add(createGnomonAxisLine(axisOrigin, zAxisEnd, 0x4488ff));
gnomonAxesGroup.add(createGnomonLabel('X', '#ff6666', axisLabelPosition(axisOrigin, xAxisEnd)));
gnomonAxesGroup.add(createGnomonLabel('Y', '#66cc66', axisLabelPosition(axisOrigin, yAxisEnd)));
gnomonAxesGroup.add(createGnomonLabel('Z', '#6699ff', axisLabelPosition(axisOrigin, zAxisEnd)));

fitGnomonCamera();

const gnomonRaycaster = new THREE.Raycaster();
const gnomonMouse = new THREE.Vector2();
let gnomonHoveredFace = -1;

function setGnomonHoveredFace(faceIndex) {
  if (gnomonHoveredFace === faceIndex) return;
  if (gnomonHoveredFace >= 0) {
    gnomonMaterials[gnomonHoveredFace].color.setHex(GNOMON_FACE_BASE);
  }
  gnomonHoveredFace = faceIndex;
  if (gnomonHoveredFace >= 0) {
    gnomonMaterials[gnomonHoveredFace].color.setHex(GNOMON_FACE_HOVER);
  }
}

function updateGnomonOrientation() {
  // Move the gnomon camera to mirror the main camera's viewing direction.
  // The gnomon GROUP stays world-aligned (identity), so axes always match world XYZ.
  const dir = new THREE.Vector3().subVectors(camera.position, target).normalize();
  gnomonCamera.position.copy(gnomonTarget).addScaledVector(dir, gnomonCamDist);
  gnomonCamera.up.copy(camera.up);
  gnomonCamera.lookAt(gnomonTarget);
}

function getGnomonMouse(event) {
  const rect = gnomonCanvas.getBoundingClientRect();
  gnomonMouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  gnomonMouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function pickGnomonFace(event) {
  getGnomonMouse(event);
  gnomonRaycaster.setFromCamera(gnomonMouse, gnomonCamera);
  const hits = gnomonRaycaster.intersectObject(gnomonCube, false);
  return hits.length > 0 ? hits[0].face.materialIndex : -1;
}

function snapToGnomonFace(faceIndex) {
  // Gnomon group is world-aligned, so face normals are already in world space.
  snapViewToDirection(GNOMON_LOCAL_FACE_NORMALS[faceIndex]);
}

gnomonCanvas.addEventListener('mousemove', (event) => {
  setGnomonHoveredFace(pickGnomonFace(event));
});

gnomonCanvas.addEventListener('mouseleave', () => {
  setGnomonHoveredFace(-1);
});

gnomonCanvas.addEventListener('click', (event) => {
  const faceIndex = pickGnomonFace(event);
  if (faceIndex < 0) return;
  event.stopPropagation();
  snapToGnomonFace(faceIndex);
});

// ── SECTION E — Render Loop ─────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  updateCoordAxisScreenScale();
  renderer.render(scene, camera);
  updateGnomonOrientation();
  gnomonRenderer.render(gnomonScene, gnomonCamera);
}
animate();

// ── State ───────────────────────────────────────────────────────────────────
let partGroup = null;
let loadedFileName = '';
const activePartContext = { projectId: null, partId: null };
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

// Hole detection state
let detectedHoles = [];
let holeVisualGroup = null;
let surfaceSelectMode = false;
const selectedFaces = new Set();
let surfaceHighlightGroup = null;
let holeWorker = null;
let holeWorkerRequestId = 0;
let activeHoleId = null;
let lastHoleDetectionSelectedOnly = false;
let holeDetectionRunning = false;
let holeProgressPanelHidden = false;

// Rectangle surface selection state
const RECT_SELECT_MIN_DRAG = 4;
let isRectSelecting = false;
let rectSelectStart = null;
const _faceCenter = new THREE.Vector3();
const _faceNormal = new THREE.Vector3();
const _projPoint = new THREE.Vector3();
const _viewDir = new THREE.Vector3();

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

function createCoordAxisLabel(text, color, position) {
  // Reuse the gnomon label approach for consistent styling.
  const size = 256;
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = size;
  labelCanvas.height = size;
  const ctx = labelCanvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.font = 'bold 168px Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#fbfbfb';
  ctx.strokeText(text, size / 2, size / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, size / 2, size / 2);
  const texture = new THREE.CanvasTexture(labelCanvas);
  texture.needsUpdate = true;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      depthWrite: false,
      transparent: true
    })
  );
  sprite.position.copy(position);
  const labelScale = 0.55 * 2.5 * 5;
  sprite.scale.set(labelScale, labelScale, 1);
  sprite.renderOrder = 100;
  sprite.userData.labelRadius = labelScale * 0.5;
  return sprite;
}

function updateCoordAxisScreenScale() {
  // Never let a coord-axis scaling issue break the entire render loop.
  try {
    if (!coordAxisGroup) return;
    if (!camera || !camera.position) return;
    const baseDist = coordAxisGroup.userData.baseDist;
    if (!baseDist || baseDist <= 0) return;
    const dist = camera.position.distanceTo(coordAxisGroup.position);
    if (!Number.isFinite(dist) || dist <= 0) return;
    let s = dist / baseDist;
    if (!Number.isFinite(s) || s <= 0) return;
    // Clamp to avoid accidental extreme scaling.
    s = Math.min(Math.max(s, 0.02), 50);
    coordAxisGroup.scale.set(s, s, s);
  } catch {
    // Swallow to keep rendering alive.
  }
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
    color: 0xa5d4ff,
    metalness: 0.15,
    roughness: 0.65,
    side: THREE.DoubleSide,
    flatShading: false
  });
  const mesh = new THREE.Mesh(geometry, material);

  const edgesGeometry = new THREE.EdgesGeometry(geometry, 30);
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x7c7c7c });
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

const DEFAULT_PART_NUMBER = 'Unknown';
const DEFAULT_COORD_STATUS = 'Click 3 points on model to define';

function setStatus(message) {
  statusBar.textContent = message;
}

function updateFloorToggleLabel() {
  if (!btnToggleFloor) return;
  btnToggleFloor.textContent = grid.visible ? 'Hide Floor' : 'Show Floor';
  btnToggleFloor.classList.toggle('active', grid.visible);
}

function toggleFloorTile() {
  grid.visible = !grid.visible;
  updateFloorToggleLabel();
  setStatus(grid.visible ? 'Floor grid shown' : 'Floor grid hidden');
}

function appendHoleProgressLog(message, className = '') {
  if (!holeProgressLog) return;
  const entry = document.createElement('div');
  entry.className = 'hole-progress-log-entry' + (className ? ` ${className}` : '');
  const time = new Date().toLocaleTimeString();
  entry.textContent = `[${time}] ${message}`;
  holeProgressLog.appendChild(entry);
  holeProgressLog.scrollTop = holeProgressLog.scrollHeight;
}

function setHoleProgressPercent(percent) {
  const pct = Math.max(0, Math.min(100, Math.round(percent ?? 0)));
  if (holeProgressBar) holeProgressBar.style.width = `${pct}%`;
  if (holeProgressPercent) holeProgressPercent.textContent = `${pct}%`;
}

function setProgressPanelTitle(title) {
  if (holeProgressTitle) holeProgressTitle.textContent = title;
}

function setHoleProgressStopVisible(visible) {
  if (btnHoleProgressStop) btnHoleProgressStop.hidden = !visible;
}

function showHoleProgressPanel() {
  holeProgressPanelHidden = false;
  if (holeProgressPanel) holeProgressPanel.hidden = false;
  if (btnHoleProgressShow) btnHoleProgressShow.hidden = true;
}

function hideHoleProgressPanel() {
  holeProgressPanelHidden = true;
  if (holeProgressPanel) holeProgressPanel.hidden = true;
  // Keep "Show Progress" available when there is log content or an active job
  const hasLog = holeProgressLog && holeProgressLog.childElementCount > 0;
  if (btnHoleProgressShow) btnHoleProgressShow.hidden = !(hasLog || holeDetectionRunning);
}

function beginProgressLog(title, firstMessage) {
  if (holeProgressLog) holeProgressLog.innerHTML = '';
  setProgressPanelTitle(title);
  setHoleProgressPercent(0);
  showHoleProgressPanel();
  if (firstMessage) appendHoleProgressLog(firstMessage);
}

function beginHoleProgressLog(scopeLabel) {
  setHoleProgressStopVisible(true);
  beginProgressLog('Hole Detection', `Starting detection on ${scopeLabel}…`);
}

function handleHoleProgressMessage(message, percent) {
  setHoleProgressPercent(percent);
  appendHoleProgressLog(message);
  if (percent != null && percent < 100) {
    setStatus(`Detecting holes… ${Math.round(percent)}%`);
  }
}

/** Yield to the browser so progress UI can paint between heavy sync stages. */
function yieldToUI() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

function reportLoadProgress(message, percent) {
  setHoleProgressPercent(percent);
  appendHoleProgressLog(message);
  setStatus(message);
}

/**
 * Lock / unlock Hole Detection panel controls while a detection job runs.
 */
function setHoleDetectionBusy(busy) {
  holeDetectionRunning = busy;
  holeDetectionSection?.classList.toggle('is-busy', busy);

  if (holeFitMethodSelect) holeFitMethodSelect.disabled = busy;
  if (holeRansacIterationsInput) holeRansacIterationsInput.disabled = busy;
  if (btnSelectAllBodies) btnSelectAllBodies.disabled = busy;
  if (btnSelectSurfaces) btnSelectSurfaces.disabled = busy;
  if (btnDetectHolesWhole) btnDetectHolesWhole.disabled = busy;
  if (btnDetectHoles) btnDetectHoles.disabled = busy;

  if (busy) {
    if (btnClearSelection) btnClearSelection.disabled = true;
    if (btnDetectHolesSelected) btnDetectHolesSelected.disabled = true;
  } else {
    updateSurfaceSelectionUI();
  }

  setHoleProgressStopVisible(busy);
}

function setPartNumberTitle(value) {
  if (partNumberEl) {
    partNumberEl.textContent = value || DEFAULT_PART_NUMBER;
  }
}

function clearPartContextFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('projectId');
  url.searchParams.delete('partId');
  window.history.replaceState({}, '', url.pathname + url.search + url.hash);
}

function resetCameraToDefault() {
  target.set(0, 0, 0);
  setOrbitFromAngles(ISOMETRIC_THETA, ISOMETRIC_PHI);
  orbitRadius = 500;
  updateCamera();
}

function resetAnalyzerSession() {
  deactivateAllTools();

  disposePartGroup();
  disposePartBboxMesh();
  disposeStockMesh();
  disposeCoordAxisGroup();

  resetAllMeasurements();
  clearHoleDetection();
  clearSurfaceSelection();

  customCoordSystem = null;
  partVolumeMm3 = 0;
  partBBox = null;
  loadedFileName = '';
  activePartContext.projectId = null;
  activePartContext.partId = null;

  propVolume.textContent = '—';
  propBbox.textContent = '—';
  propStockVolume.textContent = '—';
  propUtilization.textContent = '—';

  setStockOffsets({});
  coordStatus.textContent = DEFAULT_COORD_STATUS;
  btnApplyCoord.disabled = true;

  resetCameraToDefault();
  setStatus('No file loaded');
  setPartNumberTitle(DEFAULT_PART_NUMBER);
  clearPartContextFromUrl();
  if (fileInput) fileInput.value = '';
}

function closeAnalyzer() {
  if (!confirm('Close the current model? All graphics, measurements, and analysis data will be cleared.')) {
    return;
  }
  resetAnalyzerSession();
}

async function resolvePartNumberFromContext() {
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get('projectId');
  const partId = params.get('partId');
  if (!projectId || !partId) {
    setPartNumberTitle(DEFAULT_PART_NUMBER);
    return;
  }

  try {
    const part = await getPart(projectId, partId);
    setPartNumberTitle(part?.partNumber || DEFAULT_PART_NUMBER);
  } catch {
    setPartNumberTitle(DEFAULT_PART_NUMBER);
  }
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

function setStockOffsets(offsets = {}) {
  stockOffsetsEl.querySelectorAll('input[data-face]').forEach((input) => {
    const face = input.dataset.face;
    input.value = String(offsets[face] ?? 0);
  });
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
    color: 0x2453b3,
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
btnClose?.addEventListener('click', closeAnalyzer);

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const buffer = await file.arrayBuffer();
  const fileName = file.name;
  fileInput.value = '';
  await loadStepFile(buffer, fileName);
});

async function loadStepFile(arrayBuffer, fileName) {
  if (holeDetectionRunning) {
    stopHoleDetection();
  }

  const displayName = fileName || 'file';
  const fileSizeMb = (arrayBuffer.byteLength / (1024 * 1024)).toFixed(2);

  setHoleProgressStopVisible(false);
  beginProgressLog('Loading STEP', `Opening ${displayName} (${fileSizeMb} MB)…`);
  reportLoadProgress('Preparing to load STEP file…', 2);
  await yieldToUI();

  try {
    reportLoadProgress('Loading OCCT importer…', 8);
    await yieldToUI();
    const occt = await loadOcctLibrary();

    reportLoadProgress('Reading STEP geometry (this may take a moment)…', 18);
    await yieldToUI();
    const result = occt.ReadStepFile(new Uint8Array(arrayBuffer), null);

    if (!result || !result.meshes || result.meshes.length === 0) {
      reportLoadProgress('Error: no meshes found in STEP file', 100);
      appendHoleProgressLog('No meshes found in STEP file', 'is-error');
      setStatus('Error: no meshes found in STEP file');
      return;
    }

    const meshCount = result.meshes.length;
    reportLoadProgress(`Parsed ${meshCount} mesh(es) — rebuilding scene…`, 40);
    await yieldToUI();

    if (partGroup) {
      disposePartGroup();
    }

    disposePartBboxMesh();

    if (stockMesh) {
      disposeStockMesh();
    }

    partGroup = new THREE.Group();

    for (let meshIdx = 0; meshIdx < meshCount; meshIdx++) {
      const meshData = result.meshes[meshIdx];
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
      mesh.userData.meshIndex = meshIdx;
      partGroup.add(mesh);

      const buildPct = 40 + Math.round(((meshIdx + 1) / meshCount) * 35);
      if (meshIdx === 0 || meshIdx === meshCount - 1 || (meshIdx + 1) % 3 === 0) {
        reportLoadProgress(
          `Building mesh ${meshIdx + 1} / ${meshCount}…`,
          buildPct
        );
        await yieldToUI();
      }
    }

    scene.add(partGroup);
    reportLoadProgress('Fitting camera…', 80);
    await yieldToUI();
    fitCameraToModel();

    customCoordSystem = null;
    btnApplyCoord.disabled = true;
    disposeCoordAxisGroup();
    loadedFileName = fileName || '';

    reportLoadProgress('Computing volume, bounding box, and stock…', 88);
    await yieldToUI();
    displayProperties(partGroup);

    pickPoints = [];
    resetAllMeasurements();
    clearHoleDetection();
    clearSurfaceSelection();
    coordStatus.textContent = 'Click 3 points on model to define';

    const doneMsg = `Loaded ${meshCount} mesh(es) from ${displayName}`;
    setHoleProgressPercent(100);
    appendHoleProgressLog(doneMsg, 'is-done');
    setStatus(doneMsg);
    persistPartModelAnalysis().catch(console.error);
  } catch (err) {
    appendHoleProgressLog(`Error loading file: ${err.message}`, 'is-error');
    setHoleProgressPercent(100);
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
  if (surfaceSelectMode) {
    setSurfaceSelectMode(false);
  }
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
  persistPartModelAnalysis().catch(console.error);
});

btnApplyCoord.addEventListener('click', () => {
  applyCustomCoordSystem();
});

btnApplyCoord.disabled = true;

stockOffsetsEl.querySelectorAll('input[data-face]').forEach((input) => {
  input.addEventListener('input', () => refreshStockBox());
  input.addEventListener('change', () => {
    refreshStockBox();
    persistPartModelAnalysis().catch(console.error);
  });
});

canvas.addEventListener('click', (e) => {
  if (!partGroup) return;
  if (isDragging) return;

  // Single-face pick is handled on mouseup in surface select mode
  if (surfaceSelectMode) return;

  if (!activeTool) return;

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
  group.add(createLine(p2, p3, 0x2453b3));
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
  // Anchor the group at the custom origin so scaling does not translate it.
  coordAxisGroup.position.copy(origin);

  const localOrigin = new THREE.Vector3(0, 0, 0);
  const xEnd = xAxis.clone().multiplyScalar(len);
  const yEnd = yAxis.clone().multiplyScalar(len);
  const zEnd = zAxis.clone().multiplyScalar(len);
  coordAxisGroup.add(createLine(localOrigin, xEnd, 0xff0000));
  coordAxisGroup.add(createLine(localOrigin, yEnd, 0x00ff00));
  coordAxisGroup.add(createLine(localOrigin, zEnd, 0x0000ff));

  // Add labels after line ends (similar to world/gnomon axes).
  const labelOffset = Math.max(len * 0.08, 0.2);
  coordAxisGroup.add(createCoordAxisLabel('X', '#ff6666', axisLabelPosition(localOrigin, xEnd, labelOffset)));
  coordAxisGroup.add(createCoordAxisLabel('Y', '#66cc66', axisLabelPosition(localOrigin, yEnd, labelOffset)));
  coordAxisGroup.add(createCoordAxisLabel('Z', '#6699ff', axisLabelPosition(localOrigin, zEnd, labelOffset)));

  // Keep this custom axis fixed-size on screen by scaling with camera distance.
  coordAxisGroup.userData.baseDist = camera.position.distanceTo(coordAxisGroup.position);
  scene.add(coordAxisGroup);

  setStatus('Coordinate system defined — click Apply to update bounding box and stock');
}

// ── SECTION J — Hole Detection ─────────────────────────────────────────────

function initHoleDetectionPreferences() {
  const method = loadHoleMethodPreference();
  if (holeFitMethodSelect) holeFitMethodSelect.value = method;
  const iterations = loadRansacIterationsPreference();
  if (holeRansacIterationsInput) holeRansacIterationsInput.value = String(iterations);
}

function getHoleDetectionOptions(selectedOnly = false) {
  return {
    method: holeFitMethodSelect?.value ?? loadHoleMethodPreference(),
    ransacIterations: parseInt(holeRansacIterationsInput?.value, 10) || loadRansacIterationsPreference(),
    selectedFaces: selectedOnly && selectedFaces.size > 0 ? selectedFaces : null
  };
}

function getHoleWorker() {
  if (!holeWorker) {
    holeWorker = new Worker('/js/hole-detection-worker.js', { type: 'module' });
    holeWorker.onmessage = handleHoleWorkerMessage;
    holeWorker.onerror = (err) => {
      console.error('Hole detection worker error:', err);
      setHoleDetectionBusy(false);
      clearHoleDetection();
      appendHoleProgressLog('Hole detection worker error', 'is-error');
      setStatus('Hole detection worker error');
    };
  }
  return holeWorker;
}

function serializePartMeshes() {
  if (!partGroup) return [];
  const meshes = [];
  partGroup.children.forEach((child) => {
    if (child.isMesh && child.geometry) meshes.push(child);
  });
  return serializeMeshesFromGroup(meshes);
}

function runHoleDetection(selectedOnly = false) {
  if (holeDetectionRunning) {
    setStatus('Hole detection already in progress');
    return;
  }

  if (!partGroup) {
    setStatus('Load a STEP file first');
    return;
  }

  if (selectedOnly && selectedFaces.size === 0) {
    setStatus('Select surfaces first');
    return;
  }

  const meshes = serializePartMeshes();
  if (meshes.length === 0) {
    setStatus('No mesh data available');
    return;
  }

  const options = getHoleDetectionOptions(selectedOnly);
  const requestId = ++holeWorkerRequestId;
  lastHoleDetectionSelectedOnly = selectedOnly;

  setStatus('Detecting holes…');
  setHoleDetectionBusy(true);

  const scopeLabel = selectedOnly ? 'selected surfaces' : 'whole part';
  beginHoleProgressLog(scopeLabel);
  appendHoleProgressLog(`Method: ${options.method}, RANSAC iterations: ${options.ransacIterations}`);
  appendHoleProgressLog(`Serializing ${meshes.length} mesh(es)…`);
  setHoleProgressPercent(2);

  // Clear any previous hole visuals while a new run is in progress
  clearHoleDetection();

  // Serialize selectedFaces Set to array for worker transfer
  const workerOptions = {
    ...options,
    selectedFaces: options.selectedFaces ? [...options.selectedFaces] : null
  };

  const worker = getHoleWorker();
  worker.postMessage({
    type: 'detect',
    requestId,
    meshes,
    options: {
      ...workerOptions,
      selectedFaces: workerOptions.selectedFaces
    }
  });
}

/**
 * Immediately stop hole detection, kill the worker, and clear all remnants.
 */
function stopHoleDetection() {
  if (!holeDetectionRunning) return;

  holeWorkerRequestId += 1;

  if (holeWorker) {
    try {
      holeWorker.terminate();
    } catch (err) {
      console.error(err);
    }
    holeWorker = null;
  }

  clearHoleDetection();
  setHoleDetectionBusy(false);
  setHoleProgressPercent(100);
  appendHoleProgressLog('Detection stopped by user — results cleared', 'is-error');
  setStatus('Hole detection stopped');
}

function handleHoleWorkerMessage(event) {
  const { type, requestId, holes, elapsedMs, message, percent } = event.data;
  if (requestId !== holeWorkerRequestId) return;

  if (type === 'progress') {
    handleHoleProgressMessage(message, percent);
    return;
  }

  setHoleDetectionBusy(false);

  if (type === 'error') {
    clearHoleDetection();
    setHoleProgressPercent(100);
    appendHoleProgressLog(`Error: ${message}`, 'is-error');
    setStatus(`Hole detection error: ${message}`);
    return;
  }

  applyDetectedHoles(holes ?? []);
  const scope = lastHoleDetectionSelectedOnly ? 'selected surfaces' : 'whole part';
  const doneMsg = `Found ${holes.length} hole(s) on ${scope} (${Math.round(elapsedMs)} ms)`;
  setHoleProgressPercent(100);
  appendHoleProgressLog(doneMsg, 'is-done');
  setStatus(doneMsg);
}

function applyDetectedHoles(holes) {
  detectedHoles = holes;
  renderHoleVisuals();
  renderHolesList();
  updateHoleCountBadge();
  btnAddHolesToCycle.disabled = holes.length === 0;
}

function clearHoleDetection() {
  detectedHoles = [];
  activeHoleId = null;
  disposeHoleVisuals();
  if (holesList) holesList.innerHTML = '';
  updateHoleCountBadge();
  if (btnAddHolesToCycle) btnAddHolesToCycle.disabled = true;
}

function disposeHoleVisuals() {
  if (!holeVisualGroup) return;
  scene.remove(holeVisualGroup);
  disposeObject(holeVisualGroup);
  holeVisualGroup = null;
}

function createHoleVisual(hole) {
  const group = new THREE.Group();
  const radius = hole.radius;
  const depth = hole.depth || radius * 2;
  const axis = new THREE.Vector3(hole.axis[0], hole.axis[1], hole.axis[2]).normalize();
  const center = new THREE.Vector3(hole.center[0], hole.center[1], hole.center[2]);

  // Semi-transparent cylinder along hole axis
  const cylinderGeo = new THREE.CylinderGeometry(radius, radius, depth, 32, 1, true);
  const cylinderMat = new THREE.MeshBasicMaterial({
    color: 0xff6600,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const cylinder = new THREE.Mesh(cylinderGeo, cylinderMat);
  cylinder.raycast = () => {};

  const defaultAxis = new THREE.Vector3(0, 1, 0);
  const cylQuat = new THREE.Quaternion().setFromUnitVectors(defaultAxis, axis);
  cylinder.setRotationFromQuaternion(cylQuat);
  cylinder.position.copy(center).add(axis.clone().multiplyScalar(depth / 2));
  group.add(cylinder);

  // Torus ring at opening
  const torusGeo = new THREE.TorusGeometry(radius, Math.max(radius * 0.04, 0.05), 8, 48);
  const torusMat = new THREE.MeshBasicMaterial({
    color: 0xff9900,
    transparent: true,
    opacity: 0.7,
    depthWrite: false
  });
  const torus = new THREE.Mesh(torusGeo, torusMat);
  torus.raycast = () => {};
  torus.position.copy(center);
  const torusQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
  torus.setRotationFromQuaternion(torusQuat);
  group.add(torus);

  group.userData.holeId = hole.id;
  return group;
}

function renderHoleVisuals() {
  disposeHoleVisuals();
  if (detectedHoles.length === 0) return;

  holeVisualGroup = new THREE.Group();
  for (const hole of detectedHoles) {
    holeVisualGroup.add(createHoleVisual(hole));
  }
  scene.add(holeVisualGroup);
}

function renderHolesList() {
  if (!holesList) return;
  holesList.innerHTML = '';

  detectedHoles.forEach((hole, index) => {
    const entry = document.createElement('div');
    entry.className = 'hole-entry';
    entry.dataset.holeId = hole.id;
    if (hole.id === activeHoleId) entry.classList.add('hole-entry-active');

    const title = document.createElement('div');
    title.className = 'hole-entry-title';
    title.textContent = `Hole ${index + 1}`;

    const detail = document.createElement('div');
    detail.className = 'hole-entry-detail';
    detail.innerHTML =
      `Ø ${formatNum(hole.diameter, 2)} mm<br>` +
      `R ${formatNum(hole.radius, 2)} mm<br>` +
      `Depth ${formatNum(hole.depth, 2)} mm<br>` +
      `Quality ${(hole.quality * 100).toFixed(0)}%`;

    entry.appendChild(title);
    entry.appendChild(detail);

    entry.addEventListener('click', () => {
      activeHoleId = hole.id;
      holesList.querySelectorAll('.hole-entry').forEach((el) => el.classList.remove('hole-entry-active'));
      entry.classList.add('hole-entry-active');
      focusOnHole(hole);
    });

    holesList.appendChild(entry);
  });
}

function focusOnHole(hole) {
  const center = new THREE.Vector3(hole.center[0], hole.center[1], hole.center[2]);
  const radius = hole.radius;
  target.copy(center);
  orbitRadius = Math.max(radius * 8, 20);
  updateCamera();
}

function updateHoleCountBadge() {
  if (holeCountBadge) {
    holeCountBadge.textContent = String(detectedHoles.length);
  }
}

// ── Surface Selection ───────────────────────────────────────────────────────

function setSurfaceSelectMode(enabled) {
  surfaceSelectMode = enabled;
  document.body.classList.toggle('surface-select-mode', enabled);
  btnSelectSurfaces?.classList.toggle('active', enabled);

  if (enabled) {
    activeTool = null;
    toolBtns.forEach((b) => b.classList.remove('active'));
    btnPickCoord.classList.remove('active');
    pickPoints = [];
    clearPickPointMarkers();
    removeSnapSphere();
    setStatus('Surface selection: click faces or drag a rectangle to add surfaces');
  } else {
    cancelRectSelection();
    setStatus('Surface selection off');
  }
}

function getCanvasLocalCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    canvasW: rect.width,
    canvasH: rect.height
  };
}

function startRectSelection(e) {
  isRectSelecting = true;
  const pt = getCanvasLocalCoords(e);
  rectSelectStart = { x: pt.x, y: pt.y };
  updateRectSelectionVisual(rectSelectStart, rectSelectStart);
}

function updateRectSelection(e) {
  if (!isRectSelecting || !rectSelectStart) return;
  const pt = getCanvasLocalCoords(e);
  updateRectSelectionVisual(rectSelectStart, { x: pt.x, y: pt.y });
}

function updateRectSelectionVisual(start, end) {
  if (!surfaceSelectRectEl) return;
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  surfaceSelectRectEl.hidden = false;
  surfaceSelectRectEl.style.left = `${left}px`;
  surfaceSelectRectEl.style.top = `${top}px`;
  surfaceSelectRectEl.style.width = `${width}px`;
  surfaceSelectRectEl.style.height = `${height}px`;
}

function hideRectSelectionVisual() {
  if (!surfaceSelectRectEl) return;
  surfaceSelectRectEl.hidden = true;
  surfaceSelectRectEl.style.width = '0';
  surfaceSelectRectEl.style.height = '0';
}

function cancelRectSelection() {
  isRectSelecting = false;
  rectSelectStart = null;
  hideRectSelectionVisual();
}

function finishRectSelection(e) {
  if (!isRectSelecting || !rectSelectStart) return;

  const end = getCanvasLocalCoords(e);
  const dx = Math.abs(end.x - rectSelectStart.x);
  const dy = Math.abs(end.y - rectSelectStart.y);
  const start = { ...rectSelectStart };

  cancelRectSelection();

  if (dx < RECT_SELECT_MIN_DRAG && dy < RECT_SELECT_MIN_DRAG) {
    handleSurfaceSelectClick(e);
    return;
  }

  const added = selectFacesInScreenRect(
    Math.min(start.x, end.x),
    Math.min(start.y, end.y),
    Math.max(start.x, end.x),
    Math.max(start.y, end.y),
    end.canvasW,
    end.canvasH
  );

  updateSurfaceSelectionUI();
  rebuildSurfaceHighlight();
  setStatus(`Added ${added} surface(s) (${selectedFaces.size} total selected)`);
}

/**
 * Add all faces from every mesh body to the current selection.
 */
function selectAllBodies() {
  if (!partGroup) {
    setStatus('Load a STEP file first');
    return;
  }

  let added = 0;
  partGroup.children.forEach((child) => {
    if (!child.isMesh || !child.geometry) return;
    const meshIdx = child.userData.meshIndex ?? 0;
    const geo = child.geometry;
    const index = geo.index;
    const triCount = index ? index.count / 3 : geo.attributes.position.count / 3;

    for (let faceIdx = 0; faceIdx < triCount; faceIdx++) {
      const key = `${meshIdx}:${faceIdx}`;
      if (!selectedFaces.has(key)) {
        selectedFaces.add(key);
        added++;
      }
    }
  });

  if (!surfaceSelectMode) setSurfaceSelectMode(true);

  updateSurfaceSelectionUI();
  rebuildSurfaceHighlight();
  setStatus(`Selected all bodies — ${added} surface(s) added (${selectedFaces.size} total)`);
}

/**
 * Select faces whose projected center falls inside the screen rectangle (visible faces only).
 */
function selectFacesInScreenRect(minX, minY, maxX, maxY, canvasW, canvasH) {
  if (!partGroup) return 0;

  let added = 0;
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();

  partGroup.children.forEach((child) => {
    if (!child.isMesh || !child.geometry) return;
    const meshIdx = child.userData.meshIndex ?? 0;
    const geo = child.geometry;
    const posAttr = geo.attributes.position;
    const index = geo.index;
    const triCount = index ? index.count / 3 : posAttr.count / 3;

    for (let faceIdx = 0; faceIdx < triCount; faceIdx++) {
      let i0, i1, i2;
      if (index) {
        i0 = index.getX(faceIdx * 3);
        i1 = index.getX(faceIdx * 3 + 1);
        i2 = index.getX(faceIdx * 3 + 2);
      } else {
        i0 = faceIdx * 3;
        i1 = faceIdx * 3 + 1;
        i2 = faceIdx * 3 + 2;
      }

      v0.fromBufferAttribute(posAttr, i0);
      v1.fromBufferAttribute(posAttr, i1);
      v2.fromBufferAttribute(posAttr, i2);
      child.localToWorld(v0);
      child.localToWorld(v1);
      child.localToWorld(v2);

      _faceCenter.copy(v0).add(v1).add(v2).multiplyScalar(1 / 3);

      const edge1 = new THREE.Vector3().subVectors(v1, v0);
      const edge2 = new THREE.Vector3().subVectors(v2, v0);
      _faceNormal.crossVectors(edge1, edge2).normalize();

      // Only select faces facing the camera
      _viewDir.subVectors(_faceCenter, camera.position).normalize();
      if (_faceNormal.dot(_viewDir) > 0) continue;

      _projPoint.copy(_faceCenter).project(camera);
      if (_projPoint.z < -1 || _projPoint.z > 1) continue;

      const sx = (_projPoint.x * 0.5 + 0.5) * canvasW;
      const sy = (-_projPoint.y * 0.5 + 0.5) * canvasH;

      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) {
        const key = `${meshIdx}:${faceIdx}`;
        if (!selectedFaces.has(key)) {
          selectedFaces.add(key);
          added++;
        }
      }
    }
  });

  return added;
}

function handleSurfaceSelectClick(e) {
  const hit = raycastMeshFace(e);
  if (!hit) return;

  const meshIndex = hit.object.userData.meshIndex ?? 0;
  const faceIndex = hit.faceIndex;
  const key = `${meshIndex}:${faceIndex}`;

  if (selectedFaces.has(key)) {
    selectedFaces.delete(key);
  } else {
    selectedFaces.add(key);
  }

  updateSurfaceSelectionUI();
  rebuildSurfaceHighlight();
}

function raycastMeshFace(e) {
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObject(partGroup, true);
  if (hits.length === 0) return null;
  const hit = hits[0];
  if (!hit.face || hit.faceIndex == null) return null;
  return hit;
}

function updateSurfaceSelectionUI() {
  const count = selectedFaces.size;
  if (surfaceSelectionStatus) {
    surfaceSelectionStatus.textContent = count === 0
      ? 'No surfaces selected'
      : `${count} surface(s) selected`;
  }
  if (btnClearSelection) btnClearSelection.disabled = count === 0;
  if (btnDetectHolesSelected) btnDetectHolesSelected.disabled = count === 0;
}

function clearSurfaceSelection() {
  selectedFaces.clear();
  cancelRectSelection();
  setSurfaceSelectMode(false);
  disposeSurfaceHighlight();
  updateSurfaceSelectionUI();
}

function disposeSurfaceHighlight() {
  if (!surfaceHighlightGroup) return;
  scene.remove(surfaceHighlightGroup);
  disposeObject(surfaceHighlightGroup);
  surfaceHighlightGroup = null;
}

function rebuildSurfaceHighlight() {
  disposeSurfaceHighlight();
  if (selectedFaces.size === 0 || !partGroup) return;

  surfaceHighlightGroup = new THREE.Group();

  // Group selected faces by mesh
  const byMesh = new Map();
  for (const key of selectedFaces) {
    const [meshIdx, faceIdx] = key.split(':').map(Number);
    if (!byMesh.has(meshIdx)) byMesh.set(meshIdx, []);
    byMesh.get(meshIdx).push(faceIdx);
  }

  partGroup.children.forEach((child) => {
    if (!child.isMesh || !child.geometry) return;
    const meshIdx = child.userData.meshIndex ?? 0;
    const faceIndices = byMesh.get(meshIdx);
    if (!faceIndices || faceIndices.length === 0) return;

    const geo = child.geometry;
    const posAttr = geo.attributes.position;
    const index = geo.index;
    const highlightPositions = [];

    for (const faceIdx of faceIndices) {
      let i0, i1, i2;
      if (index) {
        i0 = index.getX(faceIdx * 3);
        i1 = index.getX(faceIdx * 3 + 1);
        i2 = index.getX(faceIdx * 3 + 2);
      } else {
        i0 = faceIdx * 3;
        i1 = faceIdx * 3 + 1;
        i2 = faceIdx * 3 + 2;
      }

      const v0 = new THREE.Vector3().fromBufferAttribute(posAttr, i0);
      const v1 = new THREE.Vector3().fromBufferAttribute(posAttr, i1);
      const v2 = new THREE.Vector3().fromBufferAttribute(posAttr, i2);
      child.localToWorld(v0);
      child.localToWorld(v1);
      child.localToWorld(v2);

      highlightPositions.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
    }

    if (highlightPositions.length === 0) return;

    const highlightGeo = new THREE.BufferGeometry();
    highlightGeo.setAttribute('position', new THREE.Float32BufferAttribute(highlightPositions, 3));
    const highlightMat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const highlightMesh = new THREE.Mesh(highlightGeo, highlightMat);
    highlightMesh.raycast = () => {};
    surfaceHighlightGroup.add(highlightMesh);
  });

  scene.add(surfaceHighlightGroup);
}

// ── Add Holes to Cycle Time ─────────────────────────────────────────────────

async function addHolesAsDrillingOperations() {
  const { projectId, partId } = activePartContext;
  if (!projectId || !partId) {
    alert('Open this analyzer from Cycle Time (linked to a part) to add drilling operations.');
    return;
  }
  if (detectedHoles.length === 0) return;

  try {
    const saved = await getPartCycleData(projectId, partId);
    if (!saved || saved.version !== 2) {
      alert('Cycle time data not found for this part.');
      return;
    }

    // Group holes by diameter (rounded to 0.1 mm)
    const groups = new Map();
    for (const hole of detectedHoles) {
      const diaKey = Math.round(hole.diameter * 10) / 10;
      if (!groups.has(diaKey)) groups.set(diaKey, []);
      groups.get(diaKey).push(hole);
    }

    const operations = [...(saved.operations ?? [])];
    let maxOrder = operations.reduce((m, o) => Math.max(m, o.order ?? 0), 0);

    for (const [diameter, holes] of groups) {
      const maxDepth = Math.max(...holes.map((h) => h.depth ?? h.radius * 2));
      maxOrder++;
      operations.push({
        id: `op-hole-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        order: maxOrder,
        name: `Drill Ø${formatNum(diameter, 1)}`,
        type: 'Drilling',
        templateId: null,
        params: { ap: maxDepth, feed: 0, holeCount: holes.length },
        ctMin: 0
      });
    }

    await savePartCycleData(projectId, partId, {
      ...saved,
      operations,
      updatedAt: new Date().toISOString()
    });

    setStatus(`Added ${groups.size} drilling operation(s) (${detectedHoles.length} holes) to Cycle Time`);
  } catch (err) {
    console.error(err);
    setStatus(`Error adding drilling operations: ${err.message}`);
  }
}

function bindHoleDetectionEvents() {
  initHoleDetectionPreferences();
  updateFloorToggleLabel();

  btnToggleFloor?.addEventListener('click', () => toggleFloorTile());

  btnHoleProgressHide?.addEventListener('click', () => {
    hideHoleProgressPanel();
  });

  btnHoleProgressShow?.addEventListener('click', () => {
    showHoleProgressPanel();
  });

  btnHoleProgressStop?.addEventListener('click', () => {
    stopHoleDetection();
  });

  btnDetectHoles?.addEventListener('click', () => runHoleDetection(false));

  btnDetectHolesWhole?.addEventListener('click', () => runHoleDetection(false));

  btnDetectHolesSelected?.addEventListener('click', () => runHoleDetection(true));

  btnSelectSurfaces?.addEventListener('click', () => {
    setSurfaceSelectMode(!surfaceSelectMode);
  });

  btnSelectAllBodies?.addEventListener('click', () => {
    selectAllBodies();
  });

  btnClearSelection?.addEventListener('click', () => {
    clearSurfaceSelection();
    setStatus('Surface selection cleared');
  });

  btnClearHoles?.addEventListener('click', () => {
    clearHoleDetection();
    setStatus('Detected holes cleared');
  });

  btnAddHolesToCycle?.addEventListener('click', () => {
    addHolesAsDrillingOperations().catch(console.error);
  });

  holeFitMethodSelect?.addEventListener('change', () => {
    if (holeDetectionRunning) return;
    const method = holeFitMethodSelect.value;
    saveHoleMethodPreference(method);
    if (detectedHoles.length > 0 && partGroup) {
      runHoleDetection(lastHoleDetectionSelectedOnly);
    }
  });

  holeRansacIterationsInput?.addEventListener('change', () => {
    if (holeDetectionRunning) return;
    const val = parseInt(holeRansacIterationsInput.value, 10);
    if (Number.isFinite(val) && val >= 50 && val <= 5000) {
      saveRansacIterationsPreference(val);
      if (detectedHoles.length > 0 && partGroup) {
        runHoleDetection(lastHoleDetectionSelectedOnly);
      }
    }
  });
}

bindHoleDetectionEvents();

async function persistPartModelAnalysis() {
  const { projectId, partId } = activePartContext;
  if (!projectId || !partId || !partBBox) return;

  const saved = await getPartCycleData(projectId, partId);
  if (!saved || saved.version !== 2) return;

  const offsets = getOffsets();
  const stock = computeStockVolume(partBBox.box, offsets);
  const fileName = saved.model3d?.fileName || loadedFileName;
  if (!fileName) return;

  await savePartCycleData(projectId, partId, {
    version: 2,
    operations: saved.operations ?? [],
    other: saved.other,
    rawMaterial: saved.rawMaterial,
    finishPart: saved.finishPart,
    model3d: {
      fileName,
      stockOffsets: offsets,
      analysis: {
        bboxW: partBBox.w,
        bboxH: partBBox.h,
        bboxD: partBBox.d,
        partVolume: partVolumeMm3,
        stockVolume: stock.volume
      }
    },
    computed: saved.computed,
    updatedAt: new Date().toISOString()
  });
}

async function initPartModelFromContext() {
  await resolvePartNumberFromContext();

  const params = new URLSearchParams(window.location.search);
  const projectId = params.get('projectId');
  const partId = params.get('partId');
  if (!projectId || !partId) return;

  activePartContext.projectId = projectId;
  activePartContext.partId = partId;

  const cycleData = await getPartCycleData(projectId, partId);
  const model3d = cycleData?.model3d;
  if (!model3d?.fileName) {
    setStatus('No 3D model linked to this part');
    return;
  }

  const stored = await getPartModelFile(projectId, partId);
  if (!stored?.arrayBuffer?.byteLength) {
    setStatus('3D model file not found — re-add it from Edit Cycle Time');
    return;
  }

  if (model3d.stockOffsets) {
    setStockOffsets(model3d.stockOffsets);
  }

  await loadStepFile(stored.arrayBuffer, stored.fileName || model3d.fileName);
}

initPartModelFromContext().catch((err) => {
  console.error(err);
  setStatus(`Error loading part model: ${err.message}`);
});
