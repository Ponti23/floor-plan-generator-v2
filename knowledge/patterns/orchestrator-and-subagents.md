---
title: Orchestrator × Executors
tags: [pattern, workflow, codex]
status: in-use
---

# Orchestrator × Executors

Our default way of executing a multi-step plan in Codex. See [[README]] for the index.

## The idea

One **orchestrator** holds the plan and judgment. Sol@Max is the default; Astra@Max takes over for
architecture or escalations. Each step is handed to a **fresh executor**, normally Luna@Max, with a
self-contained prompt. DeepSeek-Flash may take routine, precisely specified work through a verified
provider route. Terra@Max is reserved for complex execution and independent review.

- **Sol@Max = default orchestration.** Plans, briefs, judges, and maintains durable state.
- **Astra@Max = senior orchestration.** Handles architecture, ambiguity, and escalations.
- **Luna@Max = default execution.** Disposable context, one tightly scoped step at a time.
- **DeepSeek-Flash = optional routine execution.** Use a verified route for small, explicit buckets;
  fall back to Luna when unavailable.
- **Terra@Max = complex execution/review.** Used when the work crosses systems or Luna needs review.
- **The plan file + `HANDOFF.md` = durable memory.** Progress survives a session change because
  every completed step records its verification and commit.

## Why we do it this way

- **Luna utilization** — most execution stays on Luna@Max through small, precise buckets.
- **Context freshness** — one executor per step keeps each implementation focused.
- **Escalation discipline** — Terra and Astra are used for identifiable complexity, not prestige.
- **Crash-safe** — checkboxes + `HANDOFF.md` let any session resume.
- **Human seams are explicit** — secrets and interactive commands become `BLOCKED`, never guessed.

## How it runs here

Codified as the `/run-stage` skill (`.agents/skills/run-stage/SKILL.md`):

1. Read `HANDOFF.md`, the active plan, and `knowledge/BOARD.md`; confirm the last checkpoint.
2. Select the next bucket's executor: Luna@Max by default, optionally DeepSeek-Flash for an eligible
   bucket through a verified route, and Terra@Max only when its criteria apply.
3. Dispatch one fresh executor with the full step, relevant files/spec, and "verify then commit".
4. The executor reports `DONE`, `BLOCKED`, or `FAILED` with verification evidence.
5. Sol judges normal results. Astra judges architectural/high-risk outcomes and repeated failures.
6. Update the plan, board, and handoff after every completed step.

## Rules we hold to

- **One executor per step**—maximum context freshness; do not batch unless asked.
- **Luna first**—do not promote work to Terra without a concrete complexity or review reason.
- **DeepSeek is availability-gated**—if the current dispatch route cannot select it, use Luna and
  record the actual executor without asking the user to switch models.
- **Independent review for risky work**—the author is never the only reviewer.
- **Never paste secrets** into the repo or executor prompt; that is `BLOCKED`.
- **No interactive commands** in an executor; return the exact command needed from the human.
- Keep **checkboxes + HANDOFF + BOARD** accurate after every step.

## Related

- `.agents/skills/run-stage/SKILL.md` — the executable version of this pattern.
- `HANDOFF.md` — the live resume state it reads and writes.
- [[README]] — knowledge base home.
