# 3D Part Analyzer

A Blazor Server web application for analyzing STEP/STP 3D CAD files in aerospace manufacturing.

## Features

| # | Feature |
|---|---------|
| 1 | Open STEP / STP files (AP203 + AP214) |
| 2 | Rotate, pan, zoom — Three.js WebGL viewer |
| 3 | Exact part volume (mm³ / cm³) via OCCT mass properties |
| 4 | Bounding box visualization (orange wireframe) |
| 5 | Expand each of 6 faces independently for raw stock sizing |
| 6 | Raw material volume + utilization % |
| 7 | 3-point custom coordinate system with surface snap picking |

## Prerequisites

- **.NET 10 SDK** — https://dotnet.microsoft.com/download  
- **OpenCascade Technology 7.8** (Windows x64 LGPL) — https://dev.opencascade.org/release  
- **MSVC toolset** to compile the C++/CLI OCCT wrapper — one of:
  - **Visual Studio 2022 Community** (free), workload *Desktop development with C++* (include **C++/CLI**), or  
  - **Build Tools for Visual Studio 2022** (free, smaller install) — same workload/components.

**Visual Studio Code only:** VS Code is enough to edit and run the C# app (`dotnet build`, `dotnet run`). It does **not** replace MSVC for the `ThreeDAnalyzer.OcctWrapper` project. After installing Build Tools or VS 2022, from the repo root run:

```powershell
.\scripts\Build-OcctWrapper.ps1
dotnet build src\ThreeDAnalyzer.Web
```

## Build Order

### Step 1 — Set OCCT_ROOT environment variable

```powershell
# Example (adjust to your actual installation path):
[System.Environment]::SetEnvironmentVariable("OCCT_ROOT", "C:\OpenCASCADE-7.8.0-vc14-64", "User")
```

### Step 2 — Build the C++/CLI wrapper (MSBuild / Visual Studio)

**Option A — PowerShell (good with VS Code):** from repo root, with Build Tools or VS installed:

```powershell
.\scripts\Build-OcctWrapper.ps1
```

**Option B — Visual Studio IDE:** open `ThreeDAnalyzer.slnx`, set **Release | x64**, build project `ThreeDAnalyzer.OcctWrapper`.
4. Copy OCCT DLLs next to the web app executable (after at least one `dotnet build` of the web project so the output folder exists):

```powershell
$occt = $env:OCCT_ROOT
$out  = "src\ThreeDAnalyzer.Web\bin\Debug\net10.0"   # or Release\net10.0 for Release builds
New-Item -ItemType Directory -Force -Path $out | Out-Null
Copy-Item "$occt\win64\vc14\bin\*.dll" $out
```

### Step 3 — Build the Blazor web app

If the wrapper DLL exists in any of these locations (checked at **build** time), **OCCT links automatically**:

- `src\ThreeDAnalyzer.OcctWrapper\x64\Release\ThreeDAnalyzer.OcctWrapper.dll`
- `src\ThreeDAnalyzer.OcctWrapper\x64\Debug\ThreeDAnalyzer.OcctWrapper.dll`
- `src\ThreeDAnalyzer.OcctWrapper\bin\x64\Release\net10.0\ThreeDAnalyzer.OcctWrapper.dll`
- `src\ThreeDAnalyzer.OcctWrapper\bin\x64\Debug\net10.0\ThreeDAnalyzer.OcctWrapper.dll`

Or set environment variable **`OCCT_WRAPPER_DLL`** to the full path of `ThreeDAnalyzer.OcctWrapper.dll` before building.

```powershell
dotnet build src\ThreeDAnalyzer.Web\ThreeDAnalyzer.Web.csproj
```

The build prints `ThreeDAnalyzer: linking OCCT wrapper from ...` when OCCT is on, or `ThreeDAnalyzer: OCCT wrapper not linked ...` with the paths it searched when off.

To build without linking the wrapper (UI-only): `dotnet build -p:UseOcct=false`

### Step 4 — Run

```powershell
dotnet run --project src\ThreeDAnalyzer.Web
```

> **Without the wrapper DLL:** the site runs but shows how to enable OCCT. The managed wrapper is built by Visual Studio to `src\ThreeDAnalyzer.OcctWrapper\x64\Release\ThreeDAnalyzer.OcctWrapper.dll` (not under `bin\...\net10.0`).

## Project Structure

```
ThreeDAnalyzer/
├── src/
│   ├── ThreeDAnalyzer.Web/              Blazor Server app
│   │   ├── Components/Pages/            Home.razor (main), About.razor (licenses)
│   │   ├── Components/Panels/           ModelViewer, BoundingBoxPanel, CoordinatePanel, VolumeDisplay
│   │   ├── Services/                    OcctService, ThreeJsInterop
│   │   ├── Engines/                     OcctEngineAdapter (#if USE_OCCT), NullOcctEngine (stub)
│   │   └── wwwroot/js/                  viewer.js, three.module.min.js, OrbitControls.js
│   ├── ThreeDAnalyzer.Core/             Models + IOcctEngine interface
│   └── ThreeDAnalyzer.OcctWrapper/      C++/CLI native wrapper (build in VS 2022)
└── tests/ThreeDAnalyzer.Tests/
```

## Licensing

This application uses only free, royalty-free libraries:

| Library | License | Notes |
|---------|---------|-------|
| OpenCascade Technology (OCCT) 7.8 | **LGPL 2.1** | Linked dynamically. See `LGPL-2.1.txt`. |
| Three.js r165 | MIT | See `wwwroot/js/LICENSE` |
| .NET 10 / ASP.NET Core / Blazor | MIT | |
| Bootstrap 5 | MIT | |

**LGPL compliance:** OCCT is linked as loose `.dll` files — never statically embedded.  
You may replace the OCCT DLLs with your own build. See the `/about` page in the running app.

## Keyboard Shortcuts (in viewer)

| Key | Action |
|-----|--------|
| `F` | Fit camera to model |
| Left drag | Rotate |
| Right drag / Middle drag | Pan |
| Scroll | Zoom |
