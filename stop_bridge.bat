@echo off
cd /d "%~dp0"
echo Stopping Bridge Background Agent...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":49152" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
echo Bridge stopped successfully.
pause
