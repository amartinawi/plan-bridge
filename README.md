# Plan Bridge

An MCP server that enables a structured **plan → implement → review → fix** workflow between two AI coding agents. One agent creates plans and reviews code. The other implements plans and fixes review findings. They coordinate through shared plan files on disk.

Built for **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** + **[OpenCode](https://opencode.ai/)**, but the MCP tools are agent-agnostic.

## Why?

When building with AI, you often want one agent to plan and review while another implements. But coordinating between two terminals is tedious — you're constantly switching back and forth, copy-pasting plan IDs, and triggering commands manually.

Plan Bridge solves this with:
- **Local storage** — plans stored in your project at `<project>/.plans/`, not global directories
- **Inline plan creation** — create plans directly in conversation, no need for plan mode
- **Automatic phase splitting** — complex plans split into manageable phases with independent review cycles
- **Shared MCP server** — both agents read/write the same plan files
- **Automated review loops** — agents poll for status changes, no manual intervention
- **Phase-by-phase orchestration** — `/plan-bridge:full-cycle` implements and reviews each phase independently
- **Single-terminal mode** — runs everything from one terminal

## Quick Start

### 1. Build

```bash
cd plan-bridge-mcp
npm install
npm run build
```

### 2. Configure Claude Code

Register the MCP server globally (or per-project via `.mcp.json`):

```bash
claude mcp add plan-bridge -- node /path/to/plan-bridge-mcp/build/index.cjs
```

Or add manually to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "plan-bridge": {
      "command": "node",
      "args": ["/path/to/plan-bridge-mcp/build/index.cjs"]
    }
  }
}
```

Install the slash commands:

```bash
cp commands/claude-code/*.md ~/.claude/commands/
```

### 3. Configure OpenCode

Add to `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "plan-bridge": {
      "type": "local",
      "command": ["node", "/path/to/plan-bridge-mcp/build/index.cjs"]
    }
  },
  "command": {
    "plan-bridge:get-plan": {
      "description": "Retrieve a plan and implement it",
      "template": "< contents of commands/opencode/plan-bridge:get-plan.md >"
    },
    "plan-bridge:claude-review": {
      "description": "Get review findings and fix them (auto-loops)",
      "template": "< contents of commands/opencode/plan-bridge:claude-review.md >"
    },
    "plan-bridge:mark-done": {
      "description": "Force-mark a plan as completed",
      "template": "< contents of commands/opencode/plan-bridge:mark-done.md >"
    }
  }
}
```

See `commands/opencode/opencode-config-example.json` for the full example.

## Usage

### Full-Cycle (Fully Automated - Single Terminal!)

TRUE single-terminal automation from Claude Code:

1. Describe what you want to build in conversation (or use plan mode)
2. Run `/plan-bridge:full-cycle`
3. **That's it!** Claude Code automatically:
   - Analyzes plan complexity (score 0-100)
   - Splits into phases if complex (score ≥50 or 5+ files)
   - Submits the plan to local storage (`<project>/.plans/<id>/`)
   - For each phase (or single implementation if simple):
     - Runs OpenCode to implement (synchronously)
     - Reviews the code automatically
     - Runs OpenCode to fix findings
     - Loops until phase approved
     - Advances to next phase
   - Reports completion

**The conversation pauses while OpenCode works** (up to 10 min per step) - this is expected. No manual intervention needed!

**Complex plans** are automatically split into phases:
- Each phase is implemented, reviewed, and approved independently
- Reduces overwhelming review cycles
- Manageable incremental progress

### Two-Terminal Mode

For more control, run agents in separate terminals:

```
Terminal 1 (Claude Code):    /plan-bridge:send-plan → /plan-bridge:review-plan
Terminal 2 (OpenCode):       /plan-bridge:get-plan <id> → /plan-bridge:claude-review
```

Both auto-loop via `wait_for_status` — no further intervention needed.

## Commands

### Claude Code (`~/.claude/commands/`)

| Command | Description |
|---------|-------------|
| `/plan-bridge:send-plan [name]` | Submit a plan from `~/.claude/plans/` or conversation |
| `/plan-bridge:review-plan [id]` | Review implementation, auto-loop until approved |
| `/plan-bridge:full-cycle [name]` | Full automation: submit + implement + review loop |

### OpenCode (inline in `opencode.json`)

| Command | Description |
|---------|-------------|
| `/plan-bridge:get-plan [id]` | Fetch and implement a plan |
| `/plan-bridge:claude-review [id]` | Get findings, fix them, auto-loop until approved |
| `/plan-bridge:mark-done [id]` | Force-complete a plan |

## MCP Tools

15 tools available to both agents:

### Core Workflow Tools

| Tool | Purpose |
|------|---------|
| `submit_plan` | Create a simple plan (legacy) |
| `submit_phased_plan` | Create a plan with automatic complexity analysis and phase splitting (RECOMMENDED) |
| `get_plan` | Get plan by ID or latest by status |
| `list_plans` | List plans (filter by status, project_path, storage_mode) |
| `update_plan_status` | Change plan status |
| `submit_review` | Submit findings (empty = approved, phase-aware) |
| `get_review` | Get latest review for plan or current phase |
| `submit_fix_report` | Report fixes (auto-sets review_requested, phase-aware) |
| `mark_complete` | Force-complete a plan |
| `wait_for_status` | Poll until target status reached |

### Complexity & Phase Management

| Tool | Purpose |
|------|---------|
| `analyze_plan_complexity` | Analyze plan content and get phase recommendations |
| `get_current_phase` | Get the active phase for a phased plan |
| `list_plan_phases` | List all phases with status summary |
| `advance_to_next_phase` | Mark current phase complete and advance to next |
| `migrate_plan_to_local` | Migrate a global plan to local storage |

## How It Works

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
              Plan status transitions:
              submitted → in_progress →
              review_requested → needs_fixes →
              review_requested → ... → completed
```

**Storage:**
- **New plans** (default): Local storage at `<project>/.plans/<plan-id>/`
  - `plan.json` — Metadata, reviews, fixes
  - `plan.md` — Original markdown content
  - `CLAUDE.md` — Auto-generated project context
  - `phases/` — Individual phase files (if phased)
- **Legacy plans**: Global storage at `~/.plan-bridge/plans/` (backward compatible)

Each agent spawns its own MCP server process (stdio transport), but they share state through the filesystem.

## Local Storage & Phase Management

### Local Storage

Plans are now stored locally within your project:

```
<project>/
  .plans/
    <plan-id>/
      ├── plan.json          # Full plan metadata
      ├── plan.md            # Original content
      ├── CLAUDE.md          # Auto-generated context
      └── phases/            # Phase files (if complex)
          ├── phase-1.json
          ├── phase-1.md
          ├── phase-2.json
          └── phase-2.md
```

Benefits:
- Plans live with the code they describe
- Easy to inspect and track in git (add `.plans/` to `.gitignore`)
- No global pollution
- Multi-project support

### Automatic Phase Splitting

Complex plans are automatically split into phases when:
- Complexity score ≥ 50, OR
- 5+ files referenced in plan

Complexity indicators:
- Number of files
- Estimated implementation steps
- Explicit phase markers (## Phase 1, ## Step 1)
- Dependency keywords

**Phase workflow:**
1. Phase 1 implemented → reviewed → fixed → approved
2. Advance to Phase 2
3. Phase 2 implemented → reviewed → fixed → approved
4. ...repeat until all phases complete
5. Plan marked completed

**Why phases?**
- Reduces overwhelming review cycles
- Focuses implementation on manageable chunks
- Each phase gets independent review
- Clear progress tracking

## Project Structure

```
plan-bridge/
├── README.md                    # This file
├── CLAUDE.md                    # Project instructions for Claude Code
├── AGENTS.md                    # Agent interaction guide
├── LICENSE
├── commands/
│   ├── claude-code/             # Slash commands for Claude Code
│   │   ├── plan-bridge:send-plan.md
│   │   ├── plan-bridge:review-plan.md
│   │   └── plan-bridge:full-cycle.md
│   └── opencode/                # Slash commands for OpenCode
│       ├── plan-bridge:get-plan.md
│       ├── plan-bridge:claude-review.md
│       ├── plan-bridge:mark-done.md
│       └── opencode-config-example.json
└── plan-bridge-mcp/             # MCP server source
    ├── src/
    │   ├── index.ts             # Entry point
    │   ├── tools.ts             # 9 tool definitions
    │   ├── storage.ts           # File-based CRUD
    │   └── types.ts             # TypeScript interfaces
    ├── package.json
    └── tsconfig.json
```

## Requirements

- **Node.js 18+**
- **Claude Code** with MCP support
- **OpenCode** with MCP support (for two-agent workflows)
- **`opencode` CLI** in PATH (for `/full-cycle` single-terminal mode)

## License

MIT
