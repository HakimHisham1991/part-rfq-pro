namespace ThreeDAnalyzer.Core.Models;

public static class MeasureMath
{
    public static double Distance(Point3D a, Point3D b) => a.DistanceTo(b);

    /// <summary>Angle at vertex B between segments BA and BC (degrees).</summary>
    public static double? AngleDegrees(Point3D a, Point3D vertex, Point3D c)
    {
        var u = a.Subtract(vertex).Normalize();
        var v = c.Subtract(vertex).Normalize();
        if (u.Length < 1e-9 || v.Length < 1e-9)
            return null;

        var cos = Math.Clamp(u.Dot(v), -1.0, 1.0);
        return Math.Acos(cos) * (180.0 / Math.PI);
    }
}
