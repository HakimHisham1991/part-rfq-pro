// ThreeDAnalyzer.OcctWrapper — OCCT C++/CLI Implementation
// OpenCascade Technology 8.0 — LGPL 2.1
// Build: Visual Studio 2022+, /clr:netcore, x64, C++17 (required by OCCT 8)
// Set Additional Include Directories to: $(OCCT_ROOT)\inc
// Set Additional Library Directories to: $(OCCT_ROOT)\win64\vc14\lib
// OCCT_ROOT = path to your OCCT 8.0 installation (e.g. C:\OCCT\opencascade-8.0.0-vc14-64)

#include "OcctWrapper.h"

// ── OCCT Headers ───────────────────────────────────────────────────────────
// STEP reader
#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>

// BRep topology / geometry
#include <TopoDS_Shape.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS.hxx>
#include <TopExp_Explorer.hxx>
#include <BRep_Tool.hxx>

// Tessellation
#include <BRepMesh_IncrementalMesh.hxx>
#include <Poly_MeshPurpose.hxx>
#include <Poly_Triangulation.hxx>

// Bounding box
#include <BRepBndLib.hxx>
#include <Bnd_Box.hxx>

// Mass properties (volume)
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>

// Geometry primitives
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>
#include <gp_Dir.hxx>
#include <gp_Ax3.hxx>
#include <gp_Trsf.hxx>

// Shape transform
#include <BRepBuilderAPI_Transform.hxx>

// Ray–surface intersection
#include <IntCurvesFace_ShapeIntersector.hxx>
#include <gp_Lin.hxx>
#include <Precision.hxx>

// Collections
#include <TColgp_Array1OfPnt.hxx>
#include <Poly_Array1OfTriangle.hxx>
#include <TColStd_Array1OfInteger.hxx>

#include <vector>
#include <limits>

using namespace System;
using namespace System::Collections::Generic;
using namespace System::Runtime::InteropServices;

namespace ThreeDAnalyzer {
namespace OcctWrapper {

// ── Constructor / Destructor ───────────────────────────────────────────────

OcctEngine::OcctEngine()
    : m_shape(nullptr)
{
    m_shape = new TopoDS_Shape();
}

OcctEngine::~OcctEngine()
{
    this->!OcctEngine();
}

OcctEngine::!OcctEngine()
{
    if (m_shape)
    {
        delete static_cast<TopoDS_Shape*>(m_shape);
        m_shape = nullptr;
    }
}

// ── LoadStepFile ──────────────────────────────────────────────────────────

bool OcctEngine::LoadStepFile(String^ filePath)
{
    const char* path = (const char*)(Marshal::StringToHGlobalAnsi(filePath)).ToPointer();

    STEPControl_Reader reader;
    IFSelect_ReturnStatus status = reader.ReadFile(path);

    Marshal::FreeHGlobal(IntPtr((void*)path));

    if (status != IFSelect_RetDone)
        return false;

    Standard_Integer nRoots = reader.TransferRoots();
    if (nRoots == 0)
        return false;

    TopoDS_Shape* shape = static_cast<TopoDS_Shape*>(m_shape);
    *shape = reader.OneShape();

    return !shape->IsNull();
}

// ── GetMesh ───────────────────────────────────────────────────────────────

MeshData^ OcctEngine::GetMesh(double linearDeflection)
{
    return TessellateShape(m_shape, linearDeflection);
}

// ── GetBoundingBox ────────────────────────────────────────────────────────

BoundingBoxData^ OcctEngine::GetBoundingBox()
{
    return ComputeBoundingBox(m_shape);
}

// ── GetVolume ─────────────────────────────────────────────────────────────

double OcctEngine::GetVolume()
{
    TopoDS_Shape* shape = static_cast<TopoDS_Shape*>(m_shape);
    if (!shape || shape->IsNull()) return 0.0;

    GProp_GProps props;
    BRepGProp::VolumeProperties(*shape, props);
    return props.Mass();   // mm³ when shape is in mm
}

// ── GetMeshInCustomCS ─────────────────────────────────────────────────────

MeshData^ OcctEngine::GetMeshInCustomCS(
    double ox, double oy, double oz,
    double xx, double xy, double xz,
    double yx, double yy, double yz)
{
    void* transformed = TransformToCustomCS(ox,oy,oz, xx,xy,xz, yx,yy,yz);
    if (!transformed) return gcnew MeshData();
    MeshData^ result = TessellateShape(transformed, 0.1);
    delete static_cast<TopoDS_Shape*>(transformed);
    return result;
}

// ── GetBoundingBoxInCustomCS ──────────────────────────────────────────────

BoundingBoxData^ OcctEngine::GetBoundingBoxInCustomCS(
    double ox, double oy, double oz,
    double xx, double xy, double xz,
    double yx, double yy, double yz)
{
    void* transformed = TransformToCustomCS(ox,oy,oz, xx,xy,xz, yx,yy,yz);
    if (!transformed) return gcnew BoundingBoxData();
    BoundingBoxData^ result = ComputeBoundingBox(transformed);
    delete static_cast<TopoDS_Shape*>(transformed);
    return result;
}

// ── RayPickSurface ────────────────────────────────────────────────────────

bool OcctEngine::RayPickSurface(
    double rox, double roy, double roz,
    double rdx, double rdy, double rdz,
    [Out] double% hitX,
    [Out] double% hitY,
    [Out] double% hitZ)
{
    hitX = hitY = hitZ = 0.0;

    TopoDS_Shape* shape = static_cast<TopoDS_Shape*>(m_shape);
    if (!shape || shape->IsNull()) return false;

    gp_Pnt rayOrigin(rox, roy, roz);
    gp_Dir rayDir;
    try { rayDir = gp_Dir(rdx, rdy, rdz); }
    catch (...) { return false; }  // zero-length direction

    gp_Lin ray(rayOrigin, rayDir);

    IntCurvesFace_ShapeIntersector inter;
    inter.Load(*shape, Precision::Confusion());
    inter.Perform(ray, -1.0e10, 1.0e10);

    if (inter.NbPnt() == 0) return false;

    // Find the intersection point closest to the ray origin
    gp_Pnt closest = inter.Pnt(1);
    Standard_Real minDist = rayOrigin.Distance(closest);

    for (int i = 2; i <= inter.NbPnt(); ++i)
    {
        Standard_Real d = rayOrigin.Distance(inter.Pnt(i));
        if (d < minDist) { minDist = d; closest = inter.Pnt(i); }
    }

    hitX = closest.X();
    hitY = closest.Y();
    hitZ = closest.Z();
    return true;
}

// ── Private: TessellateShape ──────────────────────────────────────────────

MeshData^ OcctEngine::TessellateShape(void* shapePtr, double linearDeflection)
{
    TopoDS_Shape* shape = static_cast<TopoDS_Shape*>(shapePtr);
    if (!shape || shape->IsNull()) return gcnew MeshData();

    // Triangulate
    BRepMesh_IncrementalMesh mesher(*shape, linearDeflection, Standard_False, 0.5);
    mesher.Perform();

    std::vector<float>  verts;
    std::vector<int>    indices;
    int vertOffset = 0;

    for (TopExp_Explorer fExp(*shape, TopAbs_FACE); fExp.More(); fExp.Next())
    {
        TopoDS_Face face = TopoDS::Face(fExp.Current());
        TopLoc_Location loc;
        // OCCT 7.7+: triangulations are stored with a mesh purpose. Try several; AnyFallback alone
        // can return a non-null handle with no usable triangles on some builds.
        static const Poly_MeshPurpose kPurposes[] = {
            Poly_MeshPurpose_NONE,
            Poly_MeshPurpose_Presentation,
            Poly_MeshPurpose_Calculation,
            Poly_MeshPurpose_AnyFallback
        };
        Handle(Poly_Triangulation) tri;
        for (const Poly_MeshPurpose purpose : kPurposes)
        {
            tri = BRep_Tool::Triangulation(face, loc, purpose);
            if (!tri.IsNull() && tri->NbNodes() >= 3 && tri->NbTriangles() >= 1)
                break;
            tri.Nullify();
        }
        if (tri.IsNull()) continue;

        const int nNodes = tri->NbNodes();
        const int nTris  = tri->NbTriangles();
        const bool isReversed = (face.Orientation() == TopAbs_REVERSED);

        // Collect nodes; apply the face's location transform to put them in world space.
        // TopLoc_Location has operator const gp_Trsf&() for implicit conversion.
        for (int i = 1; i <= nNodes; ++i)
        {
            gp_Pnt p = tri->Node(i);
            if (!loc.IsIdentity())
                p.Transform(loc);   // TopLoc_Location → gp_Trsf (implicit)
            verts.push_back((float)p.X());
            verts.push_back((float)p.Y());
            verts.push_back((float)p.Z());
        }

        // Collect triangle indices
        for (int i = 1; i <= nTris; ++i)
        {
            Standard_Integer n1, n2, n3;
            tri->Triangle(i).Get(n1, n2, n3);
            // n1,n2,n3 are 1-based within this face
            if (isReversed) std::swap(n2, n3);
            indices.push_back(vertOffset + n1 - 1);
            indices.push_back(vertOffset + n2 - 1);
            indices.push_back(vertOffset + n3 - 1);
        }

        vertOffset += nNodes;
    }

    MeshData^ result = gcnew MeshData();
    result->Vertices = gcnew array<float>((int)verts.size());
    result->Indices  = gcnew array<int>((int)indices.size());

    for (int i = 0; i < (int)verts.size();   ++i) result->Vertices[i] = verts[i];
    for (int i = 0; i < (int)indices.size(); ++i) result->Indices[i]  = indices[i];

    return result;
}

// ── Private: ComputeBoundingBox ───────────────────────────────────────────

BoundingBoxData^ OcctEngine::ComputeBoundingBox(void* shapePtr)
{
    TopoDS_Shape* shape = static_cast<TopoDS_Shape*>(shapePtr);
    BoundingBoxData^ result = gcnew BoundingBoxData();

    if (!shape || shape->IsNull()) return result;

    Bnd_Box box;
    BRepBndLib::Add(*shape, box);
    if (box.IsVoid()) return result;

    Standard_Real xmin, ymin, zmin, xmax, ymax, zmax;
    box.Get(xmin, ymin, zmin, xmax, ymax, zmax);

    result->MinX = xmin; result->MinY = ymin; result->MinZ = zmin;
    result->MaxX = xmax; result->MaxY = ymax; result->MaxZ = zmax;
    return result;
}

// ── Private: TransformToCustomCS ─────────────────────────────────────────

void* OcctEngine::TransformToCustomCS(
    double ox, double oy, double oz,
    double xx, double xy, double xz,
    double yx, double yy, double yz)
{
    TopoDS_Shape* shape = static_cast<TopoDS_Shape*>(m_shape);
    if (!shape || shape->IsNull()) return nullptr;

    gp_Pnt origin(ox, oy, oz);

    // Build X and Y direction vectors from the two user-defined points (two-point form)
    gp_Vec xVec(gp_Pnt(ox, oy, oz), gp_Pnt(xx, xy, xz));
    gp_Vec yVec(gp_Pnt(ox, oy, oz), gp_Pnt(yx, yy, yz));

    if (xVec.Magnitude() < Precision::Confusion() ||
        yVec.Magnitude() < Precision::Confusion())
        return nullptr;

    xVec.Normalize();
    yVec.Normalize();

    // Z = X cross Y (right-hand rule)
    gp_Vec zVec = xVec.Crossed(yVec);
    if (zVec.Magnitude() < Precision::Confusion())
        return nullptr;   // Collinear points — cannot define a plane
    zVec.Normalize();

    // Recompute Y for orthogonality: Y = Z cross X
    yVec = zVec.Crossed(xVec);

    gp_Ax3 localCS(origin, gp_Dir(zVec), gp_Dir(xVec));

    // Build the transformation: world → local CS
    gp_Trsf trsf;
    trsf.SetTransformation(localCS);

    // Apply transform to a copy of the shape (Standard_True = copy)
    BRepBuilderAPI_Transform builder(*shape, trsf, Standard_True);
    if (!builder.IsDone()) return nullptr;

    TopoDS_Shape* transformed = new TopoDS_Shape(builder.Shape());
    return transformed;
}

} // namespace OcctWrapper
} // namespace ThreeDAnalyzer
