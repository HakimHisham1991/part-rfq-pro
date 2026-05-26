#Requires -Version 5.1
<#
.SYNOPSIS
  One-time import of an OCCT 8.0 Windows kit into runtime\occt (standalone repo layout).
.EXAMPLE
  .\scripts\Import-OcctKit.ps1 -SourcePath "C:\OCCT\opencascade-8.0.0-vc14-64"
#>
param(
    [Parameter(Mandatory = $true)]
    [string] $SourcePath
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$dest = Join-Path $repoRoot 'runtime\occt'
$src = $SourcePath.Trim().TrimEnd('\')

$inc = Join-Path $src 'inc'
$lib = Join-Path $src 'win64\vc14\lib'
$bin = Join-Path $src 'win64\vc14\bin'
if (-not ((Test-Path $inc) -and (Test-Path $lib) -and (Test-Path $bin))) {
    throw "SourcePath must be an OCCT kit root with inc\ and win64\vc14\ (lib + bin). Got: $src"
}

if (Test-Path $dest) {
    Write-Host "Removing existing $dest ..."
    Remove-Item -LiteralPath $dest -Recurse -Force
}

Write-Host "Copying OCCT kit (this may take a few minutes) ..."
Write-Host "  From: $src"
Write-Host "  To:   $dest"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Path (Join-Path $src '*') -Destination $dest -Recurse -Force

# Optional third-party bundle beside the kit (Qt/VTK) — only if present
$parent = Split-Path $src -Parent
$tpSrc = Join-Path $parent '3rdparty-vc14-64'
$tpDest = Join-Path $repoRoot 'runtime\thirdparty'
if (Test-Path $tpSrc) {
    if (Test-Path $tpDest) { Remove-Item -LiteralPath $tpDest -Recurse -Force }
    Write-Host "Copying optional 3rd-party DLL tree ..."
    Copy-Item -Path $tpSrc -Destination $tpDest -Recurse -Force
}

Write-Host "Done. Rebuild wrapper and web app from repo root (run.bat or publish-clean.bat)." -ForegroundColor Green
