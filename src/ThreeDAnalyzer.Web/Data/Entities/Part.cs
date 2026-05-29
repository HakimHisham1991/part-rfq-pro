namespace ThreeDAnalyzer.Web.Data.Entities;

public class Part
{
    public int Id { get; set; }
    public int ProjectId { get; set; }
    public Project Project { get; set; } = null!;

    public string Aircraft { get; set; } = "";
    public int No { get; set; }
    public string PartNumber { get; set; } = "";
    public string PartDescription { get; set; } = "";
    public string Picture { get; set; } = "";
    public int Qpa { get; set; }
    public int FirstLaunchQty { get; set; }
    public string FirstDelivery { get; set; } = "";
    public string MaterialSpec { get; set; } = "";
    public double FinishThickness { get; set; }
    public double FinishWidth { get; set; }
    public double FinishLength { get; set; }
    public double MaterialRulingDim { get; set; }
    public double MaterialThickness { get; set; }
    public double MaterialWidth { get; set; }
    public double MaterialLength { get; set; }
    public int QtyPerBillet { get; set; }
    public double SetupTimeHour { get; set; }
    public double CycleTurnMill { get; set; }
    public double Cycle3x { get; set; }
    public double Cycle4x { get; set; }
    public double Cycle5x { get; set; }
    public double CycleTotalHrs { get; set; }
    public string? CycleTimeDataJson { get; set; }
}
