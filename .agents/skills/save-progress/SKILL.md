---
name: save-progress
description: Use to checkpoint state before a /clear — on a merge to main (with the MERGED banner) or when the user says "checkpoint"/"save progress"/"about to clear".
---

# Save progress

Keep the project resumable after a `/clear`. A fresh session reads `knowledge/PROGRESS.md`
(AGENTS.md points there). Top = **"Resume here"** (current state); below = merge **timeline**.

## Steps

1. **Rewrite the "Resume here" block** at the top of `knowledge/PROGRESS.md` to reflect NOW —
   fields: `Current focus`, `Open threads / waiting on user`, `Next step`, `In-flight branches`,
   `Deferred`. Use today's date. (This is the only judgment step; make it accurate enough to
   resume from cold.)
2. **Merge only** — append one timeline line under `## YYYY-MM-DD`:
   `- <what shipped> — \`<sha>\` (PR #N) → next: <next step>`
3. **Merge only** — confirm the `knowledge/BOARD.md` bucket is `done` with the SHA/PR#.
4. Commit + push: `git add knowledge/PROGRESS.md knowledge/BOARD.md HANDOFF.md && git commit -m "docs(progress): checkpoint" && git push`
5. **Merge only** — then emit the green `MERGED` banner.

On-demand ("checkpoint" / pre-clear): do steps 1 + 4 only. Never append a timeline line without
a real merge. Skip entirely for branch pushes / open PRs unless the user explicitly checkpoints.

