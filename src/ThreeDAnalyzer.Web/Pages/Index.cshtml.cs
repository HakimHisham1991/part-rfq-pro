using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using ThreeDAnalyzer.Web.Services;

namespace ThreeDAnalyzer.Web.Pages;

public class IndexModel(IAuthService authService) : PageModel
{
    public IActionResult OnGet() =>
        authService.IsAuthenticated(HttpContext) ? Redirect("/Projects") : Redirect("/login");
}
