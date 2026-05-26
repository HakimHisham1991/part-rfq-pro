#Requires -Version 5.1
<#
.SYNOPSIS
  Resolves OCCT kit root: repo runtime/occt first, then OCCT_ROOT env var.
.OUTPUTS
  Full path to folder containing inc\ and win64\vc14\
#>
param(
    [switch] $ThrowIfMissing
)

$repoRoot = Split-Path $PSScriptRoot -Parent
$candidates = @(
    (Join-Path $repoRoot 'runtime\occt'),
    $env:OCCT_ROOT
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

function Test-OcctKitRoot([string] $root) {
    if (-not (Test-Path (Join-Path $root 'inc'))) { return $false }
    foreach ($toolset in @('vc14', 'vc143')) {
        $lib = Join-Path $root "win64\$toolset\lib"
        $bin = Join-Path $root "win64\$toolset\bin"
        if ((Test-Path $lib) -and (Test-Path $bin)) { return $true }
    }
    return $false
}

foreach ($root in $candidates) {
    $root = $root.Trim().TrimEnd('\')
    if (Test-OcctKitRoot $root) {
        return $root
    }
}

if ($ThrowIfMissing) {
    throw @"
OCCT kit not found. Use one of:
  1. Copy your OCCT 8.0 kit into: $repoRoot\runtime\occt
     (must contain inc\ and win64\vc14\)
  2. Or run: .\scripts\Import-OcctKit.ps1 -SourcePath "C:\path\to\opencascade-8.0.0-vc14-64"
  3. Or set user env OCCT_ROOT to an existing kit root.
"@
}

return $null
