$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot '.venv/Scripts/python.exe'
$comfyRoot = Join-Path $projectRoot 'ComfyUI'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Create the project venv first.' }
if (Get-NetTCPConnection -LocalPort 8188 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Stop ComfyUI before installing, then restart it after installation.'
}

$faceDirectory = Join-Path $comfyRoot 'custom_nodes/ComfyUI-H3-FaceRefine'
$faceCommit = 'd8521d14fe0d721d80cd9417fff5a559cbc21aba'
if (-not (Test-Path -LiteralPath $faceDirectory)) {
    & git clone https://github.com/Carasibana/ComfyUI-H3-FaceRefine.git $faceDirectory
    if ($LASTEXITCODE) { throw 'FaceRefine clone failed.' }
    & git -C $faceDirectory checkout $faceCommit
    if ($LASTEXITCODE) { throw 'FaceRefine checkout failed.' }
} else {
    $installedCommit = & git -C $faceDirectory rev-parse HEAD
    if ($installedCommit -ne $faceCommit) { throw "Existing FaceRefine is at $installedCommit; expected $faceCommit. Review it before replacing." }
}

$audioDirectory = Join-Path $comfyRoot 'custom_nodes/ComfyUI-H3-NativeAudioLock'
New-Item -ItemType Directory -Force -Path $audioDirectory | Out-Null
$audioFile = Join-Path $audioDirectory '__init__.py'
if (-not (Test-Path -LiteralPath $audioFile)) {
    Invoke-WebRequest 'https://raw.githubusercontent.com/Shrek3OnVH5/MiniMax-H3-NativeAudio-MusicVideo-Workflow/84895cfaaef39abb42fb844b02cb42f868c7bebf/custom_nodes/ComfyUI-H3-NativeAudioLock/__init__.py' -OutFile $audioFile
}

# YOLO and PySceneDetect require opencv-python. Both OpenCV wheels own cv2, so
# replace the headless distribution while ComfyUI is stopped; never keep both.
& $pythonPath -m pip uninstall -y opencv-python-headless
& $pythonPath -m pip install opencv-python==5.0.0.93
if ($LASTEXITCODE) { throw 'OpenCV installation failed.' }
& $pythonPath -m pip install --no-deps ultralytics==8.4.178 ultralytics-thop==2.2.2 ultralytics-platform==0.1.90 scenedetect==0.7.2 polars==2.0.0 polars-runtime-32==2.0.0 platformdirs==4.13.3 nvidia-ml-py==13.615.71
if ($LASTEXITCODE) { throw 'FaceRefine dependency installation failed.' }

$detectorDirectory = Join-Path $comfyRoot 'models/ultralytics/bbox'
New-Item -ItemType Directory -Force -Path $detectorDirectory | Out-Null
$detectorFile = Join-Path $detectorDirectory 'face_yolov8m.pt'
if (-not (Test-Path -LiteralPath $detectorFile)) {
    Invoke-WebRequest 'https://huggingface.co/Bingsu/adetailer/resolve/main/face_yolov8m.pt' -OutFile $detectorFile
}
if ((Get-FileHash -LiteralPath $detectorFile -Algorithm SHA256).Hash -ne '717923C19B3F4BBF5250B728F1FA6B2CB72A33AED1D236EA9CAF0E21AD943E5F') {
    throw 'Unexpected face detector hash; review the file before using it.'
}
& $pythonPath -c 'from ultralytics import YOLO; import scenedetect; print("FaceRefine dependencies ready")'
if ($LASTEXITCODE) { throw 'Dependency import check failed.' }
& $pythonPath -m pip check
if ($LASTEXITCODE) { throw 'Resolve dependency conflicts before starting ComfyUI.' }
Write-Host 'Installed. Restart ComfyUI. Studio uses native sampling and manual/rule tracking; InsightFace is not required.'
