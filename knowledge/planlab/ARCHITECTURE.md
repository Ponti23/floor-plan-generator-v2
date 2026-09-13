# PlanLab Recommended MVP Architecture

## Decision summary

Use a static-capable Next.js + React + TypeScript application. Keep the domain and solver as framework-independent TypeScript modules. Run bounded generation in a Web Worker. Render selected immutable layout results in SVG. Persist the small project document in versioned `localStorage`; no backend or IndexedDB is needed for MVP.

## System boundary

```text
React workspace
  ├─ project form state ── autosave ── localStorage adapter
  ├─ generation controller ── messages ── solver Web Worker
  └─ selected result ── SVG projection + analysis panels

Solver worker
  normalize → derive constraints → construct/search → validate
            → compute metrics → score profiles → deduplicate/select
```

The UI owns editing, presentation, and orchestration. The worker owns generation. Pure domain modules own geometry, rule evaluation, validation, metrics, scoring, and diversity; neither React nor browser storage imports into them.

## Recommended module boundaries

```text
src/
  app/                       # routes and global shell only
  features/
    project/                 # editor state and commands
    site/                    # site/offset form
    program/                 # rooms and relationships form
    generation/              # worker controller/progress/cancel
    results/                 # option selection and analysis
    plan-view/               # SVG projection and interactions
  domain/
    model/                   # project, room, layout, IDs, units
    geometry/                # integer rectangles and edge intervals
    rules/                   # definitions, instances, evaluator registry
    validation/              # hard pipeline and violations
    metrics/                 # one canonical measurement pass
    scoring/                 # normalization, profiles, explanations
    solver/                  # topology, beam search, mutations, selection
    fixtures/                # canonical project
  infrastructure/
    storage/                 # versioned localStorage repository
    worker/                  # protocol and worker entry point
  test/
```

Prefer domain-oriented names over parallel `lib`, `types`, and `utils` dumping grounds. Types live beside the behaviour that owns them. Cross-domain primitives such as `GridRect` live in `domain/geometry`.

## Data flow and invariants

1. UI draft accepts metres as decimal text and converts committed values to integer millimetres.
2. Normalization validates ranges, conservatively maps the exact millimetre envelope to the 250 mm solver grid, expands quantities, creates stable IDs, and emits an immutable `NormalizedProject`.
3. A project fingerprint hashes canonical normalized input plus solver/rule/scoring versions.
4. The worker generates immutable candidates from `(normalizedProject, seed, budget)`.
5. Hard validation always runs independently after construction, even when the constructor claims validity.
6. A single metrics pass creates evidence used by validators, scorers, explanations, and the UI.
7. Only valid candidates enter scoring and selection.
8. The UI renders worker results but never recalculates authoritative scores.

## Worker protocol

Messages are structured-clone-safe and versioned:

- request: `generate`, normalized project, seed, strategy profiles, budget, protocol version;
- progress: phase, expanded states, valid candidates, elapsed time;
- complete: selected layouts, diagnostics, reproducibility metadata;
- failed: typed error and recoverability;
- cancel: request ID.

Cancellation is cooperative, checked every bounded number of search expansions. Results from stale request IDs are ignored.

## Persistence

Persist only the editable project document, UI-safe preferences, selected option ID where still valid, seed, and schema version. Do not persist transient form errors, worker state, candidate pools, progress, derived geometry caches, or huge result histories. The most recent three displayed layouts may be persisted only if product testing proves restore-with-results is valuable; the default is to regenerate.

Use one namespaced key such as `planlab.project.v1`, a debounced save after valid edits, and an immediate flush for lifecycle visibility changes. Parse and validate on load. Migrations are sequential pure functions; failed records are copied to a recovery key and the app starts a new project without overwriting the recovery copy.

IndexedDB is unnecessary while a project is a small JSON document. Reconsider it only for multiple projects, thumbnails, histories, large exports, or offline assets.

## Deployment

No server-side runtime is required for core use. Vercel hosts the Next.js application and worker asset. Avoid server actions, API routes, secrets, and telemetry in MVP. A content-security policy and build-time version stamp are still appropriate.

## Architectural constraints for future AI and rule packs

Future natural-language input may create validated structured project commands; it must not bypass normalization or directly mutate layout coordinates. Future rule packs can register versioned definitions and instantiate rules, but MVP does not load executable code or remote regulations.

## Failure isolation

- Bad draft input stops at normalization.
- Solver timeout/budget exhaustion is an expected typed outcome.
- Worker crashes leave the editor intact and offer retry with the same seed.
- Storage corruption does not affect the in-memory solver.
- Rendering is a projection; SVG failure cannot alter authoritative geometry.
