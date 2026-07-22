/**
 * Pocket Body-2 session state (main-thread mirror of worker preparation).
 * Reset whenever a new STEP file loads or hole results are cleared/re-run.
 */

/** @type {null | {
 *   status: 'not-ready' | 'preparing' | 'ready' | 'failed',
 *   skippedHoles: Array<{holeIndex:number, diameter?:number, reason:string}>,
 *   holeCount: number,
 *   error: string|null,
 *   note: string|null
 * }} */
let pocketBodyState = null;

/** True after hole detection has completed at least once for the current part
 *  (including a run that found zero holes). */
let holeDetectionCompleted = false;

export function getPocketBodyState() {
  return pocketBodyState;
}

export function setPocketBodyState(state) {
  pocketBodyState = state;
}

export function resetPocketBodyState() {
  pocketBodyState = null;
}

export function getHoleDetectionCompleted() {
  return holeDetectionCompleted;
}

export function setHoleDetectionCompleted(value) {
  holeDetectionCompleted = !!value;
}

export function resetHoleDetectionCompleted() {
  holeDetectionCompleted = false;
}

/** Full reset for a new STEP load. */
export function resetPocketSessionFlags() {
  pocketBodyState = null;
  holeDetectionCompleted = false;
}
