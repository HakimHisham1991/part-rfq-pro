@echo off
setlocal EnableExtensions

REM Clean Release publish -> publish_clean (see scripts\Publish-Clean.ps1)
REM   OCCT kit: runtime\occt  ^(.\scripts\Import-OcctKit.ps1 once^)
REM   Self-contained (IIS):  publish-clean.bat self-contained
REM   UI only:  set SKIP_OCCT=1 && publish-clean.bat

cd /d "%~dp0"

set "ARGS="
if /i "%~1"=="self-contained" set "ARGS=-SelfContained"
if /i "%SKIP_OCCT%"=="1" set "ARGS=%ARGS% -SkipOcct"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Publish-Clean.ps1" %ARGS%
set "EC=%ERRORLEVEL%"
if not "%EC%"=="0" (
    echo.
    echo publish-clean failed with exit %EC%
    pause
)
exit /b %EC%
