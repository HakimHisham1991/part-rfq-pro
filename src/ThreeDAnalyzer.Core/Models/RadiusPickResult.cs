namespace ThreeDAnalyzer.Core.Models;

public sealed record RadiusPickResult(Point3D Hit, double RadiusMm, string Kind);
