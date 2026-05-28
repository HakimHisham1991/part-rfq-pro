# Deploy to MonsterASP.NET

## Hosting model

MonsterASP **OutOfProcess** hosting supports **DLL-only** apps (`dotnet` + `YourApp.dll`).  
Do **not** publish a self-contained `.exe` with OutOfProcess — the app pool may be disabled and the site returns **403 Forbidden**.

This repo publishes **portable framework-dependent** output with `UseAppHost=false` (runs on 32- or 64-bit `dotnet` on the server):

```xml
<aspNetCore processPath="dotnet" arguments=".\ThreeDAnalyzer.Web.dll" hostingModel="OutOfProcess" />
```

All STEP parsing runs in the browser (occt-import-js WASM). The server only serves static files and the Razor page.

## GitHub Actions secrets

In the repo: **Settings → Secrets and variables → Actions**, add values from the MonsterASP control panel (Web Deploy):

| Secret | Example |
|--------|---------|
| `WEBSITE_NAME` | `site12345` |
| `SERVER_COMPUTER_NAME` | `https://site12345.siteasp.net:8172` |
| `SERVER_USERNAME` | `site12345` |
| `SERVER_PASSWORD` | (Web Deploy password) |

`MONSTER_*` names are also accepted (same values).

**Do not** put `/msdeploy.axd?site=...` in `SERVER_COMPUTER_NAME` — use only `https://siteXXXX.siteasp.net:8172`.

## CI workflow

Push to `main` or `master` triggers `.github/workflows/deploy.yml`:

1. Validate Web Deploy secrets
2. `dotnet publish` (Release, portable, no app host)
3. Verify `ThreeDAnalyzer.Web.dll` exists and **no** `.exe`
4. Patch `web.config` for OutOfProcess + stdout logging
5. Web Deploy to MonsterASP

No npm, OCCT, or native build steps in CI.

## After deploy

1. Control panel → confirm **ASP.NET Core** is detected and the app pool is **running**.
2. File manager → **`wwwroot`** must contain `web.config`, `ThreeDAnalyzer.Web.dll`, and `wwwroot/lib/` (occt-import-js + three.js).
3. If the site fails, check **`wwwroot\logs\stdout_*.log`**.

## Local publish (same layout as CI)

```powershell
dotnet publish src/ThreeDAnalyzer.Web/ThreeDAnalyzer.Web.csproj `
  -c Release -o ./publish `
  --self-contained false /p:UseAppHost=false
```

Upload the `publish/` folder contents via Web Deploy or the control panel file manager.
