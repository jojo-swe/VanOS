# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

VanOS is **not a conventional application codebase**. It is the persistent workspace for a 25-agent AI organization running on [OpenClaw](https://github.com/openclaw/openclaw) (a personal-assistant agent platform). The repo is auto-committed as a backup of agent state — most files are markdown "memory" and "personality" files that agents read at the start of every session, not source code. The one real piece of software in here is the Next.js app under `ai-support/` (Mission Control).

Jojo (the human CEO) runs OpenClaw locally (Docker on WSL2). Each agent is a separate OpenClaw agent with its own workspace directory containing the same set of files (`SOUL.md`, `IDENTITY.md`, `AGENTS.md`, `MEMORY.md`, `USER.md`, `memory/`). `.backup-to-github.sh` runs on a cron/heartbeat, copies `$OPENCLAW_HOME/agents/*/workspace` into a local `agents-backup/` folder, and commits and pushes the main workspace to `main`. `agents-backup/` is gitignored and blocked by the privacy guard: agent workspaces hold personal data and never go into this repo.

Agent personas and memory (`SOUL.md`, `USER.md`, `MEMORY.md`, `memory/` at any depth, and `agents-backup/`) are local-only and never committed. Change the `*.example.md` templates only when the template itself should change.

## Repository structure

- **Root-level files** (`IDENTITY.md`, `AGENTS.md` (the OpenClaw agent's startup file, not coding-agent instructions), `TOOLS.md`, `HEARTBEAT.md`, `PROTOCOLS.md`, `ORG-CHART.md`, `STATUS-TEMPLATE.md`, `BOOTSTRAP.md`, plus the templates `SOUL.example.md`, `USER.example.md`, `MEMORY.example.md`) — the workspace of the **main** agent (Jojo's direct assistant, currently on Sonnet). Its real `SOUL.md`, `USER.md`, `MEMORY.md` and `memory/` exist only in the live workspace: they are gitignored and never committed. `BOOTSTRAP.md` is a first-run-only onboarding script; agents delete it once identity is established.
- **`agents-backup/<agent-id>/`** — local-only copy of each subordinate agent's workspace, written by the backup script. Gitignored and blocked by the privacy guard; it is not in this repo. See `ORG-CHART.md` for the org chart and `PROTOCOLS.md` for escalation/communication rules between agents.
- **`memory/YYYY-MM-DD.md`** — the main agent's dated raw session logs (distinct from the curated `MEMORY.md`). Local-only and gitignored, like `MEMORY.md`.
- **`ai-support/`** — Mission Control, a Next.js 16 / React 19 / TypeScript / Tailwind v4 app with tests and CI (see "The `ai-support` app" below).
- **`blog/`** — published blog post markdown, written by the "Quill" content agent.
- **`setup-org.sh`**, **`write-workspaces.py`**, **`bind-telegram.sh`** — one-time provisioning scripts used to originally create the 25 agents via the `openclaw` CLI (agent creation, identity, workspace files, Telegram binding). Not meant to be re-run casually — re-running `setup-org.sh`/`write-workspaces.py` would recreate/overwrite all agent workspace files.
- **`.backup-to-github.sh`** — the auto-backup script described above; runs against a live OpenClaw installation (`$OPENCLAW_HOME`, default `$HOME/.openclaw`), not against this checkout directly. It also keeps local tarballs of the main agent's personal files (outside git) and runs the privacy guard before every commit.
- **`scripts/privacy-guard.sh`** — fails (in CI and in the backup script) if the main agent's personal files or personal keywords are about to be committed.
- **`scripts/move-workspace-to-new-history.sh`** — one-time move of the live workspace from the archived `VanOS-old-history` repo to this one, keeping every local file.
- **`vercel.json`** — builds `ai-support/` with `@vercel/next` for the public Vercel demo.

## The `ai-support` app

Mission Control: a Next.js 16 / React 19 / Tailwind v4 dashboard plus the agent API for the AI org (bots, costs, money, connections, Home Assistant, DisplayFusion, GitHub, Notion, Slack, Obsidian, an MCP connector for Grok).

**Before changing anything under `ai-support/`, read [`ai-support/AGENTS.md`](ai-support/AGENTS.md).** It has the commands, the code map, and the rules for write routes, storage, integrations, and security. `ai-support/CLAUDE.md` imports it, so Claude Code loads it automatically when working in that folder.

In short:
- Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run check:edge` and `npm run smoke:security` from `ai-support/` before pushing. CI runs the same (type checking happens inside the build) plus gitleaks.
- `npm test` runs an explicit file list in `package.json`; add new test files there.
- Production is one VPS (`VANOS_ACCESS_MODE=private`, Tailscale Serve for the dashboard, Funnel for the bot paths). Vercel builds the same app from the root `vercel.json` only as a public demo (`VANOS_DEMO_MODE=true`). See `docs/DEPLOYMENT.md`.

## Working in this repo

- Subordinate agents' personality, memory and role live in their live OpenClaw workspaces, not in this repo. Change them there. The main agent's persona and memory are not in this repo either; change the `*.example.md` templates only when the template itself should change.
- The live workspace is the source of truth. This repo backs up the main workspace without any personal files.
- Org structure, model tiers, and escalation rules are documented in `README.md`, `ORG-CHART.md`, and `PROTOCOLS.md` — check these before assuming an agent's role or reporting line.
- Actual buildable/testable code changes belong in `ai-support/`; everything else in the repo is documentation/state with no build step.
- The main agent's root `SOUL.md`, `USER.md`, `MEMORY.md` and `memory/` hold real personal data and are **local-only**: gitignored, blocked by `scripts/privacy-guard.sh` in CI, and never committed, restored or re-added (not even from `VanOS-old-history`). Do not remove them from `.gitignore`. Because git does not back them up, `.backup-to-github.sh` keeps local tarballs; keep an off-machine copy too. The history before this policy lives in the private, archived `jojo-swe/VanOS-old-history`.
- Coding-agent instructions live in `ai-support/AGENTS.md`. Do not put them in the root `AGENTS.md`: every OpenClaw agent reads that file at startup as its own workspace guide.
- This repo is private and is auto-pushed by `.backup-to-github.sh`, which refuses to commit secret-looking files or lines and runs the privacy guard. Never commit tokens, `.env*` files, or personal data.
- Jojo writes in Swedish. Keep code, comments, commit messages and repo docs in English unless a file is already in Swedish.
