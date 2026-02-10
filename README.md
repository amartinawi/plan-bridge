# Plan Bridge

An MCP server that enables a structured **plan → implement → review → fix** workflow between two AI coding agents. One agent creates plans and reviews code. The other implements plans and fixes review findings. They coordinate through shared plan files on disk.

Built for **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** + **[OpenCode](https://opencode.ai/)**, but the MCP tools are agent-agnostic.

## Why?

When building with AI, you often want one agent to plan and review while another implements. But coordinating between two terminals is tedious — you're constantly switching back and forth, copy-pasting plan IDs, and triggering commands manually.

Plan Bridge solves this with:
- **Shared MCP server** — both agents read/write the same plan files
- **Automated review loops** — agents poll for status changes, no manual intervention
- **Single-terminal mode** — `/plan-bridge:full-cycle` runs everything from one terminal

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

1. Create a plan in Claude Code (use plan mode or describe what you want)
2. Run `/plan-bridge:full-cycle`
3. **That's it!** Claude Code automatically:
   - Submits the plan
   - Runs OpenCode to implement (synchronously)
   - Waits for completion
   - Reviews the code automatically
   - Runs OpenCode to fix findings
   - Loops until approved
   - Reports completion

**The conversation pauses while OpenCode works** (up to 10 min per step) - this is expected. No manual intervention needed!

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

9 tools available to both agents:

| Tool | Purpose |
|------|---------|
| `submit_plan` | Create a new plan |
| `get_plan` | Get plan by ID or latest by status |
| `list_plans` | List plans (filter by status, project_path) |
| `update_plan_status` | Change plan status |
| `submit_review` | Submit findings (empty = approved) |
| `get_review` | Get latest review for a plan |
| `submit_fix_report` | Report fixes (auto-sets review_requested) |
| `mark_complete` | Force-complete a plan |
| `wait_for_status` | Poll until target status reached |

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

Plans are stored as JSON files in `~/.plan-bridge/plans/`. Each agent spawns its own MCP server process (stdio transport), but they share state through the filesystem.

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
