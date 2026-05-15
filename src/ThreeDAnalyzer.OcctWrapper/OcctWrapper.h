#pragma once
// ThreeDAnalyzer.OcctWrapper — Managed C++/CLI wrapper around OpenCascade Technology (OCCT 8.0)
// License: LGPL 2.1 (OCCT) — link dynamically, do NOT statically embed.
// Build in Visual Studio 2022 with /clr:netcore, targeting net10.0.
// Set OCCT_ROOT environment variable or edit VC++ include/library directories in project settings.

using namespace System;
using namespace System::Runtime::InteropServices;

namespace ThreeDAnalyzer {
namespace OcctWrapper {

/// <summary>Triangle mesh data produced by OCCT tessellation.</summary>
public ref class MeshData
{
public:
    /// <summary>Flat float array: x0,y0,z0, x1,y1,z1, ... (mm)</summary>
    array<float>^ Vertices;

    /// <summary>Triangle index triplets.</summary>
    array<int>^ Indices;
};

/// <summary>Axis-aligned bounding box (mm).</summary>
public ref class BoundingBoxData
{
public:
    double MinX, MinY, MinZ;
    double MaxX, MaxY, MaxZ;

    property double Volume {
        double get() { return (MaxX - MinX) * (MaxY - MinY) * (MaxZ - MinZ); }
    }
};

/// <summary>
/// OCCT geometry engine. Wraps: STEP read, tessellation, volume, bounding box,
/// custom coordinate system transform, and ray-surface intersection.
/// </summary>
public ref class OcctEngine
{
public:
    OcctEngine();
    ~OcctEngine();
    !OcctEngine();

    /// <summary>Load a STEP/STP file (AP203 or AP214). Returns true on success.</summary>
    bool LoadStepFile(String^ filePath);

    /// <summary>
    /// Tessellate the shape and return a triangle mesh for WebGL rendering.
    /// Call AFTER LoadStepFile. linearDeflection in mm (0.1 = high detail).
    /// </summary>
    MeshData^ GetMesh(double linearDeflection);

    /// <summary>Axis-aligned bounding box of the shape in world space (mm).</summary>
    BoundingBoxData^ GetBoundingBox();

    /// <summary>
    /// Exact volume of the shape in mm³ using OCCT mass properties.
    /// Requires the shape to be a closed solid.
    /// </summary>
    double GetVolume();

    /// <summary>
    /// Tessellate the shape transformed into a custom coordinate system.
    /// P1 (ox,oy,oz) = new origin; P2 (xx,xy,xz) = point on X+ axis;
    /// P3 (yx,yy,yz) = point on XY plane, Y+ side. Z = X cross Y.
    /// </summary>
    MeshData^ GetMeshInCustomCS(
        double ox, double oy, double oz,
        double xx, double xy, double xz,
        double yx, double yy, double yz);

    /// <summary>Bounding box of the shape in a custom coordinate system (mm).</summary>
    BoundingBoxData^ GetBoundingBoxInCustomCS(
        double ox, double oy, double oz,
        double xx, double xy, double xz,
        double yx, double yy, double yz);

    /// <summary>
    /// Cast a ray against the shape and find the closest surface intersection.
    /// Returns true if a hit is found. Hit coordinates are in world space (mm).
    /// </summary>
    bool RayPickSurface(
        double rox, double roy, double roz,
        double rdx, double rdy, double rdz,
        [Out] double% hitX,
        [Out] double% hitY,
        [Out] double% hitZ);

private:
    void* m_shape;  // heap-allocated TopoDS_Shape*

    // Internal helpers
    MeshData^        TessellateShape(void* shape, double linearDeflection);
    BoundingBoxData^ ComputeBoundingBox(void* shape);
    void*            TransformToCustomCS(double ox, double oy, double oz,
                                         double xx, double xy, double xz,
                                         double yx, double yy, double yz);
};

} // namespace OcctWrapper
} // namespace ThreeDAnalyzer
