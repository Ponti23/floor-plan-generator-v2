<#
.SYNOPSIS
  Run the installed PlanLab release: one process serving the built UI and the API on 8010.
#>
param()

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root "dist/index.html"))) {
    throw "No built frontend found. Run 'npm run build' first."
}
& (Join-Path $PSScriptRoot "start-generation.ps1") -Release
exit $LASTEXITCODE
