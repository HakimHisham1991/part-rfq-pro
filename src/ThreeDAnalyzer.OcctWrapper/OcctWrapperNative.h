#pragma once
// Pure native OCCT helpers (implemented in OcctWrapperNative.cpp, no /clr).

class TopoDS_Shape;
class TopoDS_Face;
class gp_Lin;
class gp_Pnt;

namespace OcctNative {

double ShapeDiag(const TopoDS_Shape& shape);

bool TryRadiusFromFace(const TopoDS_Face& face, double& radiusMm, const char*& kindTag);

bool TryClosestCircleEdge(const TopoDS_Shape& shape, const gp_Lin& ray, gp_Pnt& hit,
    double& radiusMm, double toleranceMm);

} // namespace OcctNative
