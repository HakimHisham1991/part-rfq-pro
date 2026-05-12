using Microsoft.AspNetCore.Components.Forms;
using ThreeDAnalyzer.Core.Interfaces;
using ThreeDAnalyzer.Core.Models;

namespace ThreeDAnalyzer.Web.Services;

/// <summary>
/// Scoped service that manages the per-user OCCT engine instance.
/// One instance per Blazor Server circuit (one per browser tab).
/// </summary>
public sealed class OcctService(IOcctEngine engine) : IDisposable
{
    private string? _tempFilePath;
    private double _partVolumeMm3;
    private BoundingBoxData? _boundingBox;

    public bool IsLoaded => engine.IsLoaded;
    public bool IsAvailable => engine is not Web.Engines.NullOcctEngine;

    /// <summary>Part volume in mm³ (computed once on load).</summary>
    public double PartVolumeMm3 => _partVolumeMm3;

    /// <summary>World-space bounding box of the loaded part.</summary>
    public BoundingBoxData? BoundingBox => _boundingBox;

    /// <summary>
    /// Stream the uploaded browser file to a temp path, then pass to OCCT.
    /// Runs OCCT I/O on a background thread to not block the Blazor circuit.
    /// </summary>
    public async Task<bool> LoadFileAsync(IBrowserFile file, CancellationToken ct = default)
    {
        CleanupTempFile();
        _tempFilePath = Path.ChangeExtension(Path.GetTempFileName(), ".step");

        await using (var fs = File.Create(_tempFilePath))
            await file.OpenReadStream(maxAllowedSize: 512 * 1024 * 1024, ct).CopyToAsync(fs, ct);

        bool ok = await Task.Run(() => engine.LoadStepFile(_tempFilePath!), ct);
        if (!ok) return false;

        await Task.Run(() =>
        {
            _partVolumeMm3 = engine.GetVolume();
            _boundingBox = engine.GetBoundingBox();
        }, ct);

        return true;
    }

    /// <summary>Returns tessellated mesh data. Runs on background thread.</summary>
    public Task<MeshData> GetMeshAsync(double deflection = 0.1, CancellationToken ct = default) =>
        Task.Run(() => engine.GetMesh(deflection), ct);

    /// <summary>Compute bounding box in a custom coordinate system on background thread.</summary>
    public Task<BoundingBoxData> GetBoundingBoxInCustomCSAsync(CustomCS cs, CancellationToken ct = default) =>
        Task.Run(() => engine.GetBoundingBoxInCustomCS(cs), ct);

    /// <summary>
    /// Ray-pick the model surface. Called synchronously from JSInvokable callbacks.
    /// Safe to call from the Blazor circuit thread (OCCT is fast for single picks).
    /// </summary>
    public bool RayPick(Ray ray, out Point3D hitPoint) =>
        engine.RayPickSurface(ray, out hitPoint);

    private void CleanupTempFile()
    {
        if (_tempFilePath is not null && File.Exists(_tempFilePath))
        {
            try { File.Delete(_tempFilePath); } catch { /* best effort */ }
            _tempFilePath = null;
        }
    }

    public void Dispose()
    {
        CleanupTempFile();
        engine.Dispose();
    }
}
