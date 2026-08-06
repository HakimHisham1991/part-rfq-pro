/**
 * Web Worker for B-Rep feature recognition (holes + pocket methods).
 * Offloads OCCT WASM STEP import + AAG / hull / slicing from the main thread.
 */
import { analyzeStepFileFeatures } from './brep-feature-recognition.js?v=1.21.21';
import {
  prepareBody2FromStep,
  detectPocketsOnBody2,
  resetPocketPipelineSession,
  hintDetectWalls,
  hintCalculate,
  hintSuggestAxis,
  hintSuggestPocketFloor
} from './pocket-detection-pipeline.js?v=1.21.31';

function progressSink(requestId) {
  let lastProgressAt = 0;
  let lastPercent = -1;
  let lastMessage = '';
  return ({ message, percent }) => {
    const now = performance.now();
    if (
      percent < 100 &&
      now - lastProgressAt < 80 &&
      percent <= lastPercent &&
      message === lastMessage
    ) {
      return;
    }
    lastProgressAt = now;
    lastPercent = percent;
    lastMessage = message;
    self.postMessage({ type: 'progress', requestId, message, percent });
  };
}

self.onmessage = async (event) => {
  const { type, arrayBuffer, options, requestId, method, params, payload } = event.data;

  try {
    if (type === 'reset') {
      resetPocketPipelineSession();
      self.postMessage({ type: 'reset-done', requestId });
      return;
    }

    if (type === 'detect') {
      // Legacy hole detection (and old single-shot pocket path)
      const startTime = performance.now();
      const { holes, pockets } = await analyzeStepFileFeatures(arrayBuffer, {
        ...options,
        onProgress: progressSink(requestId)
      });
      self.postMessage({
        type: 'result',
        requestId,
        holes: holes ?? [],
        pockets: pockets ?? [],
        source: 'brep',
        elapsedMs: performance.now() - startTime
      });
      return;
    }

    if (type === 'prepareBody2') {
      const startTime = performance.now();
      const result = await prepareBody2FromStep(arrayBuffer, {
        ...options,
        onProgress: progressSink(requestId)
      });
      self.postMessage({
        type: 'body2-ready',
        requestId,
        ...result,
        elapsedMs: performance.now() - startTime
      });
      return;
    }

    if (type === 'detectPockets') {
      const startTime = performance.now();
      const pockets = await detectPocketsOnBody2(method || 'aag-walk', params || {}, progressSink(requestId));
      self.postMessage({
        type: 'result',
        requestId,
        holes: [],
        pockets: pockets ?? [],
        source: 'brep',
        detectionMethod: method || 'aag-walk',
        elapsedMs: performance.now() - startTime
      });
      return;
    }

    if (type === 'hintDetectWalls') {
      const result = await hintDetectWalls(payload?.floorHashes ?? [], payload?.opts ?? {}, progressSink(requestId));
      self.postMessage({ type: 'hint-walls', requestId, ...result });
      return;
    }

    if (type === 'hintSuggestAxis') {
      const axis = await hintSuggestAxis(payload?.floorHashes ?? [], payload?.wallHashes ?? []);
      self.postMessage({ type: 'hint-axis', requestId, axis });
      return;
    }

    if (type === 'hintSuggestFloor') {
      const result = await hintSuggestPocketFloor(progressSink(requestId));
      if (!result) {
        self.postMessage({
          type: 'error',
          requestId,
          message: 'No pocket floor found on Body 2 — pick a floor manually'
        });
        return;
      }
      self.postMessage({ type: 'hint-floor-suggest', requestId, ...result });
      return;
    }

    if (type === 'hintCalculate') {
      const startTime = performance.now();
      const pocket = await hintCalculate(payload || {}, progressSink(requestId));
      self.postMessage({
        type: 'hint-result',
        requestId,
        pocket,
        elapsedMs: performance.now() - startTime
      });
      return;
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      requestId,
      message: err?.message ?? String(err),
      source: 'brep'
    });
  }
};
