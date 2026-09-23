<#
.SYNOPSIS
  Keep the exact-engine app reachable from the internet: release service + quick tunnel.

.DESCRIPTION
  Runs the built UI and the model service on loopback (release mode, one origin)
  and fronts them with a Cloudflare quick tunnel. Both are watched: if either
  dies it is restarted, and the loopback service is restarted whenever the
  tunnel hostname changes so its Host allowlist stays correct.

  The current public URL is written to .runtime/public/url.txt. When the URL
  changes the script also repoints the Vercel deployment at it, so the static
  page keeps calling the live model service.

.EXAMPLE
  pwsh -NoProfile -File scripts/start-public.ps1
#>
param(
    [int]$Port = 8010,
    [int]$PollSeconds = 15,
    [switch]$NoVercelSync
)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$engineRoot = if ($env:PLANLAB_ENGINE_ROOT) { $env:PLANLAB_ENGINE_ROOT } else { "E:/Projects/floor-plan-model" }
$python = if ($env:PLANLAB_PYTHON) { $env:PLANLAB_PYTHON } else { Join-Path $engineRoot ".python/python.exe" }
$cloudflared = Join-Path $root ".runtime/tools/cloudflared.exe"
$vercelOrigin = "https://floor-plan-generator-v2.vercel.app"

$publicDir = Join-Path $root ".runtime/public"
$logDir = Join-Path $publicDir "logs"
$urlFile = Join-Path $publicDir "url.txt"
$stateFile = Join-Path $publicDir "state.txt"
$syncedFile = Join-Path $publicDir "vercel-api-base.txt"
$tunnelOut = Join-Path $logDir "cloudflared.log"
$tunnelErr = Join-Path $logDir "cloudflared.err.log"
$serviceOut = Join-Path $logDir "service.log"
$serviceErr = Join-Path $logDir "service.err.log"

foreach ($dir in @($publicDir, $logDir)) {
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
}

function Write-State {
    param([string]$Message)
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -Path $stateFile -Value $line
}

function Get-Listener {
    param([int]$Port)
    return Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
}

function Get-TunnelUrl {
    $text = ""
    foreach ($path in @($tunnelErr, $tunnelOut)) {
        if (Test-Path $path) {
            $text += (Get-Content $path -Raw -ErrorAction SilentlyContinue)
        }
    }
    $matches = [regex]::Matches($text, "https://[a-z0-9-]+\.trycloudflare\.com")
    if ($matches.Count -eq 0) { return "" }
    return $matches[$matches.Count - 1].Value
}

function Start-TunnelProcess {
    Remove-Item $tunnelOut, $tunnelErr -ErrorAction SilentlyContinue
    Start-Process -FilePath $cloudflared `
        -ArgumentList "tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:$Port" `
        -WindowStyle Hidden -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelErr | Out-Null
    Write-State "started cloudflared quick tunnel to 127.0.0.1:$Port"
}

function Stop-TunnelProcess {
    Get-Process -Name cloudflared -ErrorAction SilentlyContinue | ForEach-Object {
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
}

function Stop-ServiceProcess {
    $listener = Get-Listener -Port $Port
    if ($listener) {
        Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
        for ($i = 0; $i -lt 20; $i++) {
            Start-Sleep -Milliseconds 500
            if (-not (Get-Listener -Port $Port)) { break }
        }
    }
}

function Start-ServiceProcess {
    param([string]$TunnelHost)
    $hosts = @()
    if ($TunnelHost) { $hosts += $TunnelHost }
    $env:PLANLAB_ENGINE_ROOT = $engineRoot
    $env:PLANLAB_PYTHON = $python
    $env:PLANLAB_STATIC_DIR = Join-Path $root "dist"
    $env:PLANLAB_ALLOWED_HOSTS = ($hosts -join ",")
    $env:PLANLAB_DEV_ORIGINS = "http://127.0.0.1:5173,http://localhost:5173,$vercelOrigin"
    Start-Process -FilePath $python `
        -ArgumentList (Join-Path $root "scripts/run-service.py") `
        -WorkingDirectory $root -WindowStyle Hidden `
        -RedirectStandardOutput $serviceOut -RedirectStandardError $serviceErr | Out-Null
    Write-State "started service with allowed hosts '$($hosts -join ",")'"
}

function Sync-VercelApiBase {
    param([string]$ApiBase)
    Push-Location $root
    try {
        $env:CI = "1"
        $log = Join-Path $logDir "vercel-sync.log"
        & npx --yes vercel@latest env add VITE_PLANLAB_API_BASE production --value $ApiBase --force --yes *> $log
        $envExit = $LASTEXITCODE
        & npx --yes vercel@latest --prod --yes *>> $log
        $deployExit = $LASTEXITCODE
        # The CLI prints progress with unicode status glyphs, so trust the exit
        # codes: a failed deploy exits non-zero.
        if ($deployExit -eq 0) {
            Write-State "repointed Vercel at $ApiBase (env exit $envExit, deploy exit $deployExit)"
            return $true
        }
        Write-State "Vercel sync failed (env exit $envExit, deploy exit $deployExit); see $log"
        return $false
    } finally {
        Pop-Location
    }
}

Write-State "supervisor starting (port $Port, poll ${PollSeconds}s)"

$serviceHost = ""
$tunnelStartedAt = Get-Date
$syncAttempts = 0
$lastSyncAttempt = Get-Date

while ($true) {
    $tunnel = Get-Process -Name cloudflared -ErrorAction SilentlyContinue
    if (-not $tunnel) {
        Start-TunnelProcess
        $tunnelStartedAt = Get-Date
        Start-Sleep -Seconds 8
    }

    $url = Get-TunnelUrl
    if (-not $url -and ((Get-Date) - $tunnelStartedAt).TotalSeconds -gt 45) {
        Write-State "tunnel produced no URL within 45s; restarting it"
        Stop-TunnelProcess
        Start-TunnelProcess
        $tunnelStartedAt = Get-Date
        Start-Sleep -Seconds 8
        $url = Get-TunnelUrl
    }

    if ($url) {
        if (-not (Test-Path $urlFile) -or ((Get-Content $urlFile -Raw).Trim() -ne $url)) {
            Set-Content -Path $urlFile -Value $url
            Write-State "public URL is $url"
        }
    }

    $tunnelHost = ""
    if ($url) {
        try { $tunnelHost = ([uri]$url).Host } catch { $tunnelHost = "" }
    }

    $listener = Get-Listener -Port $Port
    if ($tunnelHost -and ($tunnelHost -ne $serviceHost)) {
        if ($listener) { Stop-ServiceProcess }
        Start-ServiceProcess -TunnelHost $tunnelHost
        $serviceHost = $tunnelHost
        Start-Sleep -Seconds 12
    } elseif (-not $listener) {
        Start-ServiceProcess -TunnelHost $serviceHost
        Start-Sleep -Seconds 12
    }

    if ($url -and -not $NoVercelSync) {
        $synced = if (Test-Path $syncedFile) { (Get-Content $syncedFile -Raw).Trim() } else { "" }
        if ($url -ne $synced) {
            if ($syncAttempts -ge 3 -and ((Get-Date) - $lastSyncAttempt).TotalMinutes -lt 30) {
                # three failures already: wait half an hour before trying again
            } else {
                $syncAttempts += 1
                $lastSyncAttempt = Get-Date
                if (Sync-VercelApiBase -ApiBase $url) {
                    Set-Content -Path $syncedFile -Value $url
                    $syncAttempts = 0
                }
            }
        }
    }

    Start-Sleep -Seconds $PollSeconds
}
