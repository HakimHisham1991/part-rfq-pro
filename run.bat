@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ---------------------------------------------------------------------------
REM  3D Part Analyzer — build and run (Blazor Server)
REM  Double-click or:  run.bat
REM  OCCT kit: runtime\occt  (.\scripts\Import-OcctKit.ps1 once)
REM  UI only (no OCCT):  set SKIP_OCCT=1 && run.bat
REM ---------------------------------------------------------------------------

cd /d "%~dp0"
set "REPO_ROOT=%CD%"
set "WEB_PROJ=%REPO_ROOT%\src\ThreeDAnalyzer.Web\ThreeDAnalyzer.Web.csproj"
set "CONFIG=Debug"
set "WRAPPER_DLL=%REPO_ROOT%\src\ThreeDAnalyzer.OcctWrapper\x64\Release\ThreeDAnalyzer.OcctWrapper.dll"
set "EXIT_CODE=0"

echo.
echo === 3D Part Analyzer ===
echo Repo: %REPO_ROOT%
echo.

where dotnet >nul 2>&1
if errorlevel 1 (
    echo ERROR: .NET SDK not found on PATH.
    echo Install .NET 10 SDK: https://dotnet.microsoft.com/download
    set "EXIT_CODE=1"
    goto :done
)

for /f "delims=" %%V in ('dotnet --version 2^>nul') do set "DOTNET_VER=%%V"
echo .NET SDK: !DOTNET_VER!
echo.

set "OCCT_ENABLED=0"
set "USE_OCCT_PROP=-p:UseOcct=false"

if /i "%SKIP_OCCT%"=="1" (
    echo SKIP_OCCT=1 — building web app without OCCT wrapper.
    goto :build_web
)

if exist "%WRAPPER_DLL%" (
    echo [OK] OCCT wrapper already built:
    echo      %WRAPPER_DLL%
    set "OCCT_ENABLED=1"
    set "USE_OCCT_PROP="
    goto :build_web
)

echo [1/4] Building OCCT C++/CLI wrapper ^(VS Build Tools + runtime\occt or OCCT_ROOT^)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%REPO_ROOT%\scripts\Build-OcctWrapper.ps1"
if errorlevel 1 (
    echo.
    echo WARNING: OCCT wrapper build failed or was skipped.
    echo   - Run: .\scripts\Import-OcctKit.ps1 -SourcePath "path\to\opencascade-8.0.0-vc14-64"
    echo   - Install VS 2022 or Build Tools with "Desktop development with C++".
    echo   - Or run UI-only:  set SKIP_OCCT=1 ^&^& run.bat
    echo.
    if exist "%WRAPPER_DLL%" (
        echo Found existing wrapper DLL; continuing with OCCT enabled.
        set "OCCT_ENABLED=1"
        set "USE_OCCT_PROP="
    ) else (
        echo No wrapper DLL found; continuing with UI-only build.
    )
) else (
    set "OCCT_ENABLED=1"
    set "USE_OCCT_PROP="
)

:build_web
echo.
echo [2/4] Building Blazor web app ^(%CONFIG%^)...
dotnet build "%WEB_PROJ%" -c %CONFIG% --verbosity minimal !USE_OCCT_PROP!
if errorlevel 1 (
    echo ERROR: dotnet build failed.
    set "EXIT_CODE=1"
    goto :done
)

if "!OCCT_ENABLED!"=="0" goto :run_app

:copy_occt
echo.
echo [3/4] Copying OCCT runtime DLLs ^(runtime\occt or OCCT_ROOT^)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%REPO_ROOT%\scripts\Copy-OcctRuntime.ps1" -Configuration %CONFIG%
if errorlevel 1 (
    echo WARNING: Copy-OcctRuntime failed.
    echo   Run once: .\scripts\Import-OcctKit.ps1 -SourcePath "path\to\opencascade-8.0.0-vc14-64"
    echo   See runtime\README.md
)

:run_app
echo.
echo [4/4] Starting web app...
echo       http://localhost:5118
echo       Press Ctrl+C to stop.
echo.

dotnet run --project "%WEB_PROJ%" -c %CONFIG% --no-build --launch-profile http
set "EXIT_CODE=!ERRORLEVEL!"

:done
echo.
if not "%EXIT_CODE%"=="0" (
    echo Finished with errors ^(exit %EXIT_CODE%^).
    echo.
    pause
) else (
    echo Stopped.
    echo.
    pause
)
endlocal & exit /b %EXIT_CODE%
