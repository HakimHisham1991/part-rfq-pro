# Bundled OCCT runtime (standalone)

The app reads OCCT from **`runtime/occt`** in this repo first. You do **not** need `C:\OCCT` on the machine after import.

## One-time setup

From repo root, copy your existing OCCT 8.0 Windows kit (LGPL) into the repo:

```powershell
.\scripts\Import-OcctKit.ps1 -SourcePath "C:\OCCT\opencascade-8.0.0-vc14-64"
```

Required layout after import:

```
runtime/occt/
  inc/
  win64/vc14/lib/
  win64/vc14/bin/    ← runtime DLLs copied next to the app on build/publish
```

Optional (only if STEP load fails without them):

```
runtime/thirdparty/   ← copied automatically when sibling 3rdparty-vc14-64 exists during Import-OcctKit
```

## Git

Native binaries are **not** committed (see root `.gitignore`). Each machine runs `Import-OcctKit.ps1` once, or copies the same `runtime/occt` folder from a build share.

## Build

```bat
run.bat
```

Scripts resolve `runtime\occt` automatically for wrapper build and `Copy-OcctRuntime.ps1`.
