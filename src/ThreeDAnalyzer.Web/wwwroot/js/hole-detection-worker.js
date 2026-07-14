/**
 * Web Worker for hole detection — offloads heavy mesh analysis from the main thread.
 */
import {
  detectHoles,
  DEFAULT_HOLE_FIT_METHOD,
  DEFAULT_RANSAC_ITERATIONS
} from './hole-detection.js';

self.onmessage = (event) => {
  const { type, meshes, options, requestId } = event.data;

  if (type !== 'detect') return;

  try {
    const startTime = performance.now();
    let lastProgressAt = 0;

    const holes = detectHoles(meshes, {
      method: options?.method ?? DEFAULT_HOLE_FIT_METHOD,
      ransacIterations: options?.ransacIterations ?? DEFAULT_RANSAC_ITERATIONS,
      minRadius: options?.minRadius ?? 0.3,
      maxRadius: options?.maxRadius ?? 500,
      mergeTolerance: options?.mergeTolerance ?? 1.5,
      selectedFaces: options?.selectedFaces ?? null,
      onProgress: ({ message, percent }) => {
        const now = performance.now();
        // Throttle progress posts so the UI stays responsive
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
      holes,
      elapsedMs: performance.now() - startTime
    });
  } catch (err) {
    self.postMessage({
      type: 'error',
      requestId,
      message: err?.message ?? String(err)
    });
  }
};
