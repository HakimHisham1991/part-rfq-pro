namespace ThreeDAnalyzer.Core.Models;

/// <summary>A ray in 3D world space for surface intersection picking.</summary>
/// <param name="Ox">Ray origin X (mm)</param>
/// <param name="Oy">Ray origin Y (mm)</param>
/// <param name="Oz">Ray origin Z (mm)</param>
/// <param name="Dx">Ray direction X (normalized)</param>
/// <param name="Dy">Ray direction Y (normalized)</param>
/// <param name="Dz">Ray direction Z (normalized)</param>
public record Ray(double Ox, double Oy, double Oz, double Dx, double Dy, double Dz);
