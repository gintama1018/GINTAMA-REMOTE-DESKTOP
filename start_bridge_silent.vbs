Set WshShell = CreateObject("WScript.Shell")
' Run Bridge agent completely hidden in background (0 = hide window)
WshShell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.Run "cmd.exe /c node desktop/run_all.js", 0, False

