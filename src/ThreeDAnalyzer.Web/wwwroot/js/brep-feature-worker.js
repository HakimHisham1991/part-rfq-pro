/**
 * Web Worker for B-Rep feature recognition (holes + pockets).
 * Offloads OCCT WASM STEP import + AAG construction from the main thread.
 */
import { analyzeStepFileFeatures } from './brep-feature-recognition.js?v=1.20.6';

self.onmessage = async (event) => {
  const { type, arrayBuffer, options, requestId } = event.data;

  if (type !== 'detect') return;

  try {
    const startTime = performance.now();
    let lastProgressAt = 0;

    const { holes, pockets } = await analyzeStepFileFeatures(arrayBuffer, {
      ...options,
      onProgress: ({ message, percent }) => {
        const now = performance.now();
        if (percent < 100 && now - lastProgressAt < 80) return;
        lastProgressAt = now;
        self.postMessage({
          type: 'progress',
          requestId,
          message,
          percent
        });
      }
    });

    self.postMessage({
      type: 'result',
      requestId,
      holes: holes ?? [],
      pockets: pockets ?? [],
      source: 'brep',
      elapsedMs: performance.now() - startTime
    });
  } catch (err) {
    self.postMessage({
      type: 'error',
      requestId,
      message: err?.message ?? String(err),
      source: 'brep'
    });
  }
};
