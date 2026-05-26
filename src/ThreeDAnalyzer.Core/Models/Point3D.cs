namespace ThreeDAnalyzer.Core.Models;

/// <summary>A point in 3D world space (mm units).</summary>
public record Point3D(double X, double Y, double Z)
{
    public static Point3D Zero => new(0, 0, 0);

    public Point3D Subtract(Point3D other) => new(X - other.X, Y - other.Y, Z - other.Z);

    public double DistanceTo(Point3D other) => Subtract(other).Length;

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
