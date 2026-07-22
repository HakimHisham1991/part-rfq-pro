$root = Split-Path $PSScriptRoot -Parent
$dest = "$root/src/ThreeDAnalyzer.Web/wwwroot/lib"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item "$root/node_modules/occt-import-js/dist/occt-import-js.js" $dest -Force
Copy-Item "$root/node_modules/occt-import-js/dist/occt-import-js.wasm" $dest -Force
Copy-Item "$root/node_modules/three/build/three.module.min.js" $dest -Force

# quickhull3d is pre-bundled for the browser worker (see: npx esbuild …)
$qhSrc = "$root/src/ThreeDAnalyzer.Web/wwwroot/lib/quickhull3d.bundle.js"
if (-not (Test-Path $qhSrc)) {
  Write-Host "WARN: quickhull3d.bundle.js missing — run: npx esbuild node_modules/quickhull3d/dist/index.js --bundle --format=esm --outfile=src/ThreeDAnalyzer.Web/wwwroot/lib/quickhull3d.bundle.js"
}

$occtWasmDest = "$dest/occt-wasm"
New-Item -ItemType Directory -Force -Path $occtWasmDest | Out-Null
Copy-Item "$root/node_modules/occt-wasm/dist/*" $occtWasmDest -Force

Write-Host "Libraries copied successfully to wwwroot/lib (including occt-wasm)"
