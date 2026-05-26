// Pure native translation unit — no C++/CLI. Linked into ThreeDAnalyzer.OcctWrapper.dll.

#include "OcctWrapperNative.h"

#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRep_Tool.hxx>
#include <BRepBndLib.hxx>
#include <Bnd_Box.hxx>
#include <GeomAbs_CurveType.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <GeomAPI_ProjectPointOnCurve.hxx>
#include <Geom_Curve.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS.hxx>
#include <cmath>

namespace OcctNative {

double ShapeDiag(const TopoDS_Shape& shape)
{
    Bnd_Box box;
    BRepBndLib::Add(shape, box);
    if (box.IsVoid()) return 100.0;
    Standard_Real xmin, ymin, zmin, xmax, ymax, zmax;
    box.Get(xmin, ymin, zmin, xmax, ymax, zmax);
    Standard_Real dx = xmax - xmin, dy = ymax - ymin, dz = zmax - zmin;
    return std::sqrt(dx * dx + dy * dy + dz * dz);
}

static double DistPointToLine(const gp_Pnt& p, const gp_Lin& line)
{
    gp_Vec w(line.Location(), p);
    return w.Crossed(line.Direction()).Magnitude();
}

bool TryRadiusFromFace(const TopoDS_Face& face, double& radiusMm, const char*& kindTag)
{
    BRepAdaptor_Surface surf(face);
    switch (surf.GetType())
    {
    case GeomAbs_Cylinder:
        radiusMm = surf.Cylinder().Radius();
        kindTag = "cylinder";
        return true;
    case GeomAbs_Sphere:
        radiusMm = surf.Sphere().Radius();
        kindTag = "sphere";
        return true;
    case GeomAbs_Torus:
        radiusMm = surf.Torus().MinorRadius();
        kindTag = "torus (minor)";
        return true;
    default:
        return false;
    }
}

bool TryClosestCircleEdge(const TopoDS_Shape& shape, const gp_Lin& ray, gp_Pnt& hit,
    double& radiusMm, double toleranceMm)
{
    double best = toleranceMm;
    bool found = false;

    for (TopExp_Explorer ex(shape, TopAbs_EDGE); ex.More(); ex.Next())
    {
        TopoDS_Edge edge = TopoDS::Edge(ex.Current());
        BRepAdaptor_Curve curve(edge);
        if (curve.GetType() != GeomAbs_Circle)
            continue;

        Standard_Real f = 0.0, l = 0.0;
        Handle(Geom_Curve) gc = BRep_Tool::Curve(edge, f, l);
        if (gc.IsNull())
            continue;

        GeomAPI_ProjectPointOnCurve proj(ray.Location(), gc, f, l);
        if (proj.NbPoints() < 1)
            continue;

        gp_Pnt nearP = proj.NearestPoint();
        Standard_Real d = DistPointToLine(nearP, ray);
        if (d >= best)
            continue;

        best = d;
        hit = nearP;
        radiusMm = curve.Circle().Radius();
        found = true;
    }

    return found;
}

} // namespace OcctNative
