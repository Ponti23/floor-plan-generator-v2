# BOARD — PlanLab active work

Active design: [`planlab/README.md`](./planlab/README.md) · staged plan: [`../DELEGATION-PLAN.md`](../DELEGATION-PLAN.md) · resume: [`../HANDOFF.md`](../HANDOFF.md)

`Status`: `todo` · `in-progress` · `needs-human` · `blocked` · `review` · `done`

| # | Bucket | Best agent | Owner | Status | Branch |
|---|---|---|---|---|---|
| 0.1 | Domain harness and canonical fixtures | luna-max | luna-max | done | `stage0-planlab-spike` (`4e045d9`) |
| 0.2 | Constructive circulation-aware generator | luna-max | luna-max | done | `stage0-planlab-spike` (`e15d97e`) |
| 0.3 | Metrics, scoring, diversity, diagnostics | luna-max | luna-max | done | `stage0-planlab-spike` (`88f88eb`) |
| 0.4 | Seed-suite feasibility benchmark | luna-max | luna-max | done | `stage0-planlab-spike` (`4d40d48`) |
| 0.5 | Independent technical review | terra-max | terra-max | done | `stage0-planlab-spike` (`605eb88`) |
| 0.6 | Architect usefulness review **(HARD GATE)** | astra-plan | user | done | `stage0-planlab-spike` (GO approved 2026-09-14) |
| 1.1 | Versioned domain schema and brief normalization | luna-max | luna-max | done | `main` (`0e8589b`) |
| 1.2 | Production geometry primitives and property oracles | luna-max | luna-max | done | `main` (`ff99f7c`) |
| 1.3 | Canonical serialization, fingerprinting, and diagnostics | luna-max | luna-max | done | `main` (`113d1d3`) |
| 1.4 | Independent domain API review | terra-max | terra-max | done | `main` (`e1c6f38`) |
| 2.1 | Layout facts pass and edge indexes | luna-max | luna-max | done | `main` (`9a24738`) |
| 2.2 | Portal geometry and access graph hardening | luna-max | luna-max | done | `main` (`7f87add`) |
| 2.3 | Rule definitions, instances, and ordered validator | terra-max | terra-max | done | `main` (`2a4f216`) |
| 2.4 | Relationship, garage, and circulation hard rules | luna-max | luna-max | done | `main` (`f93ddd3`) |
| 2.5 | Independent Milestone 2 review | terra-max | — | todo | `main` |

## Handoff rules

- Claim a bucket before editing and do not take work already owned.
- Each executor verifies and commits its bucket.
- Stage 1 hardens the approved domain semantics and remains isolated from product UI/scaffolding.
- Stage 1 public domain APIs passed independent review (1.4, `e1c6f38`). Stage
  Milestone 2 before beginning product implementation.
- Stage 2 (access, rules, validation) is staged and active. Buckets run in order; 2.3 is
  Terra-authored because it is an integration-heavy refactor, so the orchestrator judges it and
  2.5 provides independent review of the whole stack.
- Hard validity must stay authoritative: unsupported evaluators never pass, and Stage 2 must not
  change Stage 1 canonical fingerprints or verdicts for existing fixtures.
