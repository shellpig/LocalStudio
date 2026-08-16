@echo off
setlocal
cd /d "%~dp0ComfyUI"
"%~dp0.venv\Scripts\python.exe" main.py --listen 127.0.0.1 --port 8188 --enable-cors-header --auto-launch
pause
