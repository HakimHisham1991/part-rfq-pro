using Microsoft.AspNetCore.Mvc.RazorPages;

namespace ThreeDAnalyzer.Web.Pages.Settings.MaterialSpecs;

public class IndexModel : PageModel
{
    public string DefaultCreatedBy { get; private set; } = "";

    public void OnGet()
    {
        DefaultCreatedBy = HttpContext.Session.GetString("DisplayName")
            ?? HttpContext.Session.GetString("Username")
            ?? "";
    }
}
