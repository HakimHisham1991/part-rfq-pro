using ThreeDAnalyzer.Web.Data.Entities;

namespace ThreeDAnalyzer.Web.Services;

public interface IAuthService
{
    Task<User?> AuthenticateAsync(string username, string password);
    void SetUserSession(HttpContext context, User user);
    void ClearUserSession(HttpContext context);
    bool IsAuthenticated(HttpContext context);
}
