@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title FPChat Server Launcher

for %%I in ("%~dp0.") do set "FPCHAT_ROOT=%%~fI"

if not exist "%FPCHAT_ROOT%\package.json" (
    echo [ERROR] package.json not found in %FPCHAT_ROOT%.
    if /I not "%FPCHAT_LAUNCH_NONINTERACTIVE%"=="1" pause
    exit /b 1
)

if not exist "%FPCHAT_ROOT%\server.js" (
    echo [ERROR] server.js not found in %FPCHAT_ROOT%.
    if /I not "%FPCHAT_LAUNCH_NONINTERACTIVE%"=="1" pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%FPCHAT_ROOT%\scripts\start-fpchat180.ps1" -Root "%FPCHAT_ROOT%"
set "FPCHAT_EXIT=%ERRORLEVEL%"

if not "%FPCHAT_EXIT%"=="0" (
    echo [ERROR] FPChat launcher exited with code %FPCHAT_EXIT%.
)
if /I not "%FPCHAT_LAUNCH_NONINTERACTIVE%"=="1" pause
exit /b %FPCHAT_EXIT%
