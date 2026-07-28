Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptPath = fso.GetParentFolderName(WScript.ScriptFullName) & "\run.ps1"
scriptCmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " _
    & Chr(34) & scriptPath & Chr(34)

If WScript.Arguments.Count > 0 Then
    If LCase(WScript.Arguments(0)) = "sidebar" Then
        scriptCmd = scriptCmd & " -Sidebar"
    End If
End If

shell.Run scriptCmd, 0, False
