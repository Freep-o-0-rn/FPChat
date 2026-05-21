@echo off
chcp 65001 >nul
title FPChat Server Launcher

if not exist package.json (
    echo [ОШИБКА] package.json не найден.
    pause
    exit /b 1
)

if not exist node_modules (
    echo node_modules не найден. Устанавливаю зависимости...
    call npm install
    if errorlevel 1 (
        echo [ОШИБКА] npm install завершился с ошибкой.
        pause
        exit /b 1
    )
) else (
    echo Зависимости уже установлены.
)

echo Запускаю сервер...
call npm start

pause