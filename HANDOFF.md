# HANDOFF — PlanLab resume state

**Active plan:** [`DELEGATION-PLAN.md`](./DELEGATION-PLAN.md) · **Live queue:** [`knowledge/BOARD.md`](./knowledge/BOARD.md) · **Planning package:** [`knowledge/planlab/README.md`](./knowledge/planlab/README.md)

**Status:** Stage 0 is complete and approved. Stage 1 is complete (independent domain API review passed 2026-09-14). **Stage 2 (access, rules, and validation) is complete** — all five buckets landed on `main` and the independent review (2.5) passed on 2026-09-14 with three access-layer defects fixed. **Stage 3 (generator, metrics, scoring, and diversity) is active**; bucket 3.1 is complete and bucket 3.2 is the next dispatch.

## Last checkpoint

- Bucket 3.1 landed as `6089c48` (`feat: pin PlanLab metric formulas and validity gates`). The five
  metric categories now use named, versioned breakpoints; utility helpers pin their bounds and
  documented monotonic behavior; planning efficiency and allocation ratio are distinct formulas
  with garage excluded from the habitable comparison; and stale validation results cannot preserve
  a PASS after geometry changes. Diagnostics expose the separate ratios without compliance
  language. Verification: `npm test` **105 passing**; `npm run typecheck` 0 errors;
  `npm run diagnostics:canonical -- --check` clean. The intentional metrics-version update changed
  the canonical project fingerprint to
  `sha256:b8f11f6232fbc26b15a49b610c391b62dffb4b002a2e57935bc74d70d44dbf03`.

- Bucket 2.5 landed as `ded4d73` (`test: add Milestone 2 independent validation review`), closing
  Stage 2. The review (evidence: `artifacts/planlab/milestone-2/validation-review.md`) used
  differential validation against the frozen Stage 1 implementation rather than reading alone:
  15 deliberately broken layouts keep their verdict and violation set, `serializeCanonical(GenerationResult)`
  is byte-identical from `9a24738` through this commit, and the domain stays framework-free and
  deterministic. It fixed three access-layer defects of the same class — the graph and the validator
  disagreeing about one portal — all of which pre-dated Stage 2 (verified at `e1c6f38`):
  1. an unsupported portal `kind` created a traversable edge while validation reported
     `PORTAL_KIND_INVALID`;  2. a repeated portal id added a second route while validation reported
     `DUPLICATE_PORTAL_ID`;  3. a malformed candidate (missing `portals`/`spaces`) threw a
     `TypeError` out of the access helpers instead of being reported invalid — a crash could take
     down a generation run or, later, a worker. It also aligned `src/domain/generator.ts` onto the
     shared `isTransitNode` policy so the constructor can no longer explore corridors validation
     forbids (output byte-identical). Verification: `npm test` **102 passing**; `npm run typecheck`
     0 errors; canonical fingerprint unchanged.

- Bucket 2.4 landed as `f93ddd3` (`feat: implement PlanLab relationship aggregation and hard rules`).
  `mustShareWall` is now aggregation-aware instead of implicitly `any`: `any` needs one qualifying
  expanded pair, `all` needs every pair (and an empty expansion is **not** vacuously satisfied),
  and the distance aggregations `nearest`/`average` are reported through a new
  `RELATIONSHIP_AGGREGATION_UNSUPPORTED` definition rather than silently read as `any` — one defect,
  one finding. Wall contact is exact shared-edge length from the facts index (corner contact and
  sub-threshold contact never satisfy it), garage south frontage / 6 m preset / vehicle portal and
  the project circulation-width setting are pinned by tests, and a multi-defect layout is asserted
  to report every finding deterministically in pipeline order. `test/relationship-rules.test.ts`
  adds 8 tests; the pipeline-order test in `test/rule-registry.test.ts` moves 32 → 33 definitions.
  Verification: `npm test` **99 passing**; `npm run typecheck` 0 errors; canonical fingerprint
  unchanged; and `serializeCanonical(GenerationResult)` for the canonical seed is byte-identical to
  `2a4f216`, so 2.4 moved no output. Both new behaviours were checked for teeth by temporarily
  restoring implicit-`any` (the tests failed as expected) and the mutation was reverted.

- Bucket 2.3 landed as `2a4f216` (`feat: add PlanLab rule registry and ordered validator`).
  `src/domain/rules.ts` now holds the typed evaluator registry: one immutable `planlab-core`
  definition per violation code, hard rule instances carrying `enforcement`, `source`, validated
  `parameters`, and `scope`, evaluated in the eight-stage `RULE_ENGINE.md` pipeline order; an
  unknown definition id or version mismatch evaluates to `unsupported` and fails, never passes.
  Portal geometry/graph/transit policy moved to `src/domain/portalGraph.ts` (no import cycle), and
  `validation.ts` is now a façade that builds one `RuleContext` and projects fail evaluations onto
  the unchanged `ValidationResult` shape (violations additionally carry `geometryEvidence`).
  Orchestrator review (2.3 is Terra-authored, so the author was not the reviewer): 15 deliberately
  broken layouts were validated on `e1c6f38` and on this commit and compared field by field — every
  case keeps the same valid/invalid verdict and the same violation set. Three documented deltas:
  (a) violation order now follows the documented pipeline instead of the old inline order (6/15
  cases reordered, sets identical); (b) `ruleId` separators changed from underscores to kebab-case
  (`planlab-core.portal-not-on-shared-edge`); nothing in the repo consumes the old format (checked);
  (c) some violations gained additive fields (`expected`/`actual`, a layout subject) and a
  duplicate-space-id fixture now additionally reports the reachability consequences, which is the
  "return all safe-to-compute violations" rule. Verification: `npm test` **91 passing**;
  `npm run typecheck` 0 errors; canonical fingerprint unchanged; and a full
  `serializeCanonical(GenerationResult)` for the canonical seed is byte-identical between `9a24738`
  (bucket 2.1) and this commit, so buckets 2.2 and 2.3 introduced no serialization drift.

### Stage 0 benchmark reproduction — accepted drift from bucket 2.1

Verified independently (scratch worktrees at `e1c6f38` and `9a24738`, same machine):

- `e1c6f38` (end of Stage 1) reproduces all ten recorded per-seed `outputHash` values byte-for-byte.
- `9a24738` (bucket 2.1) does **not**: all ten hashes change. The cause is the enriched derived-facts
  evidence (`factsVersion` 0.4 → 0.5 plus the new `overlaps` / `sharedWallIntervals` /
  `sharedWallIndex` / `exteriorContacts` / `exteriorContactIndex` fields) being part of the
  serialized `GenerationResult`.
- The generated **layouts** and the **selected triplet** are byte-identical between `e1c6f38` and
  `9a24738`, so layout and selection semantics are unchanged; only the derived evidence payload
  moved (and grew the canonical result from ~256 MB to ~342 MB for the canonical seed).

Consequence: the recorded Milestone 0 benchmark hashes are historical evidence, not a live gate —
`e1c6f38` is the last commit that reproduces them. This needs a decision (not a hard gate): either
accept it as intended evidence evolution, or stop serializing the derived indexes so the canonical
result stays byte-stable and the Stage 0 benchmark keeps reproducing. The payload size also matters
for the Milestone 4 worker protocol. Raised for bucket 2.5 and for the user.

- Bucket 2.2 landed as `7f87add` (`fix: harden PlanLab portal geometry and access graph`).
  Two real defects closed: (a) `buildPortalGraph` added an edge for *any* portal whose
  endpoints resolved, so reachability could be established through a portal `validateLayout`
  simultaneously rejected — the graph now filters through the new exported `portalSpanValid`,
  which is the single predicate the validator's own portal step calls, and `reachableSpaceIds(layout)`
  resolves a bare layout through the pedestrian graph (vehicle frontage proves frontage, never a
  route); (b) `isTransitNode` granted transit rights to any room whose traits said so, so a private
  bedroom tagged `mayBePassThrough` could act as a corridor — private/service rooms and the
  bedroom/bathroom/garage/laundry/storage kinds are now never transit nodes, while living/dining/
  kitchen join the through-route only when the brief explicitly opts in. Verification: `npm test`
  **84 passing** (77 + 7 new in `test/portal-access.test.ts`); `npm run typecheck` 0 errors;
  canonical fingerprint unchanged. Both new test groups were checked for teeth by temporarily
  restoring the old behaviour (each failed as expected), and the mutation was reverted.
- Bucket 2.1 landed as `9a24738` (`refactor: add PlanLab layout facts pass and edge indexes`).
  `src/domain/facts.ts` now computes one immutable geometry index per candidate — per-space
  coverage, pairwise overlaps with clipped rects, shared-wall intervals plus a `a|b` pair index,
  footprint-boundary and exposed exterior contact per space per side, and unallocated interior
  area — and `metrics.ts` / `validation.ts` consume it instead of rescanning pairs. New
  `test/layout-facts.test.ts` covers hand-checked cases and an **occupancy-grid oracle** property
  test over 60 generated layouts that shares no code with `geometry.ts` (verified to have teeth by
  a temporary mutation of the shared-wall scan, which it caught). Verification: `npm test` 77
  passing; `npm run typecheck` 0 errors; `npm run diagnostics:canonical -- --check` clean with the
  fingerprint unchanged at `sha256:95d89f35db8b7eea5bc52196cb70f49a8885cf37bbdde5a82a5caff50cbc061d`.
- Bucket 1.4 passed and landed as `e1c6f38` (`fix: resolve Stage 1 review findings in domain APIs`) plus `19916f1` (`build: add TypeScript typecheck gate and node typings`). Review evidence: [`artifacts/planlab/milestone-1/domain-api-review.md`](./artifacts/planlab/milestone-1/domain-api-review.md).
- Four Stage 1 findings fixed:
  1. Normalization collapsed typed `RoomSelector` objects to strings and accepted an undocumented `"group"` variant. Object selectors are now preserved in normalized relationships, `"group"` is removed, and unresolved-selector checks are intent-aware (an instance selector no longer silently retargets to a colliding requirement id). Two new tests pin preservation and the no-retarget rule.
  2. The domain package could not typecheck. `NO_VALID_CANDIDATES` joined the `GenerationDiagnostic` union, `METRIC_CONFIG` received an explicit `number`-typed interface (fixing the `TS2394` overload error and the literal-`12` call sites), and `typescript`/`@types/node` dev dependencies plus a `npm run typecheck` script were added. All fixes are type-level; runtime behaviour is unchanged.
  3. Hardcoded metre conversions (`/ 0.25`, `GRID_MM / 1_000`) in `metrics.ts`/`validation.ts` now use `GRID_UNIT_METRES` (identical value, one named source).
  4. `unionArea` gained the same exact-range accumulation guard as `overlapArea`.
- Verification: `npm run typecheck` reports **0 errors** (was 22 pre-existing); `node --test` reports **70 passing** (was 68); `npm run diagnostics:canonical -- --check` is up to date with the canonical fingerprint unchanged at `sha256:95d89f35db8b7eea5bc52196cb70f49a8885cf37bbdde5a82a5caff50cbc061d`; a scratch-copy Stage 0 benchmark passes all gates and reproduces all ten recorded per-seed `outputHash`/`replayHash` values byte-for-byte, so Stage 1 preserved Stage 0 output semantics bit-for-bit.
- Working tree is clean; `main` is 26 commits ahead of `origin/main` and nothing is pushed. The disposable scratch copies under `%TEMP%\fp-bench-*` / `%TEMP%\fp-review-*` have been removed by the orchestrator.

## Next step

1. Execute Stage 3 in plan order. Bucket 3.2 (strategy profiles and the calibration surface,
   `luna-max`) is the next dispatch.
2. Stage 3's definition of done is the architect usefulness/scoring-language **hard gate** — it
   stops for the user and is never merged solo.
3. The Stage 0 benchmark evidence decision below is waiting on the user; it is not a blocker for
   Stage 3, but it should be settled before the Milestone 4 worker protocol fixes message payloads
   (bucket 3.4 records its mechanical consequence).
3. Orchestrator note for future stages: every dispatched executor in Stage 2 stalled at least once
   by reporting status and asking for authorization instead of implementing, and two spawned nested
   helpers. Four of the five buckets were finished by the orchestrator. Executor briefs must state
   "do the work now, do not ask, do not spawn sub-agents" — and a stalled executor should be
   interrupted and the bucket done directly rather than re-dispatched a third time.

## Open findings

- None outstanding. The former 1.4 findings (typecheck errors, selector coercion) are closed in this checkpoint.
- **Waiting on the user (decision, not a blocker):** the Stage 0 benchmark hashes no longer
  reproduce after bucket 2.1 (derived-facts evidence is serialized into `GenerationResult`;
  layouts and selections are byte-identical). Either accept the evidence evolution or stop
  serializing the derived indexes so the canonical result stays byte-stable. The 342 MB canonical
  result also bears on the Milestone 4 worker protocol. Full detail in the checkpoint note above
  and in `artifacts/planlab/milestone-2/validation-review.md`.
- `INSTANCES_BY_PROJECT` in `rules.ts` caches rule instances per project object identity; a caller
  that mutates a normalized project in place would keep stale parameters. No caller does this
  today; revisit when the project document becomes editable (Milestone 6).

## Constraints

- Milestone 0 remains the accepted mathematical feasibility baseline; Stage 1 preserved its approved semantics bit-for-bit.
- Stage 1 was production domain/geometry work only; no product application scaffolding or polished UI is in scope.
- Approved assumptions are recorded in `DELEGATION-PLAN.md`.
- The architect usefulness gate is cleared; future money/payment and product/UX/copy decisions remain human hard gates.
