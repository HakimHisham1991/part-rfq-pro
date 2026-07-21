using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using ThreeDAnalyzer.Web.Data;
using ThreeDAnalyzer.Web.Middleware;
using ThreeDAnalyzer.Web.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders =
        ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? "Data Source=App_Data/part-rfq.db";

var dbPath = connectionString.Replace("Data Source=", "", StringComparison.OrdinalIgnoreCase).Trim();
var dbDir = Path.GetDirectoryName(dbPath);
if (!string.IsNullOrEmpty(dbDir))
{
    Directory.CreateDirectory(Path.Combine(builder.Environment.ContentRootPath, dbDir));
}

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite($"Data Source={Path.Combine(builder.Environment.ContentRootPath, dbPath)}"));

builder.Services.AddControllers();
builder.Services.AddRazorPages();
builder.Services.AddDistributedMemoryCache();
builder.Services.AddSession(options =>
{
    options.IdleTimeout = TimeSpan.FromHours(8);
    options.Cookie.HttpOnly = true;
    options.Cookie.IsEssential = true;
    options.Cookie.Name = ".PartRfqPro.Session";
    options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
});
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddSingleton<PartPictureService>();

var app = builder.Build();

if (!app.Environment.IsDevelopment())
{
    app.UseForwardedHeaders();
}

using (var scope = app.Services.CreateScope())
{
    await DbSeeder.SeedAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>());
}

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
}
else
{
    app.UseHsts();
    app.UseHttpsRedirection();
}

var staticContentTypes = new FileExtensionContentTypeProvider();
staticContentTypes.Mappings[".wasm"] = "application/wasm";

void CacheLibAssets(StaticFileResponseContext ctx)
{
    var path = ctx.Context.Request.Path.Value ?? string.Empty;
    if (path.StartsWith("/lib/", StringComparison.OrdinalIgnoreCase))
    {
        // Short cache — immutable year-long headers broke Open STEP after FTP
        // when a partial/corrupt three.js was cached by browsers.
        ctx.Context.Response.Headers.CacheControl = "public, max-age=3600, must-revalidate";
    }
}

app.UseStaticFiles(new StaticFileOptions
{
    ContentTypeProvider = staticContentTypes,
    OnPrepareResponse = CacheLibAssets
});

// MonsterASP FTP unzip sometimes nests publish's wwwroot one level too deep:
//   site/wwwroot/wwwroot/lib/three.module.min.js  → URL /wwwroot/lib/...
// while the app expects /lib/.... Map that nested folder as /lib when needed.
var webRoot = app.Environment.WebRootPath;
var correctLibFile = Path.Combine(webRoot, "lib", "three.module.min.js");
var nestedLibDir = Path.Combine(webRoot, "wwwroot", "lib");
if (!File.Exists(correctLibFile) && Directory.Exists(nestedLibDir))
{
    app.Logger.LogWarning(
        "Static /lib is missing; serving from nested {{WebRoot}}/wwwroot/lib. " +
        "Move that folder up to {{WebRoot}}/lib on the server to fix the FTP layout.");
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(nestedLibDir),
        RequestPath = "/lib",
        ContentTypeProvider = staticContentTypes,
        OnPrepareResponse = CacheLibAssets
    });
}

app.UseRouting();
app.UseSession();
app.UseAppAuthentication();
app.MapControllers();
app.MapRazorPages();

app.Run();
