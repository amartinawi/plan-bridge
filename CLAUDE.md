# Project: Plan Bridge MCP

This project workspace contains the **plan-bridge** MCP server and its configuration. The plan-bridge enables a structured planner/executor workflow between Claude Code and OpenCode.

## Architecture

Claude Code acts as the **planner and reviewer**. OpenCode acts as the **executor**. They communicate through a shared MCP server that persists plans as JSON files on disk.

```
Claude Code (planner)  <-->  plan-bridge MCP  <-->  OpenCode (executor)
                             ~/.plan-bridge/plans/{id}.json
```

Both clients spawn their own MCP server process via stdio transport. Shared state is achieved through the filesystem — both processes read/write the same JSON plan files.

## Plan-Bridge MCP Server

- **Location:** `plan-bridge-mcp/` (TypeScript, built with tsup)
- **Entry point:** `plan-bridge-mcp/build/index.cjs` (compiled CJS bundle)
- **Storage:** `~/.plan-bridge/plans/` (one JSON file per plan)
- **Transport:** stdio (each client spawns its own process, shared state via filesystem)

### MCP Tools

| Tool | Used By | Purpose |
|------|---------|---------|
| `submit_plan` | Claude Code | Submit a new plan (name, content, project_path) |
| `get_plan` | Both | Get plan by ID or latest by status |
| `list_plans` | Both | List all plans with summary info; filter by status and/or project_path |
| `update_plan_status` | Both | Change plan status |
| `submit_review` | Claude Code | Submit review findings; empty findings = approved |
| `get_review` | OpenCode | Get latest review findings for a plan |
| `submit_fix_report` | OpenCode | Report fixes applied, auto-sets "review_requested" |
| `mark_complete` | Both | Force-mark a plan as completed |
| `wait_for_status` | Both | Poll a plan until it reaches a target status (enables automated review loops) |

### Plan Status Flow

```
submitted --> in_progress --> review_requested --> needs_fixes --> review_requested --> ... --> completed
```

## How Plans Are Created and Saved

Claude Code's **plan mode** saves plans as markdown files in `~/.claude/plans/`. These are the raw plan documents. When the user runs `/send-plan`, the plan content is:

1. **Extracted from `~/.claude/plans/`** — reads the most recent `.md` file, or a specific one if a name/path argument is provided
2. **Or from the conversation** — if a plan was just discussed inline
3. **Submitted to the MCP server** via `submit_plan` — this creates a JSON record in `~/.plan-bridge/plans/{uuid}.json` with full metadata, status tracking, reviews, and fix reports

The plan JSON file is the **source of truth** for the workflow. The markdown file in `~/.claude/plans/` is the original draft.

## Multiple Plans Per Project

The MCP server supports multiple plans for the same project. Plans are identified by UUID and can be filtered by `project_path`.

- `/send-plan` checks for existing plans in the same project and warns the user
- `/get-plan <plan-id>` in OpenCode retrieves a specific plan by ID
- `list_plans` can filter by both `status` and `project_path`
- Plan IDs are reported on submission — use them to reference specific plans

## Automated Review Loop

The review cycle is **fully automated** once triggered. No need to switch between terminals.

**How it works:**

1. User runs `/review-plan` in Claude Code (one time)
2. Claude Code reviews the code, submits findings
3. Claude Code calls `wait_for_status` — polls the plan file every 5 seconds waiting for OpenCode to finish fixing
4. Meanwhile, OpenCode (running `/claude-review`) gets the findings, fixes them, submits a fix report
5. `wait_for_status` detects the status change, Claude Code automatically re-reviews
6. Loop continues until 0 findings — plan is marked completed

**Timeout:** `wait_for_status` has a default 5-minute timeout. If OpenCode takes longer, the loop stops and the user can re-trigger `/review-plan`.

## Slash Commands (Claude Code)

Located in `~/.claude/commands/` (copies in `commands/claude-code/`):

- **`/send-plan [name]`** — Find a plan from `~/.claude/plans/` (or conversation), submit it via `submit_plan`. Reports the plan ID. Accepts optional argument to match a specific plan file name.
- **`/review-plan [plan-id]`** — Fetch the latest `review_requested` plan, review the implementation, submit findings. **Auto-loops:** waits for fixes and re-reviews until 0 findings.
- **`/full-cycle [name]`** — **Single-terminal orchestration.** Submits a plan, triggers OpenCode via `opencode run --command`, waits for implementation, reviews, triggers fixes, and loops until approved. No terminal switching needed.

## Slash Commands (OpenCode)

Defined inline in `~/.config/opencode/opencode.json` under the `command` key (reference copies in `commands/opencode/`):

- **`/get-plan [plan-id]`** — Fetch a submitted plan (latest or by ID), set to `in_progress`, implement it, then set `review_requested`.
- **`/claude-review [plan-id]`** — Get review findings, apply fixes, submit fix report. **Auto-loops:** waits for re-review results and fixes again until approved.
- **`/mark-done [plan-id]`** — Force-mark a plan as completed.

## Typical Workflow

### Full-Cycle (Recommended — Single Terminal)
1. Create a plan in Claude Code (plan mode or conversation)
2. Run `/full-cycle` — everything is automatic:
   - Submits the plan
   - Triggers `opencode run --command get-plan <id>` in background
   - Waits for implementation via `wait_for_status`
   - Reviews the code, submits findings
   - Triggers `opencode run --command claude-review <id>` in background
   - Waits for fixes, re-reviews, loops until 0 findings
   - Reports completion

### Two-Terminal Flow
1. **Claude Code:** `/send-plan` → note plan ID
2. **OpenCode:** `/get-plan <id>` → implements → sets review_requested
3. **Claude Code:** `/review-plan` (starts auto-loop)
4. **OpenCode:** `/claude-review` (starts auto-loop)
5. Both loops run concurrently — no further user intervention needed

## Development

```bash
cd plan-bridge-mcp
npm install
npm run build        # tsup -> build/index.cjs
```

After rebuilding, restart both Claude Code and OpenCode to pick up the new server binary.

## Key Files

| File | Purpose |
|------|---------|
| `plan-bridge-mcp/src/types.ts` | Plan, Review, FixReport interfaces |
| `plan-bridge-mcp/src/storage.ts` | File-based CRUD for `~/.plan-bridge/plans/` |
| `plan-bridge-mcp/src/tools.ts` | All 9 MCP tool definitions (including `wait_for_status`) |
| `plan-bridge-mcp/src/index.ts` | Server entry point (McpServer + StdioServerTransport) |
| `~/.claude/settings.json` | Claude Code global MCP server registration |
| `commands/claude-code/*.md` | Claude Code slash commands (`send-plan`, `review-plan`, `full-cycle`) |
| `commands/opencode/*.md` | OpenCode slash commands + example config |
| `~/.config/opencode/opencode.json` | OpenCode MCP server + inline slash commands (runtime) |
| `~/.claude/commands/*.md` | Claude Code slash commands (installed copies, runtime) |
| `~/.claude/plans/*.md` | Plan mode output — raw plan markdown files |
| `~/.plan-bridge/plans/*.json` | MCP server storage — plan JSON files with full metadata |

## Plan JSON Structure

```json
{
  "id": "uuid",
  "name": "descriptive-name",
  "content": "# Full plan markdown...",
  "status": "submitted|in_progress|review_requested|needs_fixes|completed",
  "source": "claude-code",
  "project_path": "/absolute/path/to/project",
  "created_at": "ISO timestamp",
  "updated_at": "ISO timestamp",
  "reviews": [
    {
      "id": "uuid",
      "timestamp": "ISO",
      "findings": ["specific finding 1", "specific finding 2"],
      "status": "needs_fixes|approved"
    }
  ],
  "fix_reports": [
    {
      "id": "uuid",
      "timestamp": "ISO",
      "review_id": "uuid (references which review)",
      "fixes_applied": ["description of fix 1", ...]
    }
  ]
}
```


<claude-mem-context>
# Recent Activity

<!-- This section is auto-generated by claude-mem. Edit content outside the tags. -->

### Feb 9, 2026

| ID | Time | T | Title | Read |
|----|------|---|-------|------|
| #3384 | 2:18 PM | ✅ | Gitignore Added for Plan-Bridge Project | ~437 |
</claude-mem-context>
