# Deploy to MonsterASP.NET

## Hosting model

MonsterASP **OutOfProcess** hosting supports **DLL-only** apps (`dotnet` + `YourApp.dll`).  
Do **not** publish a self-contained `.exe` with OutOfProcess — the app pool may be disabled and the site returns **403 Forbidden**.

This repo publishes **portable framework-dependent** output with `UseAppHost=false` (runs on 32- or 64-bit `dotnet` on the server):

```xml
<aspNetCore processPath="dotnet" arguments=".\ThreeDAnalyzer.Web.dll" hostingModel="OutOfProcess" />
```

All STEP parsing runs in the browser (occt-import-js WASM). The server only serves static files and the Razor page.

## CI workflow (build verification only — NO deploy)

Deployment is **manual**. `.github/workflows/deploy.yml` only verifies the project builds:

1. `dotnet publish` (Release, portable, no app host)
2. Verify required files exist and **no** `.exe`

No secrets, no Web Deploy, no npm/OCCT/native build steps in CI.

## Manual deploy (publish → zip → FTP → unzip → restart)

1. Run `publish.bat` → produces `C:\Users\Public\Documents\part-rfq-pro\publish_clean` (folder only, no zip)
2. **Zip the CONTENTS** of `publish_clean` manually — `web.config` must be at the **zip root** (do not zip the folder itself)
3. **Stop** the MonsterASP website / app pool (required — otherwise extract fails on locked `Data/*.json`)
4. Upload the zip and extract into the **site root** (`web.config` next to `ThreeDAnalyzer.Web.dll`)
5. If extract still errors on `Data/machines-master.json`: delete the server `Data` folder, extract again  
   (`Data/*.json` are seed files; live RFQ data stays in `App_Data/part-rfq.db`)
6. **Start** the website / app pool, wait 30–60 s
7. Hard-refresh the browser (Ctrl+F5)
8. Verify in the browser: `https://YOUR-SITE/lib/three.module.min.js` must return **200**  
   If only `…/wwwroot/lib/three.module.min.js` works, the zip was extracted one level too deep — move the inner `wwwroot/lib` folder up to sit next to `wwwroot/js`.

Correct server layout after extraction:

```
wwwroot            ← MonsterASP site root
├── web.config
├── ThreeDAnalyzer.Web.dll (+ .deps.json / .runtimeconfig.json)
├── Data\           (seed json files)
├── App_Data\       (live SQLite database — never delete)
├── logs\
└── wwwroot\        ← the app's static files (css / js / lib)
```

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
