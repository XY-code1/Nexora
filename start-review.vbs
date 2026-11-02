Option Explicit
Dim shell, fso, root, vault, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
vault = shell.ExpandEnvironmentStrings("%PROFILE_VAULT%")
If vault = "%PROFILE_VAULT%" Then vault = fso.BuildPath(fso.GetParentFolderName(root), "my-ai-profile")
command = "pythonw.exe """ & fso.BuildPath(root, "review_app.py") & """ --vault """ & vault & """"
shell.Run command, 0, False

