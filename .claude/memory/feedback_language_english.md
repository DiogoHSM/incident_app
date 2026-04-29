---
name: Project language is English
description: All content created in this project (code, comments, docs, memory, commit messages, PR descriptions, chat replies) must be in English, overriding the global PT-BR default
type: feedback
---

Everything in `incident_app` must be in English. This overrides the global "PT-BR by default" rule from `~/.claude/CLAUDE.md`.

**Why:** User stated explicitly on 2026-04-28: "EVERYTHING IN THIS PROJECT SHOULD BE IN ENGLISH". The repo is public on GitHub (https://github.com/DiogoHSM/incident_app), so an English-only baseline keeps it accessible to outside readers and consistent with the code (identifiers, error messages, schema, etc. are already English).

**How to apply:**
- All new files (`.md`, code, tests, migrations, comments) — English.
- Commit messages, PR titles/bodies, GitHub issue text — English.
- Any project memory (`.claude/memory/*.md`), docs (`.claude/docs/*.md`, `docs/superpowers/**`), `CLAUDE.md`, `GUARDRAILS.md`, `README.md` — English.
- Chat replies to the user in this project — English (despite global PT-BR default).
- Existing PT-BR content (CLAUDE.md, GUARDRAILS.md, foundation_followups.md, MEMORY.md indices, plan/spec docs) is legacy — translate opportunistically when editing those files for other reasons, or in a dedicated pass if the user asks.
- Global memory (`~/.claude/memory/`) is unaffected — it stays in whatever language it was written in.
