using Microsoft.EntityFrameworkCore;
using ThreeDAnalyzer.Web.Data;
using ThreeDAnalyzer.Web.Data.Entities;

namespace ThreeDAnalyzer.Web.Services;

public class AuthService(AppDbContext db) : IAuthService
{
    private const string UserIdSessionKey = "UserId";

    public async Task<User?> AuthenticateAsync(string username, string password)
    {
        var normalized = username.Trim().ToLowerInvariant();
        var user = await db.Users
            .FirstOrDefaultAsync(u => u.Username.ToLower() == normalized);

        if (user == null) return null;
        if (!string.Equals(user.Status, "Active", StringComparison.OrdinalIgnoreCase)) return null;
        if (!string.Equals(user.Password ?? "", password.Trim(), StringComparison.Ordinal)) return null;

        return user;
    }

    public void SetUserSession(HttpContext context, User user)
    {
        context.Session.SetInt32(UserIdSessionKey, user.Id);
        context.Session.SetString("Username", user.Username);
        context.Session.SetString("DisplayName", user.DisplayName);
    }

    public void ClearUserSession(HttpContext context) => context.Session.Clear();

    public bool IsAuthenticated(HttpContext context) =>
        context.Session.GetInt32(UserIdSessionKey).HasValue;
}
