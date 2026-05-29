namespace ThreeDAnalyzer.Web.Data.Entities;

public class MaterialSpec
{
    public int Id { get; set; }
    public string Specification { get; set; } = "";
    public string GeneralName { get; set; } = "";
    public string MaterialType { get; set; } = "";
    /// <summary>Density in kg/m³.</summary>
    public double Density { get; set; }
    public string CreatedBy { get; set; } = "";
    public DateOnly CreatedDate { get; set; }
    public string Status { get; set; } = "Active";
}
