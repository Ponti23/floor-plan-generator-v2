---
title: floorplan-generator Knowledge Base
tags: [moc, home]
---

# floorplan-generator Knowledge Base

The **home note** for how we build this. Plain markdown in the repo (also openable as an
[Obsidian](https://obsidian.md) vault — *Open folder as vault* → pick this `knowledge/` folder).

## How we work (patterns & playbooks)

- [[BOARD]] — **the live work queue**: what to work on now, who owns it, and status.
- [[orchestrator-and-subagents]] — Sol/Astra orchestrate; fresh DeepSeek/Luna/Terra executors handle each step.
- [[delegation-playbook]] — Luna-default routing with an optional DeepSeek-Flash routine lane.

## The project

- [ARCHITECTURE.md](../ARCHITECTURE.md) — the full spec.
- [DELEGATION-PLAN.md](../DELEGATION-PLAN.md) — the staged build plan in the delegation model.
- [PROGRESS.md](PROGRESS.md) — resume point + merge timeline.

## How to add a note

1. New markdown file in the right subfolder (`patterns/`, `conventions/`, `reference/`).
2. Add frontmatter: `title`, `tags`.
3. Link it from here and related notes with `[[wikilinks]]`.
4. Keep each note **atomic** — one idea per file. Commit it like code.

