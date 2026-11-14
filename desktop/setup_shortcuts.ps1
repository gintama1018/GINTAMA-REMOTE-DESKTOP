$ws = New-Object -ComObject WScript.Shell

# 1. SendTo shortcut
$sendTo = [Environment]::GetFolderPath('SendTo')
$s1 = $ws.CreateShortcut((Join-Path $sendTo 'POCO M6 Pro 5G.lnk'))
$s1.TargetPath = 'cmd.exe'
$s1.Arguments = '/c node "C:\Users\hp\Downloads\REMOSTE\desktop\send_to_phone.js"'
$s1.IconLocation = 'imageres.dll,67'
$s1.WindowStyle = 7
$s1.Save()

# 2. Desktop shortcut
$desk = [Environment]::GetFolderPath('Desktop')
$s2 = $ws.CreateShortcut((Join-Path $desk 'POCO M6 Pro 5G Drop Zone.lnk'))
$s2.TargetPath = 'C:\Users\hp\Downloads\REMOSTE\desktop\BridgeDropZone.exe'
$s2.IconLocation = 'imageres.dll,67'
$s2.Description = 'Drag and drop files to send to POCO M6 Pro 5G'
$s2.Save()

Write-Output "Shortcuts created successfully."
