@echo off
setlocal
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0Deploy-SkillCreatorSite.ps1" -Action Deploy
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
