/**
 * Pocket detection pipeline (worker-side):
 *  1. prepareBody2 — import STEP, recognize holes, plug → Body 2 (kept alive)
 *  2. detectPockets — aag-walk | slicing | hull-subtract | stock-subtraction | user-hinted | morphological-closing | voxel-flood-fill on Body 2
 *  3. user-hinted helpers that operate on the live Body 2 / AAG
 *
 * Shape handles stay in this module; only meshes / serializable results leave.
 */

import { loadOcct, buildAAG, recognizeHoles } from './brep-feature-recognition.js?v=1.21.21';
import { plugHoles, pickTargetSolid } from './pocket-body-preparation.js?v=1.21.2';
import {
  recognizePockets,
  recognizePocketFromFloor,
  findFloorCandidates,
  buildPocketFillSolid
} from './brep-pocket-recognition.js?v=1.21.39';
import { detectPocketsByHullSubtraction } from './pocket-hull-subtraction.js?v=1.21.12';
import { detectPocketsBySlicing } from './pocket-slicing.js?v=1.21.2';
import { detectPocketsByMorphologicalClosing } from './pocket-morphological-closing.js?v=1.21.24';
import { detectPocketsByVoxelFloodFill } from './pocket-voxel-flood-fill.js?v=1.21.24';
import { detectPocketsByStockSubtraction } from './pocket-stock-subtraction.js?v=1.21.25';
import {
  detectWallsFromFloor,
  suggestAxisFromFaces,
  extrudeFloorCavity
} from './pocket-user-hinted.js?v=1.21.21';
import { OCCT_HASH_UPPER } from './occt-hash.js?v=1.21.2';

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

function meshPayload(mesh, hashMaps = null) {
  const payload = {
    positions: Array.from(mesh.positions),
    normals: mesh.normals ? Array.from(mesh.normals) : null,
    indices: Array.from(mesh.indices),
    faceGroups: mesh.faceGroups ? Array.from(mesh.faceGroups) : null,
    faceCount: mesh.faceCount ?? null
  };
  if (hashMaps) {
    payload.aagToMeshFaceHash = serializeHashMap(hashMaps.aagToMesh);
    payload.meshToAagFaceHash = serializeHashMap(hashMaps.meshToAag);
    payload.aagHashToGroupIdx = serializeHashMap(hashMaps.aagHashToGroupIdx);
  }
  return payload;
}

function serializeHashMap(map) {
  const out = {};
  for (const [key, value] of map) out[key] = value;
  return out;
}

/**
 * Map AAG face hashes to meshShape faceGroup indices via node.faceId
 * (same face enumeration order as meshShape groups).
 */
function buildAagMeshFaceHashMaps(_occt, _body2, mesh, aag) {
  const aagToMesh = new Map();
  const meshToAag = new Map();
  const aagHashToGroupIdx = new Map();
  if (!mesh.faceGroups?.length || !aag?.nodes?.length) {
    return { aagToMesh, meshToAag, aagHashToGroupIdx };
  }

  const groupCount = mesh.faceGroups.length / 3;
  for (const node of aag.nodes) {
    const aagHash = Number(node.faceHash);
    const groupIdx = node.faceId;
    if (!Number.isFinite(aagHash) || groupIdx == null || groupIdx < 0 || groupIdx >= groupCount) {
      continue;
    }
    const meshHash = Number(mesh.faceGroups[groupIdx * 3 + 2]);
    aagHashToGroupIdx.set(aagHash, groupIdx);
    aagToMesh.set(aagHash, meshHash);
    meshToAag.set(meshHash, aagHash);
  }

  return { aagToMesh, meshToAag, aagHashToGroupIdx };
}

function triIndicesForGroupIndices(groupIndices) {
  const fg = session?.meshFaceGroups;
  if (!fg?.length) return [];

  const tris = [];
  const seen = new Set();
  for (const groupIdx of groupIndices ?? []) {
    const g = Number(groupIdx);
    if (!Number.isInteger(g) || g < 0) continue;
    const gi = g * 3;
    if (gi + 2 >= fg.length) continue;
    const triStart = fg[gi];
    const triCount = fg[gi + 1];
    for (let t = 0; t < triCount; t++) {
      const tri = triStart + t;
      if (!seen.has(tri)) {
        seen.add(tri);
        tris.push(tri);
      }
    }
  }
  return tris;
}

function faceRangesForAagNodeIndices(nodeIndices, aag) {
  const fg = session?.meshFaceGroups;
  if (!fg?.length || !aag) return [];

  const ranges = [];
  for (const ni of nodeIndices ?? []) {
    const faceId = aag.nodes[ni]?.faceId;
    if (faceId == null || faceId < 0) continue;
    const gi = faceId * 3;
    if (gi + 2 >= fg.length) continue;
    ranges.push([fg[gi], fg[gi + 1]]);
  }
  return ranges;
}

function triIndicesForAagNodeIndices(nodeIndices, aag) {
  const groupIndices = (nodeIndices ?? [])
    .map((ni) => aag?.nodes[ni]?.faceId)
    .filter((id) => Number.isInteger(id) && id >= 0);
  return triIndicesForGroupIndices(groupIndices);
}

function triIndicesForAagFaceHashes(hashes) {
  const aag = session?.aag2;
  if (!aag) return [];
  const groupIndices = [];
  const hashSet = new Set((hashes ?? []).map((h) => Number(h)));
  for (const node of aag.nodes) {
    if (hashSet.has(Number(node.faceHash))) groupIndices.push(node.faceId);
  }
  return triIndicesForGroupIndices(groupIndices);
}

function buildFaceHashMap(occt, shape) {
  const map = new Map();
  const faces = occt.getSubShapes(shape, 'face');
  for (const f of faces) {
    try {
      map.set(occt.hashCode(f, OCCT_HASH_UPPER), f);
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

    // Prebuild Body 2 AAG so User-Hinted "Detect Walls" / AAG walk don't
    // appear stuck rebuilding adjacency after Plug Holes.
    report(onProgress, 'Building AAG on Body 2…', 58);
    const aag2 = await buildAAG(body2, occt, ({ message, percent }) => {
      report(onProgress, message, 58 + Math.round((percent / 100) * 22));
    });

    report(onProgress, 'Tessellating Body 2 for viewer…', 82);
    const mesh = occt.meshShape(body2, {
      linearDeflection: 0.15,
      angularDeflection: 0.35
    });

    const faceHashToHandle = buildFaceHashMap(occt, body2);
    const hashMaps = buildAagMeshFaceHashMaps(occt, body2, mesh, aag2);
    const meshFaceGroups = mesh.faceGroups ? Array.from(mesh.faceGroups) : null;

    session = {
      occt,
      mark,
      body1,
      body2,
      aag2,
      holes,
      skipped,
      note,
      faceHashToHandle,
      aagToMeshFaceHash: hashMaps.aagToMesh,
      meshToAagFaceHash: hashMaps.meshToAag,
      aagHashToGroupIdx: hashMaps.aagHashToGroupIdx,
      meshFaceGroups
    };

    report(onProgress, 'Body 2 ready', 100);
    return {
      status: 'ready',
      holeCount: holes.length,
      skippedHoles: skipped,
      note,
      mesh: meshPayload(mesh, hashMaps)
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
    flagged:
      (p.aagWalkPass ?? 1) > 1
        ? `aag-pass-${p.aagWalkPass}`
        : p.isPatched
          ? 'patched-floor'
          : null,
    wallSurfaceArea: null,
    minCornerRadius: p.rCornerMin ?? p.rMin ?? p.minCornerRadius ?? null
  }));
}

function toVec3(v) {
  if (!v) return null;
  if (Array.isArray(v)) return { x: v[0], y: v[1], z: v[2] };
  if (v.x != null) return { x: v.x, y: v.y, z: v.z };
  return null;
}

function vecLen(v) {
  return Math.hypot(v.x, v.y, v.z);
}

function vecNorm(v) {
  const len = vecLen(v) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function vecDot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function vecSub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function vecScale(a, s) {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function holeRadiiMm(hole) {
  const radii = [];
  if (hole.radius > 0) radii.push(hole.radius);
  if (hole.diameter > 0) radii.push(hole.diameter / 2);
  for (const s of hole.stages ?? []) {
    if (s.radius > 0) radii.push(s.radius);
  }
  return radii;
}

function pocketFootprintDiameter(pocket) {
  if (pocket.maxBoundedSize?.diameter > 0) return pocket.maxBoundedSize.diameter;
  const w = pocket.maxBoundedSize?.width ?? pocket.width ?? 0;
  const l = pocket.maxBoundedSize?.length ?? pocket.length ?? 0;
  if (pocket.shape === 'circular') return Math.max(w, l);
  // Nearly circular patched footprints (common for plug-face ghosts)
  if (w > 0 && l > 0) {
    const span = Math.max(w, l);
    if (Math.abs(w - l) / span < 0.1) return (w + l) / 2;
  }
  return 0;
}

/**
 * Plug fuse leaves shallow circular “floors” (plug end faces / incomplete seals)
 * that AAG/hull/slicing can report as pockets. Drop cavities that match a
 * previously plugged hole’s diameter (and usually shallow depth).
 */
function isPluggedHoleGhostPocket(pocket, holes) {
  if (!holes?.length) return false;

  const dia = pocketFootprintDiameter(pocket);
  if (!(dia > 0)) return false;
  const pR = dia / 2;
  const depth = pocket.maxDepth ?? pocket.depth ?? 0;
  const pCenter = toVec3(pocket.center || pocket.floorLocation);
  const pAxis = toVec3(pocket.axis || pocket.floorNormal || pocket.toolAxis);
  const vol = pocket.maxBoundedVolume ?? pocket.volume ?? 0;
  const cylVol = Math.PI * pR * pR * Math.max(depth, 0);
  const volumeLooksCylindrical = cylVol > 0 && Math.abs(vol - cylVol) / cylVol < 0.15;

  // Ultra-shallow circular/patched cavities are plug-face ghosts (e.g. Ø17.93 × 1.75)
  if (
    dia >= 8 &&
    depth > 0 &&
    depth <= 2.25 &&
    (pocket.isPatched || pocket.flagged || pocket.shape === 'circular' || volumeLooksCylindrical)
  ) {
    return true;
  }

  for (const hole of holes) {
    const radii = holeRadiiMm(hole);
    if (!radii.length) continue;

    let matchedR = null;
    for (const r of radii) {
      // Plugs are fused at ~1.01× radius; allow generous tol (tessellation / rounding)
      const tol = Math.max(0.6, r * 0.08);
      if (Math.abs(pR - r) <= tol || Math.abs(pR - r * 1.01) <= tol) {
        matchedR = r;
        break;
      }
    }
    if (matchedR == null) continue;

    const hDepth = hole.depth ?? 0;
    const shallow = depth > 0 && depth <= Math.max(3.5, hDepth * 0.45);

    // Primary: diameter match + shallow cavity (user sample Ø17.93 × 1.75 mm)
    if (shallow) return true;
    if ((pocket.shape === 'circular' || pocket.isPatched || volumeLooksCylindrical) && depth > 0 && depth < 6) {
      return true;
    }

    const hAxis = toVec3(hole.axis);
    if (pAxis && hAxis) {
      const dot = Math.abs(vecDot(vecNorm(pAxis), vecNorm(hAxis)));
      if (dot < 0.85) continue;
    }

    const hCenter = toVec3(hole.center);
    if (pCenter && hCenter && hAxis) {
      const ax = vecNorm(hAxis);
      const delta = vecSub(pCenter, hCenter);
      const axial = Math.abs(vecDot(delta, ax));
      const along = vecScale(ax, vecDot(delta, ax));
      const radial = vecLen(vecSub(delta, along));
      if (radial > matchedR * 1.6 + 1) continue;
      if (axial > (hDepth || 50) + 5) continue;
      return true;
    }
    if (pCenter && hCenter && vecLen(vecSub(pCenter, hCenter)) < matchedR * 1.2 + 1) {
      return true;
    }
  }
  return false;
}

function filterPluggedHoleGhostPockets(pockets, holes, onProgress = null) {
  if (!pockets?.length || !holes?.length) return pockets ?? [];
  const kept = [];
  let removed = 0;
  for (const p of pockets) {
    if (isPluggedHoleGhostPocket(p, holes)) {
      removed += 1;
      continue;
    }
    kept.push(p);
  }
  if (removed > 0) {
    report(
      onProgress,
      `Filtered ${removed} plugged-hole ghost pocket(s); ${kept.length} remain`,
      98
    );
  }
  return kept;
}

const AAG_WALK_MAX_PASSES = 20;

function pocketCenterDist(a, b) {
  const c0 = toVec3(a?.center) || toVec3(a?.floorLocation);
  const c1 = toVec3(b?.center) || toVec3(b?.floorLocation);
  if (!c0 || !c1) return Infinity;
  return Math.hypot(c0.x - c1.x, c0.y - c1.y, c0.z - c1.z);
}

function isDuplicatePocket(candidate, existing) {
  const vol = candidate.maxBoundedVolume ?? candidate.volume ?? 0;
  for (const e of existing) {
    const ev = e.maxBoundedVolume ?? e.volume ?? 0;
    if (Math.abs(ev - vol) > Math.max(1, vol * 0.02)) continue;
    if (pocketCenterDist(candidate, e) < 2) return true;
  }
  return false;
}

/**
 * Iterative AAG walk: detect floor pockets, union fill solids into the working
 * body, rebuild AAG, repeat until no new pockets (exposes through / wall-only
 * cavities that appear after earlier voids are filled).
 */
async function detectPocketsByAagWalkIterative(occt, body2, onProgress = null) {
  const allPockets = [];
  let workingBody = body2;
  let workingOwned = false;

  for (let pass = 1; pass <= AAG_WALK_MAX_PASSES; pass++) {
    const pctBase = 10 + Math.round(((pass - 1) / AAG_WALK_MAX_PASSES) * 75);
    let aag;
    if (pass === 1 && workingBody === body2 && session?.aag2) {
      report(onProgress, `Pass ${pass}: using cached Body 2 AAG…`, pctBase);
      await new Promise((r) => setTimeout(r, 0));
      aag = session.aag2;
    } else {
      report(
        onProgress,
        `AAG face-walk pass ${pass} — building adjacency…`,
        pctBase
      );
      await new Promise((r) => setTimeout(r, 0));
      aag = await buildAAG(workingBody, occt, ({ message, percent }) => {
        report(
          onProgress,
          `Pass ${pass}: ${message}`,
          pctBase + Math.round((percent / 100) * (70 / AAG_WALK_MAX_PASSES))
        );
      });
    }

    report(onProgress, `Pass ${pass}: recognizing floor pockets…`, pctBase + 8);
    const rawBatch = recognizePockets(aag, {
      onProgress: (p) =>
        report(onProgress, `Pass ${pass}: ${p.message}`, pctBase + 8 + Math.round((p.percent / 100) * 6)),
      holeFaceIndices: new Set(),
      occt
    });

    const batch = rawBatch.filter((p) => !isDuplicatePocket(p, allPockets));
    if (!batch.length) {
      report(onProgress, `Pass ${pass}: no new pockets — done`, pctBase + 12);
      break;
    }

    for (const p of batch) {
      p.aagWalkPass = pass;
    }
    allPockets.push(...batch);
    report(
      onProgress,
      `Pass ${pass}: found ${batch.length} pocket(s) — unioning fill volume…`,
      pctBase + 14
    );

    let fusedBody = workingBody;
    let fusedBodyOwned = workingOwned;
    let fusedAny = false;
    for (let i = 0; i < batch.length; i++) {
      const pocket = batch[i];
      const fill = buildPocketFillSolid(occt, pocket, aag);
      if (!fill) continue;
      if (!fusedBodyOwned) {
        fusedBody = occt.copy(workingBody);
        fusedBodyOwned = true;
      }
      try {
        const next = occt.fuse(fusedBody, fill);
        occt.release(fill);
        if (occt.isNull(next)) continue;
        if (fusedBodyOwned) {
          try {
            occt.release(fusedBody);
          } catch {
            /* ignore */
          }
        }
        fusedBody = next;
        fusedBodyOwned = true;
        fusedAny = true;
      } catch (err) {
        try {
          occt.release(fill);
        } catch {
          /* ignore */
        }
        console.warn('AAG walk pocket fuse failed', err);
      }
      report(
        onProgress,
        `Pass ${pass}: fused pocket ${i + 1}/${batch.length}`,
        pctBase + 14 + Math.round(((i + 1) / batch.length) * 4)
      );
    }

    if (!fusedAny) {
      if (fusedBodyOwned && fusedBody !== workingBody) {
        try {
          occt.release(fusedBody);
        } catch {
          /* ignore */
        }
      }
      report(onProgress, `Pass ${pass}: could not fuse fills — stopping`, pctBase + 18);
      break;
    }

    if (workingOwned) {
      try {
        occt.release(workingBody);
      } catch {
        /* ignore */
      }
    }
    workingBody = fusedBody;
    workingOwned = fusedBodyOwned;
  }

  if (workingOwned) {
    try {
      occt.release(workingBody);
    } catch {
      /* ignore */
    }
  }

  return tagAagPockets(allPockets);
}

/**
 * Run one automatic pocket method against Body 2.
 * @param {'aag-walk'|'slicing'|'hull-subtract'|'stock-subtraction'|'morphological-closing'|'voxel-flood-fill'} method
 */
export async function detectPocketsOnBody2(method, params = {}, onProgress = null) {
  if (!session?.body2) {
    throw new Error('Body 2 is not ready — run hole detection first');
  }
  const { occt, body2, holes } = session;
  // Prefer holes captured at Plug Holes time; fall back to viewer-supplied list
  const holesForFilter =
    (Array.isArray(params.pluggedHoles) && params.pluggedHoles.length
      ? params.pluggedHoles
      : null) ||
    holes ||
    [];

  let pockets;
  if (method === 'slicing') {
    report(onProgress, 'Slicing-based detection…', 10);
    pockets = await detectPocketsBySlicing(occt, body2, params, onProgress);
  } else if (method === 'hull-subtract') {
    report(onProgress, 'Convex hull subtraction…', 10);
    pockets = await detectPocketsByHullSubtraction(occt, body2, params, onProgress);
  } else if (method === 'stock-subtraction') {
    report(onProgress, 'Stock subtraction (delta-volume)…', 10);
    pockets = await detectPocketsByStockSubtraction(occt, body2, params, onProgress);
  } else if (method === 'morphological-closing') {
    report(onProgress, 'Morphological closing (dilate → erode)…', 10);
    pockets = await detectPocketsByMorphologicalClosing(occt, body2, params, onProgress);
  } else if (method === 'voxel-flood-fill') {
    report(onProgress, 'Voxelizing and flood-filling…', 10);
    pockets = await detectPocketsByVoxelFloodFill(occt, body2, params, onProgress);
  } else {
    report(onProgress, 'Iterative AAG face-walk (fill & re-walk)…', 8);
    pockets = await detectPocketsByAagWalkIterative(occt, body2, onProgress);
  }

  report(
    onProgress,
    `Filtering plugged-hole ghosts against ${holesForFilter.length} hole(s)…`,
    95
  );
  pockets = filterPluggedHoleGhostPockets(pockets, holesForFilter, onProgress);
  report(onProgress, `Recognized ${pockets.length} pocket(s)`, 100);
  return pockets;
}

function resolveHashes(hashes) {
  if (!session) throw new Error('Body 2 is not ready');
  const handles = [];
  const missing = [];
  for (const h of hashes) {
    const key = canonicalAagFaceHash(h);
    const face =
      session.faceHashToHandle.get(key) ??
      session.faceHashToHandle.get(Number(h)) ??
      session.faceHashToHandle.get(h);
    if (face == null) missing.push(h);
    else handles.push(face);
  }
  return { handles, missing };
}

function canonicalAagFaceHash(hash) {
  const n = Number(hash);
  if (!Number.isFinite(n)) return hash;
  return session?.meshToAagFaceHash?.get(n) ?? n;
}

function nodeIndicesForHashes(hashes) {
  const aag = session.aag2;
  if (!aag) return [];
  const set = new Set();
  for (const h of hashes ?? []) {
    const n = Number(h);
    if (!Number.isFinite(n)) continue;
    set.add(canonicalAagFaceHash(n));
  }
  const idxs = [];
  for (let i = 0; i < aag.nodes.length; i++) {
    if (set.has(Number(aag.nodes[i].faceHash))) idxs.push(i);
  }
  return idxs;
}

const HINT_MIN_POCKET_FLOOR_SPAN_MM = 40;

function footprintSpanFromNode(node) {
  const uv = node?.uv;
  if (!uv) return { span: 0, minSpan: 0, area: 0 };
  const uw = Math.abs((uv.uMax ?? 0) - (uv.uMin ?? 0));
  const vw = Math.abs((uv.vMax ?? 0) - (uv.vMin ?? 0));
  return { span: Math.max(uw, vw), minSpan: Math.min(uw, vw), area: uw * vw };
}

/**
 * Reject hole-plug discs and exterior stock faces — user must pick the recessed pocket floor.
 */
function assertHintFloorSelection(floorHashes, aag) {
  const floorIdxs = nodeIndicesForHashes(floorHashes);
  if (!floorIdxs.length) {
    throw new Error(
      `Selected floor face(s) not found on Body 2 AAG (${(floorHashes ?? []).length} hash(es) sent) — re-run Plug Holes`
    );
  }

  const candidates = new Set(findFloorCandidates(aag, new Set()));
  for (const idx of floorIdxs) {
    const node = aag.nodes[idx];
    const { span } = footprintSpanFromNode(node);
    const walls = detectWallsFromFloor([idx], aag).length;
    if (candidates.has(idx) && walls > 0) continue;

    if (span < HINT_MIN_POCKET_FLOOR_SPAN_MM) {
      throw new Error(
        `Selected face is only ~${span.toFixed(0)} mm across — that's a hole plug, not the pocket. ` +
          `Click the large recessed floor in the center (~230×130 mm).`
      );
    }
    throw new Error(
      `Selected face (~${span.toFixed(0)} mm) is not a pocket floor (no rising walls found). ` +
        `Pick the recessed floor inside the pocket, not the outer flat top of the part.`
    );
  }
  return floorIdxs;
}

/** Largest AAG pocket floor — pre-select after Plug Holes. */
export async function hintSuggestPocketFloor(onProgress = null) {
  const aag = await ensureAag2(onProgress);
  const floors = findFloorCandidates(aag, new Set());
  if (!floors.length) return null;

  let bestIdx = floors[0];
  let bestSpan = 0;
  for (const idx of floors) {
    const span = footprintSpanFromNode(aag.nodes[idx]).span;
    if (span > bestSpan) {
      bestSpan = span;
      bestIdx = idx;
    }
  }

  const wallCount = detectWallsFromFloor([bestIdx], aag).length;
  const floorHash = aag.nodes[bestIdx].faceHash;
  const floorGroupIndex = aag.nodes[bestIdx].faceId;
  return {
    floorHash,
    span: bestSpan,
    wallCount,
    floorGroupIndex,
    floorFaceRanges: faceRangesForAagNodeIndices([bestIdx], aag),
    floorTriIndices: triIndicesForAagNodeIndices([bestIdx], aag)
  };
}

/** Resolve AAG floor node index from UI hash and/or OCCT face handle. */
function nodeIndexForFloor(floorHash, floorHandle, occt) {
  const fromHash = nodeIndicesForHashes([floorHash]);
  if (fromHash.length) return fromHash[0];
  const aag = session?.aag2;
  if (!aag || floorHandle == null) return -1;
  try {
    const h = occt.hashCode(floorHandle, OCCT_HASH_UPPER);
    const i = aag.nodes.findIndex((n) => Number(n.faceHash) === Number(h));
    if (i >= 0) return i;
  } catch {
    /* ignore */
  }
  return -1;
}

/**
 * User-hinted: detect walls from floor face hashes.
 */
export async function hintDetectWalls(floorHashes, opts = {}, onProgress = null) {
  report(onProgress, 'Preparing Body 2 AAG…', 20);
  const aag = await ensureAag2(onProgress);
  report(onProgress, 'Validating pocket floor…', 45);
  const floorIdxs = assertHintFloorSelection(floorHashes, aag);
  report(onProgress, 'Walking walls from floor…', 70);
  const walls = detectWallsFromFloor(floorIdxs, aag, opts);
  if (!walls.length) {
    throw new Error(
      'No pocket walls found from the selected floor — pick the large recessed center floor, then retry Detect Walls.'
    );
  }
  const wallHashes = walls.map((i) => aag.nodes[i].faceHash);
  const wallGroupIndices = walls.map((i) => aag.nodes[i].faceId);
  report(
    onProgress,
    `Detected ${wallHashes.length} wall face(s) from ${floorIdxs.length} floor face(s)`,
    100
  );
  return {
    wallHashes,
    wallCount: walls.length,
    floorCount: floorIdxs.length,
    wallGroupIndices,
    wallFaceRanges: faceRangesForAagNodeIndices(walls, aag),
    wallTriIndices: triIndicesForAagNodeIndices(walls, aag)
  };
}

/**
 * User-hinted cavity volume:
 *  1) Prefer direct floor outer-wire extrude using wall height (works with 1 wall)
 *  2) Also try AAG walk when the floor hash is on Body 2 AAG; keep the larger volume
 */
export async function hintCalculate(payload, onProgress = null) {
  if (!session?.body2) throw new Error('Body 2 is not ready');
  const { occt } = session;
  report(onProgress, 'Resolving selected faces…', 15);

  const floorHashes = payload.floorHashes ?? [];
  const wallHashes = payload.wallHashes ?? [];

  report(onProgress, 'Validating pocket floor…', 22);
  const aagForFloor = await ensureAag2(onProgress);
  assertHintFloorSelection(floorHashes, aagForFloor);

  const { handles: floorHandles, missing: missingFloors } = resolveHashes(floorHashes);
  const { handles: wallHandles, missing: missingWalls } = resolveHashes(wallHashes);
  if (!floorHandles.length) {
    throw new Error(
      `No floor faces resolved on Body 2` +
        (missingFloors.length ? ` (hash ${missingFloors[0]} missing — re-run Plug Holes)` : '')
    );
  }
  if (!wallHandles.length) {
    throw new Error(
      `Select at least one pocket wall face` +
        (missingWalls.length ? ` (wall hash missing — re-run Plug Holes)` : '')
    );
  }

  let axis = payload.axis;
  if (!axis || !Array.isArray(axis) || axis.length !== 3) {
    axis = suggestAxisFromFaces(occt, floorHandles, wallHandles);
  }
  const L = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  axis = [axis[0] / L, axis[1] / L, axis[2] / L];

  // AAG depth / volume when the floor is a real pocket (even if wall pick is partial)
  let depthHint = null;
  let aagRec = null;
  try {
    report(onProgress, 'Analyzing floor on Body 2 AAG…', 35);
    const aag = await ensureAag2(onProgress);
    const floorIdx = nodeIndexForFloor(floorHashes[0], floorHandles[0], occt);
    if (floorIdx >= 0) {
      try {
        aagRec = recognizePocketFromFloor(aag, floorIdx, occt);
        if (aagRec?.depth > 0.2) depthHint = aagRec.depth;
      } catch {
        /* floor may be plug / incomplete rim — extrude still tries */
      }
    }
  } catch {
    /* AAG optional */
  }

  report(onProgress, 'Extruding floor outer wire (plugged cavity)…', 55);
  let extruded = null;
  let extrudeErr = null;
  try {
    extruded = extrudeFloorCavity(occt, floorHandles[0], wallHandles, axis, depthHint);
  } catch (err) {
    extrudeErr = err;
  }

  // Retry AAG record if extrude failed but we didn't try recognize yet
  if (!aagRec && !extruded) {
    try {
      const aag = session.aag2 ?? (await ensureAag2(onProgress));
      const floorIdx = nodeIndexForFloor(floorHashes[0], floorHandles[0], occt);
      if (floorIdx >= 0) {
        aagRec = recognizePocketFromFloor(aag, floorIdx, occt);
      }
    } catch {
      /* ignore */
    }
  }

  const vol = (r) => r?.maxBoundedVolume ?? r?.volume ?? 0;
  let best = null;
  if (extruded && aagRec) {
    best = vol(aagRec) >= vol(extruded) * 0.9 ? aagRec : extruded;
  } else {
    best = extruded || aagRec;
  }

  if (!best || !(vol(best) > 0)) {
    throw new Error(
      extrudeErr?.message ||
        'Could not build a cavity from the selection. Select the large pocket floor (center of the part), not a small hole-plug disc, plus at least one rising wall.'
    );
  }

  // Guard: tiny “plug” selections
  const span = Math.max(best.width || 0, best.length || 0, best.maxBoundedSize?.width || 0);
  if (vol(best) < 100 && span < 40) {
    throw new Error(
      `Cavity only ${vol(best).toFixed(1)} mm³ — that looks like a hole plug, not the pocket. Click the large recessed floor in the middle (≈230×130 mm), then a side wall.`
    );
  }

  report(onProgress, 'Computing volume / depth…', 90);
  const record = {
    ...best,
    id: `hint-${Date.now()}`,
    detectionMethod: 'user-hinted',
    toolAxis: axis,
    axis,
    accessType: 'single-axis',
    volume: vol(best),
    maxBoundedVolume: vol(best),
    faceHashes: [
      ...floorHashes.map((h) => Number(h)),
      ...wallHashes.map((h) => Number(h))
    ].filter((h) => Number.isFinite(h))
  };

  if (!record.plugMesh?.positions?.length) {
    throw new Error('Cavity solid has no mesh to display');
  }

  report(
    onProgress,
    `Cavity volume ${Math.round(record.volume)} mm³ (depth ${Number(record.depth).toFixed(2)} mm)`,
    100
  );
  return record;
}

export async function hintSuggestAxis(floorHashes, wallHashes) {
  if (!session) throw new Error('Body 2 is not ready');
  const { handles: floorHandles } = resolveHashes(floorHashes);
  const { handles: wallHandles } = resolveHashes(wallHashes);
  return suggestAxisFromFaces(session.occt, floorHandles, wallHandles);
}
