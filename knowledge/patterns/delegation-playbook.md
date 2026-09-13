---
title: Delegation Playbook
tags: [pattern, delegation, workflow]
---

# Delegation Playbook

Our default way of splitting work across Astra, Sol, Terra, and Luna. See [[README]] for the index.

## The idea

**Luna@Max is the default executor.** Start every bounded bucket there and escalate only when the
work demonstrates that it needs broader judgment or deeper cross-cutting implementation. Sol@Max
normally holds the plan and judges results. Astra@Max is the senior reasoning tier for architecture,
ambiguity, consequential decisions, and failed escalations. Terra@Max is the stronger execution and
review tier for work that spans systems or requires sustained debugging.

## Roster

- **Sol@Max — default orchestrator:** understand the goal, decompose stages, write tight briefs,
  maintain the board and handoff, judge verification evidence, and merge completed buckets.
- **Astra@Max — architecture and escalation:** resolve ambiguous requirements, design system
  boundaries, judge high-risk changes, break deadlocks, and take over orchestration when Sol is
  uncertain or a bucket fails twice.
- **Luna@Max — default executor:** implement tightly scoped features and fixes, write tests and docs,
  perform repository research, run commands, and verify its own bucket. Maximize this lane.
- **Terra@Max — complex executor and independent reviewer:** handle cross-cutting refactors,
  integration work, difficult debugging, concurrency/state issues, migrations, and security-sensitive
  implementation. Review risky Luna-authored work when independent review is warranted.

## Routing

1. Planning and ordinary judgment → Sol@Max.
2. Architecture, unresolved ambiguity, high-impact tradeoffs, or repeated failure → Astra@Max.
3. Bounded implementation, tests, docs, research, and command work → Luna@Max first.
4. Cross-cutting implementation, integration-heavy changes, difficult debugging, migrations,
   concurrency/state, or security-sensitive work → Terra@Max.
5. Verification → the executor runs relevant checks and reports raw results; the orchestrator judges.
6. Independent review → use a model other than the author. Terra reviews risky Luna work; Sol or
   Astra reviews Terra work. Never send work to Terra merely because it is important—send it when
   its complexity or review independence justifies the escalation.

## The loop (once the human says "go")

Sol briefs → Luna executes and verifies → Sol judges and merges → repeat. Route directly to Terra
when the bucket meets Terra's criteria. Escalate planning or judgment to Astra when architecture,
ambiguity, risk, or repeated failure warrants it. The human is pinged only for a hard gate or a
genuine blocker.

## Hard human gates (always need the human's explicit yes)

- Money / payments (pricing, spending, any paid-provider or secret seam).
- Product / UX / copy decisions (what to build, how it reads).

Tune this list per project in `AGENTS.md`—those are the seams you never merge solo.

## Not hard-gated, handled with extra care

DB migrations / schema changes and auth / security-boundary merges go through the normal
verify-then-merge loop (no blocking human gate), with Terra implementation or review and Astra/Sol
judgment. Run migrations against a local DB plus the full security/DB test suite and merge only when
fully green.

## Related

- [[orchestrator-and-subagents]] — the execution loop these routing rules plug into.
- [[README]] — knowledge base home.
