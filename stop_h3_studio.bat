@echo off
setlocal
cd /d "%~dp0"

echo [H3 Local Studio] Stopping queued and active work...
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -UseBasicParsing -Method Post -Uri 'http://127.0.0.1:8188/interrupt' -TimeoutSec 2 | Out-Null } catch {}; try { Invoke-WebRequest -UseBasicParsing -Method Post -ContentType 'application/json' -Body (@{clear=$true} | ConvertTo-Json) -Uri 'http://127.0.0.1:8188/queue' -TimeoutSec 2 | Out-Null } catch {}"

echo [H3 Local Studio] Closing local services...
powershell -NoProfile -Command "$ports=8188,3000; $owners=Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in $ports } | Select-Object -ExpandProperty OwningProcess -Unique; $processes=Get-CimInstance Win32_Process; $byId=@{}; foreach ($item in $processes) { $byId[[int]$item.ProcessId]=$item }; $roots=@(); foreach ($owner in $owners) { $root=[int]$owner; $current=$byId[$root]; while ($null -ne $current -and $byId.ContainsKey([int]$current.ParentProcessId)) { $parent=$byId[[int]$current.ParentProcessId]; if ($parent.Name -ieq 'cmd.exe') { $root=[int]$parent.ProcessId }; $current=$parent }; $roots += $root }; foreach ($processId in ($roots | Select-Object -Unique)) { taskkill.exe /PID $processId /T /F 2>$null | Out-Null }; Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like 'H3 ComfyUI*' -or $_.MainWindowTitle -like 'H3 Studio UI*' } | Stop-Process -Force -ErrorAction SilentlyContinue"

echo [H3 Local Studio] All H3 services are closed.
if /i not "%~1"=="--from-start" pause
exit /b 0
