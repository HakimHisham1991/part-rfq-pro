#Requires -Version 5.1
<#
.SYNOPSIS
  Finds OCCT 8.0 kit root under a folder (CI occt-kit extract or local tree).
.OUTPUTS
  Full path written to stdout; sets OCCT_ROOT when -SetEnv is used.
#>
param(
    [Parameter(Mandatory = $true)]
    [string] $ParentPath,

    [switch] $SetEnv
)

$ErrorActionPreference = 'Stop'
$parent = [System.IO.Path]::GetFullPath($ParentPath)

function Test-OcctKitRoot([string] $root) {
    if (-not (Test-Path (Join-Path $root 'inc'))) { return $false }
    foreach ($toolset in @('vc14', 'vc143')) {
        $lib = Join-Path $root "win64\$toolset\lib"
        $bin = Join-Path $root "win64\$toolset\bin"
        if ((Test-Path $lib) -and (Test-Path $bin)) { return $true }
    }
    return $false
}

$candidates = New-Object System.Collections.Generic.List[string]
if (Test-OcctKitRoot $parent) { $candidates.Add($parent) }

$queue = [System.Collections.Queue]::new()
$queue.Enqueue($parent)
$depth = 0
$maxDepth = 6

while ($queue.Count -gt 0 -and $depth -le $maxDepth) {
    $levelCount = $queue.Count
    for ($i = 0; $i -lt $levelCount; $i++) {
        $dir = [string]$queue.Dequeue()
        foreach ($child in @(Get-ChildItem -LiteralPath $dir -Directory -ErrorAction SilentlyContinue)) {
            if (Test-OcctKitRoot $child.FullName) {
                if (-not $candidates.Contains($child.FullName)) {
                    $candidates.Add($child.FullName)
                }
            }
            $queue.Enqueue($child.FullName)
        }
    }
    $depth++
}

if ($candidates.Count -eq 0) {
    Write-Host "Searched under: $parent" -ForegroundColor Yellow
    if (Test-Path $parent) {
        Get-ChildItem -LiteralPath $parent -Recurse -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -eq 'inc' -or $_.Name -eq 'win64' } |
            Select-Object -First 20 FullName |
            ForEach-Object { Write-Host "  $($_.FullName)" }
    }
    throw "Could not resolve OCCT 8.0 kit under '$parent' (expected inc\ and win64\vc14 or win64\vc143 with lib + bin)."
}

$root = $candidates[0]
Write-Host "OCCT kit root: $root" -ForegroundColor Green
if ($SetEnv) {
    "OCCT_ROOT=$root" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
}
return $root
