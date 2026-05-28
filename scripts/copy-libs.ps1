$root = Split-Path $PSScriptRoot -Parent
$dest = "$root/src/ThreeDAnalyzer.Web/wwwroot/lib"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item "$root/node_modules/occt-import-js/dist/occt-import-js.js" $dest -Force
Copy-Item "$root/node_modules/occt-import-js/dist/occt-import-js.wasm" $dest -Force
Copy-Item "$root/node_modules/three/build/three.module.min.js" $dest -Force
Write-Host "Libraries copied successfully to wwwroot/lib"
