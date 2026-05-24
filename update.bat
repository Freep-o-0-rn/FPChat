@echo off
chcp 65001 >nul

set SRC=D:\FPChat
set DST=C:\_BOTS\FPChat
set BACKUP=C:\_BOTS\FPChat_backups\backup_%date:~-4%-%date:~3,2%-%date:~0,2%_%time:~0,2%-%time:~3,2%

echo === FPChat update ===

echo === Backup data and env ===
mkdir "%BACKUP%"
if exist "%DST%\data" xcopy "%DST%\data" "%BACKUP%\data" /E /I /Y
if exist "%DST%\.env" copy "%DST%\.env" "%BACKUP%\.env" /Y

echo === Copy project from flash drive ===
robocopy "%SRC%" "%DST%" /E /XD data node_modules .git /XF .env

echo === Install dependencies ===
cd /d "%DST%"
npm install

echo === Update complete ===
pause