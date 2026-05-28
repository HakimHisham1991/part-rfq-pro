# 3D Part Analyzer

Browser-based STEP/STP analyzer for aerospace manufacturing. The ASP.NET host serves static files only; all geometry parsing and measurements run in the browser via **occt-import-js** (WebAssembly) and **Three.js**.

## Features

| Feature | Status |
|---------|--------|
| Open STEP / STP | Yes |
| Pan / rotate / zoom (NX-style controls) | Yes |
| Part volume (mm³ / cm³) | Yes |
| Axis-aligned bounding box | Yes |
| Distance, angle, radius measurements | Yes |
| Vertex snap | Yes |
| Raw stock face expansion + utilization | Yes |
| 3-point custom coordinate system | Yes |

## Prerequisites

- **.NET 10 SDK** — https://dotnet.microsoft.com/download
- **Node.js** (optional, for refreshing JS libraries) — https://nodejs.org

## Run locally

```bat
run.bat
```

Or:

```powershell
dotnet run --project src\ThreeDAnalyzer.Web\ThreeDAnalyzer.Web.csproj --launch-profile http
```

Open http://localhost:5118

## Camera controls (Siemens NX style)

| Input | Action |
|-------|--------|
| `F` | Fit camera to model |
| Middle drag | Rotate |
| Shift + Middle drag | Pan |
| Scroll | Zoom |

## Refresh JavaScript libraries

After changing `package.json` dependencies:

```powershell
npm install
powershell -File scripts/copy-libs.ps1
```

Committed copies live in `src/ThreeDAnalyzer.Web/wwwroot/lib/`.

## Publish (MonsterASP / IIS)

```powershell
dotnet publish src/ThreeDAnalyzer.Web/ThreeDAnalyzer.Web.csproj `
  -c Release -o ./publish `
  --self-contained false /p:UseAppHost=false
```

Deploy via GitHub Actions (`.github/workflows/deploy.yml`) or upload the `publish/` folder manually. See [docs/DEPLOY-MONSTERASP.md](docs/DEPLOY-MONSTERASP.md).

## Project layout

```
src/ThreeDAnalyzer.Web/     ASP.NET Razor Pages host
  Pages/Index.cshtml        UI shell
  wwwroot/js/viewer.js      STEP load, 3D view, measurements
  wwwroot/lib/              occt-import-js + three.js (committed)
scripts/copy-libs.ps1       Copy npm packages into wwwroot/lib
.github/workflows/deploy.yml CI publish + Web Deploy
```
