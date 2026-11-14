@echo off
echo Removing Bridge Remote from Windows Startup...
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\BridgeRemote.lnk" 2>nul
echo.
echo [SUCCESS] Removed from Windows Startup!
echo.
pause
