param([Parameter(Mandatory=$true)][string]$Source)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = (Resolve-Path -LiteralPath $Source).Path
$destination = Join-Path $projectRoot 'services\Drama3'
if (Test-Path -LiteralPath $destination) { throw "Destination already exists: $destination" }
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot 'ComfyUI\main.py'))) { throw 'Source is not a Drama3 ComfyUI installation' }
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot '.venv\Lib\site-packages\torch'))) { throw 'Source Python packages are missing' }
New-Item -ItemType Directory -Path $destination | Out-Null
$log = Join-Path $destination 'migration-copy.log'

function Copy-RuntimeTree([string]$From, [string]$To) {
    & robocopy.exe $From $To /E /XJ /COPY:DAT /DCOPY:DAT /R:1 /W:1 /MT:8 /NP /NFL /NDL /XD __pycache__ /XF *.pyc /LOG+:$log | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Copy failed ($LASTEXITCODE): $From; see $log" }
}

# Copy, rather than move, so the original installation remains recoverable.
Copy-RuntimeTree (Join-Path $sourceRoot 'ComfyUI') (Join-Path $destination 'ComfyUI')
$python = Join-Path $projectRoot '.venv\Scripts\python.exe'
& $python -m venv --without-pip (Join-Path $destination '.venv')
if ($LASTEXITCODE -ne 0) { throw 'Could not create the project-local Python environment' }
Copy-RuntimeTree (Join-Path $sourceRoot '.venv\Lib\site-packages') (Join-Path $destination '.venv\Lib\site-packages')
if (Test-Path -LiteralPath (Join-Path $sourceRoot '.venv\share')) {
    Copy-RuntimeTree (Join-Path $sourceRoot '.venv\share') (Join-Path $destination '.venv\share')
}
$environmentPython = Join-Path $destination '.venv\Scripts\python.exe'
$entrypoints = @'
import importlib.metadata
from pathlib import Path
import sys
from pip._vendor.distlib.scripts import ScriptMaker
maker = ScriptMaker(None, str(Path(sys.executable).parent))
maker.executable = sys.executable
maker.clobber = True
for distribution in importlib.metadata.distributions():
    for entry in distribution.entry_points:
        if entry.group in {"console_scripts", "gui_scripts"}:
            maker.make(f"{entry.name} = {entry.value}", options={"gui": entry.group == "gui_scripts"})
print("Rebuilt command entrypoints for", sys.prefix)
'@
& $environmentPython -c $entrypoints
if ($LASTEXITCODE -ne 0) { throw 'Could not rebuild local Python entrypoints' }
& (Join-Path $PSScriptRoot 'install_drama3_studio.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Could not link Studio nodes' }
Write-Output "Drama3 copied to: $destination"
Write-Output 'The original installation has not been changed. Verify the copy before switching services.'
