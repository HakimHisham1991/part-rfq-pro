import * as THREE from '/lib/three.module.min.js';
import { getPart, getPartCycleData, savePartCycleData } from './data-store.js';
import { getPartModelFile } from './part-model-store.js';
import {
  serializeMeshesFromGroup,
  loadHoleMethodPreference,
  saveHoleMethodPreference,
  loadRansacIterationsPreference,
  saveRansacIterationsPreference,
  isBrepHoleMethod,
  BREP_HOLE_METHOD
} from './hole-detection.js';
import {
  getPocketBodyState,
  setPocketBodyState,
  resetPocketBodyState,
  resetPocketSessionFlags,
  getHoleDetectionCompleted,
  setHoleDetectionCompleted
} from './pocket-state.js';

/** Cache-bust only our JS workers — never append ?v= to .wasm (breaks OCCT on some hosts). */
const JS_ASSET_V = '1.21.7';

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
const btnToggleFloor = document.getElementById('btn-toggle-floor');
const btnTogglePerspective = document.getElementById('btn-toggle-perspective');
const featureSidePanels = document.getElementById('feature-side-panels');
const holePanel = document.getElementById('hole-panel');
const pocketPanel = document.getElementById('pocket-panel');
const btnCollapseHolePanel = document.getElementById('btn-collapse-hole-panel');
const btnCollapsePocketPanel = document.getElementById('btn-collapse-pocket-panel');
const toolBtns = document.querySelectorAll('.tool-btn');

// Hole detection DOM refs
const holeFitMethodSelect = document.getElementById('hole-fit-method');
const holeRansacIterationsInput = document.getElementById('hole-ransac-iterations');
const btnSelectSurfaces = document.getElementById('btn-select-surfaces');
const btnSelectAllBodies = document.getElementById('btn-select-all-bodies');
const btnClearSelection = document.getElementById('btn-clear-selection');
const btnRunHoleDetection = document.getElementById('btn-run-hole-detection');
const btnPlugHoles = document.getElementById('btn-plug-holes');
const btnClearHolePlugs = document.getElementById('btn-clear-hole-plugs');
const pocketGateWarningText = document.getElementById('pocket-gate-warning-text');
const surfaceSelectionStatus = document.getElementById('surface-selection-status');
const holesList = document.getElementById('holes-list');
const holesSummaryList = document.getElementById('holes-summary-list');
const holeCountBadge = document.getElementById('hole-count-badge');
const holeGroupCountBadge = document.getElementById('hole-group-count-badge');
const chkGroupDiameter = document.getElementById('chk-group-diameter');
const chkGroupDepth = document.getElementById('chk-group-depth');
const btnAddHolesToCycle = document.getElementById('btn-add-holes-to-cycle');
const btnClearHoles = document.getElementById('btn-clear-holes');
const btnCsvDetectedHoles = document.getElementById('btn-csv-detected-holes');
const btnCsvHoleGroups = document.getElementById('btn-csv-hole-groups');
const holeProgressPanel = document.getElementById('hole-progress-panel');
const holeProgressTitle = document.getElementById('hole-progress-title');
const holeProgressBar = document.getElementById('hole-progress-bar');
const holeProgressPercent = document.getElementById('hole-progress-percent');
const holeProgressLog = document.getElementById('hole-progress-log');
const btnHoleProgressHide = document.getElementById('btn-hole-progress-hide');
const btnHoleProgressShow = document.getElementById('btn-hole-progress-show');
const btnHoleProgressStop = document.getElementById('btn-hole-progress-stop');
const holeDetectionSection = document.getElementById('hole-detection-section');

// Pocket detection DOM refs
const btnRunPocketDetection = document.getElementById('btn-run-pocket-detection');
const pocketsList = document.getElementById('pockets-list');
const pocketCountBadge = document.getElementById('pocket-count-badge');
const btnClearPockets = document.getElementById('btn-clear-pockets');
const btnCsvDetectedPockets = document.getElementById('btn-csv-detected-pockets');
const pocketDetectionSection = document.getElementById('pocket-detection-section');
const pocketGateWarning = document.getElementById('pocket-gate-warning');
const pocketPreparingNotice = document.getElementById('pocket-preparing-notice');
const pocketPrepWarning = document.getElementById('pocket-prep-warning');
const pocketPrepHoleCount = document.getElementById('pocket-prep-hole-count');
const pocketPrepSkippedText = document.getElementById('pocket-prep-skipped-text');
const pocketDetectionMethod = document.getElementById('pocket-detection-method');
const pocketParamsAagWalk = document.getElementById('pocket-params-aag-walk');
const pocketParamsHullSubtract = document.getElementById('pocket-params-hull-subtract');
const pocketParamsSlicing = document.getElementById('pocket-params-slicing');
const pocketParamsUserHinted = document.getElementById('pocket-params-user-hinted');
const btnGotoHoleDetection = document.getElementById('btn-goto-hole-detection');
const btnSelectFloor = document.getElementById('btn-select-floor');
const btnClearFloor = document.getElementById('btn-clear-floor');
const floorSelectionCount = document.getElementById('floor-selection-count');
const btnSelectWalls = document.getElementById('btn-select-walls');
const btnDetectWalls = document.getElementById('btn-detect-walls');
const wallSelectionCount = document.getElementById('wall-selection-count');
const hintWallStep = document.getElementById('hint-wall-step');
const hintDetectWallOptions = document.getElementById('hint-detect-wall-options');
const hintIncludeFillets = document.getElementById('hint-include-fillets');
const hintMaxDepth = document.getElementById('hint-max-depth');
const hintPlugStep = document.getElementById('hint-plug-step');
const hintAxisMode = document.getElementById('hint-axis-mode');
const hintAxisManual = document.getElementById('hint-axis-manual');
const hintAxisX = document.getElementById('hint-axis-x');
const hintAxisY = document.getElementById('hint-axis-y');
const hintAxisZ = document.getElementById('hint-axis-z');
const hintAxisPreview = document.getElementById('hint-axis-preview');
const hintCalculateStep = document.getElementById('hint-calculate-step');
const btnHintCalculate = document.getElementById('btn-hint-calculate');
const btnHintNewPocket = document.getElementById('btn-hint-new-pocket');

// File picker: Open button uses HTML onclick so it works even if this module
// fails later. Only the change→load path is wired here.
let loadStepFileHandler = null;
fileInput?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const buffer = await file.arrayBuffer();
  const fileName = file.name;
  fileInput.value = '';
  if (typeof loadStepFileHandler === 'function') {
    await loadStepFileHandler(buffer, fileName);
  } else if (statusBar) {
    statusBar.textContent = 'Viewer still loading — try again in a moment';
  }
});

// ── SECTION A — Scene Setup ─────────────────────────────────────────────────
// Mobile (e.g. Galaxy A51): uncapped devicePixelRatio (often 2.5–3) + antialias
// exhausts Mali GPU memory and yields a blank canvas. Cap DPR; detect low-end.
let lowEndGpu = (() => {
  const mem = navigator.deviceMemory;
  const cores = navigator.hardwareConcurrency || 8;
  if (typeof mem === 'number' && mem <= 4) return true;
  if (cores <= 4 && window.matchMedia('(pointer: coarse)').matches) return true;
  return false;
})();

const getDPR = () => Math.min(window.devicePixelRatio || 1, lowEndGpu ? 1 : 2);

let webglContextLost = false;
let renderer;
try {
  if (!canvas) throw new Error('Missing #three-canvas');
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !lowEndGpu,
    powerPreference: lowEndGpu ? 'low-power' : 'default',
    failIfMajorPerformanceCaveat: false
  });
  renderer.setPixelRatio(getDPR());
} catch (err) {
  console.error('WebGL init failed', err);
  if (statusBar) {
    statusBar.textContent =
      'WebGL failed to start — Open STEP may still work after fixing GPU/drivers, but 3D view is unavailable.';
  }
  // Minimal stub so later code can guard on renderer
  renderer = {
    setPixelRatio() {},
    setSize() {},
    render() {},
    dispose() {},
    getContext() { return null; },
    domElement: canvas
  };
}

// Refine low-end after GL is available (UNMASKED_RENDERER is the reliable signal)
try {
  const gl = renderer.getContext();
  const info = gl?.getExtension?.('WEBGL_debug_renderer_info');
  if (info) {
    const gpu = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || '');
    if (/Mali-G(5|6|7)|Mali-T|Adreno \(TM\) [1-5]|Adreno [345]|Adreno 5[0-3]|PowerVR/i.test(gpu)) {
      lowEndGpu = true;
      renderer.setPixelRatio(getDPR());
    }
  }
} catch (_) {
  /* ignore — keep heuristic */
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe8e9ed);

const PERSPECTIVE_FOV = 45;
const perspectiveCamera = new THREE.PerspectiveCamera(PERSPECTIVE_FOV, 1, 0.01, 100000);
perspectiveCamera.up.set(0, 0, 1);
const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100000);
orthoCamera.up.set(0, 0, 1);
/** Perspective OFF by default → orthographic (CAD-style). */
let perspectiveEnabled = false;
let viewAspect = 1;
let camera = orthoCamera;

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

function perspectiveFovRad() {
  return (PERSPECTIVE_FOV * Math.PI) / 180;
}

function updateOrthoFrustum() {
  const halfH = Math.max(orbitRadius * Math.tan(perspectiveFovRad() / 2), 0.01);
  const halfW = halfH * Math.max(viewAspect, 0.01);
  orthoCamera.left = -halfW;
  orthoCamera.right = halfW;
  orthoCamera.top = halfH;
  orthoCamera.bottom = -halfH;
  orthoCamera.updateProjectionMatrix();
}

function updateCamera() {
  const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(orbitQuat);
  camera.position.copy(target).addScaledVector(dir, orbitRadius);
  // orbitQuat's local Y is always the correct camera up (no projection formula,
  // no pole singularity, no conditional branch).
  camera.up.copy(new THREE.Vector3(0, 1, 0).applyQuaternion(orbitQuat));
  camera.lookAt(target);
  if (!perspectiveEnabled) updateOrthoFrustum();
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

  const vFov = perspectiveFovRad();
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(viewAspect, 0.01));
  const fov = Math.min(vFov, hFov);
  orbitRadius = (sphere.radius / Math.sin(fov / 2)) * 1.15;

  updateCamera();
}

updateCamera();

// ── Pointer / mouse / touch controls ────────────────────────────────────────
// Desktop (unchanged): middle-drag orbit, Shift+middle pan, wheel zoom, F fit.
// Mobile: 1-finger orbit, pinch zoom, 2-finger pan, double-tap fit.
// touch-action:none + preventDefault stop Chrome from scrolling/zooming the page.
canvas.style.touchAction = 'none';

let isDragging = false;
let lastMouse = { x: 0, y: 0 };

/** Shared orbit from screen deltas (mouse middle-drag + 1-finger touch). */
function applyOrbitDelta(dx, dy) {
  const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(orbitQuat);
  const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(orbitQuat);
  const rotH = new THREE.Quaternion().setFromAxisAngle(cameraUp, -dx * 0.005);
  const rotV = new THREE.Quaternion().setFromAxisAngle(cameraRight, -dy * 0.005);
  orbitQuat.premultiply(rotH).premultiply(rotV);
  updateCamera();
}

/** Shared pan from screen deltas (Shift+middle mouse + 2-finger drag). */
function applyPanDelta(dx, dy) {
  const panSpeed = orbitRadius * 0.001;
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  target.addScaledVector(right, -dx * panSpeed);
  target.addScaledVector(up, dy * panSpeed);
  updateCamera();
}

function applyZoomFactor(factor) {
  orbitRadius *= factor;
  orbitRadius = Math.max(1, orbitRadius);
  updateCamera();
}

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
      applyPanDelta(dx, dy);
    } else {
      applyOrbitDelta(dx, dy);
    }
    return;
  }

  if (activeTool && isSnapPickTool(activeTool)) {
    handleSnapMouseMove(e);
  }
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  applyZoomFactor(e.deltaY > 0 ? 1.1 : 0.9);
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

// ── Touch / Pointer gestures (mobile) ───────────────────────────────────────
const activePointers = new Map();
const TOUCH_DRAG_THRESHOLD_PX = 8;
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_MAX_DIST_PX = 28;

let touchGesture = null; // 'orbit' | 'pinchpan' | null
let touchMoved = false;
let touchOrbitLast = null;
let pinchStartDist = 0;
let pinchStartRadius = 0;
let pinchPanLastMid = null;
let lastTapTime = 0;
let lastTapX = 0;
let lastTapY = 0;
let suppressNextClick = false;

function pointerDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function pointerMidpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function isTouchLikePointer(e) {
  return e.pointerType === 'touch' || e.pointerType === 'pen';
}

function onTouchPointerDown(e) {
  if (!isTouchLikePointer(e)) return;
  e.preventDefault();
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch (_) {
    /* some browsers throw if already captured */
  }
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  touchMoved = false;

  if (activePointers.size === 1) {
    const now = performance.now();
    const dist = Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY);
    // Double-tap → fit model (before orbit starts)
    if (now - lastTapTime < DOUBLE_TAP_MS && dist < DOUBLE_TAP_MAX_DIST_PX) {
      fitCameraToModel();
      lastTapTime = 0;
      suppressNextClick = true;
      touchGesture = 'doubletap';
      touchOrbitLast = null;
      return;
    }
    lastTapTime = now;
    lastTapX = e.clientX;
    lastTapY = e.clientY;
    touchGesture = 'orbit';
    touchOrbitLast = { x: e.clientX, y: e.clientY };
  } else if (activePointers.size >= 2) {
    // 2-finger: pinch zoom + two-finger pan
    const pts = [...activePointers.values()];
    pinchStartDist = Math.max(1, pointerDistance(pts[0], pts[1]));
    pinchStartRadius = orbitRadius;
    pinchPanLastMid = pointerMidpoint(pts[0], pts[1]);
    touchGesture = 'pinchpan';
    touchOrbitLast = null;
  }
}

function onTouchPointerMove(e) {
  if (!isTouchLikePointer(e)) return;
  if (!activePointers.has(e.pointerId)) return;
  e.preventDefault();
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (touchGesture === 'orbit' && activePointers.size === 1 && touchOrbitLast) {
    const dx = e.clientX - touchOrbitLast.x;
    const dy = e.clientY - touchOrbitLast.y;
    if (!touchMoved && Math.hypot(dx, dy) < TOUCH_DRAG_THRESHOLD_PX) return;
    touchMoved = true;
    suppressNextClick = true;
    touchOrbitLast = { x: e.clientX, y: e.clientY };
    // 1-finger drag → orbit (even if a measure tool is active — tools use tap)
    applyOrbitDelta(dx, dy);
    return;
  }

  if (touchGesture === 'pinchpan' && activePointers.size >= 2) {
    touchMoved = true;
    suppressNextClick = true;
    const pts = [...activePointers.values()];
    const dist = Math.max(1, pointerDistance(pts[0], pts[1]));
    const mid = pointerMidpoint(pts[0], pts[1]);
    // Pinch → zoom
    const zoomFactor = pinchStartDist / dist;
    orbitRadius = Math.max(1, pinchStartRadius * zoomFactor);
    // 2-finger drag → pan
    if (pinchPanLastMid) {
      applyPanDelta(mid.x - pinchPanLastMid.x, mid.y - pinchPanLastMid.y);
    } else {
      updateCamera();
    }
    pinchPanLastMid = mid;
    // Keep pinch baseline in sync so combined pinch+pan feels stable
    pinchStartDist = dist;
    pinchStartRadius = orbitRadius;
  }
}

function onTouchPointerUp(e) {
  if (!isTouchLikePointer(e)) return;
  if (!activePointers.has(e.pointerId)) return;
  e.preventDefault();
  activePointers.delete(e.pointerId);
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch (_) {
    /* ignore */
  }

  if (activePointers.size === 0) {
    // Short tap (no drag) → synthesize pick for measurement / surface tools
    if (!touchMoved && touchGesture !== 'doubletap' && !suppressNextClick && partGroup) {
      const synthetic = {
        clientX: e.clientX,
        clientY: e.clientY,
        button: 0,
        preventDefault() {},
        stopPropagation() {}
      };
      if (surfaceSelectMode) {
        // Single-face tap pick via rect of zero size / existing finish path
        startRectSelection(synthetic);
        finishRectSelection(synthetic);
      } else if (activeTool) {
        const point = getPickPoint(synthetic);
        if (point) {
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
        }
      }
    }
    touchGesture = null;
    touchOrbitLast = null;
    pinchPanLastMid = null;
    touchMoved = false;
    // Clear suppress on next tick so a real click from leftover mouse synth is ignored
    if (suppressNextClick) {
      setTimeout(() => {
        suppressNextClick = false;
      }, 0);
    }
  } else if (activePointers.size === 1) {
    // Lifted one finger from pinch — resume 1-finger orbit with remaining pointer
    const remaining = [...activePointers.values()][0];
    touchGesture = 'orbit';
    touchOrbitLast = { x: remaining.x, y: remaining.y };
    pinchPanLastMid = null;
  }
}

canvas.addEventListener('pointerdown', onTouchPointerDown, { passive: false });
canvas.addEventListener('pointermove', onTouchPointerMove, { passive: false });
canvas.addEventListener('pointerup', onTouchPointerUp, { passive: false });
canvas.addEventListener('pointercancel', onTouchPointerUp, { passive: false });

// ── SECTION C — Resize Handler ──────────────────────────────────────────────
function applyCanvasSize() {
  const parent = canvas.parentElement;
  if (!parent) return;
  // Prefer measured box — clientWidth can be 0 briefly during mobile chrome show/hide
  const rect = parent.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width || parent.clientWidth || 1));
  const h = Math.max(1, Math.round(rect.height || parent.clientHeight || 1));
  renderer.setPixelRatio(getDPR());
  renderer.setSize(w, h, false);
  viewAspect = w / h;
  perspectiveCamera.aspect = viewAspect;
  perspectiveCamera.updateProjectionMatrix();
  if (!perspectiveEnabled) updateOrthoFrustum();
}

const resizeObserver = new ResizeObserver(() => {
  applyCanvasSize();
});
resizeObserver.observe(canvas.parentElement);

window.addEventListener('resize', () => applyCanvasSize());
window.addEventListener('orientationchange', () => {
  // Orientation change often reports stale sizes until the next frame
  setTimeout(applyCanvasSize, 100);
  setTimeout(applyCanvasSize, 400);
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    applyCanvasSize();
    if (webglContextLost) {
      recoverWebGL('Tab visible — attempting WebGL recovery');
    }
  }
});

// Initial size (parent may still be laying out)
applyCanvasSize();
requestAnimationFrame(applyCanvasSize);

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

let gnomonRenderer = new THREE.WebGLRenderer({
  canvas: gnomonCanvas,
  alpha: true,
  antialias: !lowEndGpu
});
gnomonRenderer.setPixelRatio(getDPR());
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
  if (webglContextLost) return;
  try {
    updateCoordAxisScreenScale();
    renderer.render(scene, camera);
    updateGnomonOrientation();
    gnomonRenderer.render(gnomonScene, gnomonCamera);
  } catch (err) {
    // Context loss mid-frame can throw; recover instead of killing the rAF loop
    console.warn('Render error (possible WebGL context loss):', err);
    webglContextLost = true;
    showViewerError('WebGL render failed. Tap Retry to recover.', true);
  }
}
animate();

// ── Viewer loading / error UI ───────────────────────────────────────────────
const viewerLoadingEl = document.getElementById('viewer-loading');
const viewerLoadingTextEl = document.getElementById('viewer-loading-text');
const viewerErrorEl = document.getElementById('viewer-error');
const viewerErrorTextEl = document.getElementById('viewer-error-text');
const viewerErrorRetryBtn = document.getElementById('viewer-error-retry');
const viewerErrorDismissBtn = document.getElementById('viewer-error-dismiss');

function showViewerLoading(message) {
  if (viewerLoadingTextEl) viewerLoadingTextEl.textContent = message || 'Loading…';
  if (viewerLoadingEl) viewerLoadingEl.hidden = false;
}

function hideViewerLoading() {
  if (viewerLoadingEl) viewerLoadingEl.hidden = true;
}

function showViewerError(message, canRetry = false) {
  if (viewerErrorTextEl) viewerErrorTextEl.textContent = message;
  if (viewerErrorRetryBtn) viewerErrorRetryBtn.hidden = !canRetry;
  if (viewerErrorEl) viewerErrorEl.hidden = false;
}

function hideViewerError() {
  if (viewerErrorEl) viewerErrorEl.hidden = true;
}

viewerErrorDismissBtn?.addEventListener('click', () => hideViewerError());
viewerErrorRetryBtn?.addEventListener('click', () => {
  recoverWebGL('Manual retry');
});

/**
 * Re-create WebGL renderers after context loss and reload the current STEP if we still have it.
 * Mid-tier Android GPUs (Mali on A51) lose context under memory pressure — blank canvas without this.
 */
async function recoverWebGL(reason = 'WebGL context recovery') {
  console.warn(reason);
  showViewerLoading('Recovering WebGL…');
  hideViewerError();
  try {
    try {
      renderer.dispose();
    } catch (_) {
      /* already dead */
    }
    try {
      gnomonRenderer.dispose();
    } catch (_) {
      /* already dead */
    }

    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !lowEndGpu,
      powerPreference: lowEndGpu ? 'low-power' : 'default',
      failIfMajorPerformanceCaveat: false
    });
    renderer.setPixelRatio(getDPR());

    gnomonRenderer = new THREE.WebGLRenderer({
      canvas: gnomonCanvas,
      alpha: true,
      antialias: !lowEndGpu
    });
    gnomonRenderer.setPixelRatio(getDPR());
    gnomonRenderer.setSize(GNOMON_WIDGET_PX, GNOMON_WIDGET_PX, false);
    gnomonRenderer.setClearColor(0x000000, 0);

    attachWebGlContextHandlers(canvas);
    attachWebGlContextHandlers(gnomonCanvas);

    webglContextLost = false;
    applyCanvasSize();

    if (lastLoadedArrayBuffer?.byteLength) {
      await loadStepFile(lastLoadedArrayBuffer, loadedFileName || 'recovered.step');
    } else {
      hideViewerLoading();
      setStatus('WebGL recovered — reload a STEP file if the model is missing');
    }
  } catch (err) {
    console.error(err);
    hideViewerLoading();
    webglContextLost = true;
    showViewerError(`WebGL recovery failed: ${err.message}`, true);
    setStatus(`WebGL recovery failed: ${err.message}`);
  }
}

function attachWebGlContextHandlers(targetCanvas) {
  if (!targetCanvas || targetCanvas.dataset.webglHandlers === '1') return;
  targetCanvas.dataset.webglHandlers = '1';
  targetCanvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); // required to allow contextrestored
    webglContextLost = true;
    showViewerError('WebGL context lost (GPU memory). Recovering…', true);
    setStatus('WebGL context lost — recovering…');
  });
  targetCanvas.addEventListener('webglcontextrestored', () => {
    recoverWebGL('webglcontextrestored');
  });
}

attachWebGlContextHandlers(canvas);
attachWebGlContextHandlers(gnomonCanvas);

// ── State ───────────────────────────────────────────────────────────────────
let partGroup = null;
let loadedFileName = '';
/** Kept for WebGL context-loss recovery (reload without re-picking the file). */
let lastLoadedArrayBuffer = null;
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
let brepHoleWorker = null;
let holeWorkerRequestId = 0;
/** 'brep' | 'mesh' — which worker is handling the active request */
let activeHoleDetectionSource = null;
/** 'holes' | 'pockets' — which feature job the user started */
let activeFeatureJob = null;
let activeHoleId = null;
let activeHoleGroupKey = null;
const highlightedHoleIds = new Set();
let holeDetectionRunning = false;
let holeProgressPanelHidden = false;
const holeMethodHint = document.getElementById('hole-method-hint');
const holeRansacGroup = document.getElementById('hole-ransac-group');

// Pocket detection state
let detectedPockets = [];
let pocketVisualGroup = null;
let activePocketId = null;
const highlightedPocketIds = new Set();
/** Original occt-import-js meshes kept when Body 2 replaces the display. */
let body1PartGroupBackup = null;
/** faceGroups triples from Body 2 meshShape: [triStart, triCount, faceHash] */
let body2FaceGroups = null;
/** 'floor' | 'wall-select' | null */
let hintPickMode = null;
const hintFloorHashes = new Set();
const hintWallHashes = new Set();
let hintAxis = null;
let hintHighlightGroup = null;

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

function updatePerspectiveToggleLabel() {
  if (!btnTogglePerspective) return;
  btnTogglePerspective.textContent = 'Perspective';
  btnTogglePerspective.classList.toggle('active', perspectiveEnabled);
  btnTogglePerspective.setAttribute(
    'title',
    perspectiveEnabled
      ? 'Perspective ON — click for orthographic'
      : 'Perspective OFF (orthographic) — click to enable'
  );
}

function setPerspectiveEnabled(enabled) {
  perspectiveEnabled = !!enabled;
  camera = perspectiveEnabled ? perspectiveCamera : orthoCamera;
  updateCamera();
  applyCanvasSize();
  updatePerspectiveToggleLabel();
}

function togglePerspective() {
  setPerspectiveEnabled(!perspectiveEnabled);
  setStatus(perspectiveEnabled ? 'Perspective view ON' : 'Perspective view OFF (orthographic)');
}

function syncFeaturePanelsCollapsedClass() {
  if (!featureSidePanels) return;
  const holeCollapsed = !holePanel || holePanel.classList.contains('collapsed');
  const pocketCollapsed = !pocketPanel || pocketPanel.classList.contains('collapsed');
  featureSidePanels.classList.toggle('all-collapsed', holeCollapsed && pocketCollapsed);
}

function updateFeaturePanelCollapseLabel(panel, button, label) {
  if (!button || !panel) return;
  const collapsed = panel.classList.contains('collapsed');
  button.textContent = collapsed ? 'Expand' : 'Collapse';
  button.title = collapsed ? `Expand ${label} panel` : `Collapse ${label} panel`;
  button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

function updateHolePanelCollapseLabel() {
  updateFeaturePanelCollapseLabel(holePanel, btnCollapseHolePanel, 'hole');
}

function updatePocketPanelCollapseLabel() {
  updateFeaturePanelCollapseLabel(pocketPanel, btnCollapsePocketPanel, 'pocket');
}

function toggleHolePanelCollapse() {
  if (!holePanel) return;
  holePanel.classList.toggle('collapsed');
  updateHolePanelCollapseLabel();
  syncFeaturePanelsCollapsedClass();
  requestAnimationFrame(() => applyCanvasSize());
}

function togglePocketPanelCollapse() {
  if (!pocketPanel) return;
  pocketPanel.classList.toggle('collapsed');
  updatePocketPanelCollapseLabel();
  syncFeaturePanelsCollapsedClass();
  requestAnimationFrame(() => applyCanvasSize());
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
    const label = activeFeatureJob === 'pockets' ? 'pockets' : 'holes';
    setStatus(`Detecting ${label}… ${Math.round(percent)}%`);
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
 * Lock / unlock Hole / Pocket Detection panel controls while a detection job runs.
 */
function setHoleDetectionBusy(busy) {
  holeDetectionRunning = busy;
  holeDetectionSection?.classList.toggle('is-busy', busy);
  pocketDetectionSection?.classList.toggle('is-busy', busy);

  if (holeFitMethodSelect) holeFitMethodSelect.disabled = busy;
  if (holeRansacIterationsInput) holeRansacIterationsInput.disabled = busy;
  if (btnSelectAllBodies) btnSelectAllBodies.disabled = busy;
  if (btnSelectSurfaces) btnSelectSurfaces.disabled = busy;

  // Detect / clear buttons follow selection + busy state together
  updateSurfaceSelectionUI();
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
  disposeBody1Backup();
  disposePartBboxMesh();
  disposeStockMesh();
  disposeCoordAxisGroup();
  disposeHintHighlight();
  resetHintWorkflow();

  resetAllMeasurements();
  clearHoleDetection();
  clearPocketDetection();
  clearSurfaceSelection();
  resetPocketSessionFlags();
  resetPocketWorkerSession();
  refreshPocketGateUI();

  customCoordSystem = null;
  partVolumeMm3 = 0;
  partBBox = null;
  loadedFileName = '';
  lastLoadedArrayBuffer = null;
  body2FaceGroups = null;
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

  // Lazy OCCT/WASM load — only when a STEP is opened (saves mobile memory at idle)
  occtInstancePromise = (async () => {
    try {
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
    } catch (err) {
      // Allow retry after failure (OOM / network on mobile)
      occtInstancePromise = null;
      throw err;
    }
  })();

  return occtInstancePromise;
}

// ── SECTION E — File Loading ────────────────────────────────────────────────
btnClose?.addEventListener('click', closeAnalyzer);

async function loadStepFile(arrayBuffer, fileName) {
  if (holeDetectionRunning) {
    stopHoleDetection();
  }

  const displayName = fileName || 'file';
  const fileSizeMb = (arrayBuffer.byteLength / (1024 * 1024)).toFixed(2);

  // Retain buffer for WebGL context-loss recovery on mobile
  lastLoadedArrayBuffer = arrayBuffer;

  setHoleProgressStopVisible(false);
  beginProgressLog('Loading STEP', `Opening ${displayName} (${fileSizeMb} MB)…`);
  reportLoadProgress('Preparing to load STEP file…', 2);
  showViewerLoading(`Loading ${displayName}…`);
  hideViewerError();
  await yieldToUI();

  try {
    reportLoadProgress('Loading OCCT importer (WASM)…', 8);
    showViewerLoading('Loading OCCT WASM…');
    await yieldToUI();
    const occt = await loadOcctLibrary();

    reportLoadProgress('Reading STEP geometry (this may take a moment)…', 18);
    showViewerLoading('Parsing STEP geometry…');
    await yieldToUI();
    const result = occt.ReadStepFile(new Uint8Array(arrayBuffer), null);

    if (!result || !result.meshes || result.meshes.length === 0) {
      reportLoadProgress('Error: no meshes found in STEP file', 100);
      appendHoleProgressLog('No meshes found in STEP file', 'is-error');
      setStatus('Error: no meshes found in STEP file');
      showViewerError('No meshes found in STEP file');
      hideViewerLoading();
      return;
    }

    const meshCount = result.meshes.length;
    reportLoadProgress(`Parsed ${meshCount} mesh(es) — rebuilding scene…`, 40);
    showViewerLoading(`Building ${meshCount} mesh(es)…`);
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
    applyCanvasSize();
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
    clearPocketDetection();
    clearSurfaceSelection();
    disposeBody1Backup();
    disposeHintHighlight();
    resetHintWorkflow();
    body2FaceGroups = null;
    resetPocketSessionFlags();
    resetPocketWorkerSession();
    refreshPocketGateUI();
    coordStatus.textContent = 'Click 3 points on model to define';

    const doneMsg = `Loaded ${meshCount} mesh(es) from ${displayName}`;
    setHoleProgressPercent(100);
    appendHoleProgressLog(doneMsg, 'is-done');
    setStatus(doneMsg);
    hideViewerLoading();
    persistPartModelAnalysis().catch(console.error);
  } catch (err) {
    appendHoleProgressLog(`Error loading file: ${err.message}`, 'is-error');
    setHoleProgressPercent(100);
    setStatus(`Error loading file: ${err.message}`);
    showViewerError(`Failed to load STEP: ${err.message}`, true);
    hideViewerLoading();
    console.error(err);
  }
}

loadStepFileHandler = loadStepFile;

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
  // Touch handlers synthesize picks; ignore ghost click after drag/double-tap
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }
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

function updateHoleMethodUi(method) {
  const brep = isBrepHoleMethod(method);
  if (holeRansacGroup) holeRansacGroup.style.display = brep ? 'none' : '';
  if (holeMethodHint) {
    holeMethodHint.textContent = brep
      ? 'Exact CAD surfaces — no circle fit needed'
      : 'Fits circles to mesh triangles (slower, use if B-Rep fails)';
  }
}

function initHoleDetectionPreferences() {
  // Always default to B-Rep Feature Recognition on load
  const method = BREP_HOLE_METHOD;
  if (holeFitMethodSelect) holeFitMethodSelect.value = method;
  saveHoleMethodPreference(method);
  const iterations = loadRansacIterationsPreference();
  if (holeRansacIterationsInput) holeRansacIterationsInput.value = String(iterations);
  updateHoleMethodUi(method);
}

function getHoleDetectionOptions() {
  return {
    method: holeFitMethodSelect?.value ?? loadHoleMethodPreference(),
    ransacIterations: parseInt(holeRansacIterationsInput?.value, 10) || loadRansacIterationsPreference(),
    selectedFaces: selectedFaces.size > 0 ? selectedFaces : null
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

function getBrepHoleWorker() {
  if (!brepHoleWorker) {
    brepHoleWorker = new Worker(`/js/brep-feature-worker.js?v=${JS_ASSET_V}`, { type: 'module' });
    brepHoleWorker.onmessage = handleHoleWorkerMessage;
    brepHoleWorker.onerror = (err) => {
      console.error('B-Rep hole worker error:', err);
      if (holeDetectionRunning && activeHoleDetectionSource === 'brep') {
        appendHoleProgressLog(
          `B-Rep worker error: ${err.message || err} — falling back to mesh analysis…`,
          'is-error'
        );
        startMeshHoleDetection(holeWorkerRequestId);
      }
    };
  }
  return brepHoleWorker;
}

function serializePartMeshes() {
  if (!partGroup) return [];
  const meshes = [];
  partGroup.children.forEach((child) => {
    if (child.isMesh && child.geometry) meshes.push(child);
  });
  return serializeMeshesFromGroup(meshes);
}

function startMeshHoleDetection(requestId) {
  const meshes = serializePartMeshes();
  if (meshes.length === 0) {
    setHoleDetectionBusy(false);
    appendHoleProgressLog('No mesh data available for fallback', 'is-error');
    setStatus('Hole detection error: no mesh data');
    return;
  }

  const options = getHoleDetectionOptions();
  // Mesh circle-fit cannot use brep-aag — fall back to RANSAC+Taubin
  const meshMethod = isBrepHoleMethod(options.method) ? 'ransac-taubin' : options.method;
  activeHoleDetectionSource = 'mesh';
  appendHoleProgressLog(`Mesh detection — method: ${meshMethod}, RANSAC: ${options.ransacIterations}`);
  appendHoleProgressLog(`Serializing ${meshes.length} mesh(es)…`);
  setHoleProgressPercent(2);

  const workerOptions = {
    ...options,
    method: meshMethod,
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

function runHoleDetection() {
  if (holeDetectionRunning) {
    setStatus('Hole detection already in progress');
    return;
  }

  if (!partGroup) {
    setStatus('Load a STEP file first');
    return;
  }

  // New hole run invalidates plugs / Body 2 and pocket results first
  if (body1PartGroupBackup || getPocketBodyState()) {
    clearPocketDetection();
    resetHintWorkflow();
    disposeHintHighlight();
    restoreBody1Mesh({ clearSelection: true });
    resetPocketBodyState();
    resetPocketWorkerSession();
  }

  // No selection yet → treat as whole-part detection
  if (selectedFaces.size === 0) {
    selectAllBodies();
    if (selectedFaces.size === 0) {
      setStatus('No surfaces available to detect holes on');
      return;
    }
  }

  const requestId = ++holeWorkerRequestId;
  activeFeatureJob = 'holes';

  setStatus('Detecting holes…');
  setHoleDetectionBusy(true);

  const scopeLabel = `${selectedFaces.size} selected surface(s)`;
  beginHoleProgressLog(scopeLabel);
  clearHoleDetection();

  const method = getHoleDetectionOptions().method;
  const preferBrep =
    isBrepHoleMethod(method) &&
    lastLoadedArrayBuffer &&
    lastLoadedArrayBuffer.byteLength > 0;

  if (preferBrep) {
    activeHoleDetectionSource = 'brep';
    appendHoleProgressLog(`Method: ${BREP_HOLE_METHOD} — B-Rep feature recognition (AAG)…`);
    setHoleProgressPercent(2);
    try {
      const worker = getBrepHoleWorker();
      // Transfer a copy so the main thread keeps lastLoadedArrayBuffer for recovery
      const bufferCopy = lastLoadedArrayBuffer.slice(0);
      worker.postMessage(
        {
          type: 'detect',
          requestId,
          arrayBuffer: bufferCopy,
          options: { features: 'holes' }
        },
        [bufferCopy]
      );
    } catch (err) {
      console.warn('Failed to start B-Rep worker, falling back to mesh', err);
      appendHoleProgressLog('B-Rep worker unavailable — falling back to mesh analysis…', 'is-error');
      startMeshHoleDetection(requestId);
    }
    return;
  }

  if (isBrepHoleMethod(method) && !lastLoadedArrayBuffer) {
    appendHoleProgressLog('No STEP buffer for B-Rep — using mesh detection…', 'is-error');
  }
  startMeshHoleDetection(requestId);
}

/**
 * Pocket detection — gated on Body 2 (hole-plugged duplicate).
 */
function runPocketDetection() {
  if (holeDetectionRunning) {
    setStatus('Feature detection already in progress');
    return;
  }

  const method = pocketDetectionMethod?.value || 'aag-walk';
  if (method === 'user-hinted') {
    setStatus('User-hinted mode uses the step buttons — not Detect Pockets');
    return;
  }

  const state = getPocketBodyState();
  if (!state || state.status !== 'ready') {
    window.alert(
      'Plug Holes is inactive.\n\nRun “Plug Holes” after Detect Holes before running Detect Pockets. Pocket detection requires the hole-plugged Body 2.'
    );
    setStatus('Plug Holes first — then run Detect Pockets');
    refreshPocketGateUI();
    return;
  }

  if (!partGroup) {
    setStatus('Load a STEP file first');
    return;
  }

  const requestId = ++holeWorkerRequestId;
  activeFeatureJob = 'pockets';
  activeHoleDetectionSource = 'brep';

  let params = {};
  if (method === 'hull-subtract') {
    params = {
      minVolume: Number(document.getElementById('pocket-min-volume')?.value ?? 1),
      minOpeningWidth: Number(document.getElementById('pocket-min-opening')?.value ?? 0.5),
      hullDeflection: Number(document.getElementById('pocket-hull-deflection')?.value ?? 0.02)
    };
  } else if (method === 'slicing') {
    params = {
      axisOverride: document.getElementById('pocket-slicing-axis')?.value || 'auto',
      sliceStep: Number(document.getElementById('pocket-slice-step')?.value ?? 0.5),
      minContourArea: Number(document.getElementById('pocket-min-contour-area')?.value ?? 1)
    };
  }

  // Serialize holes the viewer already detected so the worker can filter plug ghosts
  // even if its Body-2 session hole list differs.
  params.pluggedHoles = detectedHoles.map((h) => ({
    radius: h.radius,
    diameter: h.diameter,
    depth: h.depth,
    center: h.center,
    axis: h.axis,
    stages: (h.stages || [])
      .filter((s) => s.type === 'cylinder' && s.radius > 0)
      .map((s) => ({ type: 'cylinder', radius: s.radius, depth: s.depth }))
  }));

  setStatus(`Detecting pockets (${method})…`);
  setHoleDetectionBusy(true);
  beginProgressLog('Pocket Detection', `Starting pocket detection (${method})…`);
  setHoleProgressStopVisible(true);
  clearPocketDetection();
  appendHoleProgressLog(`Method: ${method} on hole-plugged Body 2…`);
  setHoleProgressPercent(2);

  try {
    const worker = getBrepHoleWorker();
    worker.postMessage({
      type: 'detectPockets',
      requestId,
      method,
      params
    });
  } catch (err) {
    console.error('Failed to start pocket detection', err);
    setHoleDetectionBusy(false);
    activeFeatureJob = null;
    activeHoleDetectionSource = null;
    appendHoleProgressLog(`Worker unavailable: ${err.message || err}`, 'is-error');
    setStatus('Pocket detection error: worker unavailable');
  }
}

function resetPocketWorkerSession() {
  try {
    if (brepHoleWorker) {
      brepHoleWorker.postMessage({ type: 'reset', requestId: ++holeWorkerRequestId });
    }
  } catch {
    /* ignore */
  }
}

function disposeBody1Backup() {
  if (!body1PartGroupBackup) return;
  body1PartGroupBackup.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
    }
  });
  body1PartGroupBackup = null;
}

function disposeHintHighlight() {
  if (!hintHighlightGroup) return;
  scene.remove(hintHighlightGroup);
  disposeObject(hintHighlightGroup);
  hintHighlightGroup = null;
}

function resetHintWorkflow() {
  hintPickMode = null;
  hintFloorHashes.clear();
  hintWallHashes.clear();
  hintAxis = null;
  disposeHintHighlight();
  if (floorSelectionCount) floorSelectionCount.textContent = '0 face(s) selected';
  if (wallSelectionCount) wallSelectionCount.textContent = '0 face(s)';
  if (hintWallStep) hintWallStep.dataset.disabled = 'true';
  if (hintPlugStep) hintPlugStep.dataset.disabled = 'true';
  if (hintCalculateStep) hintCalculateStep.dataset.disabled = 'true';
  if (hintDetectWallOptions) hintDetectWallOptions.hidden = true;
  if (btnHintNewPocket) btnHintNewPocket.hidden = true;
  if (hintAxisPreview) hintAxisPreview.textContent = '';
}

function syncPocketMethodParamsUI() {
  const method = pocketDetectionMethod?.value || 'aag-walk';
  if (pocketParamsAagWalk) pocketParamsAagWalk.hidden = method !== 'aag-walk';
  if (pocketParamsHullSubtract) pocketParamsHullSubtract.hidden = method !== 'hull-subtract';
  if (pocketParamsSlicing) pocketParamsSlicing.hidden = method !== 'slicing';
  if (pocketParamsUserHinted) pocketParamsUserHinted.hidden = method !== 'user-hinted';
  if (btnRunPocketDetection) btnRunPocketDetection.hidden = method === 'user-hinted';
}

function isHolePlugsActive() {
  return getPocketBodyState()?.status === 'ready';
}

function refreshPocketGateUI() {
  const state = getPocketBodyState();
  const hasHolesRun = getHoleDetectionCompleted();
  const plugsActive = state?.status === 'ready';
  const plugsPreparing = state?.status === 'preparing';
  const methodSelect = pocketDetectionMethod;
  const runBtn = btnRunPocketDetection;

  // Plug Holes / Clear Hole Plugs controls
  if (btnPlugHoles) {
    const canPlug =
      hasHolesRun &&
      !!lastLoadedArrayBuffer?.byteLength &&
      !holeDetectionRunning &&
      !plugsActive &&
      !plugsPreparing;
    btnPlugHoles.disabled = !canPlug;
    btnPlugHoles.classList.toggle('active', plugsActive);
    btnPlugHoles.title = plugsActive
      ? 'Hole plugs active (Body 2 ready)'
      : !hasHolesRun
        ? 'Run Detect Holes first'
        : plugsPreparing
          ? 'Plugging holes…'
          : 'Plug detected holes and prepare Body 2 for pocket detection';
  }
  if (btnClearHolePlugs) {
    const canClear =
      plugsActive ||
      plugsPreparing ||
      state?.status === 'failed';
    // Allow clear while Plug Holes is running so the user can abort/reset
    const blockedByOtherJob = holeDetectionRunning && activeFeatureJob !== 'prepareBody2';
    btnClearHolePlugs.disabled = !canClear || blockedByOtherJob;
    btnClearHolePlugs.title = canClear
      ? 'Remove hole plugs and restore original Body 1 (clears pocket detection)'
      : 'No hole plugs active';
  }

  if (!hasHolesRun) {
    if (pocketGateWarning) pocketGateWarning.hidden = false;
    if (pocketGateWarningText) {
      pocketGateWarningText.textContent =
        'Run Detect Holes, then Plug Holes — pocket detection operates on a copy of the part with holes plugged, to avoid reporting hole bores as false pocket cavities.';
    }
    if (btnGotoHoleDetection) btnGotoHoleDetection.textContent = 'Detect Holes';
    if (pocketPreparingNotice) pocketPreparingNotice.hidden = true;
    if (pocketPrepWarning) pocketPrepWarning.hidden = true;
    if (methodSelect) methodSelect.disabled = true;
    if (runBtn) {
      runBtn.disabled = true;
      runBtn.title = 'Run Detect Holes, then Plug Holes first';
    }
    return;
  }

  if (!plugsActive && !plugsPreparing) {
    if (pocketGateWarning) pocketGateWarning.hidden = false;
    if (pocketGateWarningText) {
      pocketGateWarningText.textContent =
        'Plug Holes must be active first — pocket detection operates on a copy of the part with all holes plugged, to avoid reporting hole bores as false pocket cavities.';
    }
    if (btnGotoHoleDetection) btnGotoHoleDetection.textContent = 'Plug Holes';
    if (pocketPreparingNotice) pocketPreparingNotice.hidden = true;
    if (state?.status !== 'failed' && pocketPrepWarning) pocketPrepWarning.hidden = true;
    if (methodSelect) methodSelect.disabled = true;
    if (runBtn) {
      // Keep clickable so the user gets an explicit warning
      runBtn.disabled = holeDetectionRunning || !partGroup;
      runBtn.title = 'Plug Holes first';
    }
    if (state?.status === 'failed') {
      if (pocketPrepWarning) pocketPrepWarning.hidden = false;
      if (pocketPrepSkippedText) {
        pocketPrepSkippedText.textContent =
          `Body preparation failed: ${state.error}. Pocket detection unavailable until Plug Holes succeeds.`;
      }
    }
    return;
  }

  if (pocketGateWarning) pocketGateWarning.hidden = true;

  if (plugsPreparing) {
    if (pocketPreparingNotice) pocketPreparingNotice.hidden = false;
    if (pocketPrepHoleCount) pocketPrepHoleCount.textContent = String(state.holeCount ?? detectedHoles.length);
    if (methodSelect) methodSelect.disabled = true;
    if (runBtn) {
      runBtn.disabled = true;
      runBtn.title = 'Waiting for Plug Holes…';
    }
    return;
  }

  if (pocketPreparingNotice) pocketPreparingNotice.hidden = true;

  // ready
  if (methodSelect) methodSelect.disabled = false;
  syncPocketMethodParamsUI();
  if (runBtn) {
    runBtn.disabled = holeDetectionRunning || !partGroup;
    runBtn.title = '';
  }

  if (state.skippedHoles?.length > 0) {
    if (pocketPrepWarning) pocketPrepWarning.hidden = false;
    if (pocketPrepSkippedText) {
      pocketPrepSkippedText.textContent =
        `${state.skippedHoles.length} hole(s) could not be plugged and may still appear as spurious cavities.`;
    }
  } else if (pocketPrepWarning) {
    pocketPrepWarning.hidden = true;
  }
}

function restoreBody1Mesh({ clearSelection = true } = {}) {
  if (!body1PartGroupBackup) return false;
  if (partGroup) {
    scene.remove(partGroup);
    partGroup.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      }
    });
    partGroup = null;
  }
  partGroup = body1PartGroupBackup;
  body1PartGroupBackup = null;
  scene.add(partGroup);
  body2FaceGroups = null;
  if (clearSelection) clearSurfaceSelection();
  return true;
}

function clearHolePlugs({ confirm = true } = {}) {
  const state = getPocketBodyState();
  const hasPlugs =
    state &&
    (state.status === 'ready' || state.status === 'preparing' || state.status === 'failed');
  if (!hasPlugs && !body1PartGroupBackup) {
    setStatus('No hole plugs to clear');
    return;
  }

  if (confirm) {
    const ok = window.confirm(
      'Clear Hole Plugs?\n\nThis will restore the original part (Body 1) and reset all Pocket Detection data (detected pockets will be cleared).'
    );
    if (!ok) return;
  }

  if (holeDetectionRunning && activeFeatureJob === 'prepareBody2') {
    stopHoleDetection();
  }

  clearPocketDetection();
  resetHintWorkflow();
  disposeHintHighlight();
  restoreBody1Mesh();
  resetPocketBodyState();
  resetPocketWorkerSession();
  refreshPocketGateUI();
  setStatus('Hole plugs cleared — Body 1 restored; pocket detection reset');
}

function prepareBody2() {
  if (!lastLoadedArrayBuffer?.byteLength) {
    setPocketBodyState({ status: 'failed', skippedHoles: [], holeCount: 0, error: 'No STEP buffer', note: null });
    refreshPocketGateUI();
    return;
  }

  const existing = getPocketBodyState();
  if (existing?.status === 'preparing' || existing?.status === 'ready') return;
  if (holeDetectionRunning && activeFeatureJob === 'prepareBody2') return;

  setPocketBodyState({
    status: 'preparing',
    skippedHoles: [],
    holeCount: detectedHoles.length,
    error: null,
    note: null
  });
  // Update notices without re-entering prepare
  if (pocketGateWarning) pocketGateWarning.hidden = true;
  if (pocketPreparingNotice) pocketPreparingNotice.hidden = false;
  if (pocketPrepHoleCount) pocketPrepHoleCount.textContent = String(detectedHoles.length);
  if (pocketDetectionMethod) pocketDetectionMethod.disabled = true;
  if (btnRunPocketDetection) btnRunPocketDetection.disabled = true;

  const requestId = ++holeWorkerRequestId;
  activeFeatureJob = 'prepareBody2';
  setHoleDetectionBusy(true);
  beginProgressLog('Pocket Body Prep', 'Plugging holes and preparing Body 2…');
  setHoleProgressStopVisible(true);
  setHoleProgressPercent(2);

  try {
    const worker = getBrepHoleWorker();
    const bufferCopy = lastLoadedArrayBuffer.slice(0);
    worker.postMessage(
      {
        type: 'prepareBody2',
        requestId,
        arrayBuffer: bufferCopy
      },
      [bufferCopy]
    );
  } catch (err) {
    setHoleDetectionBusy(false);
    activeFeatureJob = null;
    setPocketBodyState({
      status: 'failed',
      skippedHoles: [],
      holeCount: detectedHoles.length,
      error: String(err?.message ?? err),
      note: null
    });
    refreshPocketGateUI();
  }
}

function applyBody2Mesh(meshPayload) {
  if (!meshPayload?.positions?.length || !meshPayload?.indices?.length) return;

  // Keep Body 1 meshes for restore on new load (disposePartGroup clears display)
  if (partGroup && !body1PartGroupBackup) {
    body1PartGroupBackup = partGroup;
    scene.remove(partGroup);
    partGroup = null;
  } else if (partGroup) {
    disposePartGroup();
  }

  const geometry = new THREE.BufferGeometry();
  const pos = meshPayload.positions instanceof Float32Array
    ? meshPayload.positions
    : new Float32Array(meshPayload.positions);
  const idx = meshPayload.indices instanceof Uint32Array
    ? meshPayload.indices
    : new Uint32Array(meshPayload.indices);
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setIndex(new THREE.BufferAttribute(idx, 1));
  if (meshPayload.normals?.length) {
    const nrm = meshPayload.normals instanceof Float32Array
      ? meshPayload.normals
      : new Float32Array(meshPayload.normals);
    geometry.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  } else {
    geometry.computeVertexNormals();
  }

  body2FaceGroups = meshPayload.faceGroups || null;

  const mesh = createShadedMeshWithEdges(geometry);
  mesh.userData.meshIndex = 0;
  mesh.userData.isBody2 = true;
  // Slightly different tint so Body 2 is visually distinct
  if (mesh.material && mesh.material.color) {
    mesh.material.color.setHex(0xb8c8e0);
  }

  partGroup = new THREE.Group();
  partGroup.userData.isBody2 = true;
  partGroup.add(mesh);
  scene.add(partGroup);
  clearSurfaceSelection();
  setStatus('Showing Body 2 (holes plugged) — ready for pocket detection');
}

function faceHashFromTriangle(triIndex) {
  if (!body2FaceGroups?.length) return null;
  for (let i = 0; i + 2 < body2FaceGroups.length; i += 3) {
    const triStart = body2FaceGroups[i];
    const triCount = body2FaceGroups[i + 1];
    const faceHash = body2FaceGroups[i + 2];
    if (triIndex >= triStart && triIndex < triStart + triCount) return faceHash;
  }
  return null;
}

function rebuildHintHighlight() {
  disposeHintHighlight();
  if (!partGroup || (!hintFloorHashes.size && !hintWallHashes.size)) return;
  // Highlight by recoloring is hard without per-face materials; use status text primarily.
  // Soft overlay: outline whole Body 2 when selecting.
  hintHighlightGroup = new THREE.Group();
  scene.add(hintHighlightGroup);
}

function updateHintStepUI() {
  if (floorSelectionCount) {
    floorSelectionCount.textContent = `${hintFloorHashes.size} face(s) selected`;
  }
  if (wallSelectionCount) {
    wallSelectionCount.textContent = `${hintWallHashes.size} face(s)`;
  }
  if (hintWallStep) hintWallStep.dataset.disabled = hintFloorHashes.size === 0 ? 'true' : 'false';
  if (hintPlugStep) hintPlugStep.dataset.disabled = hintWallHashes.size === 0 ? 'true' : 'false';
  const axisOk = hintAxis && hintAxis.length === 3;
  if (hintCalculateStep) {
    hintCalculateStep.dataset.disabled =
      hintFloorHashes.size === 0 || hintWallHashes.size === 0 || !axisOk ? 'true' : 'false';
  }
  if (hintAxisPreview && hintAxis) {
    hintAxisPreview.textContent = `axis [${hintAxis.map((v) => v.toFixed(3)).join(', ')}]`;
  }
}

/**
 * Immediately stop hole detection, kill the worker, and clear all remnants.
 */
function stopHoleDetection() {
  if (!holeDetectionRunning) return;

  holeWorkerRequestId += 1;
  activeHoleDetectionSource = null;
  const stoppedJob = activeFeatureJob;
  activeFeatureJob = null;

  if (holeWorker) {
    try {
      holeWorker.terminate();
    } catch (err) {
      console.error(err);
    }
    holeWorker = null;
  }
  if (brepHoleWorker) {
    try {
      brepHoleWorker.terminate();
    } catch (err) {
      console.error(err);
    }
    brepHoleWorker = null;
  }

  if (stoppedJob === 'pockets' || stoppedJob === 'hintCalc' || stoppedJob === 'hintWalls') {
    clearPocketDetection();
  } else if (stoppedJob === 'prepareBody2') {
    setPocketBodyState({
      status: 'not-ready',
      skippedHoles: [],
      holeCount: detectedHoles.length,
      error: null,
      note: null
    });
    refreshPocketGateUI();
  } else if (stoppedJob !== 'hintAxis') {
    clearHoleDetection();
  }
  setHoleDetectionBusy(false);
  setHoleProgressPercent(100);
  appendHoleProgressLog('Detection stopped by user — results cleared', 'is-error');
  setStatus(
    stoppedJob === 'pockets' || stoppedJob === 'prepareBody2'
      ? 'Pocket preparation/detection stopped'
      : 'Hole detection stopped'
  );
}

function handleHoleWorkerMessage(event) {
  const data = event.data;
  const { type, requestId, holes, pockets, elapsedMs, message, percent, source } = data;
  if (requestId !== holeWorkerRequestId) return;

  if (type === 'progress') {
    handleHoleProgressMessage(message, percent);
    return;
  }

  if (type === 'body2-ready') {
    setHoleDetectionBusy(false);
    activeFeatureJob = null;
    activeHoleDetectionSource = null;
    setPocketBodyState({
      status: 'ready',
      skippedHoles: data.skippedHoles ?? [],
      holeCount: data.holeCount ?? 0,
      error: null,
      note: data.note ?? null
    });
    applyBody2Mesh(data.mesh);
    setHoleProgressPercent(100);
    appendHoleProgressLog(
      `Body 2 ready — ${data.holeCount ?? 0} hole(s) plugged` +
        (data.skippedHoles?.length ? ` (${data.skippedHoles.length} skipped)` : '') +
        ` (${Math.round(elapsedMs || 0)} ms)`,
      'is-done'
    );
    refreshPocketGateUI();
    return;
  }

  if (type === 'hint-walls') {
    setHoleDetectionBusy(false);
    activeFeatureJob = null;
    hintWallHashes.clear();
    for (const h of data.wallHashes ?? []) hintWallHashes.add(h);
    updateHintStepUI();
    setStatus(`Detected ${data.wallCount ?? 0} wall face(s)`);
    // Auto-suggest axis
    try {
      const worker = getBrepHoleWorker();
      const rid = ++holeWorkerRequestId;
      activeFeatureJob = 'hintAxis';
      worker.postMessage({
        type: 'hintSuggestAxis',
        requestId: rid,
        payload: {
          floorHashes: [...hintFloorHashes],
          wallHashes: [...hintWallHashes]
        }
      });
    } catch {
      /* ignore */
    }
    return;
  }

  if (type === 'hint-axis') {
    activeFeatureJob = null;
    hintAxis = data.axis ?? [0, 0, 1];
    updateHintStepUI();
    return;
  }

  if (type === 'hint-result') {
    setHoleDetectionBusy(false);
    activeFeatureJob = null;
    if (data.pocket) {
      detectedPockets = [...detectedPockets, data.pocket];
      clearPocketHighlightState();
      renderPocketVisuals();
      renderPocketsList();
      updatePocketCountBadge();
      updatePocketCsvButtons();
      if (btnHintNewPocket) btnHintNewPocket.hidden = false;
      setStatus(`Added user-hinted pocket (${Math.round(elapsedMs || 0)} ms)`);
      appendHoleProgressLog('User-hinted pocket added to table', 'is-done');
    }
    setHoleProgressPercent(100);
    return;
  }

  if (type === 'error') {
    if (activeFeatureJob === 'prepareBody2') {
      setHoleDetectionBusy(false);
      activeHoleDetectionSource = null;
      activeFeatureJob = null;
      setPocketBodyState({
        status: 'failed',
        skippedHoles: [],
        holeCount: detectedHoles.length,
        error: message,
        note: null
      });
      setHoleProgressPercent(100);
      appendHoleProgressLog(`Body 2 prep failed: ${message}`, 'is-error');
      setStatus(`Body 2 preparation failed: ${message}`);
      refreshPocketGateUI();
      return;
    }

    if (activeFeatureJob === 'pockets' || activeFeatureJob === 'hintCalc' || activeFeatureJob === 'hintWalls') {
      setHoleDetectionBusy(false);
      activeHoleDetectionSource = null;
      activeFeatureJob = null;
      setHoleProgressPercent(100);
      appendHoleProgressLog(`Error: ${message}`, 'is-error');
      setStatus(`Pocket detection error: ${message}`);
      return;
    }

    // B-Rep failure → automatic mesh fallback (keep busy flag on)
    if (source === 'brep' || activeHoleDetectionSource === 'brep') {
      console.warn('B-Rep feature recognition failed, falling back to mesh curvature analysis', message);
      appendHoleProgressLog(
        `B-Rep recognition failed (${message}) — falling back to mesh analysis…`,
        'is-error'
      );
      startMeshHoleDetection(requestId);
      return;
    }

    setHoleDetectionBusy(false);
    activeFeatureJob = null;
    clearHoleDetection();
    setHoleProgressPercent(100);
    appendHoleProgressLog(`Error: ${message}`, 'is-error');
    setStatus(`Hole detection error: ${message}`);
    return;
  }

  if (type !== 'result') return;

  setHoleDetectionBusy(false);
  activeHoleDetectionSource = null;
  const job = activeFeatureJob;
  activeFeatureJob = null;

  const holeCount = (holes ?? []).length;
  const pocketCount = (pockets ?? []).length;
  const srcLabel = source === 'brep' ? 'B-Rep AAG' : 'mesh';

  if (job === 'pockets') {
    applyDetectedPockets(pockets ?? []);
    const methodLabel = data.detectionMethod || 'pockets';
    const doneMsg = `Found ${pocketCount} pocket(s) via ${methodLabel} (${Math.round(elapsedMs)} ms)`;
    setHoleProgressPercent(100);
    appendHoleProgressLog(doneMsg, 'is-done');
    setStatus(doneMsg);
    return;
  }

  applyDetectedHoles(holes ?? []);
  setHoleDetectionCompleted(true);
  // Invalidate / rebuild Body 2 from the new hole set
  setPocketBodyState(null);
  resetPocketWorkerSession();
  const doneMsg = `Found ${holeCount} hole(s) via ${srcLabel} on ${selectedFaces.size} selected surface(s) (${Math.round(elapsedMs)} ms)`;
  setHoleProgressPercent(100);
  appendHoleProgressLog(doneMsg, 'is-done');
  setStatus(doneMsg);
  refreshPocketGateUI();
}

function applyDetectedHoles(holes) {
  detectedHoles = holes;
  clearHoleHighlightState();
  renderHoleVisuals();
  renderHolesList();
  renderHolesSummary();
  updateHoleCountBadge();
  updateHoleCsvButtons();
  btnAddHolesToCycle.disabled = holes.length === 0;
}

function clearHoleDetection() {
  detectedHoles = [];
  clearHoleHighlightState();
  disposeHoleVisuals();
  if (holesList) holesList.innerHTML = '';
  if (holesSummaryList) holesSummaryList.innerHTML = '';
  updateHoleCountBadge();
  updateHoleGroupCountBadge(0);
  updateHoleCsvButtons();
  if (btnAddHolesToCycle) btnAddHolesToCycle.disabled = true;
}

function pocketFootprintDiameterForFilter(pocket) {
  if (pocket.maxBoundedSize?.diameter > 0) return pocket.maxBoundedSize.diameter;
  const w = pocket.maxBoundedSize?.width ?? pocket.width ?? 0;
  const l = pocket.maxBoundedSize?.length ?? pocket.length ?? 0;
  if (pocket.shape === 'circular') return Math.max(w, l);
  if (w > 0 && l > 0 && Math.abs(w - l) / Math.max(w, l) < 0.1) return (w + l) / 2;
  return 0;
}

function holeRadiiForFilter(hole) {
  const radii = [];
  if (hole.radius > 0) radii.push(hole.radius);
  if (hole.diameter > 0) radii.push(hole.diameter / 2);
  for (const s of hole.stages ?? []) {
    if (s.type === 'cylinder' && s.radius > 0) radii.push(s.radius);
    else if (s.radius > 0) radii.push(s.radius);
  }
  return radii;
}

/** Main-thread safety net: drop shallow circular cavities that match detected holes. */
function filterPluggedHoleGhostPocketsLocal(pockets, holes) {
  if (!pockets?.length) return [];
  if (!holes?.length) return pockets;
  return pockets.filter((pocket) => {
    const dia = pocketFootprintDiameterForFilter(pocket);
    const depth = pocket.maxDepth ?? pocket.depth ?? 0;
    // Ultra-shallow circular/patched cavities after hole plugging are plug-face ghosts
    if (
      dia >= 8 &&
      depth > 0 &&
      depth <= 2.25 &&
      (pocket.isPatched || pocket.flagged || pocket.shape === 'circular')
    ) {
      return false;
    }
    if (!(dia > 0) || !holes?.length) return true;
    const pR = dia / 2;
    for (const hole of holes) {
      for (const r of holeRadiiForFilter(hole)) {
        const tol = Math.max(0.6, r * 0.08);
        if (Math.abs(pR - r) > tol && Math.abs(pR - r * 1.01) > tol) continue;
        if (depth > 0 && depth <= Math.max(3.5, (hole.depth || 0) * 0.45)) return false;
        if ((pocket.shape === 'circular' || pocket.isPatched) && depth > 0 && depth < 6) {
          return false;
        }
      }
    }
    return true;
  });
}

function applyDetectedPockets(pockets) {
  const incoming = pockets ?? [];
  const filtered = filterPluggedHoleGhostPocketsLocal(incoming, detectedHoles);
  if (filtered.length < incoming.length) {
    appendHoleProgressLog(
      `Removed ${incoming.length - filtered.length} plugged-hole ghost pocket(s)`,
      'is-done'
    );
  }
  detectedPockets = filtered;
  clearPocketHighlightState();
  renderPocketVisuals();
  renderPocketsList();
  updatePocketCountBadge();
  updatePocketCsvButtons();
}

function clearPocketDetection() {
  detectedPockets = [];
  clearPocketHighlightState();
  disposePocketVisuals();
  if (pocketsList) pocketsList.innerHTML = '';
  updatePocketCountBadge();
  updatePocketCsvButtons();
}

function clearPocketHighlightState() {
  activePocketId = null;
  highlightedPocketIds.clear();
}

function clearHoleHighlightState() {
  activeHoleId = null;
  activeHoleGroupKey = null;
  highlightedHoleIds.clear();
}

function disposeHoleVisuals() {
  if (!holeVisualGroup) return;
  scene.remove(holeVisualGroup);
  disposeObject(holeVisualGroup);
  holeVisualGroup = null;
}

function disposePocketVisuals() {
  if (!pocketVisualGroup) return;
  scene.remove(pocketVisualGroup);
  disposeObject(pocketVisualGroup);
  pocketVisualGroup = null;
}

const HOLE_COLOR_NORMAL = 0xff6600;
const HOLE_COLOR_NORMAL_RING = 0xff9900;
const HOLE_COLOR_HIGHLIGHT = 0xff6b6b;
const HOLE_COLOR_HIGHLIGHT_RING = 0xff3b3b;

function createHoleVisual(hole) {
  const group = new THREE.Group();
  if (!hole?.axis || !hole?.center || !(hole.radius > 0)) return group;

  const axis = new THREE.Vector3(hole.axis[0], hole.axis[1], hole.axis[2]).normalize();
  const opening = new THREE.Vector3(hole.center[0], hole.center[1], hole.center[2]);
  const defaultAxis = new THREE.Vector3(0, 1, 0);
  const cylQuat = new THREE.Quaternion().setFromUnitVectors(defaultAxis, axis);
  const capQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
  const mats = [];

  // Draw every cylindrical stage so counterbore / step holes show large + small
  // overlapping solids (not only the smallest radius).
  const cylStages = (hole.stages || []).filter(
    (s) => s.type === 'cylinder' && s.radius > 0 && (s.depth > 0 || s.location)
  );
  /** @type {Array<{ radius: number, depth: number, mid: THREE.Vector3, mouth: THREE.Vector3 }>} */
  let segments;
  if (cylStages.length > 0) {
    segments = cylStages.map((s) => {
      const depth = Math.max(s.depth || hole.radius * 0.5, s.radius * 0.25);
      let mid;
      let mouth;
      if (s.location && Array.isArray(s.location)) {
        mid = new THREE.Vector3(s.location[0], s.location[1], s.location[2]);
        // Prefer stage axis if present; else hole axis
        let sAxis = axis;
        if (s.axis && Array.isArray(s.axis)) {
          sAxis = new THREE.Vector3(s.axis[0], s.axis[1], s.axis[2]).normalize();
          if (sAxis.dot(axis) < 0) sAxis.negate();
        }
        mouth = mid.clone().addScaledVector(sAxis, -depth / 2);
      } else {
        mouth = opening.clone();
        mid = opening.clone().addScaledVector(axis, depth / 2);
      }
      return { radius: s.radius, depth, mid, mouth };
    });
  } else {
    const depth = Math.max(hole.depth || hole.radius * 2, hole.radius * 0.5);
    segments = [
      {
        radius: hole.radius,
        depth,
        mid: opening.clone().addScaledVector(axis, depth / 2),
        mouth: opening.clone()
      }
    ];
  }

  // Largest first so smaller bore draws on top when transparent
  segments.sort((a, b) => b.radius - a.radius);

  for (const seg of segments) {
    const cylinderGeo = new THREE.CylinderGeometry(seg.radius, seg.radius, seg.depth, 32, 1, false);
    const cylinderMat = new THREE.MeshBasicMaterial({
      color: HOLE_COLOR_NORMAL,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: true
    });
    const cylinder = new THREE.Mesh(cylinderGeo, cylinderMat);
    cylinder.raycast = () => {};
    cylinder.name = 'hole-cylinder';
    cylinder.setRotationFromQuaternion(cylQuat);
    cylinder.position.copy(seg.mid);
    // Keep both stages visible when they occupy the same space
    cylinder.renderOrder = Math.round(seg.radius * 10);
    group.add(cylinder);
    mats.push(cylinderMat);

    const capGeo = new THREE.CircleGeometry(seg.radius, 32);
    const capMat = new THREE.MeshBasicMaterial({
      color: HOLE_COLOR_NORMAL,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const capTop = new THREE.Mesh(capGeo, capMat);
    capTop.raycast = () => {};
    capTop.name = 'hole-cap';
    capTop.setRotationFromQuaternion(capQuat);
    capTop.position.copy(seg.mouth);
    capTop.renderOrder = cylinder.renderOrder + 1;
    group.add(capTop);
    mats.push(capMat);

    const capBot = new THREE.Mesh(capGeo.clone(), capMat.clone());
    capBot.raycast = () => {};
    capBot.name = 'hole-cap';
    capBot.setRotationFromQuaternion(capQuat);
    capBot.position.copy(seg.mouth.clone().addScaledVector(axis, seg.depth));
    capBot.renderOrder = cylinder.renderOrder + 1;
    group.add(capBot);
    mats.push(capBot.material);
  }

  // Ring at the overall hole opening (largest mouth radius)
  const ringR = Math.max(...segments.map((s) => s.radius), hole.radius);
  const torusGeo = new THREE.TorusGeometry(ringR, Math.max(ringR * 0.04, 0.05), 8, 48);
  const torusMat = new THREE.MeshBasicMaterial({
    color: HOLE_COLOR_NORMAL_RING,
    transparent: true,
    opacity: 0.75,
    depthWrite: false
  });
  const torus = new THREE.Mesh(torusGeo, torusMat);
  torus.raycast = () => {};
  torus.name = 'hole-ring';
  torus.position.copy(opening);
  const torusQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
  torus.setRotationFromQuaternion(torusQuat);
  torus.renderOrder = 50;
  group.add(torus);
  mats.push(torusMat);

  group.userData.holeId = hole.id;
  group.userData.holeMats = mats;
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
  updateHoleVisualHighlights();
}

function updateHoleVisualHighlights() {
  if (!holeVisualGroup) return;
  const hasHighlight = highlightedHoleIds.size > 0;

  holeVisualGroup.children.forEach((group) => {
    const highlighted = hasHighlight && highlightedHoleIds.has(group.userData.holeId);
    group.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const isRing = child.name === 'hole-ring';
      if (isRing) {
        child.material.color.setHex(highlighted ? HOLE_COLOR_HIGHLIGHT_RING : HOLE_COLOR_NORMAL_RING);
        child.material.opacity = highlighted ? 0.95 : 0.75;
      } else {
        child.material.color.setHex(highlighted ? HOLE_COLOR_HIGHLIGHT : HOLE_COLOR_NORMAL);
        child.material.opacity = highlighted ? 0.65 : 0.4;
      }
    });
  });
}

function holeSizeKey(value) {
  return formatNum(value, 2);
}

function getHoleGroupOptions() {
  return {
    byDiameter: chkGroupDiameter?.checked ?? true,
    byDepth: chkGroupDepth?.checked ?? false
  };
}

function buildHoleGroups() {
  const { byDiameter, byDepth } = getHoleGroupOptions();
  if ((!byDiameter && !byDepth) || detectedHoles.length === 0) return [];

  const map = new Map();
  detectedHoles.forEach((hole, index) => {
    const diaKey = byDiameter ? holeSizeKey(hole.diameter) : '*';
    const depthKey = byDepth ? holeSizeKey(hole.depth ?? 0) : '*';
    const key = `${diaKey}|${depthKey}`;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        holes: [],
        indices: [],
        diameter: byDiameter ? Number(diaKey) : null,
        depth: byDepth ? Number(depthKey) : null
      };
      map.set(key, group);
    }
    group.holes.push(hole);
    group.indices.push(index + 1);
  });

  const groups = [...map.values()];
  groups.sort((a, b) => {
    if (a.diameter != null && b.diameter != null && a.diameter !== b.diameter) {
      return a.diameter - b.diameter;
    }
    if (a.depth != null && b.depth != null && a.depth !== b.depth) {
      return a.depth - b.depth;
    }
    return b.holes.length - a.holes.length;
  });
  return groups;
}

function renderHolesList() {
  if (!holesList) return;
  holesList.innerHTML = '';

  if (detectedHoles.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'holes-table-empty';
    empty.textContent = 'No holes detected';
    holesList.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'holes-table';

  const thead = document.createElement('thead');
  thead.innerHTML =
    '<tr>' +
    '<th class="col-name">Name</th>' +
    '<th class="col-diameter">Diameter</th>' +
    '<th class="col-depth">Depth</th>' +
    '<th class="col-quality">Quality</th>' +
    '</tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  detectedHoles.forEach((hole, index) => {
    const row = document.createElement('tr');
    row.dataset.holeId = hole.id;
    if (hole.id === activeHoleId) row.classList.add('hole-row-active');

    const nameCell = document.createElement('td');
    nameCell.className = 'col-name';
    nameCell.textContent = `Hole ${index + 1}`;

    const diaCell = document.createElement('td');
    diaCell.className = 'col-diameter';
    diaCell.textContent = `Ø ${formatNum(hole.diameter, 2)} mm`;

    const depthCell = document.createElement('td');
    depthCell.className = 'col-depth';
    depthCell.textContent = `${formatNum(hole.depth, 2)} mm`;

    const qualityCell = document.createElement('td');
    qualityCell.className = 'col-quality';
    qualityCell.textContent = `${(hole.quality * 100).toFixed(0)}%`;

    row.appendChild(nameCell);
    row.appendChild(diaCell);
    row.appendChild(depthCell);
    row.appendChild(qualityCell);

    row.addEventListener('click', () => {
      selectSingleHole(hole, row, tbody);
    });

    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  holesList.appendChild(table);
}

function renderHolesSummary() {
  if (!holesSummaryList) return;
  holesSummaryList.innerHTML = '';

  const { byDiameter, byDepth } = getHoleGroupOptions();
  if (!byDiameter && !byDepth) {
    updateHoleGroupCountBadge(0);
    updateHoleCsvButtons();
    const empty = document.createElement('div');
    empty.className = 'holes-table-empty';
    empty.textContent = 'Tick Unique Diameter and/or Unique Depth to group holes';
    holesSummaryList.appendChild(empty);
    return;
  }

  if (detectedHoles.length === 0) {
    updateHoleGroupCountBadge(0);
    updateHoleCsvButtons();
    const empty = document.createElement('div');
    empty.className = 'holes-table-empty';
    empty.textContent = 'No holes to summarize';
    holesSummaryList.appendChild(empty);
    return;
  }

  const groups = buildHoleGroups();
  updateHoleGroupCountBadge(groups.length);
  updateHoleCsvButtons();

  const table = document.createElement('table');
  table.className = 'holes-table';

  const thead = document.createElement('thead');
  thead.innerHTML =
    '<tr>' +
    '<th class="col-name">Name</th>' +
    '<th class="col-diameter">Diameter</th>' +
    '<th class="col-depth">Depth</th>' +
    '<th class="col-qty">Qty</th>' +
    '</tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  groups.forEach((group, index) => {
    const row = document.createElement('tr');
    row.dataset.groupKey = group.key;
    if (group.key === activeHoleGroupKey) row.classList.add('hole-group-row-active');

    const nameCell = document.createElement('td');
    nameCell.className = 'col-name';
    nameCell.textContent = `Group ${index + 1}`;

    const diaCell = document.createElement('td');
    diaCell.className = 'col-diameter';
    diaCell.textContent = group.diameter != null ? `Ø ${formatNum(group.diameter, 2)} mm` : '—';

    const depthCell = document.createElement('td');
    depthCell.className = 'col-depth';
    depthCell.textContent = group.depth != null ? `${formatNum(group.depth, 2)} mm` : '—';

    const qtyCell = document.createElement('td');
    qtyCell.className = 'col-qty';
    qtyCell.textContent = String(group.holes.length);

    row.appendChild(nameCell);
    row.appendChild(diaCell);
    row.appendChild(depthCell);
    row.appendChild(qtyCell);

    row.addEventListener('click', () => {
      selectHoleGroup(group, row, tbody);
    });

    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  holesSummaryList.appendChild(table);
}

function selectSingleHole(hole, row, tbody) {
  activeHoleId = hole.id;
  activeHoleGroupKey = null;
  highlightedHoleIds.clear();

  tbody.querySelectorAll('tr').forEach((el) => el.classList.remove('hole-row-active'));
  row.classList.add('hole-row-active');
  holesSummaryList?.querySelectorAll('tr').forEach((el) => el.classList.remove('hole-group-row-active'));

  updateHoleVisualHighlights();
  focusOnHole(hole);
  setStatus(`Focused Hole — Ø ${formatNum(hole.diameter, 2)} mm`);
}

function selectHoleGroup(group, row, tbody) {
  activeHoleId = null;
  activeHoleGroupKey = group.key;
  highlightedHoleIds.clear();
  for (const hole of group.holes) highlightedHoleIds.add(hole.id);

  tbody.querySelectorAll('tr').forEach((el) => el.classList.remove('hole-group-row-active'));
  row.classList.add('hole-group-row-active');
  holesList?.querySelectorAll('tr').forEach((el) => el.classList.remove('hole-row-active'));

  updateHoleVisualHighlights();
  focusOnHoles(group.holes);

  const parts = [];
  if (group.diameter != null) parts.push(`Ø ${formatNum(group.diameter, 2)} mm`);
  if (group.depth != null) parts.push(`depth ${formatNum(group.depth, 2)} mm`);
  setStatus(`Highlighted ${group.holes.length} hole(s)${parts.length ? ` — ${parts.join(', ')}` : ''}`);
}

function focusOnHole(hole) {
  const center = new THREE.Vector3(hole.center[0], hole.center[1], hole.center[2]);
  const radius = hole.radius;
  target.copy(center);
  orbitRadius = Math.max(radius * 8, 20);
  updateCamera();
}

function focusOnHoles(holes) {
  if (!holes || holes.length === 0) return;
  if (holes.length === 1) {
    focusOnHole(holes[0]);
    return;
  }

  // This Three.js build has no Box3.expandBySphere — expand with points only.
  const box = new THREE.Box3();
  let maxRadius = 0;
  for (const hole of holes) {
    const center = new THREE.Vector3(hole.center[0], hole.center[1], hole.center[2]);
    const axis = new THREE.Vector3(hole.axis[0], hole.axis[1], hole.axis[2]).normalize();
    const radius = hole.radius || 0;
    const depth = hole.depth || radius * 2;
    maxRadius = Math.max(maxRadius, radius);
    box.expandByPoint(center);
    box.expandByPoint(center.clone().addScaledVector(axis, depth));
  }

  if (box.isEmpty()) return;
  box.expandByScalar(Math.max(maxRadius * 1.5, 1));

  const fitCenter = box.getCenter(new THREE.Vector3());
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  if (!(sphere.radius > 0)) return;

  target.copy(fitCenter);
  const vFov = perspectiveFovRad();
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(viewAspect, 0.01));
  const fov = Math.min(vFov, hFov);
  orbitRadius = Math.max((sphere.radius / Math.sin(fov / 2)) * 1.45, 20);
  updateCamera();
}

function updateHoleCountBadge() {
  if (holeCountBadge) {
    holeCountBadge.textContent = String(detectedHoles.length);
  }
}

function updateHoleGroupCountBadge(count) {
  if (holeGroupCountBadge) {
    holeGroupCountBadge.textContent = String(count);
  }
}

function updateHoleCsvButtons() {
  if (btnCsvDetectedHoles) btnCsvDetectedHoles.disabled = detectedHoles.length === 0;
  if (btnCsvHoleGroups) {
    const { byDiameter, byDepth } = getHoleGroupOptions();
    const canGroup = (byDiameter || byDepth) && detectedHoles.length > 0;
    btnCsvHoleGroups.disabled = !canGroup || buildHoleGroups().length === 0;
  }
}

const POCKET_COLOR_NORMAL = 0x2a9d8f;
const POCKET_COLOR_NORMAL_EDGE = 0x1d7a6e;
const POCKET_COLOR_FLOOR = 0x3dbfaf;
const POCKET_COLOR_CEILING = 0x1a7a6e;
const POCKET_COLOR_HIGHLIGHT = 0xe9c46a;
const POCKET_COLOR_HIGHLIGHT_EDGE = 0xf4a261;

/** Rounded-rectangle Shape in XY (Z = depth) for max-bounded pocket volume. */
function createRoundedRectShape(width, length, cornerRadius) {
  const shape = new THREE.Shape();
  const hw = width / 2;
  const hl = length / 2;
  const r = Math.max(0, Math.min(cornerRadius || 0, hw - 1e-3, hl - 1e-3));

  if (r < 0.05) {
    shape.moveTo(-hw, -hl);
    shape.lineTo(hw, -hl);
    shape.lineTo(hw, hl);
    shape.lineTo(-hw, hl);
    shape.closePath();
    return shape;
  }

  shape.moveTo(-hw + r, -hl);
  shape.lineTo(hw - r, -hl);
  shape.absarc(hw - r, -hl + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(hw, hl - r);
  shape.absarc(hw - r, hl - r, r, 0, Math.PI / 2, false);
  shape.lineTo(-hw + r, hl);
  shape.absarc(-hw + r, hl - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-hw, -hl + r);
  shape.absarc(-hw + r, -hl + r, r, Math.PI, (Math.PI * 3) / 2, false);
  return shape;
}

function createCircularPocketShape(diameter) {
  const shape = new THREE.Shape();
  const r = Math.max(diameter / 2, 0.5);
  shape.absarc(0, 0, r, 0, Math.PI * 2, false);
  return shape;
}

function orientPocketVolumeGroup(group, center, normal, xAxisArr) {
  // Local +Z = depth (floor → ceiling). Align Z to pocket axis.
  const zAxis = normal.clone().normalize();
  let xAxis = xAxisArr
    ? new THREE.Vector3(xAxisArr[0], xAxisArr[1], xAxisArr[2]).normalize()
    : new THREE.Vector3(1, 0, 0);
  if (Math.abs(xAxis.dot(zAxis)) > 0.95) {
    xAxis = new THREE.Vector3(0, 1, 0);
  }
  xAxis = xAxis.sub(zAxis.clone().multiplyScalar(xAxis.dot(zAxis))).normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
  const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  group.quaternion.setFromRotationMatrix(m);
  group.position.copy(center);
}

/**
 * NX-style plugged body visual: prefer OCCT outer-wire extrude mesh;
 * fall back to rounded-rect extrusion.
 */
function createPocketVisual(pocket) {
  const group = new THREE.Group();
  const plug = pocket.plugMesh;
  if (plug?.positions?.length && plug?.indices?.length) {
    const geo = new THREE.BufferGeometry();
    const pos = plug.positions instanceof Float32Array
      ? plug.positions
      : new Float32Array(plug.positions);
    const idx =
      plug.indices instanceof Uint32Array
        ? plug.indices
        : new Uint32Array(plug.indices);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();

    const volMat = new THREE.MeshBasicMaterial({
      color: 0xe040a0,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const volumeMesh = new THREE.Mesh(geo, volMat);
    volumeMesh.raycast = () => {};
    group.add(volumeMesh);

    const edges = new THREE.EdgesGeometry(geo);
    const edgeMat = new THREE.LineBasicMaterial({
      color: 0xb01070,
      transparent: true,
      opacity: 0.85
    });
    const wire = new THREE.LineSegments(edges, edgeMat);
    wire.raycast = () => {};
    group.add(wire);

    group.userData.pocketId = pocket.id;
    group.userData.pocketMats = { volMat, edgeMat, floorMat: volMat, ceilingMat: volMat };
    return group;
  }

  const outline = pocket.outline || {};
  const centerArr = outline.center || pocket.center || pocket.floorLocation;
  if (!centerArr) return group;

  const axisArr = outline.axis || pocket.axis || pocket.floorNormal || [0, 0, 1];
  const normal = new THREE.Vector3(axisArr[0], axisArr[1], axisArr[2]).normalize();
  if (!Number.isFinite(normal.x) || normal.lengthSq() < 1e-12) normal.set(0, 0, 1);

  const center = new THREE.Vector3(centerArr[0], centerArr[1], centerArr[2]);
  const MAX_VIS = 250;
  let width = outline.width || pocket.width || 8;
  let length = outline.length || pocket.length || width;
  if (pocket.shape === 'circular' || pocket.maxBoundedSize?.diameter) {
    const dia = pocket.maxBoundedSize?.diameter || Math.max(width, length);
    width = dia;
    length = dia;
  }
  width = Math.min(Math.max(width, 2), MAX_VIS);
  length = Math.min(Math.max(length, 2), MAX_VIS);
  const depth = Math.min(
    Math.max(outline.depth || pocket.maxDepth || pocket.depth || 1, 0.5),
    MAX_VIS
  );
  const cornerRadius = Math.min(
    outline.cornerRadius || pocket.cornerRadius || 0,
    width / 2,
    length / 2
  );

  const shape =
    pocket.shape === 'circular'
      ? createCircularPocketShape(width)
      : createRoundedRectShape(width, length, cornerRadius);

  const volGroup = new THREE.Group();
  const extrudeGeo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 12
  });
  const volMat = new THREE.MeshBasicMaterial({
    color: 0xe040a0,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const volumeMesh = new THREE.Mesh(extrudeGeo, volMat);
  volumeMesh.raycast = () => {};
  volGroup.add(volumeMesh);

  const edges = new THREE.EdgesGeometry(extrudeGeo);
  const edgeMat = new THREE.LineBasicMaterial({
    color: 0xb01070,
    transparent: true,
    opacity: 0.9
  });
  const wire = new THREE.LineSegments(edges, edgeMat);
  wire.raycast = () => {};
  volGroup.add(wire);

  orientPocketVolumeGroup(volGroup, center, normal, outline.xAxis);
  group.add(volGroup);

  group.userData.pocketId = pocket.id;
  group.userData.pocketMats = { volMat, edgeMat, floorMat: volMat, ceilingMat: volMat };
  return group;
}

function renderPocketVisuals() {
  disposePocketVisuals();
  if (detectedPockets.length === 0) return;

  pocketVisualGroup = new THREE.Group();
  for (const pocket of detectedPockets) {
    pocketVisualGroup.add(createPocketVisual(pocket));
  }
  scene.add(pocketVisualGroup);
  updatePocketVisualHighlights();
}

function updatePocketVisualHighlights() {
  if (!pocketVisualGroup) return;
  const hasHighlight = highlightedPocketIds.size > 0;
  const PLUG = 0xe040a0;
  const PLUG_EDGE = 0xb01070;

  pocketVisualGroup.children.forEach((group) => {
    const highlighted = hasHighlight && highlightedPocketIds.has(group.userData.pocketId);
    const mats = group.userData.pocketMats;
    if (!mats?.volMat) return;
    mats.volMat.color.setHex(highlighted ? POCKET_COLOR_HIGHLIGHT : PLUG);
    mats.volMat.opacity = highlighted ? 0.65 : 0.45;
    if (mats.edgeMat) {
      mats.edgeMat.color.setHex(highlighted ? POCKET_COLOR_HIGHLIGHT_EDGE : PLUG_EDGE);
      mats.edgeMat.opacity = highlighted ? 1 : 0.85;
    }
  });
}

function pocketShapeLabel(shape) {
  if (!shape) return '—';
  return shape.charAt(0).toUpperCase() + shape.slice(1);
}

function formatPocketBoundedSize(pocket) {
  if (pocket.maxBoundedSize?.diameter > 0) {
    return `Ø ${formatNum(pocket.maxBoundedSize.diameter, 2)} mm`;
  }
  if (pocket.shape === 'circular') {
    const dia = Math.max(pocket.width || 0, pocket.length || 0);
    return dia > 0 ? `Ø ${formatNum(dia, 2)} mm` : '—';
  }
  const w = pocket.maxBoundedSize?.width ?? pocket.width;
  const l = pocket.maxBoundedSize?.length ?? pocket.length;
  if (!(w > 0) || !(l > 0)) return '—';
  return `${formatNum(w, 2)} × ${formatNum(l, 2)} mm`;
}

function renderPocketsList() {
  if (!pocketsList) return;
  pocketsList.innerHTML = '';

  if (detectedPockets.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'holes-table-empty';
    empty.textContent = 'No pockets detected';
    pocketsList.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'holes-table';

  const thead = document.createElement('thead');
  thead.innerHTML =
    '<tr>' +
    '<th class="col-name">Name</th>' +
    '<th class="col-size">Max Bounded Size</th>' +
    '<th class="col-depth">Max Depth</th>' +
    '<th class="col-volume">Cavity Volume</th>' +
    '</tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  let cavityVolumeTotal = 0;
  detectedPockets.forEach((pocket, index) => {
    const row = document.createElement('tr');
    row.dataset.pocketId = pocket.id;
    if (pocket.id === activePocketId) row.classList.add('hole-row-active');

    const nameCell = document.createElement('td');
    nameCell.className = 'col-name';
    let name = `Pocket ${index + 1}`;
    if (pocket.detectionMethod && pocket.detectionMethod !== 'aag-walk') {
      name += ` [${pocket.detectionMethod}]`;
    }
    if (pocket.isFullyEnclosed) name += ' (enclosed)';
    else if (pocket.isPatched) name += ' (patched)';
    else if (pocket.isThrough || pocket.accessType === 'through') name += ' (thru)';
    if (pocket.flagged) name += ` *`;
    nameCell.textContent = name;

    const sizeCell = document.createElement('td');
    sizeCell.className = 'col-size';
    sizeCell.textContent = formatPocketBoundedSize(pocket);

    const depthCell = document.createElement('td');
    depthCell.className = 'col-depth';
    const depthVal = pocket.maxDepth ?? pocket.depth;
    depthCell.textContent =
      pocket.isThrough || !(depthVal > 0) ? '—' : `${formatNum(depthVal, 2)} mm`;

    const volumeCell = document.createElement('td');
    volumeCell.className = 'col-volume';
    const vol = pocket.maxBoundedVolume ?? pocket.volume ?? 0;
    if (vol > 0) cavityVolumeTotal += vol;
    volumeCell.textContent = vol > 0 ? `${formatNum(vol, 1)} mm³` : '—';

    row.appendChild(nameCell);
    row.appendChild(sizeCell);
    row.appendChild(depthCell);
    row.appendChild(volumeCell);

    row.addEventListener('click', () => {
      selectSinglePocket(pocket, row, tbody);
    });

    tbody.appendChild(row);
  });

  table.appendChild(tbody);

  const tfoot = document.createElement('tfoot');
  const totalRow = document.createElement('tr');
  totalRow.className = 'pocket-volume-total-row';
  totalRow.innerHTML =
    '<td class="col-name" colspan="3">Total</td>' +
    `<td class="col-volume">${formatNum(cavityVolumeTotal, 1)} mm³</td>`;
  tfoot.appendChild(totalRow);
  table.appendChild(tfoot);

  pocketsList.appendChild(table);
}

function selectSinglePocket(pocket, row, tbody) {
  activePocketId = pocket.id;
  highlightedPocketIds.clear();
  highlightedPocketIds.add(pocket.id);

  tbody.querySelectorAll('tr').forEach((el) => el.classList.remove('hole-row-active'));
  row.classList.add('hole-row-active');

  updatePocketVisualHighlights();
  focusOnPocket(pocket);
  const depthVal = pocket.maxDepth ?? pocket.depth;
  const vol = pocket.maxBoundedVolume ?? 0;
  setStatus(
    `Focused Pocket — ${pocketShapeLabel(pocket.shape)}` +
      (pocket.isPatched ? ' (patched)' : '') +
      (depthVal > 0 ? ` · depth ${formatNum(depthVal, 2)} mm` : '') +
      (vol > 0 ? ` · ${formatNum(vol, 0)} mm³` : '')
  );
}

function focusOnPocket(pocket) {
  const centerArr = pocket.outline?.center || pocket.center || pocket.floorLocation;
  if (!centerArr) return;
  const center = new THREE.Vector3(centerArr[0], centerArr[1], centerArr[2]);
  const span = Math.max(
    pocket.width || 0,
    pocket.length || 0,
    pocket.maxDepth || pocket.depth || 0,
    10
  );
  target.copy(center);
  orbitRadius = Math.max(span * 3, 20);
  updateCamera();
}

function updatePocketCountBadge() {
  if (pocketCountBadge) {
    pocketCountBadge.textContent = String(detectedPockets.length);
  }
}

function updatePocketCsvButtons() {
  if (btnCsvDetectedPockets) btnCsvDetectedPockets.disabled = detectedPockets.length === 0;
}

function exportDetectedPocketsCsv() {
  if (detectedPockets.length === 0) {
    setStatus('No detected pockets to export');
    return;
  }

  const rows = detectedPockets.map((pocket, index) => [
    `Pocket ${index + 1}${pocket.isPatched ? ' (patched)' : ''}`,
    formatPocketBoundedSize(pocket),
    formatNum(pocket.maxDepth ?? pocket.depth, 2),
    formatNum(pocket.maxBoundedVolume ?? pocket.volume ?? 0, 1),
    pocket.isPatched ? 'yes' : 'no',
    formatNum(pocket.cornerRadius ?? 0, 2)
  ]);

  const cavityTotal = detectedPockets.reduce(
    (sum, p) => sum + (p.maxBoundedVolume ?? p.volume ?? 0),
    0
  );
  rows.push(['Total', '', '', formatNum(cavityTotal, 1), '', '']);

  downloadCsv(
    `${holeCsvFilePrefix()}_detected-pockets.csv`,
    [
      'Name',
      'MaxBoundedSize',
      'MaxDepth_mm',
      'CavityVolume_mm3',
      'Patched',
      'CornerRadius_mm'
    ],
    rows
  );
  setStatus(`Exported ${rows.length} detected pocket(s) to CSV`);
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function downloadCsv(filename, headers, rows) {
  const lines = [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => row.map(csvEscape).join(','))
  ];
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function holeCsvFilePrefix() {
  const part = (partNumberEl?.textContent || 'part').trim().replace(/[^\w.-]+/g, '_') || 'part';
  const stamp = new Date().toISOString().slice(0, 10);
  return `${part}_${stamp}`;
}

function exportDetectedHolesCsv() {
  if (detectedHoles.length === 0) {
    setStatus('No detected holes to export');
    return;
  }

  const rows = detectedHoles.map((hole, index) => [
    `Hole ${index + 1}`,
    formatNum(hole.diameter, 2),
    formatNum(hole.depth, 2),
    (hole.quality * 100).toFixed(0)
  ]);

  downloadCsv(
    `${holeCsvFilePrefix()}_detected-holes.csv`,
    ['Name', 'Diameter_mm', 'Depth_mm', 'Quality_pct'],
    rows
  );
  setStatus(`Exported ${rows.length} detected hole(s) to CSV`);
}

function exportHoleGroupsCsv() {
  const groups = buildHoleGroups();
  if (groups.length === 0) {
    setStatus('No hole groups to export');
    return;
  }

  const rows = groups.map((group, index) => [
    `Group ${index + 1}`,
    group.diameter != null ? formatNum(group.diameter, 2) : '',
    group.depth != null ? formatNum(group.depth, 2) : '',
    group.holes.length
  ]);

  downloadCsv(
    `${holeCsvFilePrefix()}_hole-groups.csv`,
    ['Name', 'Diameter_mm', 'Depth_mm', 'Qty'],
    rows
  );
  setStatus(`Exported ${rows.length} hole group(s) to CSV`);
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

  // User-hinted floor/wall picking on Body 2 (B-Rep face hashes via faceGroups)
  if (hintPickMode === 'floor' || hintPickMode === 'wall-select') {
    const faceHash = faceHashFromTriangle(hit.faceIndex);
    if (faceHash == null) {
      setStatus('Face hash unavailable — wait for Body 2 mesh with face groups');
      return;
    }
    const set = hintPickMode === 'floor' ? hintFloorHashes : hintWallHashes;
    if (set.has(faceHash)) set.delete(faceHash);
    else set.add(faceHash);
    if (hintPickMode === 'floor') {
      hintWallHashes.clear();
      hintAxis = null;
    }
    updateHintStepUI();
    setStatus(
      hintPickMode === 'floor'
        ? `Floor: ${hintFloorHashes.size} face(s)`
        : `Walls: ${hintWallHashes.size} face(s)`
    );
    return;
  }

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
  const noSelection = count === 0;

  if (surfaceSelectionStatus) {
    surfaceSelectionStatus.textContent = noSelection
      ? 'No surfaces selected — Detect Holes will use the whole part'
      : `${count} surface(s) selected`;
  }
  if (btnClearSelection) btnClearSelection.disabled = noSelection || holeDetectionRunning;

  // Detect Holes stays available whenever a part is loaded (and not busy).
  // Pocket Detect is gated on Body 2 readiness (refreshPocketGateUI).
  const detectDisabled = holeDetectionRunning || !partGroup;
  if (btnRunHoleDetection) btnRunHoleDetection.disabled = detectDisabled;
  refreshPocketGateUI();
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
  updateSurfaceSelectionUI();

  btnToggleFloor?.addEventListener('click', () => toggleFloorTile());
  btnTogglePerspective?.addEventListener('click', () => togglePerspective());
  btnCollapseHolePanel?.addEventListener('click', () => toggleHolePanelCollapse());
  btnCollapsePocketPanel?.addEventListener('click', () => togglePocketPanelCollapse());
  updatePerspectiveToggleLabel();
  updateHolePanelCollapseLabel();
  updatePocketPanelCollapseLabel();
  syncFeaturePanelsCollapsedClass();
  updateFloorToggleLabel();

  btnHoleProgressHide?.addEventListener('click', () => {
    hideHoleProgressPanel();
  });

  btnHoleProgressShow?.addEventListener('click', () => {
    showHoleProgressPanel();
  });

  btnHoleProgressStop?.addEventListener('click', () => {
    stopHoleDetection();
  });

  btnRunHoleDetection?.addEventListener('click', () => runHoleDetection());
  btnPlugHoles?.addEventListener('click', () => prepareBody2());
  btnClearHolePlugs?.addEventListener('click', () => clearHolePlugs());
  btnRunPocketDetection?.addEventListener('click', () => runPocketDetection());

  btnGotoHoleDetection?.addEventListener('click', () => {
    if (holePanel?.classList.contains('collapsed')) toggleHolePanelCollapse();
    const plugsNeeded = getHoleDetectionCompleted() && !isHolePlugsActive();
    const target = plugsNeeded ? btnPlugHoles : btnRunHoleDetection;
    target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    target?.focus();
  });

  pocketDetectionMethod?.addEventListener('change', () => {
    syncPocketMethodParamsUI();
    if (pocketDetectionMethod.value !== 'user-hinted') {
      hintPickMode = null;
      setSurfaceSelectMode(false);
    }
    refreshPocketGateUI();
  });

  btnSelectFloor?.addEventListener('click', () => {
    hintPickMode = 'floor';
    setSurfaceSelectMode(true);
    setStatus('Click faces to define the pocket floor');
  });
  btnClearFloor?.addEventListener('click', () => {
    resetHintWorkflow();
    setStatus('Floor selection cleared');
  });
  btnSelectWalls?.addEventListener('click', () => {
    if (!hintFloorHashes.size) return;
    hintPickMode = 'wall-select';
    if (hintDetectWallOptions) hintDetectWallOptions.hidden = true;
    setSurfaceSelectMode(true);
    setStatus('Click faces to include as pocket walls');
  });
  btnDetectWalls?.addEventListener('click', () => {
    if (!hintFloorHashes.size) return;
    if (hintDetectWallOptions) hintDetectWallOptions.hidden = false;
    const requestId = ++holeWorkerRequestId;
    activeFeatureJob = 'hintWalls';
    setHoleDetectionBusy(true);
    beginProgressLog('User-Hinted', 'Detecting walls from floor…');
    try {
      getBrepHoleWorker().postMessage({
        type: 'hintDetectWalls',
        requestId,
        payload: {
          floorHashes: [...hintFloorHashes],
          opts: {
            includeFillets: hintIncludeFillets?.checked !== false,
            maxDepth: Number(hintMaxDepth?.value ?? 200)
          }
        }
      });
    } catch (err) {
      setHoleDetectionBusy(false);
      activeFeatureJob = null;
      setStatus(String(err?.message ?? err));
    }
  });

  hintAxisMode?.addEventListener('change', () => {
    const mode = hintAxisMode.value;
    if (hintAxisManual) hintAxisManual.hidden = mode !== 'manual';
    if (mode === 'auto' && hintFloorHashes.size && hintWallHashes.size) {
      const requestId = ++holeWorkerRequestId;
      activeFeatureJob = 'hintAxis';
      getBrepHoleWorker().postMessage({
        type: 'hintSuggestAxis',
        requestId,
        payload: {
          floorHashes: [...hintFloorHashes],
          wallHashes: [...hintWallHashes]
        }
      });
    } else if (mode === 'manual') {
      hintAxis = [
        Number(hintAxisX?.value ?? 0),
        Number(hintAxisY?.value ?? 0),
        Number(hintAxisZ?.value ?? 1)
      ];
      updateHintStepUI();
    }
  });
  for (const el of [hintAxisX, hintAxisY, hintAxisZ]) {
    el?.addEventListener('input', () => {
      if (hintAxisMode?.value !== 'manual') return;
      hintAxis = [
        Number(hintAxisX?.value ?? 0),
        Number(hintAxisY?.value ?? 0),
        Number(hintAxisZ?.value ?? 1)
      ];
      updateHintStepUI();
    });
  }

  btnHintCalculate?.addEventListener('click', () => {
    if (!hintFloorHashes.size || !hintWallHashes.size) return;
    const requestId = ++holeWorkerRequestId;
    activeFeatureJob = 'hintCalc';
    setHoleDetectionBusy(true);
    beginProgressLog('User-Hinted', 'Calculating pocket volume…');
    try {
      getBrepHoleWorker().postMessage({
        type: 'hintCalculate',
        requestId,
        payload: {
          floorHashes: [...hintFloorHashes],
          wallHashes: [...hintWallHashes],
          axis: hintAxis
        }
      });
    } catch (err) {
      setHoleDetectionBusy(false);
      activeFeatureJob = null;
      setStatus(String(err?.message ?? err));
    }
  });
  btnHintNewPocket?.addEventListener('click', () => {
    resetHintWorkflow();
    setStatus('Define another pocket');
  });

  syncPocketMethodParamsUI();
  refreshPocketGateUI();

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

  btnClearPockets?.addEventListener('click', () => {
    clearPocketDetection();
    setStatus('Detected pockets cleared');
  });

  btnCsvDetectedPockets?.addEventListener('click', () => exportDetectedPocketsCsv());

  const onHoleGroupOptionChange = () => {
    activeHoleGroupKey = null;
    highlightedHoleIds.clear();
    holesList?.querySelectorAll('tr').forEach((el) => el.classList.remove('hole-row-active'));
    updateHoleVisualHighlights();
    renderHolesSummary();
  };
  chkGroupDiameter?.addEventListener('change', onHoleGroupOptionChange);
  chkGroupDepth?.addEventListener('change', onHoleGroupOptionChange);

  btnCsvDetectedHoles?.addEventListener('click', () => exportDetectedHolesCsv());
  btnCsvHoleGroups?.addEventListener('click', () => exportHoleGroupsCsv());

  btnAddHolesToCycle?.addEventListener('click', () => {
    addHolesAsDrillingOperations().catch(console.error);
  });

  holeFitMethodSelect?.addEventListener('change', () => {
    if (holeDetectionRunning) return;
    const method = holeFitMethodSelect.value;
    saveHoleMethodPreference(method);
    updateHoleMethodUi(method);
    if (detectedHoles.length > 0 && partGroup && selectedFaces.size > 0) {
      runHoleDetection();
    }
  });

  holeRansacIterationsInput?.addEventListener('change', () => {
    if (holeDetectionRunning) return;
    const val = parseInt(holeRansacIterationsInput.value, 10);
    if (Number.isFinite(val) && val >= 50 && val <= 5000) {
      saveRansacIterationsPreference(val);
      if (detectedHoles.length > 0 && partGroup && selectedFaces.size > 0) {
        runHoleDetection();
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
