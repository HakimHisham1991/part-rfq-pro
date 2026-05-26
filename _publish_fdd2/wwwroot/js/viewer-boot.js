/**
 * Loads viewer.js (ES module) on demand before Blazor calls window.ThreeDViewer.* .
 * Deferred module scripts run after synchronous blazor.web.js, so relying only on a
 * <script type="module" src="/js/viewer.js"> tag can race startup and tear down the circuit.
 */
window.threeAnalyzerLoadViewer = async function () {
    if (window.ThreeDViewer) return;
    // Dynamic import is cached: re-import does not re-run module top-level, so we must
    // always recover the API from the module namespace (see viewer.js named export).
    const mod = await import('/js/viewer.js');
    window.ThreeDViewer = mod.ThreeDViewer;
    if (!window.ThreeDViewer) {
        throw new Error('viewer.js did not export ThreeDViewer (check Network / Console for /js/viewer.js)');
    }
};

/** Safe teardown: do not clear window.ThreeDViewer — that breaks the next load after a cached import(). */
window.threeAnalyzerDisposeViewerSafe = function () {
    try {
        if (window.ThreeDViewer && typeof window.ThreeDViewer.dispose === 'function')
            window.ThreeDViewer.dispose();
    }
    catch (e) {
        console.warn('[viewer-boot] dispose', e);
    }
};
