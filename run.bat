@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ---------------------------------------------------------------------------
REM  3D Part Analyzer — build and run (Razor Pages + browser WASM)
REM  Double-click or:  run.bat
REM  Opens http://localhost:5118 — STEP parsing runs entirely in the browser.
REM ---------------------------------------------------------------------------

cd /d "%~dp0"
set "REPO_ROOT=%CD%"
set "WEB_PROJ=%REPO_ROOT%\src\ThreeDAnalyzer.Web\ThreeDAnalyzer.Web.csproj"
set "CONFIG=Debug"
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

echo [1/2] Building web app ^(%CONFIG%^)...
dotnet build "%WEB_PROJ%" -c %CONFIG% --verbosity minimal
if errorlevel 1 (
    echo ERROR: dotnet build failed.
    set "EXIT_CODE=1"
    goto :done
)

echo.
echo [2/2] Starting web app...
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
