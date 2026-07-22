/**
 * Pocket detection pipeline (worker-side):
 *  1. prepareBody2 — import STEP, recognize holes, plug → Body 2 (kept alive)
 *  2. detectPockets — aag-walk | hull-subtract | slicing on Body 2
 *  3. user-hinted helpers that operate on the live Body 2 / AAG
 *
 * Shape handles stay in this module; only meshes / serializable results leave.
 */

import { loadOcct, buildAAG, recognizeHoles } from './brep-feature-recognition.js?v=1.21.0';
import { plugHoles, pickTargetSolid } from './pocket-body-preparation.js?v=1.21.0';
import { recognizePockets } from './brep-pocket-recognition.js?v=1.21.0';
import { detectPocketsByHullSubtraction, computeDepthAlongAxis } from './pocket-hull-subtraction.js?v=1.21.0';
import { detectPocketsBySlicing } from './pocket-slicing.js?v=1.21.0';
import {
  detectWallsFromFloor,
  suggestAxisFromFaces,
  buildHintedPocketRecord
} from './pocket-user-hinted.js?v=1.21.0';
import { sewFaces } from './brep-sew-utils.js?v=1.21.0';

/** @type {null | {
 *   occt: object,
 *   mark: number,
 *   body1: number,
 *   body2: number,
 *   aag2: object|null,
 *   holes: object[],
 *   skipped: object[],
 *   note: string|null,
 *   faceHashToHandle: Map<number, number>
 * }} */
let session = null;

function report(onProgress, message, percent) {
  if (typeof onProgress === 'function') onProgress({ message, percent });
}

function meshPayload(mesh) {
  return {
    positions: Array.from(mesh.positions),
    normals: mesh.normals ? Array.from(mesh.normals) : null,
    indices: Array.from(mesh.indices),
    faceGroups: mesh.faceGroups ? Array.from(mesh.faceGroups) : null,
    faceCount: mesh.faceCount ?? null
  };
}

function buildFaceHashMap(occt, shape) {
  const map = new Map();
  const faces = occt.getSubShapes(shape, 'face');
  for (const f of faces) {
    try {
      map.set(occt.hashCode(f, 1 << 30), f);
    } catch {
      /* skip */
    }
  }
  return map;
}

export function resetPocketPipelineSession() {
  if (session?.occt && session.mark != null) {
    try {
      session.occt.releaseSince(session.mark);
    } catch {
      /* ignore */
    }
  }
  session = null;
}

export function getPipelineReady() {
  return !!(session && session.body2 != null);
}

/**
 * Import STEP, plug holes → Body 2, tessellate for viewer swap.
 */
export async function prepareBody2FromStep(arrayBuffer, options = {}) {
  resetPocketPipelineSession();
  const onProgress = options.onProgress ?? null;
  report(onProgress, 'Loading OCCT B-Rep kernel…', 2);

  const occt = await loadOcct(options);
  const mark = occt.checkpoint();

  try {
    report(onProgress, 'Importing STEP as B-Rep…', 8);
    const bytes = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
    const shape = occt.importStep(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    );
    if (occt.isNull(shape)) throw new Error('B-Rep STEP import returned a null shape');

    const { target: body1, note } = pickTargetSolid(occt, shape);

    report(onProgress, 'Building AAG for hole plugging…', 15);
    const aag1 = await buildAAG(body1, occt, ({ message, percent }) => {
      report(onProgress, message, 15 + Math.round((percent / 100) * 25));
    });

    report(onProgress, 'Recognizing holes to plug…', 42);
    const holes = recognizeHoles(aag1, { onProgress: null });

    const { body2, skipped } = plugHoles(occt, body1, aag1, holes, (p) =>
      report(onProgress, p.message, p.percent)
    );

    report(onProgress, 'Tessellating Body 2 for viewer…', 70);
    const mesh = occt.meshShape(body2, {
      linearDeflection: 0.15,
      angularDeflection: 0.35
    });

    const faceHashToHandle = buildFaceHashMap(occt, body2);

    session = {
      occt,
      mark,
      body1,
      body2,
      aag2: null,
      holes,
      skipped,
      note,
      faceHashToHandle
    };

    report(onProgress, 'Body 2 ready', 100);
    return {
      status: 'ready',
      holeCount: holes.length,
      skippedHoles: skipped,
      note,
      mesh: meshPayload(mesh)
    };
  } catch (err) {
    try {
      occt.releaseSince(mark);
    } catch {
      /* ignore */
    }
    session = null;
    throw err;
  }
}

async function ensureAag2(onProgress) {
  if (!session) throw new Error('Body 2 is not ready');
  if (session.aag2) return session.aag2;
  report(onProgress, 'Building AAG on Body 2…', 30);
  session.aag2 = await buildAAG(session.body2, session.occt, ({ message, percent }) => {
    report(onProgress, message, 30 + Math.round((percent / 100) * 30));
  });
  return session.aag2;
}

function tagAagPockets(pockets) {
  return pockets.map((p, i) => ({
    ...p,
    id: p.id ?? `aag-${i}`,
    detectionMethod: 'aag-walk',
    volume: p.maxBoundedVolume ?? p.volume ?? 0,
    toolAxis: p.axis ?? p.floorNormal ?? null,
    accessType: p.isThrough ? 'through' : 'single-axis',
    isFullyEnclosed: false,
    flagged: p.isPatched ? 'patched-floor' : null,
    wallSurfaceArea: null,
    minCornerRadius: null
  }));
}

/**
 * Run one automatic pocket method against Body 2.
 * @param {'aag-walk'|'hull-subtract'|'slicing'} method
 */
export async function detectPocketsOnBody2(method, params = {}, onProgress = null) {
  if (!session?.body2) {
    throw new Error('Body 2 is not ready — run hole detection first');
  }
  const { occt, body2 } = session;

  if (method === 'hull-subtract') {
    report(onProgress, 'Convex hull subtraction…', 10);
    return detectPocketsByHullSubtraction(occt, body2, params, onProgress);
  }

  if (method === 'slicing') {
    report(onProgress, 'Slicing-based detection…', 10);
    return detectPocketsBySlicing(occt, body2, params, onProgress);
  }

  // default: aag-walk
  const aag = await ensureAag2(onProgress);
  report(onProgress, 'AAG face-walk pocket recognition…', 65);
  // Holes already plugged on Body 2 — no hole-face exclusion needed
  const pockets = recognizePockets(aag, { onProgress, holeFaceIndices: new Set(), occt });
  report(onProgress, `Recognized ${pockets.length} pocket(s)`, 100);
  return tagAagPockets(pockets);
}

function resolveHashes(hashes) {
  if (!session) throw new Error('Body 2 is not ready');
  const handles = [];
  const missing = [];
  for (const h of hashes) {
    const face = session.faceHashToHandle.get(h);
    if (face == null) missing.push(h);
    else handles.push(face);
  }
  return { handles, missing };
}

function nodeIndicesForHashes(hashes) {
  const aag = session.aag2;
  if (!aag) return [];
  const set = new Set(hashes);
  const idxs = [];
  for (let i = 0; i < aag.nodes.length; i++) {
    if (set.has(aag.nodes[i].faceHash)) idxs.push(i);
  }
  return idxs;
}

/**
 * User-hinted: detect walls from floor face hashes.
 */
export async function hintDetectWalls(floorHashes, opts = {}, onProgress = null) {
  const aag = await ensureAag2(onProgress);
  const floorIdxs = nodeIndicesForHashes(floorHashes);
  if (!floorIdxs.length) throw new Error('Selected floor face(s) not found on Body 2 AAG');
  const walls = detectWallsFromFloor(floorIdxs, aag, opts);
  const wallHashes = walls.map((i) => aag.nodes[i].faceHash);
  return { wallHashes, wallCount: walls.length, floorCount: floorIdxs.length };
}

/**
 * User-hinted: sew floor+walls+opening cap and return metrics.
 */
export async function hintCalculate(payload, onProgress = null) {
  if (!session?.body2) throw new Error('Body 2 is not ready');
  const { occt, body2 } = session;
  report(onProgress, 'Resolving selected faces…', 20);

  const floorHashes = payload.floorHashes ?? [];
  const wallHashes = payload.wallHashes ?? [];
  const { handles: floorHandles } = resolveHashes(floorHashes);
  const { handles: wallHandles } = resolveHashes(wallHashes);
  if (!floorHandles.length) throw new Error('No floor faces resolved');
  if (!wallHandles.length) throw new Error('No wall faces resolved');

  let axis = payload.axis;
  if (!axis || !Array.isArray(axis) || axis.length !== 3) {
    axis = suggestAxisFromFaces(occt, floorHandles, wallHandles);
  }
  const L = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  axis = [axis[0] / L, axis[1] / L, axis[2] / L];

  report(onProgress, 'Enclosing cavity…', 45);
  let solid = null;
  let flagged = null;
  try {
    // Cap: extrude floor outer wire along axis, then common with a large prism —
    // preferred path: sew selected faces after building a planar opening cap
    // from the free boundary is complex; use floor-wire extrude ∩ body gap approx:
    const floorFace = floorHandles[0];
    const wire = occt.outerWire(floorFace);
    const bb = occt.getBoundingBox(body2, true);
    const diag =
      Math.hypot(bb.xmax - bb.xmin, bb.ymax - bb.ymin, bb.zmax - bb.zmin) * 1.5;
    const prism = occt.extrude(wire, axis[0] * diag, axis[1] * diag, axis[2] * diag);
    // Build solid from floor+walls via sew; if that fails use extruded prism cut
    try {
      solid = sewFaces(occt, [...floorHandles, ...wallHandles], 1e-3);
      // Clip to extruded region
      solid = occt.common(solid, prism);
    } catch {
      // Fallback: plug volume ≈ extruded floor clipped somehow — use prism volume
      // against cut of a bbox solid is unreliable; just use the extruded face solidify
      solid = occt.sewAndSolidify([floorFace, ...wallHandles], 1e-3);
      flagged = 'axis-extrusion-fallback';
    }
  } catch (err) {
    throw new Error(`Enclosure failed: ${err?.message ?? err}`);
  }

  if (occt.isNull(solid) || !(Math.abs(occt.getVolume(solid)) > 0)) {
    throw new Error('Enclosed solid is empty');
  }

  report(onProgress, 'Computing volume / depth…', 80);
  const record = buildHintedPocketRecord(occt, solid, {
    axis,
    faceHandles: [...floorHandles, ...wallHandles],
    faceHashes: [...floorHashes, ...wallHashes],
    accessType: 'single-axis',
    flagged
  });
  // Prefer axis-aligned depth
  record.maxDepth = computeDepthAlongAxis(occt, solid, axis);
  record.depth = record.maxDepth;
  report(onProgress, 'Done', 100);
  return record;
}

export async function hintSuggestAxis(floorHashes, wallHashes) {
  if (!session) throw new Error('Body 2 is not ready');
  const { handles: floorHandles } = resolveHashes(floorHashes);
  const { handles: wallHandles } = resolveHashes(wallHashes);
  return suggestAxisFromFaces(session.occt, floorHandles, wallHandles);
}
