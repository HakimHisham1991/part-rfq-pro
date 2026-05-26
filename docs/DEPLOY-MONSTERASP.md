# Deploy to MonsterASP.NET

## Why you saw 403 and “ASP.NET Core not detected”

MonsterASP documents that **OutOfProcess** hosting supports **only DLL** apps (`dotnet` + `YourApp.dll`).  
A **self-contained `.exe`** with `OutOfProcess` disables the app pool — the site looks empty, IIS returns **403 Forbidden**, and the control panel shows **ASP.NET Core application was not detected**.

This repo’s GitHub workflow publishes **framework-dependent** `win-x64` output with `UseAppHost=false` so `web.config` uses:

```xml
<aspNetCore processPath="dotnet" arguments=".\ThreeDAnalyzer.Web.dll" hostingModel="OutOfProcess" />
```

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

## GitHub Actions OCCT download

The workflow installs OCCT from two official V8_0_0 zips (not the large “combined” archive):

- `opencascade-release-no-pch.zip`
- `3rdparty-vc14-64.zip`

They are extracted under `occt-kit/staging/` as siblings (outer zips may contain another `.zip` — the install script unpacks those automatically). Cache key: `occt-v8-opencascade+3rdparty-v5`.

## After deploy

1. Control panel → your site → confirm **ASP.NET Core** is detected and the app pool is **running** (not disabled).
2. File manager → **`wwwroot`** must contain `web.config`, `ThreeDAnalyzer.Web.dll`, and OCCT native DLLs.
3. If the site still fails, open **`wwwroot\logs\stdout_*.log`** (stdout is enabled by the workflow).

## Re-enable a disabled app pool

If you previously deployed a self-contained `.exe` with OutOfProcess, MonsterASP may have disabled the pool. Open a **support ticket** to re-enable it, then redeploy with the fixed workflow.

## Local publish (same layout as CI)

```powershell
.\scripts\Publish-Clean.ps1 -OutputDirectory .\publish_monster -SelfContained:$false
# Publish-Clean.ps1 uses win-x64; csproj sets UseAppHost=false for IIS-friendly web.config
```

Manual Web Deploy: upload the publish folder contents via the control panel batch example (files land in `wwwroot`).
