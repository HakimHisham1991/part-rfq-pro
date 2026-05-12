namespace ThreeDAnalyzer.Core.Models;

/// <summary>Tessellated triangle mesh data for transfer to the browser (Three.js).</summary>
public class MeshData
{
    /// <summary>Flat array of vertex positions: x0,y0,z0, x1,y1,z1, … (mm units)</summary>
    public float[] Vertices { get; set; } = [];

    /// <summary>Triangle index triplets into the Vertices array.</summary>
    public int[] Indices { get; set; } = [];

    public bool IsEmpty => Vertices.Length == 0;
}
