using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace ThreeDAnalyzer.Web.Pages;

public class IndexModel : PageModel
{
    public IActionResult OnGet() => Redirect("/Projects");
}
