namespace ThreeDAnalyzer.Core.Models;

/// <summary>Axis-aligned bounding box of a shape in a given coordinate system (mm units).</summary>
public class BoundingBoxData
{
    public double MinX { get; set; }
    public double MinY { get; set; }
    public double MinZ { get; set; }
    public double MaxX { get; set; }
    public double MaxY { get; set; }
    public double MaxZ { get; set; }

    public double SizeX => MaxX - MinX;
    public double SizeY => MaxY - MinY;
    public double SizeZ => MaxZ - MinZ;

    /// <summary>Volume of the bounding box in mm³.</summary>
    public double Volume => SizeX * SizeY * SizeZ;

    /// <summary>Volume of the bounding box in cm³.</summary>
    public double VolumeCm3 => Volume / 1000.0;

    public bool IsEmpty => SizeX <= 0 || SizeY <= 0 || SizeZ <= 0;
}
