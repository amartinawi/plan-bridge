# Plan Bridge MCP Server

A shared [MCP](https://modelcontextprotocol.io/) server that enables a structured **plan → implement → review → fix** workflow between two AI coding agents. One agent plans and reviews. The other implements and fixes. They coordinate through shared plan files on disk.

Designed for **Claude Code** (planner/reviewer) + **OpenCode** (executor), but the MCP tools are agent-agnostic.

## How It Works

```
Claude Code                    MCP Server (stdio)                    OpenCode
─────────────                  ──────────────────                    ────────
/send-plan ──────► submit_plan ──► ~/.plan-bridge/plans/{id}.json
                                                                    /get-plan ──► get_plan
                                                                    (implements)
                                                                    update_plan_status → "review_requested"
/review-plan ──► get_plan + read code + submit_review
                   (findings[] or approved)
                                                                    /claude-review ──► get_review
                                                                    (fixes code)
                                                                    submit_fix_report → "review_requested"
                   ↑_______________ loop until 0 findings _______________↑
                   submit_review(findings=[]) → "completed"
```

### Full-Cycle Mode (Single Terminal)

With `/full-cycle`, Claude Code orchestrates everything — no terminal switching needed:

```
Claude Code (single terminal)
──────────────────────────────
/full-cycle
  ├─ submit_plan                          → plan submitted
  ├─ opencode run --command get-plan      → OpenCode implements (background)
  ├─ wait_for_status("review_requested")  → blocks until done
  ├─ review code + submit_review          → findings submitted
  ├─ opencode run --command claude-review → OpenCode fixes (background)
  ├─ wait_for_status("review_requested")  → blocks until done
  ├─ re-review + submit_review            → loop until 0 findings
  └─ "completed"                          → done
```

### Status Flow

```
submitted → in_progress → review_requested → needs_fixes → review_requested → ... → completed
```

## Setup

### 1. Build the Server

```bash
cd plan-bridge-mcp
npm install
npm run build
```

This compiles `src/index.ts` into `build/index.cjs` via tsup.

### 2. Register with Claude Code

Register the MCP server globally:

```bash
claude mcp add plan-bridge -- node /absolute/path/to/plan-bridge-mcp/build/index.cjs
```

Or add to `~/.claude/settings.json` (or a project-level `.mcp.json`):

```json
{
  "mcpServers": {
    "plan-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/plan-bridge-mcp/build/index.cjs"]
    }
  }
}
```

Copy the slash commands to `~/.claude/commands/`:

```bash
cp commands/claude-code/*.md ~/.claude/commands/
```

Restart Claude Code to pick up the server.

### 3. Register with OpenCode

Add to `~/.config/opencode/opencode.json` under the `mcp` key:

```json
"plan-bridge": {
  "type": "local",
  "command": ["node", "/absolute/path/to/plan-bridge-mcp/build/index.cjs"]
}
```

Add the slash commands under the `command` key. See `commands/opencode/opencode-config-example.json` for the full structure, or paste the contents of each `.md` file as the `template` value.

Restart OpenCode to pick up the server and commands.

## Usage

### Claude Code Commands

| Command | What it does |
|---------|-------------|
| `/send-plan [name]` | Submit a plan to the bridge (from `~/.claude/plans/`, conversation, or by name) |
| `/review-plan [plan-id]` | Review implementation, submit findings. Auto-loops until approved |
| `/full-cycle [name]` | **Full automation**: submit plan + trigger OpenCode + review loop — single terminal |

### OpenCode Commands

| Command | What it does |
|---------|-------------|
| `/get-plan [plan-id]` | Fetch a plan, implement it, set to review_requested |
| `/claude-review [plan-id]` | Get findings, fix them, auto-loop until approved |
| `/mark-done [plan-id]` | Force-mark a plan as completed |

### Workflows

**Full-Cycle (recommended — single terminal):**
1. Create a plan in Claude Code (plan mode or conversation)
2. Run `/full-cycle` — everything else is automatic

**Manual (two terminals):**
1. Claude Code: `/send-plan` → note plan ID
2. OpenCode: `/get-plan <id>` → implements
3. Claude Code: `/review-plan` (starts auto-loop)
4. OpenCode: `/claude-review` (starts auto-loop)
5. Both loop concurrently until approved

## MCP Tools (9 total)

| Tool | Purpose |
|------|---------|
| `submit_plan` | Create a new plan (name, content, project_path, source) |
| `get_plan` | Get a plan by ID or latest by status |
| `list_plans` | List plans with optional status and project_path filters |
| `update_plan_status` | Change a plan's status |
| `submit_review` | Submit review findings (empty array = approved → completed) |
| `get_review` | Get the latest review for a plan |
| `submit_fix_report` | Report applied fixes (auto-sets review_requested) |
| `mark_complete` | Force-complete a plan |
| `wait_for_status` | Poll until plan reaches target status (enables automated loops) |

## Project Structure

```
plan-bridge/
├── .gitignore
├── CLAUDE.md                          # Project instructions for Claude Code
├── AGENTS.md                          # Agent interaction guide
├── commands/
│   ├── claude-code/
│   │   ├── send-plan.md               # /send-plan command
│   │   ├── review-plan.md             # /review-plan command (auto-loop)
│   │   └── full-cycle.md              # /full-cycle command (single terminal)
│   └── opencode/
│       ├── get-plan.md                # /get-plan command
│       ├── claude-review.md           # /claude-review command (auto-loop)
│       ├── mark-done.md               # /mark-done command
│       └── opencode-config-example.json
├── plan-bridge-mcp/
│   ├── src/
│   │   ├── index.ts                   # Server entry point + stdio transport
│   │   ├── tools.ts                   # 9 MCP tool definitions
│   │   ├── storage.ts                 # File-based plan CRUD
│   │   └── types.ts                   # Plan, Review, FixReport interfaces
│   ├── package.json
│   └── tsconfig.json
```

## Storage

Plans are persisted as individual JSON files in `~/.plan-bridge/plans/`. Each client spawns its own server process over stdio, but they share state through the filesystem. The storage directory is auto-created on startup.

## Requirements

- Node.js 18+
- Claude Code with MCP support
- OpenCode with MCP support (for two-agent workflows)
- `opencode` CLI (for `/full-cycle` single-terminal mode)

## License

MIT
