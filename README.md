# PlanLab — concept layout generator

A browser-only tool that turns a written architectural brief into three conceptually different
floor-plan options, scores them against an explicit model, and shows why. Everything runs on the
user's machine: there is no backend, no account, and no network call.

## What it does

- Edit a brief: site, offsets, area policy, rooms with dimension policy, relationships, and planning
  assumptions.
- Generate up to three **distinct** options — Compact Efficiency, Best Flow, Balanced — each scored by
  the same five-category model, with raw metrics, category scores, rule checks (PASS / WARNING / FAIL)
  and observations that can highlight the geometry they refer to.
- The brief and the layouts are saved in the browser, so a refresh keeps your work and your options.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

```bash
npm test             # 197 tests
npm run typecheck
npm run build        # static bundle in dist/
npm run preview      # serve the production build
```

`npm run diagnostics:canonical -- --check` verifies the canonical domain output is unchanged, and
`npm run benchmark:stage0:check` runs the Stage 0 gate (layout validity, determinism, diversity,
expansion budget, timing) against a recorded baseline.

## Deploy

Static hosting. Vercel is configured in `vercel.json` (framework `vite`, build `npm run build`,
output `dist`); the same bundle works on any static host. There is no server runtime and no secret.

## Limitations — read before using

**Conceptual layout only — verify dimensions, regulations, and construction requirements before use.**

The generated plans are conceptual studies, not construction documents. The app deliberately makes no
claim of:

- compliance, certification, or approval (building code, planning, council, permit);
- construction-document, tender, or cost suitability;
- accessibility or wheelchair compliance;
- being "architect-approved", "guaranteed", "optimal", or "buildable";
- a metric or category score being a regulatory assessment.

Scores are a calibrated opinion about the brief you typed. They order options; they do not certify
them. The plan carries no furniture, windows, door swings, or services, because none of that is
authoritative data in this build.

Other limits:

- one project at a time, stored in this browser only (clearing site data deletes it);
- the brief and the last generation are saved; the wider candidate pool is not;
- desktop-first layout; a narrow window is usable but not a polished mobile editor;
- the centre viewport shows what the solver placed. If a brief cannot be satisfied, the app says so
  rather than showing an approximation.

## How it is built

| Layer | Where | Notes |
|---|---|---|
| Domain (geometry, rules, metrics, scoring, generator) | `src/domain/` | Pure, deterministic, no DOM. Canonical serialization and fingerprints make regressions visible. |
| Worker protocol + controller | `src/worker/` | Generation runs off the main thread with cancellation, monotonic progress, stale-response rejection and a watchdog. |
| Workspace | `src/app/` | Three panes, SVG projection, viewport, local storage. No framework. |
| Evidence | `artifacts/planlab/` | Per-bucket records, benchmark baselines, screenshots, review findings. |
| Planning | `knowledge/planlab/` | Product spec, UI architecture, scoring system, test strategy, delegation plan. |

The frontend is vanilla TypeScript plus native SVG and CSS on purpose: semantic HTML keeps the
workspace accessible and the mockup fidelity is achieved through hierarchy and palette rather than a
component library.

## Working on it

- `AGENTS.md` — operating rules, and where operating memory lives.
- `knowledge/PROGRESS.md` — resume point; read this first.
- `knowledge/BOARD.md` — the work queue, bucket by bucket.
- `DELEGATION-PLAN.md` — the staged build plan.
- `scripts/capture-ui.mjs` — headless-Chrome screenshot and DOM-digest harness used for the
  visual-fidelity loop:

  ```bash
  npm run dev -- --host 127.0.0.1 --port 5173 &
  node scripts/capture-ui.mjs --out artifacts/planlab/milestone-6/check.png
  ```
# PlanLab generation service (draft run instructions — verified locally)

The integration work lives on the `integration/planlab-engine-mvp` branch. There are two
services: the existing Vite frontend and a new local Python generation service that runs the
real Topology Model v1 and Geometry Engine v1 behind a single-origin HTTP API.

## Development

```powershell
# terminal 1 — prepare the service overlay once, then run the API + warm worker on 8010
pwsh -NoProfile -File scripts/start-generation.ps1 -Setup

# terminal 2 — Vite on 5173 with /api proxied to 127.0.0.1:8010
npm run dev
```

## Installed release on this machine

```powershell
npm run build
pwsh -NoProfile -File scripts/start-planlab.ps1      # serves dist + API on http://127.0.0.1:8010
```

`vercel.json` still builds a static preview, but a static bundle cannot run the model: real
generation only works against the local service. There is no public deployment and no API key.

## Configuration

Copy `.env.generation.example` to `.env.generation.local` if your paths differ. The service binds
loopback only, requires `X-PlanLab-Client: 1` on mutations, caps request bodies at 128 KiB, and
refuses a second instance on the same data directory.

## Verification

```powershell
npm test                # 207 frontend tests
npm run typecheck
npm run build
npm run contracts:check # schema + room policy are in sync with the implementation
npm run test:service    # 56 service unit tests
npm run test:service:integration
```

Known limitations: one job at a time, 360 s active-job deadline, straight corridors only,
symbolic openings, and architectural infeasibility reported as a limited search rather than a
proof about every possible footprint.
