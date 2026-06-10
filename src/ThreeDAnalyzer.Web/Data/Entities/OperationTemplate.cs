namespace ThreeDAnalyzer.Web.Data.Entities;

public class OperationTemplate
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string OperationType { get; set; } = "";
    public string ParamsJson { get; set; } = "{}";
    public string CreatedBy { get; set; } = "";
    public DateOnly CreatedDate { get; set; }
    public string Status { get; set; } = "Active";
}
