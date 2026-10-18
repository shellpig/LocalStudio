@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\drama3_service.ps1" -Action Stop
set "DRAMA3_EXIT=%ERRORLEVEL%"
if /i not "%~1"=="--no-pause" pause
exit /b %DRAMA3_EXIT%
