@echo off
echo ========================================================
echo   Setting up "Send to POCO M6 Pro 5G" Windows Integration
echo ========================================================

set SCRIPT_DIR=%~dp0
set NODE_SCRIPT=%SCRIPT_DIR%desktop\send_to_phone.js
set DROP_ZONE_EXE=%SCRIPT_DIR%desktop\BridgeDropZone.exe

:: 1. Add Right-Click Context Menu for ALL files
echo [*] Adding Windows Explorer Right-Click Context Menu...
reg add "HKCU\Software\Classes\*\shell\BridgeSendToPhone" /ve /d "Send to POCO M6 Pro 5G" /f >nul
reg add "HKCU\Software\Classes\*\shell\BridgeSendToPhone" /v "Icon" /d "imageres.dll,-67" /f >nul
reg add "HKCU\Software\Classes\*\shell\BridgeSendToPhone\command" /ve /d "\"cmd.exe\" /c node \"%NODE_SCRIPT%\" \"%%1\"" /f >nul

:: 2. Add to Windows "Send To" Menu
echo [*] Adding to Windows "Send to" Menu...
powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$sendToPath = [Environment]::GetFolderPath('SendTo'); " ^
  "$s = $ws.CreateShortcut((Join-Path $sendToPath 'POCO M6 Pro 5G.lnk')); " ^
  "$s.TargetPath = 'cmd.exe'; " ^
  "$s.Arguments = '/c node \"'%NODE_SCRIPT%'\"'; " ^
  "$s.IconLocation = 'imageres.dll,67'; " ^
  "$s.WindowStyle = 7; " ^
  "$s.Save()"

:: 3. Create Desktop Shortcut for Floating Drag & Drop Zone
echo [*] Creating Desktop Shortcut for POCO Drop Zone...
powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$desktop = [Environment]::GetFolderPath('Desktop'); " ^
  "$s = $ws.CreateShortcut((Join-Path $desktop 'POCO M6 Pro 5G Drop Zone.lnk')); " ^
  "$s.TargetPath = '%DROP_ZONE_EXE%'; " ^
  "$s.IconLocation = 'imageres.dll,67'; " ^
  "$s.Description = 'Drag and drop files to send to POCO M6 Pro 5G'; " ^
  "$s.Save()"

echo.
echo [OK] Integration Complete!
echo You can now:
echo  1. Drag and drop any file onto the floating POCO Drop Zone.
echo  2. Right-click ANY file in File Explorer and click "Send to POCO M6 Pro 5G".
echo  3. Right-click ANY file -^> Send to -^> "POCO M6 Pro 5G".
echo ========================================================
pause
