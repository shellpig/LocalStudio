@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\drama3_service.ps1" -Action Start
set "DRAMA3_EXIT=%ERRORLEVEL%"
if not "%DRAMA3_EXIT%"=="0" if /i not "%~1"=="--no-pause" pause
exit /b %DRAMA3_EXIT%
