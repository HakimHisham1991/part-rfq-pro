using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace ThreeDAnalyzer.Web.Pages.Settings;

public class IndexModel : PageModel
{
    public IActionResult OnGet() => Redirect("/Settings/Users");
}
