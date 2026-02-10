# 🚀 Just Released My First MCP: Plan Bridge - Automated Plan → Implement → Review → Fix Workflow Between AI Coding Agents

**TL;DR:** I built an MCP server that lets Claude Code plan/review code while OpenCode implements and fixes — with fully automated review loops. No more terminal switching or manual coordination!

---

## The Problem

When working with multiple AI coding agents, you often want one to **plan and review** while another **implements**. But coordinating between two terminals is tedious:

- ❌ Constantly switching between windows
- ❌ Copy-pasting plan IDs manually
- ❌ Triggering commands back and forth
- ❌ No way to automate the review loop

## The Solution: Plan Bridge

**Plan Bridge** is an MCP server that creates a structured `plan → implement → review → fix` workflow between two AI coding agents. It coordinates everything through shared plan files on disk.

### What It Does

- **Shared MCP server** — both agents read/write the same plan files
- **Automated review loops** — agents poll for status changes, no manual intervention needed
- **Single-terminal mode** — `/plan-bridge:full-cycle` runs everything from one terminal

### How It Works

```
                    ┌─────────────┐
                    │  Plan File  │
                    │  (JSON on   │
                    │   disk)     │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────┴─────┐     │     ┌──────┴─────┐
        │ Claude    │     │     │  OpenCode  │
        │ Code      │     │     │            │
        │           │     │     │            │
        │ submit    │────►│     │            │
        │ review    │◄────│────►│ implement  │
        │ approve   │────►│     │ fix        │
        └───────────┘     │     └────────────┘
                          │
              Status flow:
              submitted → in_progress →
              review_requested → needs_fixes →
              review_requested → ... → completed
```

## Key Features

### 9 MCP Tools
- `submit_plan` — Create a new plan
- `get_plan` — Get plan by ID or latest by status
- `list_plans` — List plans with filters
- `update_plan_status` — Change plan status
- `submit_review` — Submit findings (empty = approved)
- `get_review` — Get latest review for a plan
- `submit_fix_report` — Report fixes applied
- `mark_complete` — Force-complete a plan
- `wait_for_status` — Poll until target status reached

### Slash Commands

**Claude Code:**
- `/plan-bridge:send-plan [name]` — Submit a plan
- `/plan-bridge:review-plan [id]` — Review implementation, auto-loop until approved
- `/plan-bridge:full-cycle [name]` — Full automation from one terminal!

**OpenCode:**
- `/plan-bridge:get-plan [id]` — Fetch and implement a plan
- `/plan-bridge:claude-review [id]` — Get findings, fix them, auto-loop
- `/plan-bridge:mark-done [id]` — Force-complete a plan

## Quick Start

```bash
cd plan-bridge-mcp
npm install
npm run build
```

Then configure both Claude Code and OpenCode to use the MCP server. Plans are stored as JSON files in `~/.plan-bridge/plans/`.

## My First Contribution

This is my first-ever MCP and my first open-source contribution to the AI coding community! I built it because I needed a way to coordinate between Claude Code and OpenCode without constantly switching terminals.

The server is agent-agnostic — you could use it with any MCP-compatible AI agents, not just Claude Code and OpenCode.

## Get It Now

**GitHub:** https://github.com/amartinawi/plan-bridge

**Requirements:**
- Node.js 18+
- Claude Code with MCP support
- OpenCode with MCP support (for two-agent workflows)
- `opencode` CLI in PATH (for `/plan-bridge:full-cycle`)

## Feedback Welcome!

Since this is my first MCP, I'd love feedback, suggestions, and contributions! Feel free to:

- ⭐ Star the repo if you find it useful
- 🐛 Open issues for bugs or feature requests
- 💬 Comment here with your thoughts

Would love to hear how others are using AI agents together and what workflows you'd like to see supported!

---

**Tags:** #MCP #ClaudeCode #OpenCode #AI #AIWorkflow #DeveloperTools #TypeScript #OpenSource
