namespace ThreeDAnalyzer.Web.Data.Entities;

public class Project
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public DateOnly DateRegistered { get; set; }
    public string Owner { get; set; } = "";
    public string Status { get; set; } = "Open";

    public ICollection<Part> Parts { get; set; } = new List<Part>();
}
