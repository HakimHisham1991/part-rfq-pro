namespace ThreeDAnalyzer.Core.Models;

/// <summary>A point in 3D world space (mm units).</summary>
public record Point3D(double X, double Y, double Z)
{
    public static Point3D Zero => new(0, 0, 0);

    public Point3D Subtract(Point3D other) => new(X - other.X, Y - other.Y, Z - other.Z);

    public double Length => Math.Sqrt(X * X + Y * Y + Z * Z);

    public Point3D Normalize()
    {
        var len = Length;
        return len < 1e-12 ? Zero : new(X / len, Y / len, Z / len);
    }

    public Point3D Cross(Point3D other) => new(
        Y * other.Z - Z * other.Y,
        Z * other.X - X * other.Z,
        X * other.Y - Y * other.X);

    public double Dot(Point3D other) => X * other.X + Y * other.Y + Z * other.Z;

    public override string ToString() => $"({X:F3}, {Y:F3}, {Z:F3})";
}

/// <summary>
/// Three-point custom coordinate system definition.
/// P1 = custom origin, P2 = point on custom X+ axis, P3 = point on custom XY plane (Y+ side).
/// </summary>
public class CustomCS
{
    /// <summary>P1: The new coordinate system origin (world space).</summary>
    public Point3D? Origin { get; set; }

    /// <summary>P2: A point along the custom X+ direction (world space).</summary>
    public Point3D? XPoint { get; set; }

    /// <summary>P3: A point roughly along the custom Y+ direction, defining the XY plane (world space).</summary>
    public Point3D? YPoint { get; set; }

    public bool IsComplete => Origin is not null && XPoint is not null && YPoint is not null;

    /// <summary>
    /// Validates that the three points define a non-degenerate coordinate system.
    /// Returns null if valid, or an error message.
    /// </summary>
    public string? Validate()
    {
        if (!IsComplete) return "All three points must be picked.";

        var xDir = XPoint!.Subtract(Origin!).Normalize();
        var yDir = YPoint!.Subtract(Origin!).Normalize();
        var crossLen = xDir.Cross(yDir).Length;

        if (crossLen < 0.01)
            return "The three points are collinear — they cannot define a plane. Pick different points.";

        return null;
    }
}
