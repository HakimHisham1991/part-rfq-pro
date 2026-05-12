#if USE_OCCT
using ThreeDAnalyzer.Core.Interfaces;
using ThreeDAnalyzer.Core.Models;

// ReSharper disable once CheckNamespace
namespace ThreeDAnalyzer.Web.Engines;

/// <summary>
/// Adapts the C++/CLI OcctEngine (ThreeDAnalyzer.OcctWrapper.dll) to the IOcctEngine interface.
/// This file only compiles when USE_OCCT is defined (build with: dotnet build -p:UseOcct=true).
/// </summary>
public sealed class OcctEngineAdapter : IOcctEngine
{
    private OcctWrapper.OcctEngine? _engine;
    private bool _loaded;

    private OcctWrapper.OcctEngine Engine =>
        _engine ??= CreateEngine();

    private static OcctWrapper.OcctEngine CreateEngine()
    {
        try
        {
            return new OcctWrapper.OcctEngine();
        }
        catch (Exception ex)
        {
            throw OcctNativeLoadWrap(ex);
        }
    }

    private static InvalidOperationException OcctNativeLoadWrap(Exception ex)
    {
        string baseDir = AppContext.BaseDirectory.TrimEnd('\\', '/');
        string hint =
            "Also ensure ijwhost.dll is next to ThreeDAnalyzer.OcctWrapper.dll (dotnet build copies it when UseIJWHost is on), " +
            "then copy every *.dll from %OCCT_ROOT%\\win64\\vc14\\bin and from your OCCT " +
            "3rdparty-vc14-64 tree into the app's output folder (same folder as ThreeDAnalyzer.Web.dll), " +
            $"e.g.: {baseDir}. From repo root: .\\scripts\\Copy-OcctRuntime.ps1 -Configuration Debug.";
        return new InvalidOperationException(
            "OcctWrapper or a native OCCT dependency failed to load (" + ex.GetType().Name + ": " + ex.Message + "). " + hint,
            ex);
    }

    public bool IsLoaded => _loaded;

    public bool LoadStepFile(string path)
    {
        _loaded = Engine.LoadStepFile(path);
        return _loaded;
    }

    public MeshData GetMesh(double linearDeflection = 0.1)
    {
        var raw = Engine.GetMesh(linearDeflection);
        return new MeshData
        {
            Vertices = raw.Vertices,
            Indices  = raw.Indices
        };
    }

    public BoundingBoxData GetBoundingBox()
    {
        var raw = Engine.GetBoundingBox();
        return new BoundingBoxData
        {
            MinX = raw.MinX, MinY = raw.MinY, MinZ = raw.MinZ,
            MaxX = raw.MaxX, MaxY = raw.MaxY, MaxZ = raw.MaxZ
        };
    }

    public double GetVolume() => Engine.GetVolume();

    public MeshData GetMeshInCustomCS(CustomCS cs)
    {
        var raw = Engine.GetMeshInCustomCS(
            cs.Origin!.X, cs.Origin.Y, cs.Origin.Z,
            cs.XPoint!.X, cs.XPoint.Y, cs.XPoint.Z,
            cs.YPoint!.X, cs.YPoint.Y, cs.YPoint.Z);
        return new MeshData { Vertices = raw.Vertices, Indices = raw.Indices };
    }

    public BoundingBoxData GetBoundingBoxInCustomCS(CustomCS cs)
    {
        var raw = Engine.GetBoundingBoxInCustomCS(
            cs.Origin!.X, cs.Origin.Y, cs.Origin.Z,
            cs.XPoint!.X, cs.XPoint.Y, cs.XPoint.Z,
            cs.YPoint!.X, cs.YPoint.Y, cs.YPoint.Z);
        return new BoundingBoxData
        {
            MinX = raw.MinX, MinY = raw.MinY, MinZ = raw.MinZ,
            MaxX = raw.MaxX, MaxY = raw.MaxY, MaxZ = raw.MaxZ
        };
    }

    public bool RayPickSurface(Ray ray, out Point3D hitPoint)
    {
        double hx, hy, hz;
        bool hit = Engine.RayPickSurface(
            ray.Ox, ray.Oy, ray.Oz,
            ray.Dx, ray.Dy, ray.Dz,
            out hx, out hy, out hz);
        hitPoint = hit ? new Point3D(hx, hy, hz) : Point3D.Zero;
        return hit;
    }

    public void Dispose() => _engine?.Dispose();
}
#endif
