using ThreeDAnalyzer.Core.Models;

namespace ThreeDAnalyzer.Core.Interfaces;

/// <summary>
/// Abstraction over the OCCT geometry kernel.
/// Implementations: OcctEngineAdapter (real, via C++/CLI wrapper) or NullOcctEngine (stub).
/// </summary>
public interface IOcctEngine : IDisposable
{
    /// <summary>Load a STEP/STP file. Returns true on success.</summary>
    bool LoadStepFile(string path);

    /// <summary>
    /// Tessellate the loaded shape and return mesh data for Three.js rendering.
    /// Call AFTER LoadStepFile succeeds.
    /// </summary>
    /// <param name="linearDeflection">Chord deviation in mm. Use 0.1 for aerospace detail.</param>
    MeshData GetMesh(double linearDeflection = 0.1);

    /// <summary>Axis-aligned bounding box of the loaded shape (world coordinate system).</summary>
    BoundingBoxData GetBoundingBox();

    /// <summary>Volume of the loaded shape in mm³ (exact, using OCCT mass properties).</summary>
    double GetVolume();

    /// <summary>
    /// Tessellate the shape transformed into a custom coordinate system.
    /// The bbox of the result is axis-aligned in the new CS — useful for stock-size estimation.
    /// </summary>
    MeshData GetMeshInCustomCS(CustomCS cs);

    /// <summary>Bounding box of the shape in a custom coordinate system.</summary>
    BoundingBoxData GetBoundingBoxInCustomCS(CustomCS cs);

    /// <summary>
    /// Cast a ray against the loaded shape and return the closest surface hit.
    /// Returns true if a hit was found.
    /// </summary>
    bool RayPickSurface(Ray ray, out Point3D hitPoint);

    bool IsLoaded { get; }
}
