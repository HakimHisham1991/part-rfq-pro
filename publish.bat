@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ---------------------------------------------------------------------------
REM  Part RFQ Pro — clean Release publish for MonsterASP manual FTP upload
REM  Double-click or:  publish.bat
REM  Output: C:\Users\Public\Documents\part-rfq-pro\publish_clean
REM  Paths are absolute — safe to run this .bat from any location.
REM ---------------------------------------------------------------------------

set "REPO_ROOT=C:\Users\Public\Documents\part-rfq-pro\part-rfq-pro"
set "WEB_PROJ=%REPO_ROOT%\src\ThreeDAnalyzer.Web\ThreeDAnalyzer.Web.csproj"
set "PUBLISH_DIR=C:\Users\Public\Documents\part-rfq-pro\publish_clean"
set "EXIT_CODE=0"

echo.
echo === Part RFQ Pro — Publish ===
echo Repo:   %REPO_ROOT%
echo Output: %PUBLISH_DIR%
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

echo [1/4] Cleaning publish folder...
if exist "%PUBLISH_DIR%" (
    rmdir /s /q "%PUBLISH_DIR%"
    if errorlevel 1 (
        echo ERROR: Could not remove "%PUBLISH_DIR%"
        set "EXIT_CODE=1"
        goto :done
    )
)
echo       Removed old output ^(if any^).

echo.
echo [2/4] Publishing Release ^(portable, DLL-only, no .exe^)...
dotnet publish "%WEB_PROJ%" -c Release -o "%PUBLISH_DIR%" --self-contained false /p:UseAppHost=false
if errorlevel 1 (
    echo ERROR: dotnet publish failed.
    set "EXIT_CODE=1"
    goto :done
)

echo.
echo [3/4] Configuring web.config for MonsterASP OutOfProcess...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$pub = '%PUBLISH_DIR%';" ^
  "New-Item -ItemType Directory -Force -Path (Join-Path $pub 'logs') | Out-Null;" ^
  "$wc = Join-Path $pub 'web.config';" ^
  "[xml]$doc = Get-Content -LiteralPath $wc -Raw;" ^
  "$asp = $doc.SelectSingleNode('//*[local-name()=''aspNetCore'']');" ^
  "if (-not $asp) { throw 'aspNetCore element not found in web.config' };" ^
  "$asp.SetAttribute('processPath','dotnet');" ^
  "$asp.SetAttribute('arguments','.\ThreeDAnalyzer.Web.dll');" ^
  "$asp.SetAttribute('hostingModel','OutOfProcess');" ^
  "$asp.SetAttribute('stdoutLogEnabled','true');" ^
  "$asp.SetAttribute('stdoutLogFile','.\logs\stdout');" ^
  "$doc.Save($wc);"
if errorlevel 1 (
    echo ERROR: web.config configuration failed.
    set "EXIT_CODE=1"
    goto :done
)

echo.
echo [4/4] Verifying publish output...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$pub = '%PUBLISH_DIR%';" ^
  "$required = @('web.config','ThreeDAnalyzer.Web.dll','ThreeDAnalyzer.Web.deps.json','ThreeDAnalyzer.Web.runtimeconfig.json','Data\material-specs-master.json','wwwroot\lib\occt-import-js.wasm','wwwroot\js\viewer.js');" ^
  "foreach ($f in $required) { if (-not (Test-Path (Join-Path $pub $f))) { throw \"Missing: $f\" } };" ^
  "if (Test-Path (Join-Path $pub 'ThreeDAnalyzer.Web.exe')) { throw 'ThreeDAnalyzer.Web.exe must not be present' };" ^
  "Write-Host '       All required files present. No .exe — OK for MonsterASP.'"
if errorlevel 1 (
    echo ERROR: Publish verification failed.
    set "EXIT_CODE=1"
    goto :done
)

echo.
echo Publish complete.
echo Upload everything inside:
echo   %PUBLISH_DIR%
echo to MonsterASP wwwroot via FTP ^(merge/replace files^).
echo.

:done
if not "%EXIT_CODE%"=="0" (
    echo Finished with errors ^(exit %EXIT_CODE%^).
) else (
    echo Ready for manual FTP upload.
)
echo.
pause
endlocal & exit /b %EXIT_CODE%
