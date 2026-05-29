using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using ThreeDAnalyzer.Web.Models;
using ThreeDAnalyzer.Web.Services;

namespace ThreeDAnalyzer.Web.Pages;

public class LoginModel(IAuthService authService) : PageModel
{
    [BindProperty]
    public LoginViewModel Input { get; set; } = new();

    public IActionResult OnGet()
    {
        if (authService.IsAuthenticated(HttpContext))
            return Redirect("/Projects");
        return Page();
    }

    public async Task<IActionResult> OnPostAsync()
    {
        if (!ModelState.IsValid)
            return Page();

        var user = await authService.AuthenticateAsync(Input.Username, Input.Password);
        if (user == null)
        {
            Input.ErrorMessage = "Invalid username or password";
            return Page();
        }

        authService.SetUserSession(HttpContext, user);
        return Redirect("/Projects");
    }
}
