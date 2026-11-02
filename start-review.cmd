@echo off
setlocal
set "FRAMEWORK=%~dp0"
if defined PROFILE_VAULT (
  set "VAULT=%PROFILE_VAULT%"
) else (
  set "VAULT=%~dp0..\my-ai-profile"
)
python "%FRAMEWORK%review_app.py" --vault "%VAULT%"
if errorlevel 1 pause

