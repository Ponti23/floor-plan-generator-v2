---
title: Public access to the exact engine
tags: [operations, deployment, tunnel]
---

# Public access to the exact engine

The exact engine page (`engine.html`) needs the Python model service: PyTorch
topology model + OR-Tools CP-SAT. A static host cannot run that, so the page and
the service live in two places.

| Piece | Where | Notes |
|---|---|---|
| Exact engine page, concept page | Vercel project `ponti23s-projects/floor-plan-generator-v2` | `https://floor-plan-generator-v2.vercel.app/engine.html`; built from `main` of `Ponti23/floor-plan-generator-v2` |
| Model service | This machine, `127.0.0.1:8010`, release mode (serves `dist/` too) | Checkpoint `topology_v1/checkpoints/full_v1a/best`, OR-Tools 9.15 |
| Public route to the service | Cloudflare quick tunnel (`cloudflared`, no account) | URL changes whenever the tunnel restarts |
| Supervisor | `scripts/start-public.ps1` | Restarts the service and tunnel, repoints Vercel when the tunnel URL changes |

The Vercel build bakes the tunnel URL in through `VITE_PLANLAB_API_BASE`, so the
page on Vercel calls the model service on this machine. The tunnel also serves
the whole app on one origin, which is a second working link.

## Start it

```powershell
pwsh -NoProfile -File scripts/start-public.ps1
```

It writes state to `.runtime/public/`:

- `url.txt` — the current public URL
- `state.txt` — what the supervisor did, newest last
- `logs/` — `cloudflared.*.log`, `service.*.log`, `vercel-sync.log`

## Verify it

```powershell
# the tunnel, page and API on one origin
node scripts/verify-public-engine.mjs --url (Get-Content .runtime/public/url.txt -Raw).Trim()

# the Vercel page calling the tunnelled service
node scripts/verify-public-engine.mjs --url https://floor-plan-generator-v2.vercel.app `
  --api-base (Get-Content .runtime/public/url.txt -Raw).Trim()
```

Both run real generation in headless Chrome and exit non-zero on any failure.

## Stop it

```powershell
Get-Process pwsh | Where-Object { $_.Id -ne $PID } | Stop-Process -Force   # supervisor (careful: kills other pwsh)
Get-Process cloudflared | Stop-Process -Force
Get-NetTCPConnection -LocalPort 8010 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

Kill the supervisor first, or it restarts what you just stopped.

## Service configuration this uses

These are read at service start (`services/generation/planlab_service/config.py`):

- `PLANLAB_ALLOWED_HOSTS` — the tunnel hostname. The service answers only loopback
  hosts plus this list, so the tunnel must be named here.
- `PLANLAB_DEV_ORIGINS` — extra allowed `Origin` values; the Vercel origin is added.
  The tunnel host is accepted as an origin automatically, because Vite's module
  scripts are fetched with `crossorigin` and therefore carry an `Origin` header.
- `PLANLAB_STATIC_DIR` — `dist/`, served by the same process (release mode).

## Limits worth knowing

- The service is loopback-only; it is reachable from outside solely through the
  tunnel, and only for the allowlisted hostname.
- One generation job at a time, 360 s active-job deadline, eight solver workers.
- Quick tunnels have no uptime guarantee and the URL changes on restart. The
  supervisor repoints Vercel when that happens, so the Vercel link is the stable
  one to share.
- Everything stops if this machine sleeps, shuts down, or loses its network.
