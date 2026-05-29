namespace ThreeDAnalyzer.Web.Middleware;

public class AuthenticationMiddleware(RequestDelegate next)
{
    private static readonly string[] PublicPrefixes =
    [
        "/login",
        "/css/",
        "/js/",
        "/lib/",
        "/images/",
        "/favicon"
    ];

    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path.Value ?? "";

        if (IsPublicPath(path))
        {
            await next(context);
            return;
        }

        if (!context.Session.GetInt32("UserId").HasValue)
        {
            if (path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase))
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }

            context.Response.Redirect("/login");
            return;
        }

        await next(context);
    }

    private static bool IsPublicPath(string path)
    {
        if (string.Equals(path, "/", StringComparison.OrdinalIgnoreCase)) return true;
        return PublicPrefixes.Any(p =>
            path.StartsWith(p, StringComparison.OrdinalIgnoreCase));
    }
}

public static class AuthenticationMiddlewareExtensions
{
    public static IApplicationBuilder UseAppAuthentication(this IApplicationBuilder app) =>
        app.UseMiddleware<AuthenticationMiddleware>();
}
