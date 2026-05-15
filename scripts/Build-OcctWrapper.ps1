#Requires -Version 5.1
<#
.SYNOPSIS
  Builds ThreeDAnalyzer.OcctWrapper.vcxproj using MSBuild from Visual Studio / Build Tools.

.DESCRIPTION
  Visual Studio Code does not compile C++/CLI projects. You need MSVC installed
  (Visual Studio 2022 Community, or "Build Tools for Visual Studio 2022" with the
  "Desktop development with C++" workload, including C++/CLI support).

  Set OCCT_ROOT to your OCCT 8.0 install before running (User or Machine env var).

.EXAMPLE
  cd C:\path\to\part-rfq-pro
  .\scripts\Build-OcctWrapper.ps1
  dotnet build src\ThreeDAnalyzer.Web
#>
$ErrorActionPreference = 'Stop'
# scripts\ -> repo root
$repoRoot = Split-Path $PSScriptRoot -Parent
$webCsproj = Join-Path $repoRoot 'src\ThreeDAnalyzer.Web\ThreeDAnalyzer.Web.csproj'
if (-not (Test-Path $webCsproj)) {
    throw "Could not find $webCsproj - run scripts\Build-OcctWrapper.ps1 from inside the cloned repo."
}

if (-not $env:OCCT_ROOT -or -not (Test-Path $env:OCCT_ROOT)) {
    Write-Warning "OCCT_ROOT is missing or invalid. Set it to your OCCT install, e.g. C:\OCCT\opencascade-8.0.0-vc14-64"
}

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere)) {
    throw (
        "vswhere.exe not found. Install one of:" +
        [Environment]::NewLine + "  - Visual Studio 2022 Community (free), OR" +
        [Environment]::NewLine + "  - Build Tools for Visual Studio 2022" +
        [Environment]::NewLine + "with workload: Desktop development with C++ (include MSVC v143 and C++/CLI)." +
        [Environment]::NewLine + "https://visualstudio.microsoft.com/downloads/"
    )
}

$msbuild = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\MSBuild.exe' | Select-Object -First 1
if (-not $msbuild -or -not (Test-Path $msbuild)) {
    throw 'MSBuild.exe not found. Install Visual Studio Build Tools with MSBuild.'
}

$vcxproj = Join-Path $repoRoot 'src\ThreeDAnalyzer.OcctWrapper\ThreeDAnalyzer.OcctWrapper.vcxproj'
if (-not (Test-Path $vcxproj)) {
    throw "Missing $vcxproj"
}

Write-Host "MSBuild: $msbuild"
Write-Host "Project: $vcxproj"
Write-Host "OCCT_ROOT: $($env:OCCT_ROOT)"

& $msbuild $vcxproj /m /p:Configuration=Release /p:Platform=x64 /v:minimal
if ($LASTEXITCODE -ne 0) {
    throw "MSBuild failed with exit code $LASTEXITCODE"
}

$dll = Join-Path $repoRoot 'src\ThreeDAnalyzer.OcctWrapper\x64\Release\ThreeDAnalyzer.OcctWrapper.dll'
if (Test-Path $dll) {
    Write-Host "OK: $dll"
} else {
    Write-Warning "Build reported success but DLL not at expected Release path. Check x64\Debug or bin\ subfolders."
}
