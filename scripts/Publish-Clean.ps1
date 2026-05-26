#Requires -Version 5.1
<#
.SYNOPSIS
  Clean publish of ThreeDAnalyzer.Web into an empty output folder (Release, win-x64).

.DESCRIPTION
  1. Deletes the output folder if it exists
  2. Builds the OCCT C++/CLI wrapper (unless -SkipOcct)
  3. dotnet publish
  4. Copies wrapper + OCCT native DLLs into the publish folder

.PARAMETER OutputDirectory
  Target folder. Parent directories are created; existing content is removed first.

.PARAMETER SelfContained
  Include the .NET runtime in the output (recommended for IIS / hosts without .NET 10).

.PARAMETER SkipOcct
  Publish UI-only build (-p:UseOcct=false), skip wrapper build and OCCT DLL copy.

.EXAMPLE
  .\scripts\Publish-Clean.ps1

.EXAMPLE
  .\scripts\Publish-Clean.ps1 -OutputDirectory "D:\deploy\part-rfq-pro" -SelfContained
#>
param(
    [string] $OutputDirectory = 'C:\Users\Public\Documents\part-rfq-pro\publish_clean',

    [switch] $SelfContained,

    [switch] $SkipOcct
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$webCsproj = Join-Path $repoRoot 'src\ThreeDAnalyzer.Web\ThreeDAnalyzer.Web.csproj'
$wrapperDir = Join-Path $repoRoot 'src\ThreeDAnalyzer.OcctWrapper\x64\Release'

if (-not (Test-Path $webCsproj)) {
    throw "Missing project: $webCsproj"
}

$out = [System.IO.Path]::GetFullPath($OutputDirectory)
Write-Host "=== Clean publish ===" -ForegroundColor Cyan
Write-Host "Output: $out"

if (Test-Path $out) {
    Write-Host "Removing existing folder..." -ForegroundColor Yellow
    Remove-Item -LiteralPath $out -Recurse -Force
}

$publishArgs = @(
    'publish', $webCsproj,
    '-c', 'Release',
    '-o', $out,
    '--runtime', 'win-x64',
    '/p:AppendRuntimeIdentifierToOutputPath=false',
    '/p:UseAppHost=false'
)

if ($SelfContained) {
    $publishArgs += '--self-contained', 'true'
}
else {
    $publishArgs += '--self-contained', 'false'
}

if ($SkipOcct) {
    $publishArgs += '/p:UseOcct=false'
}
elseif (-not (Test-Path (Join-Path $wrapperDir 'ThreeDAnalyzer.OcctWrapper.dll'))) {
    Write-Host "Building OCCT wrapper..." -ForegroundColor Cyan
    & (Join-Path $repoRoot 'scripts\Build-OcctWrapper.ps1')
}

Write-Host "Publishing web app..." -ForegroundColor Cyan
& dotnet @publishArgs
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed with exit code $LASTEXITCODE" }

if (-not $SkipOcct) {
    Write-Host "Copying OCCT wrapper + runtime DLLs..." -ForegroundColor Cyan
    Copy-Item (Join-Path $wrapperDir '*.dll') $out -Force -ErrorAction Stop
    & (Join-Path $repoRoot 'scripts\Copy-OcctRuntime.ps1') -Configuration Release -OutputDirectory $out
}

Write-Host "Done: $out" -ForegroundColor Green
Write-Host "Run locally (framework-dependent): dotnet $out\ThreeDAnalyzer.Web.dll"
if ($SelfContained) {
    Write-Host "Run locally (self-contained): $out\ThreeDAnalyzer.Web.exe"
}
