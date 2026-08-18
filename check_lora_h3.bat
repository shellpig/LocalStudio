@echo off
setlocal
cd /d "%~dp0"
echo [H3] Checking LoRA compatibility with the MiniMax H3 DiT...
echo.
"%~dp0.venv\Scripts\python.exe" "%~dp0tools\check_lora_h3.py" %*
echo.
echo Drag a .safetensors file onto this .bat to check that file only.
pause
