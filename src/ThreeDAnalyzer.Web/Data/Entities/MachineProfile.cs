namespace ThreeDAnalyzer.Web.Data.Entities;

public class MachineProfile
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    /// <summary>Rapid rate in mm/min.</summary>
    public double RapidRateMmpm { get; set; }
    /// <summary>Spindle power in kW.</summary>
    public double SpindlePowerKw { get; set; }
    public double AccelDecelFactor { get; set; }
    /// <summary>Tool change time in seconds.</summary>
    public double ToolChangeTimeSec { get; set; }
    public string CreatedBy { get; set; } = "";
    public DateOnly CreatedDate { get; set; }
    public string Status { get; set; } = "Active";
}
