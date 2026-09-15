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
