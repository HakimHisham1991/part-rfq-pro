namespace ThreeDAnalyzer.Core.Models;

/// <summary>
/// Three-point custom coordinate system definition.
/// P1 = custom origin, P2 = point on custom X+ axis, P3 = point on custom XY plane (Y+ side).
/// </summary>
public class CustomCS
{
    public Point3D? Origin { get; set; }
    public Point3D? XPoint { get; set; }
    public Point3D? YPoint { get; set; }

    public bool IsComplete => Origin is not null && XPoint is not null && YPoint is not null;

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
