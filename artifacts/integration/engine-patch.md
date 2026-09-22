# Engine patch record — geometry_engine_v1+integration.1 (S02)

Recorded 2026-09-23, Australia/Perth. Companion to `ASTRA_IMPLEMENTATION_MASTER_PLAN.md` S02.

## Why the engine had to change

The integration cannot advertise inputs the solver ignores or makes impossible. Two defects were confirmed with failing regressions **before** any engine edit.

Baseline contradiction, measured with the pre-patch `ge_layout_model.py` (`b652c7ff…`) restored byte-exact from `artifacts/integration/engine-before/` and the new regression file:

| Regression | Baseline result | Cause |
|---|---|---|
| Demo E with the optional study forced absent | `AssertionError: INFEASIBLE` | An absent room was pinned to `w = h = 1` at the envelope origin while `area = w × h` and `area = 0` were both asserted, so **no optional room could ever be absent**. Zone, no-overlap, corridor-overlap, access and relationship constraints were also ungated for absent rooms. |
| Demo E with an optional study larger than the envelope (400 m² min in a 129 m² envelope) | `AssertionError: INFEASIBLE` | Same contradiction, so the solver could not drop the impossible room. |
| Demo B with `min_width_mm = 4400`, `min_height_mm = 3400`, `min_short_side_mm = 3200` | `AssertionError: 4080 not greater than or equal to 4400 : B1 width` | The model enforced only the minimum *short side*; the resolved brief's per-axis minima were never applied. |

The pre-patch engine also could not report the axis minima, because the emitted room record did not carry them.

## What changed

Only two files changed. `ge_circulation.py` was inspected but is **unchanged**: `ge_circulation.py:67/195/265`, `ge_walls.py:47` and `ge_engine.py:107` already filter on `present`, so no reproduced absent-room defect needed a patch there.

| File | Before | After |
|---|---|---|
| `geometry_engine_v1/ge_layout_model.py` | `b652c7ffbe71b30bbaa74020ce8413c51c5bf58a6d11fc036b1b268f179f8a8e` | `cd3536838239def22dfe770a93e6e8b4e5329f3b10477e73e1ed2883bca6cfe4` |
| `geometry_engine_v1/ge_validator.py` | `b9cc31274dc1402dd243d1588716e25b696ee03560cab41d1bf8f83331bfc07c` | `1e3663ba3c8752cc5d7a01f8859b859568cc0b79093c618b17e828678e017fe1` |

New file: `geometry_engine_v1/test_integration_constraints.py` (`d8abbb084966e6d985b5012b7ac465094970a3ebc076ad4cb28c6a7c364be5c3`).

### `ge_layout_model.py`

1. **Zero-extent absence.** `w`/`h` domains start at 0 (they were `1..W`), and the area variable starts at 0. An absent room is exactly `w = h = area = 0` at the canonical envelope origin, so it cannot overlap, touch, block or borrow space. This is what makes absence satisfiable at all.
2. **Presence-gated constraints.** A new `all_present(*rooms)` helper builds the "every listed room is present" literal (returning `None` when all are required, so the all-required formulation is unchanged). It gates: no-overlap between two rooms, room-versus-corridor overlap, the zone side constraints, hard/direct relationship contact (`t` is forced to 1, i.e. no violation, when either endpoint is absent), preferred-adjacency rewards, and soft zoning penalties.
3. **Access.** The "either touch the corridor or reach it through a non-private room" disjunction is now enforced only while the room is present, and the access violation term counts only present rooms.
4. **Authored axis minima.** `min_width_mm` and `min_height_mm` are enforced in addition to the short side, on the world axes. The emitted room record now carries both values.

### `ge_validator.py`

V04 now checks the short-side minimum **and** the authored per-axis minima, read from the original resolved brief (`brief["rooms"]`) rather than from the solver's own reported numbers. No check was deleted or renumbered: the validator still emits V01–V20 and the layout fixture still reports 20/20.

## Verification

`geometry_engine_v1/test_integration_constraints.py` — 8 tests, 162 s, all pass:

* forced absence of demo E's optional study is feasible, the study has zero geometry at the canonical origin, and every required room is present;
* an optional study larger than the envelope is dropped rather than fatal;
* two optional rooms can both be absent;
* an absent room does not violate a hard relationship that names it;
* an optional room that fits is still kept;
* authored axis minima hold on the world axes (including an asymmetric 5000 × 3200 case);
* an all-required programme (demo B) is unaffected and keeps zero feasibility violations.

The same three diagnostic regressions were re-run against the restored pre-patch file and failed exactly as tabulated above; the patched file was then restored and its hash re-checked.

Protected-source integrity (`artifacts/integration/engine-after-sha256.json`): of the 89 hashed protected entries, exactly **2 changed** (the two files above) and **87 are byte-identical** to the S00 manifest, with **0 missing**. Datasets, training code, model code, checkpoint, manifests, demo briefs and `ge_circulation.py` are untouched.

### Golden demos at the original budget

Runner: `.tmp/run_engine_after_demos.py`, `top_k = 5`, `top_n = 3`, `time_limit_s = 30`, `render = False`. Artifacts: `artifacts/integration/engine-after/demo_results.json`.

| Demo | Candidates | Layouts | Validated | Structured solver statuses | Elapsed | Checks |
|---|---|---|---|---|---|---|
| A | 3 | 3 | 3 | FEASIBLE, OPTIMAL | 73.3 s | 20/20 each |
| B | 5 | 3 | 3 | FEASIBLE | 151.3 s | 20/20 each |
| C | 5 | 3 | 3 | FEASIBLE, OPTIMAL | 151.0 s | 20/20 each |
| D | 5 | 0 | 0 | INFEASIBLE | 0.7 s | — |
| E | 5 | 3 | 3 | FEASIBLE | 150.8 s | 20/20 each |

Acceptance: A/B/C/E each return at least one validated layout; D returns no layout with a structured `INFEASIBLE` status (never an architectural verdict inferred from prose) and no `UNKNOWN` masquerading as infeasible.

Comparison with the historical `evaluations/demo_summary.json` (A 3/3 70.8 s, B 5/5 151.0 s, C 5/5 151.1 s, D 0/0 0.6 s, E 5/5 150.7 s): timings and validation are unchanged within noise, and D's structured status matches. The layout-count difference for B/C/E is the runner's `top_n = 3` (the product's published ceiling) versus the historical runner's `top_n = max(3, top_k) = 5`; it is a reporting choice, not a regression. `compare_old_new.py` was therefore not re-run: no edge or relationship behaviour changed for an all-required programme.

Demo E's default run keeps the study in all three layouts (10 rooms present, nothing omitted), which is correct: the study fits, and absence carries its own cost. The absence path itself is proven by the forced-absence and oversize-study regressions above.

## Caveats carried forward

* The raw engine attempt record for the S01 layout fixture lists `relaxations_applied.hard_adjacency = true` while the layout-level `relaxations_applied` is empty. S03 must reconcile attempt-level relaxation with the product rule that hard requirements stay hard (`max_attempts_per_candidate = 2`).
* The engine still writes its own log to `geometry_engine_v1/logs/session.log`; the service JSONL trace is S10 work.
* Absence is priced through `room_absence_per_mm2`, unchanged by this patch. The product decides optional inclusion policy, not the engine.
* This patch does not prove that every footprint on a site is impossible when D reports INFEASIBLE; that remains a limited-search statement, which is why the public error code for it is `NO_VALID_LAYOUT` with `proof = limited_search`.
