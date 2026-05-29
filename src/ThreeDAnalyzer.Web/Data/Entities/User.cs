namespace ThreeDAnalyzer.Web.Data.Entities;

public class User
{
    public int Id { get; set; }
    public string Username { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public DateOnly CreatedDate { get; set; }
    public string Status { get; set; } = "Active";
}
