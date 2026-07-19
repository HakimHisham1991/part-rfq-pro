@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ---------------------------------------------------------------------------
REM  Part RFQ Pro — clean Release publish for MonsterASP manual FTP upload
REM  Double-click or:  publish.bat
REM  Output folder: C:\Users\Public\Documents\part-rfq-pro\publish_clean
REM  Output zip:    C:\Users\Public\Documents\part-rfq-pro\publish_clean.zip
REM ---------------------------------------------------------------------------

set "REPO_ROOT=C:\Users\Public\Documents\part-rfq-pro\part-rfq-pro"
set "WEB_PROJ=%REPO_ROOT%\src\ThreeDAnalyzer.Web\ThreeDAnalyzer.Web.csproj"
set "PUBLISH_DIR=C:\Users\Public\Documents\part-rfq-pro\publish_clean"
set "PUBLISH_ZIP=C:\Users\Public\Documents\part-rfq-pro\publish_clean.zip"
set "EXIT_CODE=0"

echo.
echo === Part RFQ Pro — Publish ===
echo Repo:   %REPO_ROOT%
echo Output: %PUBLISH_DIR%
echo Zip:    %PUBLISH_ZIP%
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

echo [1/5] Cleaning publish folder and old zip...
if exist "%PUBLISH_DIR%" (
    rmdir /s /q "%PUBLISH_DIR%"
    if errorlevel 1 (
        echo ERROR: Could not remove "%PUBLISH_DIR%"
        echo        Close any Explorer windows / apps using that folder, then retry.
        set "EXIT_CODE=1"
        goto :done
    )
)
if exist "%PUBLISH_ZIP%" del /f /q "%PUBLISH_ZIP%"
echo       Cleaned.

echo.
echo [2/5] Publishing Release ^(portable, DLL-only, no .exe^)...
dotnet publish "%WEB_PROJ%" -c Release -o "%PUBLISH_DIR%" --self-contained false /p:UseAppHost=false
if errorlevel 1 (
    echo ERROR: dotnet publish failed.
    set "EXIT_CODE=1"
    goto :done
)

echo.
echo [3/5] Configuring web.config for MonsterASP OutOfProcess...
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
echo [4/5] Verifying publish output...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$pub = '%PUBLISH_DIR%';" ^
  "$required = @('web.config','ThreeDAnalyzer.Web.dll','ThreeDAnalyzer.Web.deps.json','ThreeDAnalyzer.Web.runtimeconfig.json','Data\material-specs-master.json','wwwroot\lib\occt-import-js.wasm','wwwroot\lib\three.module.min.js','wwwroot\js\viewer.js');" ^
  "foreach ($f in $required) { if (-not (Test-Path (Join-Path $pub $f))) { throw \"Missing: $f\" } };" ^
  "if (Test-Path (Join-Path $pub 'ThreeDAnalyzer.Web.exe')) { throw 'ThreeDAnalyzer.Web.exe must not be present' };" ^
  "$viewer = Get-Item (Join-Path $pub 'wwwroot\js\viewer.js');" ^
  "$three = Get-Item (Join-Path $pub 'wwwroot\lib\three.module.min.js');" ^
  "if ($viewer.Length -lt 10000) { throw 'viewer.js looks truncated' };" ^
  "if ($three.Length -lt 100000) { throw 'three.module.min.js looks truncated' };" ^
  "Write-Host '       All required files present (viewer + three.js OK).'"
if errorlevel 1 (
    echo ERROR: Publish verification failed.
    set "EXIT_CODE=1"
    goto :done
)

echo.
echo [5/5] Creating zip of publish CONTENTS ^(not a nested folder^)...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Add-Type -AssemblyName System.IO.Compression.FileSystem;" ^
  "$pub = '%PUBLISH_DIR%'; $zip = '%PUBLISH_ZIP%';" ^
  "if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force };" ^
  "Compress-Archive -Path (Join-Path $pub '*') -DestinationPath $zip -CompressionLevel Optimal;" ^
  "$z = [System.IO.Compression.ZipFile]::OpenRead($zip);" ^
  "try {" ^
  "  $names = $z.Entries | ForEach-Object { $_.FullName.Replace('\','/') };" ^
  "  if ($names -notcontains 'web.config') { throw 'Zip missing web.config at ROOT — wrong nesting' };" ^
  "  if (-not ($names | Where-Object { $_ -eq 'wwwroot/js/viewer.js' })) { throw 'Zip missing wwwroot/js/viewer.js' };" ^
  "  if ($names | Where-Object { $_ -like 'publish_clean/*' }) { throw 'Zip incorrectly nests publish_clean/ folder' };" ^
  "  Write-Host ('       Zip OK: ' + [math]::Round((Get-Item $zip).Length/1MB,1) + ' MB, ' + $z.Entries.Count + ' entries');" ^
  "} finally { $z.Dispose() }"
if errorlevel 1 (
    echo ERROR: Zip creation / verification failed.
    set "EXIT_CODE=1"
    goto :done
)

echo.
echo Publish complete.
echo.
echo FTP checklist:
echo   1. Upload %PUBLISH_ZIP%
echo   2. On the server, unzip so web.config is in the SITE ROOT
echo      ^(same folder as ThreeDAnalyzer.Web.dll — NOT inside publish_clean/^)
echo   3. Restart the site / app pool
echo   4. Hard-refresh the browser ^(Ctrl+F5^)
echo   5. Open DevTools → Network: /js/viewer.js and /lib/three.module.min.js must be 200
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
