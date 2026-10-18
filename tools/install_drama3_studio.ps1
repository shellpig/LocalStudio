param()
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$Drama3Root = Join-Path $projectRoot 'services\Drama3'
$source = (Resolve-Path -LiteralPath (Join-Path $projectRoot 'integrations\ComfyUI-Drama3-Studio')).Path
$customNodes = (Resolve-Path -LiteralPath (Join-Path $Drama3Root 'ComfyUI\custom_nodes')).Path
$destination = Join-Path $customNodes 'ComfyUI-Drama3-Studio'
if (Test-Path -LiteralPath $destination) {
    $existing = Get-Item -LiteralPath $destination
    if ($existing.LinkType -ne 'Junction' -or $existing.Target -ne $source) {
        throw "Existing path is not the Studio junction: $destination"
    }
} else {
    New-Item -ItemType Junction -Path $destination -Target $source | Out-Null
}
Write-Output "Drama3 Studio nodes linked: $destination"
Write-Output 'Restart Drama3 and H3 ComfyUI to load the integration.'
