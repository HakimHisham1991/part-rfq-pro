using ThreeDAnalyzer.Core.Interfaces;
using ThreeDAnalyzer.Web.Components;
using ThreeDAnalyzer.Web.Engines;
using ThreeDAnalyzer.Web.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents()
    .AddHubOptions(options =>
    {
        // Default 32 KB is quickly exceeded when large mesh arrays arrive from JS (e.g. picking) or tooling.
        options.MaximumReceiveMessageSize = 128 * 1024 * 1024;
    });

// OCCT engine — resolved at startup.
// Without USE_OCCT build flag the NullOcctEngine is used (app starts, shows instructions).
// With USE_OCCT flag (dotnet build -p:UseOcct=true) the real C++/CLI adapter is used.
#if USE_OCCT
builder.Services.AddScoped<IOcctEngine, OcctEngineAdapter>();
#else
builder.Services.AddScoped<IOcctEngine, NullOcctEngine>();
#endif

builder.Services.AddScoped<OcctService>();
builder.Services.AddScoped<ThreeJsInterop>();

var app = builder.Build();

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
    app.UseHsts();
}

app.UseStatusCodePagesWithReExecute("/not-found", createScopeForStatusCodePages: true);
app.UseHttpsRedirection();
app.UseAntiforgery();

app.MapStaticAssets();
app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

app.Run();
