@echo off
setlocal
set "FRAMEWORK=%~dp0"
python "%FRAMEWORK%launcher.py" %*
if errorlevel 1 pause
