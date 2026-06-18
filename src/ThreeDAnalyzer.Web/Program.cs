using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
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

app.UseStaticFiles();
app.UseRouting();
app.UseSession();
app.UseAppAuthentication();
app.MapControllers();
app.MapRazorPages();

app.Run();
