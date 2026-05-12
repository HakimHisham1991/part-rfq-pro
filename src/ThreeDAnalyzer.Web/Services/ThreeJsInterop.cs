using Microsoft.JSInterop;
using ThreeDAnalyzer.Core.Models;

namespace ThreeDAnalyzer.Web.Services;

/// <summary>Typed wrappers for all JavaScript calls into viewer.js (ThreeDViewer object).</summary>
public sealed class ThreeJsInterop(IJSRuntime js)
{
    private ValueTask EnsureViewerModuleLoadedAsync() =>
        js.InvokeVoidAsync("threeAnalyzerLoadViewer");

    public async ValueTask InitViewerAsync<T>(string canvasId, DotNetObjectReference<T> dotNetRef)
        where T : class
    {
        await EnsureViewerModuleLoadedAsync();
        await js.InvokeVoidAsync("ThreeDViewer.init", canvasId, dotNetRef);
    }

    public async ValueTask LoadMeshAsync(float[] vertices, int[] indices)
    {
        await EnsureViewerModuleLoadedAsync();
        await js.InvokeVoidAsync("ThreeDViewer.loadMesh", vertices, indices);
    }

    public async ValueTask ShowBoundingBoxAsync(BoundingBoxData bb)
    {
        await EnsureViewerModuleLoadedAsync();
        await js.InvokeVoidAsync("ThreeDViewer.showBoundingBox",
            bb.MinX, bb.MinY, bb.MinZ, bb.MaxX, bb.MaxY, bb.MaxZ);
    }

    public async ValueTask UpdateBoundingBoxAsync(
        double minX, double minY, double minZ,
        double maxX, double maxY, double maxZ)
    {
        await EnsureViewerModuleLoadedAsync();
        await js.InvokeVoidAsync("ThreeDViewer.showBoundingBox", minX, minY, minZ, maxX, maxY, maxZ);
    }

    public async ValueTask ShowOrientedBoundingBoxAsync(
        double ox, double oy, double oz,
        double ux, double uy, double uz,
        double vx, double vy, double vz,
        double wx, double wy, double wz,
        double mx, double my, double mz,
        double Mx, double My, double Mz)
    {
        await EnsureViewerModuleLoadedAsync();
        await js.InvokeVoidAsync("ThreeDViewer.showOrientedBoundingBox",
            ox, oy, oz, ux, uy, uz, vx, vy, vz, wx, wy, wz, mx, my, mz, Mx, My, Mz);
    }

    public async ValueTask SetSnapModeAsync(bool enabled)
    {
        await EnsureViewerModuleLoadedAsync();
        await js.InvokeVoidAsync("ThreeDViewer.setSnapMode", enabled);
    }

    public async ValueTask SyncCsPickMarkersAsync(
        bool h0,
        double x0, double y0, double z0,
        bool h1,
        double x1, double y1, double z1,
        bool h2,
        double x2, double y2, double z2,
        int sphereIdx)
    {
        await EnsureViewerModuleLoadedAsync();
        await js.InvokeVoidAsync("ThreeDViewer.syncCsPickMarkers",
            h0, x0, y0, z0,
            h1, x1, y1, z1,
            h2, x2, y2, z2,
            sphereIdx);
    }

    public async ValueTask ClearSnapMarkersAsync()
    {
        await EnsureViewerModuleLoadedAsync();
        await js.InvokeVoidAsync("ThreeDViewer.clearSnapMarkers");
    }

    public async ValueTask FitCameraAsync()
    {
        await EnsureViewerModuleLoadedAsync();
        await js.InvokeVoidAsync("ThreeDViewer.fitCamera");
    }

    public ValueTask DisposeViewerAsync() =>
        js.InvokeVoidAsync("threeAnalyzerDisposeViewerSafe");
}
