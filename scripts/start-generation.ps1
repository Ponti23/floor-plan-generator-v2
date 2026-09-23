<#
.SYNOPSIS
  Prepare (once) and run the PlanLab generation service in a development terminal.

.EXAMPLE
  pwsh -NoProfile -File scripts/start-generation.ps1 -Setup
  pwsh -NoProfile -File scripts/start-generation.ps1
#>
param(
    [switch]$Setup,
    [switch]$Release
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$engineRoot = if ($env:PLANLAB_ENGINE_ROOT) { $env:PLANLAB_ENGINE_ROOT } else { "E:/Projects/floor-plan-model" }
$python = if ($env:PLANLAB_PYTHON) { $env:PLANLAB_PYTHON } else { Join-Path $engineRoot ".python/python.exe" }
$overlay = if ($env:PLANLAB_SERVICE_SITE_PACKAGES) { $env:PLANLAB_SERVICE_SITE_PACKAGES } else { Join-Path $root ".runtime/generation/site-packages" }
$lockFile = Join-Path $overlay ".requirements.lock.txt"

if (-not (Test-Path $python)) {
    throw "Engine interpreter not found at $python. Set PLANLAB_PYTHON or install the engine workspace."
}
if (-not (Test-Path (Join-Path $engineRoot "geometry_engine_v1"))) {
    throw "Engine package not found under $engineRoot. Set PLANLAB_ENGINE_ROOT."
}
$checkpoint = Join-Path $engineRoot "topology_v1/checkpoints/full_v1a/best.pt"
if (-not (Test-Path $checkpoint)) {
    throw "Model checkpoint not found at $checkpoint. The service can still list saved projects, but generation will report MODEL_LOAD_FAILURE."
}

if ($Setup -or -not (Test-Path $lockFile)) {
    if (-not (Test-Path $overlay)) { New-Item -ItemType Directory -Force -Path $overlay | Out-Null }
    $resolved = (& $python -c "import sys; print('ok')" 2>$null)
    if ($LASTEXITCODE -ne 0) { throw "The engine interpreter cannot run: $python" }
    Write-Host "Installing service dependencies into $overlay"
    & $python -m pip install --disable-pip-version-check --no-input `
        --target $overlay `
        --require-hashes --only-binary=:all: `
        -r (Join-Path $root "services/generation/requirements.lock.txt")
    if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed; the protected engine environment is untouched." }
    Copy-Item (Join-Path $root "services/generation/requirements.lock.txt") $lockFile -Force
}

$env:PLANLAB_ENGINE_ROOT = $engineRoot
$env:PLANLAB_PYTHON = $python
$env:PLANLAB_SERVICE_SITE_PACKAGES = $overlay
if ($Release) {
    if (-not (Test-Path (Join-Path $root "dist/index.html"))) {
        throw "Release mode needs a built frontend: run 'npm run build' first."
    }
    $env:PLANLAB_STATIC_DIR = Join-Path $root "dist"
}

Write-Host "Starting PlanLab generation service on http://$($env:PLANLAB_HOST ?? '127.0.0.1'):$($env:PLANLAB_PORT ?? '8010')"
& $python (Join-Path $root "scripts/run-service.py")
exit $LASTEXITCODE
