using ThreeDAnalyzer.Core.Models;

namespace ThreeDAnalyzer.Core.Interfaces;

public interface IOcctEngine : IDisposable
{
    bool LoadStepFile(string path);

    MeshData GetMesh(double linearDeflection = 0.1);

    BoundingBoxData GetBoundingBox();

    double GetVolume();

    MeshData GetMeshInCustomCS(CustomCS cs);

    BoundingBoxData GetBoundingBoxInCustomCS(CustomCS cs);

    bool RayPickSurface(Ray ray, out Point3D hitPoint);

    /// <summary>Pick a cylindrical/toroidal/spherical face or circular edge; returns radius in mm.</summary>
    bool RayPickRadius(Ray ray, out RadiusPickResult? result);

    bool IsLoaded { get; }
}
