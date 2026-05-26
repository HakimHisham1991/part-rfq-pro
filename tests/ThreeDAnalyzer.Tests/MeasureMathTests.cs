using ThreeDAnalyzer.Core.Models;

namespace ThreeDAnalyzer.Tests;

public class MeasureMathTests
{
    [Fact]
    public void Distance_is_euclidean()
    {
        var a = new Point3D(0, 0, 0);
        var b = new Point3D(3, 4, 0);
        Assert.Equal(5, MeasureMath.Distance(a, b), 6);
    }

    [Fact]
    public void Angle_at_right_angle_is_90()
    {
        var a = new Point3D(1, 0, 0);
        var v = new Point3D(0, 0, 0);
        var c = new Point3D(0, 1, 0);
        Assert.Equal(90, MeasureMath.AngleDegrees(a, v, c)!.Value, 2);
    }
}
