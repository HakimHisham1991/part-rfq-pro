#Requires -Version 5.1
<#
.SYNOPSIS
  Downloads and extracts OCCT 8.0 Windows kits for GitHub Actions (opencascade + 3rdparty zips).
.DESCRIPTION
  The single "combined" zip layout varies; MonsterASP/CI uses the official pair:
    opencascade-release-no-pch.zip + 3rdparty-vc14-64.zip
  Sibling layout matches dev.opencascade.org and Import-OcctKit.ps1.
#>
param(
    [string] $KitParent = (Join-Path (Split-Path $PSScriptRoot -Parent) 'occt-kit'),

    [switch] $SetEnv
)

$ErrorActionPreference = 'Stop'
$kitParent = [System.IO.Path]::GetFullPath($KitParent)
$staging = Join-Path $kitParent 'staging'
$resolveScript = Join-Path $PSScriptRoot 'Resolve-OcctKitUnder.ps1'

function Test-ZipFile([string] $path, [long] $minBytes) {
    if (-not (Test-Path $path)) { return $false }
    $len = (Get-Item -LiteralPath $path).Length
    if ($len -lt $minBytes) { return $false }
    $fs = [System.IO.File]::OpenRead($path)
    try {
        $b0 = $fs.ReadByte()
        $b1 = $fs.ReadByte()
        return ($b0 -eq 0x50 -and $b1 -eq 0x4B)
    }
    finally { $fs.Dispose() }
}

function Expand-NestedZipsIn([string] $dir, [int] $maxPasses = 6) {
    for ($pass = 1; $pass -le $maxPasses; $pass++) {
        $inner = @(Get-ChildItem -LiteralPath $dir -Filter '*.zip' -File -Recurse -ErrorAction SilentlyContinue)
        if ($inner.Count -eq 0) { return }
        Write-Host "Extracting $($inner.Count) nested zip(s) (pass $pass) ..."
        foreach ($z in $inner) {
            $dest = $z.DirectoryName
            if (-not $dest) { continue }
            Expand-Archive -LiteralPath $z.FullName -DestinationPath $dest -Force
            Remove-Item -LiteralPath $z.FullName -Force
        }
    }
    $left = @(Get-ChildItem -LiteralPath $dir -Filter '*.zip' -File -Recurse -ErrorAction SilentlyContinue)
    if ($left.Count -gt 0) {
        throw "Nested zip(s) remain after extraction: $($left[0].FullName)"
    }
}

function Get-Zip([string] $url, [string] $outPath, [long] $minBytes) {
    if (Test-ZipFile $outPath $minBytes) {
        Write-Host "Using cached zip: $outPath ($((Get-Item $outPath).Length) bytes)"
        return
    }
    Write-Host "Downloading $url ..."
    Invoke-WebRequest -Uri $url -OutFile $outPath -UseBasicParsing
    if (-not (Test-ZipFile $outPath $minBytes)) {
        throw "Download failed or not a zip (expected >= $minBytes bytes, PK header). Path: $outPath"
    }
}

# Reuse valid staging tree when present (e.g. Actions cache restored occt-kit/staging).
try {
    $existing = & $resolveScript -ParentPath $staging
    Write-Host "OCCT kit already present: $existing"
    if ($SetEnv -and $env:GITHUB_ENV) {
        "OCCT_ROOT=$existing" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
        $tp = Join-Path $staging '3rdparty-vc14-64'
        if (Test-Path $tp) {
            "THIRDPARTY_ROOT=$tp" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
        }
    }
    return $existing
}
catch {
    Write-Host "No valid kit under $staging — downloading ..."
}

if (Test-Path $kitParent) {
    Remove-Item -LiteralPath $kitParent -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $staging | Out-Null

$base = 'https://github.com/Open-Cascade-SAS/OCCT/releases/download/V8_0_0'
$zipDir = Join-Path $kitParent '_zips'
New-Item -ItemType Directory -Force -Path $zipDir | Out-Null

$occtZip = Join-Path $zipDir 'opencascade-release-no-pch.zip'
$tpZip = Join-Path $zipDir '3rdparty-vc14-64.zip'
Get-Zip "$base/opencascade-release-no-pch.zip" $occtZip 40MB
Get-Zip "$base/3rdparty-vc14-64.zip" $tpZip 120MB

Write-Host "Extracting OCCT ..."
Expand-Archive -LiteralPath $occtZip -DestinationPath $staging -Force
Write-Host "Extracting 3rd-party ..."
Expand-Archive -LiteralPath $tpZip -DestinationPath $staging -Force

# GitHub release zips often wrap the real kit (e.g. opencascade-8.0.0-vc14-64.zip inside the outer zip).
Expand-NestedZipsIn -dir $staging

Write-Host "Staging contents:"
Get-ChildItem -LiteralPath $staging | ForEach-Object { Write-Host "  $($_.Name)" }

$root = & $resolveScript -ParentPath $staging
$tpRoot = Join-Path $staging '3rdparty-vc14-64'
if (-not (Test-Path $tpRoot)) {
    Write-Warning "3rdparty-vc14-64 folder not found beside OCCT root; STEP may need -IncludeThirdParty from another path."
}

Write-Host "OCCT_ROOT=$root"
if (Test-Path $tpRoot) { Write-Host "THIRDPARTY_ROOT=$tpRoot" }

if ($SetEnv -and $env:GITHUB_ENV) {
    "OCCT_ROOT=$root" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
    if (Test-Path $tpRoot) {
        "THIRDPARTY_ROOT=$tpRoot" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
    }
}

return $root
