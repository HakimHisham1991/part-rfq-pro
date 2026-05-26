#Requires -Version 5.1
<#
.SYNOPSIS
  Copies OCCT native DLLs from runtime/occt (or OCCT_ROOT) into the app output folder.
.EXAMPLE
  .\scripts\Copy-OcctRuntime.ps1 -Configuration Debug
#>
param(
    [ValidateSet('Debug', 'Release')]
    [string] $Configuration = 'Debug',

    [string] $ThirdPartyRoot = '',

    [string] $OutputDirectory = '',

    # When set, also copies all DLLs under runtime/thirdparty (large Qt/VTK tree).
    [switch] $IncludeThirdParty
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$resolveScript = Join-Path $PSScriptRoot 'Resolve-OcctRoot.ps1'

$occtRoot = & $resolveScript -ThrowIfMissing

if ($OutputDirectory) {
    $out = $OutputDirectory
}
else {
    $base = Join-Path $repoRoot "src\ThreeDAnalyzer.Web\bin\$Configuration\net10.0"
    $ridOut = Join-Path $base 'win-x64'
    if (Test-Path $ridOut) { $out = $ridOut }
    else { $out = $base }
}

$ocBin = $null
foreach ($toolset in @('vc14', 'vc143')) {
    $try = Join-Path $occtRoot "win64\$toolset\bin"
    if (Test-Path $try) {
        $ocBin = $try
        break
    }
}
if (-not $ocBin) {
    throw "Missing OCCT bin folder under $occtRoot\win64\vc14\bin or win64\vc143\bin"
}

Write-Host "OCCT kit: $occtRoot"
New-Item -ItemType Directory -Force -Path $out | Out-Null
Copy-Item (Join-Path $ocBin '*.dll') $out -Force
Write-Host "Copied OCCT dlls -> $out"

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
        Write-Host "Copied ijwhost.dll -> $out"
    }
    else {
        Write-Warning "ijwhost.dll not found under $hostPackRoot"
    }
}

$tproot = $ThirdPartyRoot
if ([string]::IsNullOrWhiteSpace($tproot) -and $env:THIRDPARTY_ROOT) {
    $tproot = $env:THIRDPARTY_ROOT.Trim()
}
if ([string]::IsNullOrWhiteSpace($tproot)) {
    $bundled = Join-Path $repoRoot 'runtime\thirdparty'
    if (Test-Path $bundled) { $tproot = $bundled }
}

if ($IncludeThirdParty -and -not [string]::IsNullOrWhiteSpace($tproot) -and (Test-Path $tproot)) {
    Get-ChildItem $tproot -Recurse -Filter '*.dll' -ErrorAction SilentlyContinue |
        Copy-Item -Destination $out -Force
    Write-Host "Copied 3rd-party dlls -> $out from $tproot"
}
elseif (-not [string]::IsNullOrWhiteSpace($tproot) -and (Test-Path $tproot)) {
    Write-Host "Skipping 3rd-party copy (use -IncludeThirdParty if STEP load fails). Kit at: $tproot"
}

Write-Host 'Done.'
