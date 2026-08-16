@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -Command "$ports=8188,3000; if (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in $ports }) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
  echo [H3 Local Studio] Existing H3 services were found.
  choice /C YN /N /M "Stop them and start fresh? [Y/N]: "
  if errorlevel 2 goto ensure_services
  call "%~dp0stop_h3_studio.bat" --from-start
)

:ensure_services

echo [H3 Local Studio] Checking ComfyUI...
powershell -NoProfile -Command "try { $null=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8188/system_stats' -TimeoutSec 2; exit 0 } catch { exit 1 }"
if errorlevel 1 start "H3 ComfyUI" /min /d "%~dp0ComfyUI" cmd /k ""%~dp0.venv\Scripts\python.exe" main.py --listen 127.0.0.1 --port 8188 --enable-cors-header --disable-auto-launch"

echo [H3 Local Studio] Checking interface...
powershell -NoProfile -Command "try { $null=Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000' -TimeoutSec 2; exit 0 } catch { exit 1 }"
if errorlevel 1 start "H3 Studio UI" /min /d "%~dp0h3-local-studio" cmd /k "npm.cmd run dev"

echo [H3 Local Studio] Waiting for local services...
powershell -NoProfile -Command "$limit=(Get-Date).AddMinutes(2); do { $comfy=$false; $ui=$false; try { $null=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8188/system_stats' -TimeoutSec 2; $comfy=$true } catch {}; try { $null=Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000' -TimeoutSec 2; $ui=$true } catch {}; if ($comfy -and $ui) { exit 0 }; Start-Sleep -Seconds 2 } while ((Get-Date) -lt $limit); exit 1"
if errorlevel 1 (
  echo ComfyUI or the interface did not start. Check the minimized H3 windows.
  pause
  exit /b 1
)

start "" "http://localhost:3000"
echo H3 Local Studio is ready at http://localhost:3000
exit /b 0
