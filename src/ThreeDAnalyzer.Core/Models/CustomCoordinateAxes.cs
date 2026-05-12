namespace ThreeDAnalyzer.Core.Models;

// Oriented axes match OcctEngine::TransformToCustomCS (Z = X×Y raw, then Y = Z×X).
public static class CustomCoordinateAxes
{
    public static void GetOrthonormalDirections(CustomCS cs, out Point3D xAxis, out Point3D yAxis, out Point3D zAxis)
    {
        if (!cs.IsComplete)
            throw new InvalidOperationException("Custom CS is incomplete.");

        var ox = cs.Origin!;
        var xDir = cs.XPoint!.Subtract(ox).Normalize();
        var yRaw = cs.YPoint!.Subtract(ox).Normalize();
        zAxis = xDir.Cross(yRaw).Normalize();
        yAxis = zAxis.Cross(xDir).Normalize();
        xAxis = xDir;
    }
}
