# floorplan-generator — agent operating rules

{{PROJECT_ONELINER}} See [ARCHITECTURE.md](ARCHITECTURE.md) for the full spec.

## Current state — read these first when picking up a session

- **[knowledge/PROGRESS.md](knowledge/PROGRESS.md)** — resume point. Top **"Resume here"** block =
  current focus + open threads + next step; below it, the merge timeline. **Read first after a `/clear`.**
- **[knowledge/BOARD.md](knowledge/BOARD.md)** — the work queue, whose turn it is, handoff rules.
- **[DELEGATION-PLAN.md](DELEGATION-PLAN.md)** — the staged build plan (the *how*).
- **[HANDOFF.md](HANDOFF.md)** — tactical next-step / blocked state for `/run-stage`.

## Operating rules (read every session — the ones a cold clone forgets)

- **Delegation.** Sol@Max is the default orchestrator; Astra@Max takes architecture, ambiguous
  product/technical decisions, and escalations. Luna@Max is the default executor for tightly
  scoped code, tests, docs, research, and commands. Terra@Max handles cross-cutting implementation,
  difficult debugging, integration, and independent review. Route per
  [delegation-playbook](knowledge/patterns/delegation-playbook.md). **Never ask the user to switch models.**
- **Human hard-gates.** Money/payments and product/UX/copy decisions stop for the user. For this
  project that means: {{HARD_GATES}}. Never merge those solo.
- **Ponytail default** — laziest solution that actually works; YAGNI; stdlib/native before deps.
- **Product LLM (pipeline)** — {{PRODUCT_LLM}}. (This is the *product's* API. Astra/Sol/Terra/Luna
  above refer to the *build agents*, unchanged.)
- **Design work** goes through the `impeccable` skill.

## Repo facts (not folklore)

- **Stack:** {{STACK}}
- **Deploy:** {{DEPLOY}}
- **Secrets** live in a local `.env` (never committed): {{SECRETS}}

## Where operating memory lives

Canonical rules live *here* in AGENTS.md + `knowledge/`. Path-namespaced auto-memory is orphaned
when the repo moves/clones — treat it as a supplement, not the source.

