using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using ThreeDAnalyzer.Web.Services;

namespace ThreeDAnalyzer.Web.Pages;

public class LogoutModel(IAuthService authService) : PageModel
{
    public IActionResult OnGet()
    {
        authService.ClearUserSession(HttpContext);
        return Redirect("/login");
    }
}
