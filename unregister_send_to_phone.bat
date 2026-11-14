@echo off
echo Removing Send to POCO M6 Pro 5G integration...
reg delete "HKCU\Software\Classes\*\shell\BridgeSendToPhone" /f >nul 2>&1
powershell -NoProfile -Command "$sendTo = [Environment]::GetFolderPath('SendTo'); Remove-Item (Join-Path $sendTo 'POCO M6 Pro 5G.lnk') -ErrorAction SilentlyContinue; $desk = [Environment]::GetFolderPath('Desktop'); Remove-Item (Join-Path $desk 'POCO M6 Pro 5G Drop Zone.lnk') -ErrorAction SilentlyContinue"
echo [OK] Integration removed.
