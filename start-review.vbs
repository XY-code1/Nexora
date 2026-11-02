Option Explicit
Dim shell, fso, root, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
command = "pythonw.exe """ & fso.BuildPath(root, "launcher.py") & """"
shell.Run command, 0, False
