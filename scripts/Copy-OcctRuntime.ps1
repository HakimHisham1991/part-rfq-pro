#Requires -Version 5.1
<#
.SYNOPSIS
  Copies OCCT and (optional) 3rd-party native DLLs into the Blazor app's output folder
  so ThreeDAnalyzer.OcctWrapper.dll can load at runtime ("specified module could not be found").
.EXAMPLE
  [Environment]::SetEnvironmentVariable('OCCT_ROOT', 'C:\OCCT\opencascade-8.0.0-vc14-64','User')
  .\scripts\Copy-OcctRuntime.ps1 -Configuration Debug
#>
param(
    [ValidateSet('Debug', 'Release')]
    [string] $Configuration = 'Debug',

    # Optional override; defaults to env THIRDPARTY_ROOT, else sibling folder .\3rdparty-vc14-64 under OCCT_ROOT's parent.
    [string] $ThirdPartyRoot = '',

    # When set (e.g. CI publish folder), OCCT runtime DLLs are copied here instead of the local bin path.
    [string] $OutputDirectory = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
if ($OutputDirectory) {
    $out = $OutputDirectory
}
else {
    $base = Join-Path $repoRoot "src\ThreeDAnalyzer.Web\bin\$Configuration\net10.0"
    $ridOut = Join-Path $base "win-x64"
    if (Test-Path $ridOut) { $out = $ridOut }
    else { $out = $base }
}

if (-not $env:OCCT_ROOT -or -not (Test-Path $env:OCCT_ROOT)) {
    throw "Set OCCT_ROOT to your OCCT kit root (folder that contains win64\vc14\bin), then re-run."
}

$ocBin = Join-Path $env:OCCT_ROOT 'win64\vc14\bin'
if (-not (Test-Path $ocBin)) {
    throw "Missing OCCT bin folder: $ocBin - check OCCT_ROOT."
}

New-Item -ItemType Directory -Force -Path $out | Out-Null
Copy-Item (Join-Path $ocBin '*.dll') $out -Force
Write-Host "Copied OCCT dlls -> $out"

# C++/CLI netcore (OcctWrapper.dll) statically depends on ijwhost.dll beside it (IJW mixed assembly).
$dotnetRoot = if ($env:DOTNET_ROOT) { $env:DOTNET_ROOT.TrimEnd('\').TrimEnd('/') } else { Join-Path ${env:ProgramFiles} 'dotnet' }
$hostPackRoot = Join-Path $dotnetRoot 'packs\Microsoft.NETCore.App.Host.win-x64'
if (Test-Path $hostPackRoot) {
    $versionDirs = @(Get-ChildItem $hostPackRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like '10.*' })
    if ($versionDirs.Count -eq 0) {
        $versionDirs = @(Get-ChildItem $hostPackRoot -Directory -ErrorAction SilentlyContinue)
    }
    $packDir = $versionDirs |
        Sort-Object { try { [Version]$_.Name } catch { [Version]'0.0.0' } } |
        Select-Object -Last 1
    $ijPath = if ($packDir) { Join-Path $packDir.FullName 'runtimes\win-x64\native\ijwhost.dll' } else { $null }
    if ($ijPath -and (Test-Path $ijPath)) {
        Copy-Item $ijPath $out -Force
        Write-Host "Copied ijwhost.dll -> $out ($ijPath)"
    }
    else {
        Write-Warning "ijwhost.dll not found under $hostPackRoot. Rebuild ThreeDAnalyzer.Web (UseIJWHost) or install .NET 10 SDK packs."
    }
}
else {
    Write-Warning "App Host packs not found at $hostPackRoot - reinstall .NET SDK or set DOTNET_ROOT."
}

# Resolve optional third-party root: -ThirdPartyRoot, or env THIRDPARTY_ROOT, or sibling .\3rdparty-vc14-64
$tproot = $ThirdPartyRoot
if ([string]::IsNullOrWhiteSpace($tproot) -and $env:THIRDPARTY_ROOT) {
    $tproot = $env:THIRDPARTY_ROOT.Trim()
}

if (-not [string]::IsNullOrWhiteSpace($tproot)) {
    if (-not (Test-Path $tproot)) {
        Write-Warning "Third-party root not found: $tproot"
    }
    else {
        Get-ChildItem $tproot -Recurse -Filter '*.dll' -ErrorAction SilentlyContinue |
            Copy-Item -Destination $out -Force
        Write-Host "Copied 3rd-party dlls -> $out from $tproot"
    }
}
else {
    $parent = Split-Path $env:OCCT_ROOT -Parent
    $guess = Join-Path $parent '3rdparty-vc14-64'
    if (Test-Path $guess) {
        Get-ChildItem $guess -Recurse -Filter '*.dll' -ErrorAction SilentlyContinue |
            Copy-Item -Destination $out -Force
        Write-Host "Copied 3rd-party dlls -> $out from $guess"
    }
    else {
        Write-Warning "No 3rd-party folder at $guess - if load still fails, copy its bin DLLs manually."
    }
}

Write-Host "Done."
