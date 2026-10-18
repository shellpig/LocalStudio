param(
    [ValidateSet('Start','Stop','Status')][string]$Action = 'Status',
    [ValidateRange(1024,65535)][int]$Port = 8190
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $projectRoot 'services\Drama3'
$comfyRoot = Join-Path $runtime 'ComfyUI'
$python = Join-Path $runtime '.venv\Scripts\python.exe'
$base = "http://127.0.0.1:$Port"

function Get-RuntimeInfo {
    try { return Invoke-RestMethod "$base/drama3-studio/runtime" -TimeoutSec 3 } catch { return $null }
}

function Test-ProjectProcess([int]$ProcessId) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId"
    if (-not $process -or $process.CommandLine -notmatch "main\.py.*--port\s+$Port(?:\s|$)") { return $false }
    # Windows venv python.exe can launch the shared base interpreter as a child.
    if ($process.ExecutablePath -ieq $python) { return $true }
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.ParentProcessId)"
    return $null -ne $parent -and $parent.ExecutablePath -ieq $python
}

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener -and -not (Test-ProjectProcess $listener.OwningProcess)) {
    if ($Action -eq 'Stop') { Write-Output "Port $Port belongs to another installation; it was left running."; exit 0 }
    throw "Port $Port belongs to another installation. No process was stopped or started."
}
if ($Action -eq 'Status') {
    $info = Get-RuntimeInfo
    if ($info -and $info.comfyRoot -ieq $comfyRoot) { Write-Output "Drama3 ready: $comfyRoot ($Port)"; exit 0 }
    Write-Output "Drama3 is not ready on port $Port."
    exit 1
}
if ($Action -eq 'Stop') {
    if (-not $listener) { Write-Output 'Project Drama3 is already stopped.'; exit 0 }
    $queue = Invoke-RestMethod "$base/queue" -TimeoutSec 5
    if ($queue.queue_running.Count -gt 0 -or $queue.queue_pending.Count -gt 0) {
        throw 'Drama3 still has work. Stop or finish it in Studio before closing the service.'
    }
    $targetProcess = Get-Process -Id $listener.OwningProcess
    $null = $targetProcess.Handle
    Stop-Process -InputObject $targetProcess
    if (-not $targetProcess.WaitForExit(30000)) {
        throw 'Drama3 process did not exit; memory has not been released.'
    }
    Write-Output "Stopped project Drama3 on port $Port."
    exit 0
}
if (-not (Test-Path -LiteralPath $python) -or -not (Test-Path -LiteralPath (Join-Path $comfyRoot 'main.py'))) {
    throw "Project-local Drama3 is not installed: $runtime"
}
if (-not $listener) {
    & (Join-Path $PSScriptRoot 'install_drama3_studio.ps1')
    $run = Join-Path $runtime 'run'
    New-Item -ItemType Directory -Force -Path $run | Out-Null
    $arguments = @('main.py','--listen','127.0.0.1','--port',"$Port",'--disable-auto-launch','--disable-pinned-memory')
    $started = Start-Process -FilePath $python -ArgumentList $arguments -WorkingDirectory $comfyRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $run "server-$Port.stdout.log") -RedirectStandardError (Join-Path $run "server-$Port.stderr.log")
    Write-Output "Starting project Drama3 (PID $($started.Id), port $Port)..."
    Write-Output 'Only the service is starting. Models are loaded when a job executes.'
}
$deadline = (Get-Date).AddMinutes(5)
do {
    $info = Get-RuntimeInfo
    if ($info -and $info.comfyRoot -ieq $comfyRoot) { Write-Output "Drama3 ready: $comfyRoot ($Port)"; exit 0 }
    Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)
throw "Drama3 startup timed out. Check $runtime\run\server-$Port.stderr.log"
