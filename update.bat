@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title FPChat Safe Updater

set "SRC="
if defined FPCHAT_UPDATE_DST (
    set "DST=%FPCHAT_UPDATE_DST%"
) else (
    set "DST=C:\_BOTS\FPChat"
)
if defined FPCHAT_UPDATE_BACKUP_ROOT (
    set "BACKUP_ROOT=%FPCHAT_UPDATE_BACKUP_ROOT%"
) else (
    set "BACKUP_ROOT=C:\_BOTS\FPChat_backups"
)
set "SERVER_WAS_RUNNING=0"
set "LIVE_FILES_TOUCHED=0"
set "BACKUP_READY=0"
set "HAD_DATA=0"
set "HAD_ENV=0"
set "HAD_NODE_MODULES=0"
set "NODE_MAJOR="
set "STAGE="
set "STAMP="
set "APP_PORT=3010"
set "EXPECTED_BUILD=183.9"
set "SOURCE_BUILD="

rem Prefer the folder that contains this updater. This keeps working when
rem Windows assigns the flash drive a letter other than D:.
for %%I in ("%~dp0.") do set "SCRIPT_DIR=%%~fI"
if /I not "%SCRIPT_DIR%"=="%DST%" if exist "%SCRIPT_DIR%\package.json" set "SRC=%SCRIPT_DIR%"
if not defined SRC if /I not "%SCRIPT_DIR%"=="%DST%" if exist "%SCRIPT_DIR%\FPChat\package.json" set "SRC=%SCRIPT_DIR%\FPChat"
if not defined SRC if exist "D:\FPChat\package.json" set "SRC=D:\FPChat"
if not defined SRC for %%D in (D E F G H I J K L M N O P Q R S T U V W X Y Z) do if not defined SRC if exist "%%D:\FPChat\package.json" set "SRC=%%D:\FPChat"

for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set "STAMP=%%I"
if not defined STAMP set "STAMP=%RANDOM%"

set "BACKUP=%BACKUP_ROOT%\backup_%STAMP%"
set "STAGE=%BACKUP_ROOT%\_stage_%STAMP%"

echo.
echo ========================================
echo        FPChat safe update, build %EXPECTED_BUILD%
echo ========================================
echo.

echo [1/7] Checking paths and tools...
if not defined SRC (
    echo [ERROR] FPChat project source was not found.
    echo Put update.bat in the project folder on the flash drive.
    echo Expected structure: ^<flash-drive^>:\FPChat\package.json
    goto :fail
)
if not exist "%SRC%\" (
    echo [ERROR] Source folder not found: %SRC%
    goto :fail
)
if not exist "%SRC%\package.json" (
    echo [ERROR] package.json not found in source folder.
    goto :fail
)
if not exist "%SRC%\package-lock.json" (
    echo [ERROR] package-lock.json not found. Deterministic install is impossible.
    goto :fail
)
if not exist "%SRC%\server.js" (
    echo [ERROR] server.js not found in source folder.
    goto :fail
)
if not exist "%SRC%\public\version.json" (
    echo [ERROR] public\version.json not found in source folder.
    goto :fail
)
for /f "usebackq delims=" %%V in (`powershell -NoProfile -Command "$p=Join-Path $env:SRC 'public\version.json'; $v=(Get-Content -LiteralPath $p -Raw | ConvertFrom-Json).build; [Console]::Write([Convert]::ToString($v,[Globalization.CultureInfo]::InvariantCulture))"`) do set "SOURCE_BUILD=%%V"
if not defined SOURCE_BUILD (
    echo [ERROR] Cannot read build number from public\version.json.
    goto :fail
)
if not "%SOURCE_BUILD%"=="%EXPECTED_BUILD%" (
    echo [ERROR] Wrong FPChat source build: %SOURCE_BUILD%.
    echo Expected build: %EXPECTED_BUILD%.
    echo Download or copy the correct build before updating the server.
    goto :fail
)
echo Source build verified: %SOURCE_BUILD%
if /I "%SRC%"=="%DST%" (
    echo [ERROR] Source and destination must be different.
    goto :fail
)
if not exist "%DST%\" mkdir "%DST%" >nul 2>&1
if not exist "%BACKUP_ROOT%\" mkdir "%BACKUP_ROOT%" >nul 2>&1
if not exist "%BACKUP_ROOT%\" (
    echo [ERROR] Cannot create backup folder: %BACKUP_ROOT%
    goto :fail
)
if exist "%STAGE%\" (
    echo [ERROR] Temporary staging folder already exists: %STAGE%
    echo Delete it manually only after checking that no update is running.
    goto :fail
)
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not available in PATH.
    goto :fail
)
where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm is not available in PATH.
    goto :fail
)
for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%V"
if not "%NODE_MAJOR%"=="22" (
    echo [ERROR] FPChat requires Node.js 22.x because of better-sqlite3 compatibility.
    echo Current Node.js major version: %NODE_MAJOR%
    goto :fail
)

if exist "%DST%\.env" (
    for /f "tokens=1,* delims==" %%A in ('findstr /B /C:"APP_PORT=" "%DST%\.env" 2^>nul') do (
        if /I "%%A"=="APP_PORT" set "APP_PORT=%%B"
    )
)
if not defined APP_PORT set "APP_PORT=3010"

echo [2/7] Building isolated staging copy...
mkdir "%STAGE%" >nul 2>&1
if not exist "%STAGE%\" (
    echo [ERROR] Cannot create staging folder: %STAGE%
    goto :fail
)
robocopy "%SRC%" "%STAGE%" /E /XD "%SRC%\data" "%SRC%\node_modules" "%SRC%\.git" /XF .env /R:2 /W:2
if errorlevel 8 (
    echo [ERROR] Project copy to staging failed.
    goto :fail
)

echo [3/7] Installing locked dependencies in staging...
pushd "%STAGE%"
call npm ci --omit=dev --no-audit --no-fund
if errorlevel 1 (
    popd
    echo [ERROR] npm ci failed. The live installation was not changed.
    goto :fail
)
popd

echo [4/7] Stopping FPChat before touching SQLite and files...
powershell -NoProfile -Command "$c=@(Get-NetTCPConnection -LocalPort %APP_PORT% -State Listen -ErrorAction SilentlyContinue); if($c.Count -gt 0){exit 1}; exit 0" >nul 2>&1
if errorlevel 1 (
    set "SERVER_WAS_RUNNING=1"
    taskkill /FI "WINDOWTITLE eq FPChat Server Launcher" /T /F >nul 2>&1
    timeout /t 2 /nobreak >nul
)
powershell -NoProfile -Command "$c=@(Get-NetTCPConnection -LocalPort %APP_PORT% -State Listen -ErrorAction SilentlyContinue); if($c.Count -gt 0){exit 1}; exit 0" >nul 2>&1
if errorlevel 1 (
    set "SERVER_WAS_RUNNING=0"
    echo [ERROR] Port %APP_PORT% is still busy.
    echo Close the FPChat server manually and run update.bat again.
    goto :fail
)

echo [5/7] Backing up current installation...
if exist "%DST%\data\" set "HAD_DATA=1"
if exist "%DST%\.env" set "HAD_ENV=1"
if exist "%DST%\node_modules\" set "HAD_NODE_MODULES=1"
mkdir "%BACKUP%" >nul 2>&1
if not exist "%BACKUP%\" (
    echo [ERROR] Cannot create backup folder: %BACKUP%
    goto :fail
)
if exist "%DST%\" (
    robocopy "%DST%" "%BACKUP%\app" /E /XD "%DST%\data" "%DST%\node_modules" "%DST%\.git" /XF .env /COPY:DAT /DCOPY:DAT /R:2 /W:2
    if errorlevel 8 (
        echo [ERROR] Application backup failed. Update canceled.
        goto :fail
    )
)
if exist "%DST%\data\" (
    robocopy "%DST%\data" "%BACKUP%\data" /E /COPY:DAT /DCOPY:DAT /R:2 /W:2
    if errorlevel 8 (
        echo [ERROR] SQLite data backup failed. Update canceled.
        goto :fail
    )
)
if exist "%DST%\.env" (
    copy /Y "%DST%\.env" "%BACKUP%\.env" >nul
    if errorlevel 1 (
        echo [ERROR] .env backup failed. Update canceled.
        goto :fail
    )
)
if exist "%DST%\node_modules\" (
    robocopy "%DST%\node_modules" "%BACKUP%\node_modules" /E /COPY:DAT /DCOPY:DAT /R:2 /W:2
    if errorlevel 8 (
        echo [ERROR] Dependency rollback backup failed. Update canceled.
        goto :fail
    )
)
set "BACKUP_READY=1"

echo [6/7] Applying application files...
set "LIVE_FILES_TOUCHED=1"
robocopy "%STAGE%" "%DST%" /E /XD "%STAGE%\node_modules" "%STAGE%\data" "%STAGE%\.git" /XF .env /COPY:DAT /DCOPY:DAT /R:2 /W:2
if errorlevel 8 (
    echo [ERROR] Application files could not be copied completely.
    echo Backup is available at: %BACKUP%
    goto :fail
)
robocopy "%STAGE%\node_modules" "%DST%\node_modules" /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:2
if errorlevel 8 (
    echo [ERROR] Dependencies could not be copied completely.
    echo Backup is available at: %BACKUP%
    goto :fail
)
if not exist "%DST%\data\" mkdir "%DST%\data" >nul 2>&1
if /I "%FPCHAT_UPDATE_TEST_FAIL_AFTER_DEPENDENCIES%"=="1" (
    echo [TEST] Injecting failure after live application and dependency writes.
    goto :fail
)

echo [7/7] Cleaning staging folder...
rmdir /S /Q "%STAGE%" >nul 2>&1

echo.
echo ========================================
echo Update completed successfully.
echo Backup: %BACKUP%
if "%SERVER_WAS_RUNNING%"=="1" echo FPChat was stopped for the update and remains stopped.
echo Start the server manually with start_chat.bat after checking the update.
echo ========================================
if /I not "%FPCHAT_UPDATE_NONINTERACTIVE%"=="1" pause
exit /b 0

:fail
if defined STAGE if exist "%STAGE%\" rmdir /S /Q "%STAGE%" >nul 2>&1
if "%LIVE_FILES_TOUCHED%"=="1" if "%BACKUP_READY%"=="1" (
    call :rollback
    if errorlevel 1 (
        echo [ROLLBACK ERROR] Automatic restore failed. Keep the backup at: %BACKUP%
        echo Do not start FPChat until code, data, config and dependencies are checked.
    ) else (
        echo [ROLLBACK] Previous FPChat code, data, config and dependencies were restored.
    )
)
if "%SERVER_WAS_RUNNING%"=="1" (
    echo FPChat was stopped by the updater and was not restarted.
    echo Start it manually with start_chat.bat only after the installation is verified.
)
echo.
echo Update was canceled.
if "%LIVE_FILES_TOUCHED%"=="1" if not "%BACKUP_READY%"=="1" echo Live files may be incomplete; no complete rollback snapshot was available.
if /I not "%FPCHAT_UPDATE_NONINTERACTIVE%"=="1" pause
exit /b 1

:rollback
echo [ROLLBACK] Restoring previous FPChat installation from: %BACKUP%
if not exist "%BACKUP%\app\" (
    echo [ROLLBACK ERROR] Application backup is missing.
    exit /b 1
)
robocopy "%BACKUP%\app" "%DST%" /MIR /XD data node_modules .git /XF .env /COPY:DAT /DCOPY:DAT /R:2 /W:2
if errorlevel 8 exit /b 1

if "%HAD_DATA%"=="1" (
    if not exist "%BACKUP%\data\" exit /b 1
    if not exist "%DST%\data\" mkdir "%DST%\data" >nul 2>&1
    robocopy "%BACKUP%\data" "%DST%\data" /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:2
    if errorlevel 8 exit /b 1
) else (
    if exist "%DST%\data\" rmdir /S /Q "%DST%\data"
)

if "%HAD_ENV%"=="1" (
    if not exist "%BACKUP%\.env" exit /b 1
    copy /Y "%BACKUP%\.env" "%DST%\.env" >nul
    if errorlevel 1 exit /b 1
) else (
    if exist "%DST%\.env" del /F /Q "%DST%\.env"
)

if "%HAD_NODE_MODULES%"=="1" (
    if not exist "%BACKUP%\node_modules\" exit /b 1
    if not exist "%DST%\node_modules\" mkdir "%DST%\node_modules" >nul 2>&1
    robocopy "%BACKUP%\node_modules" "%DST%\node_modules" /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:2
    if errorlevel 8 exit /b 1
) else (
    if exist "%DST%\node_modules\" rmdir /S /Q "%DST%\node_modules"
)

echo [ROLLBACK] Restore completed successfully.
exit /b 0
