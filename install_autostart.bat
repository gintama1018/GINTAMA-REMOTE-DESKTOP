@echo off
echo ========================================================
echo   Installing Bridge Remote to Windows Silent Startup
echo ========================================================
powershell -NoProfile -Command "$wsh = New-Object -ComObject WScript.Shell; $s = $wsh.CreateShortcut(\"$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\BridgeRemote.lnk\"); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%~dp0start_bridge_silent.vbs\"'; $s.WorkingDirectory = '%~dp0'; $s.Description = 'Bridge Remote Background Agent'; $s.Save()"
echo.
echo [SUCCESS] Bridge Remote will now automatically start in the background when Windows boots!
echo (No command prompt window will be shown).
echo.
pause

