' Starts Game Tracker in the background (if it is not already running) and opens its window.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "node src\server.js", 0, False
WScript.Sleep 1500
sh.Run "msedge --app=http://127.0.0.1:47830/game-tracker --window-size=1180,900", 1, False
