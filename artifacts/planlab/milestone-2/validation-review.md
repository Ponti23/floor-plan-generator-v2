# Stage 2 — independent validation-stack review (bucket 2.5)

Reviewer: Sol@Max (orchestrator) · 2026-09-14 · target: `main` `22ec47d`
(Stage 2 head at review start; fixes recorded at the end of this document)

## Scope

Independent review of the Stage 2 hardening work, i.e. the whole authoritative
hard-validity stack:

| Bucket | Commit | Surface |
|---|---|---|
| 2.1 | `9a24738` | `src/domain/facts.ts` + consumer rewiring in `metrics.ts` / `validation.ts` |
| 2.2 | `7f87add` | portal geometry, access graph, transit policy |
| 2.3 | `2a4f216` | `src/domain/rules.ts`, `src/domain/portalGraph.ts`, `validation.ts` façade |
| 2.4 | `f93ddd3` | relationship aggregation, garage and circulation hard rules |

Against `knowledge/planlab/RULE_ENGINE.md` (rule model, evaluation results, hard
rules, validation pipeline, circulation policy), `DATA_MODEL.md` (`LayoutFacts`,
area definitions), `COORDINATE_SYSTEM.md`, and the Milestone 2 acceptance
criteria in `IMPLEMENTATION_PLAN.md`.

Independence note: buckets 2.1, 2.2 and 2.4 were executed by the orchestrator
after dispatched executors stalled, so this review leans on **differential
evidence against frozen prior commits** rather than on reading alone. Where the
orchestrator is also the author, the oracle is the previous implementation
(`e1c6f38`, end of Stage 1) run in a scratch worktree, not the author's own
reasoning.

## Method

1. Re-run the full suite, typecheck and canonical diagnostics on the review
   target.
2. Differential validation: 15 deliberately broken layouts (bad portal wall,
   short portal, removed portal, overlapping spaces, duplicate space id, space
   outside the footprint, invalid role, undersized room, unsupported schema
   version, footprint over the GFA cap, bad entrance id, unknown portal space,
   coverage cap, unsatisfied relationship, unresolved selector) validated on
   `e1c6f38` and on `2a4f216`, comparing every violation field.
3. Serialization parity: `serializeCanonical(GenerationResult)` compared
   commit-to-commit for the canonical seeds.
4. Adversarial probes of the access layer (malformed layouts, unsupported
   portal kinds, repeated portal ids), each checked against `e1c6f38` to
   attribute the finding correctly.
5. Purity and determinism greps over `src/domain/`.

## Verified clean (no action)

- **No verdict drift.** On all 15 broken layouts the valid/invalid verdict and
  the multiset of violations are unchanged from `e1c6f38`. Documented deltas:
  violation *order* now follows the documented eight-stage pipeline (6/15
  cases), `ruleId` separators are kebab-case, and some violations gained
  additive fields (`expected`/`actual`, a layout subject). No consumer in the
  repo depends on the old ruleId spelling (`rg` over the tree).
- **No generation drift through Stage 2.** `serializeCanonical(GenerationResult)`
  is byte-identical across `9a24738` → `2a4f216` → `f93ddd3` → this review's
  fixes (canonical seeds 01 and 04 checked explicitly).
- **Framework coupling and determinism.** No React/browser/storage imports, no
  `Math.random`, no wall-clock or locale use anywhere in `src/domain/`.
- **Facts vs primitives.** The facts pass agrees with an occupancy-grid oracle
  over 60 generated layouts that shares no code with `geometry.ts`
  (`test/layout-facts.test.ts`); the oracle was mutation-checked and caught a
  deliberately broken shared-wall scan.
- **Unsupported evaluators cannot pass.** Unknown definition ids and version
  mismatches produce a failing `RULE_DEFINITION_UNSUPPORTED` evaluation; a
  disabled instance is `notApplicable`, never a pass.
- **Unsupported aggregations cannot pass.** `nearest`/`average` on the hard
  `mustShareWall` rule is reported (`RELATIONSHIP_AGGREGATION_UNSUPPORTED`) and
  is not silently read as `any`; mutation-checked.
- **Exact wall contact.** Corner contact, sub-threshold contact and
  under-threshold portals never satisfy or create a route; boundary cases are
  pinned at exactly the threshold.

## Findings fixed in this review

All three are the same class of defect — the access graph and the validator
disagreeing about the same portal — and all three pre-date Stage 2 (verified at
`e1c6f38`), but they are squarely inside the access-layer contract this
milestone owns.

1. **The graph admitted portals of unsupported kind.** `portalSpanValid` did not
   check `kind`, so `buildPortalGraph(layout)` created a traversable edge for a
   portal the validator simultaneously rejected as `PORTAL_KIND_INVALID`.
   Reachability could therefore be established through a portal that is not a
   door. Fixed: kind is now part of the geometry predicate.
2. **Repeated portal ids created a second route.** The validator reports
   `DUPLICATE_PORTAL_ID` and keeps the first occurrence; the graph added an edge
   per occurrence. Fixed: the graph keeps the first occurrence too, so the two
   agree.
3. **A malformed candidate crashed the access helpers.** `buildPortalGraph`
   iterated `layout.portals` and `layout.spaces` unguarded, so a candidate
   missing either field threw `TypeError: layout.portals is not iterable`
   instead of being reported invalid — one bad candidate could take down a
   generation run (and, later, a worker) rather than be rejected. Fixed:
   degraded inputs yield an empty graph and the validator still produces
   findings.

Also aligned in this review: `src/domain/generator.ts` had its own
`mayBePassThrough || hallway` transit helper, the looser pre-2.2 rule. The
constructor now delegates to the shared `isTransitNode`, so search and
validation cannot disagree about which rooms may be corridors. Output is
byte-identical on the canonical seeds.

## Open findings (not fixed here — decisions or later-milestone scope)

1. **Stage 0 benchmark evidence no longer reproduces** (recorded in
   `HANDOFF.md`). Bucket 2.1 added the derived index fields to the serialized
   `GenerationResult`, so the ten recorded per-seed `outputHash` values change;
   `e1c6f38` is the last commit that reproduces them. Layouts and selected
   triplets are byte-identical throughout, so this is an evidence-shape change
   rather than a semantics change. Two options: accept the evolution, or stop
   serializing derived indexes so the canonical result stays byte-stable. The
   payload also grew ~256 MB → ~342 MB, which matters for the Milestone 4 worker
   protocol. **Decision required from the user; not a defect to fix solo.**
2. **`INSTANCES_BY_PROJECT` is a `WeakMap` keyed by project object identity.**
   Reusing the same normalized project object is fast and correct, but a caller
   that mutates a project in place (rather than cloning) would keep stale rule
   parameters. No current caller does this; worth a defensive note when the
   project document becomes editable (Milestone 6).
3. **Soft rules are still unmodelled.** `RuleEnforcement` and the evaluation
   statuses support `soft`/`warning`, but every built-in instance is `hard`.
   That is Milestone 3 scope (`SCORING_SYSTEM.md`), not a Stage 2 gap.

## Verification

- `npm test` → **102 passing, 0 failing** (99 before this review's four
  regression tests).
- `npm run typecheck` → 0 errors.
- `npm run diagnostics:canonical -- --check` → clean; canonical fingerprint
  unchanged at
  `sha256:95d89f35db8b7eea5bc52196cb70f49a8885cf37bbdde5a82a5caff50cbc061d`.
- `serializeCanonical(GenerationResult)` byte-identical to `f93ddd3` for
  `planlab-canonical-01` and `planlab-canonical-04`.

## Verdict

**PASS WITH OPEN FINDINGS.** The Stage 2 hard-validity stack is authoritative:
every defect class the milestone targeted is detected independently, the access
graph can no longer disagree with the validator, unsupported evaluators and
aggregations cannot pass, rule source/version is preserved on every violation,
and no verdict changed. The open findings are an evidence-shape decision for
the user plus two forward-looking notes for later milestones.
