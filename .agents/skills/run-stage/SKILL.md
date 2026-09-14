---
name: run-stage
description: Use to autonomously execute the active plan in this repo, one step at a time via fresh DeepSeek-Flash, Luna@Max, or Terra@Max executors, until the stage is done or a step is blocked. Trigger with /run-stage, "run the stage", "continue the stage", "execute the plan till blocked".
---

# Run Stage

Drive the active plan to completion as the **orchestrator** (Sol@Max by default; Astra@Max for
architecture or escalations). Each step runs in a **fresh executor**—Luna@Max by default, or
optionally DeepSeek-Flash for eligible routine work through a verified provider route. Terra@Max
takes steps that meet the escalation criteria in the delegation playbook.
Only stop when a step is BLOCKED (needs a human) or FAILED (needs reasoning).

**Announce at start:** "Running the stage via the executor loop. Sol/Astra orchestrates; Luna@Max
executes by default, DeepSeek-Flash may take eligible routine work when available, and Terra@Max
handles complex or review work."

## Resume ritual (do this first, every time)

1. Read `HANDOFF.md` → get the **active plan** path + the current bucket.
2. Open the active plan (`DELEGATION-PLAN.md`) and `knowledge/BOARD.md` → list the unchecked
   `- [ ]` steps / `todo` buckets, in order.
3. `git log --oneline -5` → confirm the last committed checkpoint matches HANDOFF.
4. If HANDOFF says "Blocked on …", surface that blocker and **stop** — don't dispatch. The
   user must clear it (paste a secret, run an interactive command, provide a test fixture) first.

## The loop

For each unchecked step, in order:

1. **Select and dispatch one fresh executor.** Use **Luna@Max by default**. DeepSeek-Flash may take
   repository research, non-product docs, mechanical edits, or small tests/fixes with explicit
   acceptance criteria only through a provider route verified to select the intended model and
   provide the required tools. If that route is unavailable, use Luna without stopping. Use
   **Terra@Max** only for cross-cutting implementation, integration-heavy changes, difficult
   debugging, migrations, concurrency/state, security-sensitive work, or independent review. Give
   the executor a self-contained prompt:
   - The full step text from the plan (copy it — the subagent has no conversation context).
   - Pointers to the files it touches, and the relevant spec section.
   - Instruction: do the work, **run that step's verification**, and on success **commit**.
   - Instruction: report back exactly one of — `DONE: <what + verification result + commit
     hash>` / `BLOCKED: <exactly what's needed from the human>` / `FAILED: <error>`.
2. **On DONE:** check the box in the plan + flip the BOARD bucket to `done` with the SHA,
   update HANDOFF's "Next step", commit the bookkeeping. Continue.
3. **On BLOCKED:** stop the loop. Leave the box unchecked, bucket `blocked`. Update HANDOFF
   "Blocked on" with the exact ask. Tell the user precisely what you need, then end the turn.
4. **On FAILED:** stop the loop and report the error verbatim. Sol may tighten the brief and retry
   once; after two failures or unresolved ambiguity, escalate judgment to Astra. Do not retry blindly.

When all boxes are checked: update HANDOFF to mark the stage complete + record any artifacts
(URLs, IDs), commit, and report.

## Rules

- **One subagent per step** (max context freshness). Don't batch unless the user asks.
- **Never paste secrets into the repo or a subagent prompt.** A step needing a key/URL is a
  BLOCKED — ask the user, don't invent or hardcode values.
- **Don't run interactive commands** (first `fly launch`/`deploy`, anything that opens a
  browser or waits on a prompt). Those are BLOCKED → hand back with the exact command.
- **Availability fallback.** Never assume a custom catalog entry makes DeepSeek dispatchable. If
  the current tool does not expose a verified DeepSeek route, use Luna and record the actual
  executor. Do not shell-launch an agent as a workaround.
- **Luna first for broader bounded work.** Do not route to Terra without a concrete complexity or
  independent-review reason.
- **Independent review for risky work.** Terra reviews risky DeepSeek- or Luna-authored work; Sol or
  Astra reviews Terra-authored work. **Hard gates** (see AGENTS.md) stop for the user—never merge
  those solo.
- HANDOFF + checkboxes + BOARD are the durable resume state — keep them accurate after every
  step. A `/compact` mid-run is safe; all state lives in those files.

