@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title FPChat Safe Updater

set "SRC=D:\FPChat"
set "DST=C:\_BOTS\FPChat"
set "BACKUP_ROOT=C:\_BOTS\FPChat_backups"
set "SERVER_WAS_RUNNING=0"
set "LIVE_FILES_TOUCHED=0"
set "NODE_MAJOR="
set "STAGE="
set "STAMP="
set "APP_PORT=3010"

for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set "STAMP=%%I"
if not defined STAMP set "STAMP=%RANDOM%"

set "BACKUP=%BACKUP_ROOT%\backup_%STAMP%"
set "STAGE=%BACKUP_ROOT%\_stage_%STAMP%"

echo.
echo ========================================
echo        FPChat safe update, build 55
echo ========================================
echo.

echo [1/7] Checking paths and tools...
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

echo [7/7] Cleaning staging folder...
rmdir /S /Q "%STAGE%" >nul 2>&1

if "%SERVER_WAS_RUNNING%"=="1" (
    echo Restarting FPChat server...
    start "FPChat Server" /D "%DST%" cmd /c call "%DST%\start_chat.bat"
    timeout /t 3 /nobreak >nul
)

echo.
echo ========================================
echo Update completed successfully.
echo Backup: %BACKUP%
if "%SERVER_WAS_RUNNING%"=="1" echo Server restart command was issued.
echo ========================================
pause
exit /b 0

:fail
if defined STAGE if exist "%STAGE%\" rmdir /S /Q "%STAGE%" >nul 2>&1
if "%SERVER_WAS_RUNNING%"=="1" if "%LIVE_FILES_TOUCHED%"=="0" (
    echo Attempting to restart the previous FPChat server...
    start "FPChat Server" /D "%DST%" cmd /c call "%DST%\start_chat.bat"
)
echo.
echo Update was canceled. Existing data and .env were not intentionally removed.
if "%LIVE_FILES_TOUCHED%"=="1" echo Live files may be incomplete; use the backup shown above before restarting.
pause
exit /b 1
