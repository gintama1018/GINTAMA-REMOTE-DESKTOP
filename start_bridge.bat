@echo off
cd /d "%~dp0"
title Bridge - Remote Companion (Active)

echo ========================================================
echo   Starting Bridge Remote Companion...
echo ========================================================
echo.

node desktop/run_all.js

echo.
echo Process terminated.
pause
