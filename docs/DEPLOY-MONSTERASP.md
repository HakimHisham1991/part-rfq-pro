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

## Manual FTP zip upload

1. Run `publish.bat` → produces `C:\Users\Public\Documents\part-rfq-pro\publish_clean.zip`
2. **Stop** the MonsterASP website / app pool (required — otherwise extract fails on locked `Data/*.json`)
3. Upload the zip and extract into the **site root** (`web.config` next to `ThreeDAnalyzer.Web.dll`)
4. If extract still errors on `Data/machines-master.json`: delete the server `Data` folder, extract again  
   (`Data/*.json` are seed files; live RFQ data stays in `App_Data/part-rfq.db`)
5. **Start** the website / app pool
6. Hard-refresh the browser (Ctrl+F5)
7. Verify in the browser: `https://YOUR-SITE/lib/three.module.min.js` must return **200**  
   If only `…/wwwroot/lib/three.module.min.js` works, the zip was extracted one level too deep — move the inner `wwwroot/lib` folder up to sit next to `wwwroot/js`.

## After deploy

1. Control panel → confirm **ASP.NET Core** is detected and the app pool is **running**.
2. File manager → site **`wwwroot`** must contain at least:
   - `web.config` (OutOfProcess: `dotnet` + `ThreeDAnalyzer.Web.dll`)
   - `ThreeDAnalyzer.Web.dll`, `ThreeDAnalyzer.Web.deps.json`, `ThreeDAnalyzer.Web.runtimeconfig.json`
   - `Data/material-specs-master.json`
   - nested `wwwroot/` folder (css, js, lib including `occt-import-js.wasm`)
3. Upload the **contents** of the publish folder into the site `wwwroot` (not an extra nested folder).
4. If the site fails, check **`logs/stdout_*.log`** on the server.

### HTTP 400 on MonsterASP

If the browser shows **HTTP ERROR 400** but `stdout_*.log` shows `Application started`, the app is running; IIS/SSL forwarding is usually the cause. This project disables **HTTPS redirection** in Production (MonsterASP terminates SSL). Re-publish with the latest build, upload all files, and restart the app pool.

First startup seeds the SQLite database (users + 171 material specs) and can take **30–60 seconds** — wait for `Application started` in the log before testing the URL.

## Local publish (same layout as CI)

```powershell
dotnet publish src/ThreeDAnalyzer.Web/ThreeDAnalyzer.Web.csproj `
  -c Release -o ./publish `
  --self-contained false /p:UseAppHost=false
```

Upload the `publish/` folder contents via Web Deploy or the control panel file manager.
