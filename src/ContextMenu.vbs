Option Explicit

Dim APP_NAME, FILE_NAME, COMMAND_LABEL
Dim shell, shellApp, fso, path, keyDir, keyDrv, keyExists, msg

APP_NAME = "Gallezy"
FILE_NAME = "Gallezy.exe"
COMMAND_LABEL = "Open with Galle&zy"

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set shellApp = Wscript.CreateObject("Shell.Application")

' Run by WScript / Run as admin
If Right(LCase(WScript.FullName), 12) = "\cscript.exe" Or Wscript.Arguments.Count = 0 Then
  shellApp.ShellExecute "wscript.exe", """" & WScript.ScriptFullName & """ runas", "", "runas", 1
  WScript.Quit()
End If

path = fso.GetFile(WScript.ScriptFullName).ParentFolder.Path & "\" & FILE_NAME
keyDir = "HKCR\Directory\shell\" & APP_NAME
keyDrv = "HKCR\Drive\shell\" & APP_NAME

If Not fso.FileExists(path) Then
  MsgBox "Not Found File: " & path, vbCritical, APP_NAME
  WScript.Quit(1)
End If

On Error Resume Next
shell.RegRead(keyDir & "\")
If Err.Number = 0 Then
  keyExists = true
End If
On Error Goto 0

If keyExists Then msg = "Unregister " Else msg = "Register "
If MsgBox(msg & APP_NAME & " with context menu." & vbCrLf & "Continue?", _
    vbYesNo + vbQuestion, APP_NAME) <> vbYes Then
  WScript.Quit(1)
End If

If keyExists Then ' Remove
  shell.RegDelete keyDir & "\command\"
  shell.RegDelete keyDir & "\"
  shell.RegDelete keyDrv & "\command\"
  shell.RegDelete keyDrv & "\"
Else
  shell.RegWrite keyDir & "\", COMMAND_LABEL
  shell.RegWrite keyDir & "\command\", """" & path & """ ""%1"""
  shell.RegWrite keyDrv & "\", COMMAND_LABEL
  shell.RegWrite keyDrv & "\command\", """" & path & """ ""%1"""
End If

MsgBox "Success!", vbInformation, APP_NAME
WScript.Quit()
