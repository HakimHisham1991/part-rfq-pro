using ThreeDAnalyzer.Core.Interfaces;
using ThreeDAnalyzer.Core.Models;

namespace ThreeDAnalyzer.Web.Engines;

/// <summary>
/// Stub OCCT engine used when ThreeDAnalyzer.OcctWrapper.dll is not yet available.
/// Build the C++/CLI project in Visual Studio 2022, then set UseOcct=true to enable the real engine.
/// </summary>
public sealed class NullOcctEngine : IOcctEngine
{
    private const string Msg =
        "OCCT wrapper is not available. " +
        "Open ThreeDAnalyzer.OcctWrapper.vcxproj in Visual Studio 2022, build it, " +
        "then rebuild this project with: dotnet build -p:UseOcct=true";

    public bool IsLoaded => false;

    public bool LoadStepFile(string path) =>
        throw new InvalidOperationException(Msg);

    public MeshData GetMesh(double linearDeflection = 0.1) =>
        throw new InvalidOperationException(Msg);

    public BoundingBoxData GetBoundingBox() =>
        throw new InvalidOperationException(Msg);

    public double GetVolume() =>
        throw new InvalidOperationException(Msg);

    public MeshData GetMeshInCustomCS(CustomCS cs) =>
        throw new InvalidOperationException(Msg);

    public BoundingBoxData GetBoundingBoxInCustomCS(CustomCS cs) =>
        throw new InvalidOperationException(Msg);

    public bool RayPickSurface(Ray ray, out Point3D hitPoint)
    {
        hitPoint = Point3D.Zero;
        throw new InvalidOperationException(Msg);
    }

    public void Dispose() { }
}
