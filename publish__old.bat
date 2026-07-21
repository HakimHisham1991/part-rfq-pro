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
echo === Part RFQ Pro - Publish ===
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
echo [5/5] Creating zip with forward-slash paths ^(MonsterASP-safe^)...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Add-Type -AssemblyName System.IO.Compression;" ^
  "Add-Type -AssemblyName System.IO.Compression.FileSystem;" ^
  "$pub = '%PUBLISH_DIR%'; $zip = '%PUBLISH_ZIP%';" ^
  "if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force };" ^
  "$utf8 = New-Object System.Text.UTF8Encoding $false;" ^
  "$fs = [IO.File]::Open($zip, [IO.FileMode]::CreateNew);" ^
  "try {" ^
  "  $archive = New-Object IO.Compression.ZipArchive($fs, [IO.Compression.ZipArchiveMode]::Create, $false, $utf8);" ^
  "  try {" ^
  "    Get-ChildItem -LiteralPath $pub -Recurse -File | ForEach-Object {" ^
  "      $rel = $_.FullName.Substring($pub.Length).TrimStart('\','/').Replace('\','/');" ^
  "      [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $rel, [IO.Compression.CompressionLevel]::Optimal);" ^
  "    };" ^
  "  } finally { $archive.Dispose() }" ^
  "} finally { $fs.Dispose() };" ^
  "$z = [IO.Compression.ZipFile]::OpenRead($zip);" ^
  "try {" ^
  "  $names = @($z.Entries | ForEach-Object { $_.FullName });" ^
  "  if ($names -contains 'Data\\machines-master.json') { throw 'Zip still has backslash Data paths — rebuild failed' };" ^
  "  if ($names -notcontains 'web.config') { throw 'Zip missing web.config at ROOT' };" ^
  "  if ($names -notcontains 'Data/machines-master.json') { throw 'Zip missing Data/machines-master.json' };" ^
  "  if ($names -notcontains 'wwwroot/js/viewer.js') { throw 'Zip missing wwwroot/js/viewer.js' };" ^
  "  if ($names | Where-Object { $_ -like 'publish_clean/*' }) { throw 'Zip incorrectly nests publish_clean/' };" ^
  "  Write-Host ('       Zip OK: ' + [math]::Round((Get-Item $zip).Length/1MB,1) + ' MB, ' + $z.Entries.Count + ' entries, forward-slash paths');" ^
  "} finally { $z.Dispose() }"
if errorlevel 1 (
    echo ERROR: Zip creation / verification failed.
    set "EXIT_CODE=1"
    goto :done
)

echo.
echo Publish complete.
echo.
echo FTP checklist ^(IMPORTANT^):
echo   1. In MonsterASP control panel: STOP the website / app pool first
echo      ^(extract fails if Data/*.json is locked by the running app^)
echo   2. Upload %PUBLISH_ZIP%
echo   3. Unzip into the SITE ROOT so web.config sits next to ThreeDAnalyzer.Web.dll
echo      ^(NOT inside a publish_clean/ subfolder^)
echo   4. If extract still fails on Data/*: delete the server Data folder, then unzip again
echo      ^(Data/*.json are seed files only — SQLite App_Data/part-rfq.db keeps live data^)
echo   5. START the website / app pool
echo   6. Hard-refresh the browser ^(Ctrl+F5^)
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
