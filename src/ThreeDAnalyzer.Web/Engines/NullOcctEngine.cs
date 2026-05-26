using ThreeDAnalyzer.Core.Interfaces;
using ThreeDAnalyzer.Core.Models;

namespace ThreeDAnalyzer.Web.Engines;

public sealed class NullOcctEngine : IOcctEngine
{
    private const string Msg =
        "OCCT is not linked. Import runtime\\occt (see runtime\\README.md), build the wrapper, then rebuild the web project.";

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

    public bool RayPickRadius(Ray ray, out RadiusPickResult? result)
    {
        result = null;
        throw new InvalidOperationException(Msg);
    }

    public void Dispose() { }
}
