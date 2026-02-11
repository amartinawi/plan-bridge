# Project: Plan Bridge MCP

This project workspace contains the **plan-bridge** MCP server and its configuration. The plan-bridge enables a structured planner/executor workflow between Claude Code and OpenCode.

## Architecture

Claude Code acts as the **planner and reviewer**. OpenCode acts as the **executor**. They communicate through a shared MCP server that persists plans as JSON files on disk.

```
Claude Code (planner)  <-->  plan-bridge MCP  <-->  OpenCode (executor)
                             <project>/.plans/{id}/plan.json (local storage)
```

Both clients spawn their own MCP server process via stdio transport. Shared state is achieved through the filesystem — both processes read/write the same JSON plan files.

## Plan-Bridge MCP Server

- **Location:** `plan-bridge-mcp/` (TypeScript, built with tsup)
- **Entry point:** `plan-bridge-mcp/build/index.cjs` (compiled CJS bundle)
- **Storage:** `<project>/.plans/<id>/` (local, per-plan directory) OR `~/.plan-bridge/plans/` (global, legacy)
- **Transport:** stdio (each client spawns its own process, shared state via filesystem)

### MCP Tools

#### Core Workflow Tools

| Tool | Used By | Purpose |
|------|---------|---------|
| `submit_plan` | Claude Code | Submit a simple plan (legacy) |
| `submit_phased_plan` | Claude Code | Submit with automatic complexity analysis and phase splitting (RECOMMENDED) |
| `get_plan` | Both | Get plan by ID or latest by status (include project_path for local storage) |
| `list_plans` | Both | List all plans; filter by status, project_path, and/or storage_mode |
| `update_plan_status` | Both | Change plan status (include project_path) |
| `submit_review` | Claude Code | Submit review findings; empty = approved (phase-aware, include project_path) |
| `get_review` | OpenCode | Get latest review for plan or current phase (include project_path) |
| `submit_fix_report` | OpenCode | Report fixes applied, auto-sets "review_requested" (phase-aware, include project_path) |
| `submit_self_assessment` | OpenCode | Report implementation quality, tests, concerns (TOKEN OPTIMIZATION) |
| `mark_complete` | Both | Force-mark a plan as completed (include project_path) |
| `wait_for_status` | Both | Poll until target status reached (include project_path) |

#### Phase Management Tools

| Tool | Used By | Purpose |
|------|---------|---------|
| `analyze_plan_complexity` | Claude Code | Analyze plan content and get phase recommendations |
| `get_current_phase` | Both | Get the active phase for a phased plan |
| `list_plan_phases` | Both | List all phases with status summary |
| `advance_to_next_phase` | Claude Code | Mark current phase complete and advance to next |
| `migrate_plan_to_local` | Both | Migrate a global plan to local storage |

### Plan Status Flow

```
submitted --> in_progress --> review_requested --> needs_fixes --> review_requested --> ... --> completed
```

## How Plans Are Created and Saved

Plans can be created in two ways:

1. **Inline in conversation** (RECOMMENDED) — Extract plan content directly from the current conversation
2. **From plan mode** (legacy) — Read from `~/.claude/plans/` markdown files

When the user runs `/plan-bridge:send-plan`, the workflow:

1. **Find plan content** from conversation, `~/.claude/plans/`, or arguments
2. **Analyze complexity** via `analyze_plan_complexity`:
   - Calculates score (0-100)
   - Detects file count, steps, dependencies
   - Recommends phases if complex (score ≥50 or 5+ files)
3. **Submit via `submit_phased_plan`** — creates local storage:
   - `<project>/.plans/<id>/plan.json` — Full metadata, status, reviews, fixes
   - `<project>/.plans/<id>/plan.md` — Original markdown content
   - `<project>/.plans/<id>/CLAUDE.md` — Auto-generated project context
   - `<project>/.plans/<id>/phases/` — Individual phase files (if phased)

The plan JSON file is the **source of truth** for the workflow.

## Multiple Plans Per Project

The MCP server supports multiple plans for the same project. Plans are identified by UUID and can be filtered by `project_path`.

- `/plan-bridge:send-plan` checks for existing plans in the same project and warns the user
- `/plan-bridge:get-plan <plan-id>` in OpenCode retrieves a specific plan by ID
- `list_plans` can filter by `status`, `project_path`, and `storage_mode`
- Plan IDs are reported on submission — use them to reference specific plans

## Phase Management

### Complexity Analysis

Plans are automatically analyzed for complexity when submitted via `submit_phased_plan`. Complexity is determined by:

- **File count** — How many files will be modified
- **Estimated steps** — Number of implementation steps (numbered lists, task lists, action items)
- **Explicit phases** — Presence of "Phase 1", "Step 1", etc.
- **Dependencies** — Keywords like "depends on", "requires", "prerequisite"
- **Plan length** — Total lines of content

**Complexity Score (0-100):**
- Score ≥50 OR 5+ files → Complex plan, automatically split into phases
- Score <50 AND <5 files → Simple plan, no splitting

### Automatic Phase Splitting

Complex plans are split into phases based on:

1. **Explicit phases in content** — If plan has "## Phase 1: Setup", "## Step 2: Implementation", etc., those are used
2. **Standard patterns** — Setup → Core → Testing → Documentation
3. **Section boundaries** — Natural divisions in the plan structure

Each phase gets:
- Sequential number (1, 2, 3...)
- Name and description
- Estimated files
- Content specific to that phase
- Dependencies (each phase depends on previous by default)

### Phase Workflow

For phased plans:

1. **Submit plan** — Automatically split into phases
2. **Phase 1 cycle:**
   - OpenCode implements Phase 1 only
   - Claude Code reviews Phase 1 only
   - Fix loop until Phase 1 approved
3. **Advance to Phase 2** — Call `advance_to_next_phase`
4. **Phase 2 cycle:** (repeat)
5. ...continue until all phases complete
6. **Plan marked completed**

**Why phases?**
- Reduces overwhelming review cycles
- Focuses implementation on manageable chunks
- Each phase gets independent review and approval
- Clear progress tracking

### Phase-Scoped Operations

When a plan is phased:
- `get_current_phase` — Returns active phase details
- `submit_review` — Adds review to current phase, not plan level
- `get_review` — Gets review from current phase
- `submit_fix_report` — Adds fix report to current phase
- `advance_to_next_phase` — Marks current phase complete, sets next as active

OpenCode only sees and implements the current phase content.

## Automated Review Loop

The review cycle is **fully automated** once triggered. No need to switch between terminals.

**For simple plans:**

1. User runs `/plan-bridge:review-plan` in Claude Code (one time)
2. Claude Code reviews the code, submits findings
3. Claude Code calls `wait_for_status` — polls every 5 seconds waiting for OpenCode
4. Meanwhile, OpenCode (running `/claude-review`) gets findings, fixes them, submits fix report
5. `wait_for_status` detects status change, Claude Code automatically re-reviews
6. Loop continues until 0 findings — plan marked completed

**For phased plans:**

- Same loop, but scoped to **current phase only**
- After phase approved, advance to next phase
- Repeat loop for each phase
- All phases complete → plan completed

**Timeout:** `wait_for_status` has a default 20-minute timeout (1200 seconds). If timeout, user can re-trigger.

## Token Optimization: Trust + Verify

**Problem**: Standard reviews consume 10k-50k tokens per cycle (reading entire codebase).

**Solution**: Self-assessment + differential review = **50-70% token reduction**.

### How It Works

1. **OpenCode Self-Assessment** (NEW):
   - After implementation, OpenCode calls `submit_self_assessment`
   - Reports: files changed, tests passed/failed, requirements met, concerns, questions
   - Provides git diff summary

2. **Claude Code Trust + Verify**:
   - Reads self-assessment (0.5k tokens)
   - Reviews git diff only (1-2k tokens) — not full files
   - **If clean** (tests pass, no concerns): Spot-check 1 file → approve
   - **If concerns**: Focus review on flagged areas only
   - **If tests fail**: Deep review of changed files via diff

### Token Comparison

| Scenario | Old Tokens | New Tokens | Savings |
|----------|------------|------------|---------|
| Clean implementation | 9,000 | 4,000 | 56% |
| With concerns | 12,000 | 6,500 | 46% |
| Failed tests | 15,000 | 9,000 | 40% |
| **3-phase full cycle** | **72,000** | **33,000** | **54%** |

### Optimized Commands

- **`/plan-bridge:review-plan-optimized`** — Diff-based reviews with Trust + Verify
- **`/plan-bridge:full-cycle-optimized`** — Full orchestration with token optimization
- OpenCode commands updated inline with self-assessment steps

See `TOKEN_OPTIMIZATION.md` for detailed architecture and metrics.

## Output Optimization: Quiet Mode

**Problem**: OpenCode can be verbose during implementation (~2,800 tokens of console output).

**Solution**: Quiet mode with structured summaries = **95% output reduction**.

### How It Works

1. **Suppress operational messages** — No "Reading file...", "Writing to...", etc.
2. **Consolidate status updates** — One emoji indicator instead of multiple lines
3. **Batch file operations** — Show all files in tree structure, not one-by-one
4. **Summarize tests** — "15 passed (2.3s)" instead of full test runner output
5. **Progressive disclosure** — Show details only on errors/warnings

### Output Comparison

| Scenario | Verbose | Quiet | Savings |
|----------|---------|-------|---------|
| Simple implementation | 2,800 | 120 | 96% |
| With warnings | 3,500 | 250 | 93% |
| Failed tests | 3,800 | 280 | 93% |
| **Full 3-phase cycle** | **16,800** | **920** | **95%** |

### Quiet Commands

- **`plan-bridge:get-plan-quiet`** — Silent implementation with structured summary
- **`plan-bridge:claude-review-quiet`** — Silent fix loop with structured summary

### Combined Savings

When combined with Trust + Verify:

- Claude Code reviews: **56% reduction** (9k → 4k tokens)
- OpenCode output: **96% reduction** (2.8k → 0.12k tokens)
- **Combined per cycle: 65% reduction** (11.8k → 4.1k tokens)
- **Full 3-phase workflow: 68% reduction** (77k → 25k tokens)

See `OUTPUT_OPTIMIZATION.md` for detailed examples and architecture.

## Slash Commands (Claude Code)

Located in `~/.claude/commands/` (copies in `commands/claude-code/`):

- **`/plan-bridge:send-plan [name]`** — Analyze complexity, submit plan with automatic phase splitting. Creates local storage at `<project>/.plans/<id>/`. Can extract plan from conversation (recommended) or `~/.claude/plans/`.
- **`/plan-bridge:review-plan [plan-id]`** — Review implementation (current phase if phased). **Auto-loops:** waits for fixes and re-reviews until phase/plan approved.
- **`/plan-bridge:full-cycle [name]`** — **Single-terminal orchestration with phase-by-phase flow.** Analyzes, submits, then for each phase: implements → reviews → fixes (loop) → advances to next. TRUE automation!

## Slash Commands (OpenCode)

Defined inline in `~/.config/opencode/opencode.json` under the `command` key (reference copies in `commands/opencode/`):

- **`/plan-bridge:get-plan [plan-id]`** — Fetch plan, check if phased, implement current phase only (or full plan if simple), set `review_requested`.
- **`/plan-bridge:claude-review [plan-id]`** — Get review findings for current phase, apply fixes, submit fix report. **Auto-loops:** until phase/plan approved.
- **`/plan-bridge:mark-done [plan-id]`** — Force-mark a plan as completed.

## Typical Workflow

### Full-Cycle (Recommended — Fully Automated!)

1. Describe what you want to build in conversation (or use plan mode)
2. Run `/plan-bridge:full-cycle`
3. Claude Code automatically:
   - **Analyzes complexity** — determines if plan should be split into phases
   - **Submits to local storage** — `<project>/.plans/<id>/`
   - **For each phase** (or single implementation if simple):
     - Runs OpenCode to implement (conversation pauses ~2-10 min)
     - Reviews code automatically
     - If findings: Runs OpenCode to fix (conversation pauses)
     - Loops until 0 findings (phase approved)
     - Advances to next phase
   - **Reports completion** — all phases done, plan completed

**TRUE single-terminal automation!** Phase-by-phase flow with zero manual intervention.

### Two-Terminal Flow

1. **Claude Code:** `/plan-bridge:send-plan` → analyzes, submits, reports plan ID and phase structure
2. **OpenCode:** `/plan-bridge:get-plan <id>` → implements current phase → sets review_requested
3. **Claude Code:** `/plan-bridge:review-plan` → reviews current phase (starts auto-loop)
4. **OpenCode:** `/plan-bridge:claude-review` → fixes current phase (starts auto-loop)
5. Both loops run concurrently until current phase approved
6. **Claude Code:** Advance to next phase, repeat steps 2-5
7. All phases complete → plan completed

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
| `plan-bridge-mcp/src/types.ts` | Plan, Phase, Review, FixReport, ComplexityAnalysis interfaces |
| `plan-bridge-mcp/src/storage.ts` | Dual-mode file-based CRUD (local + global storage) |
| `plan-bridge-mcp/src/complexity.ts` | Complexity analysis and phase recommendation logic |
| `plan-bridge-mcp/src/tools.ts` | All 15 MCP tool definitions |
| `plan-bridge-mcp/src/index.ts` | Server entry point (McpServer + StdioServerTransport) |
| `~/.claude/settings.json` | Claude Code global MCP server registration |
| `commands/claude-code/*.md` | Claude Code slash commands |
| `commands/opencode/*.md` | OpenCode slash commands + example config |
| `~/.config/opencode/opencode.json` | OpenCode MCP server + inline slash commands (runtime) |
| `~/.claude/commands/*.md` | Claude Code slash commands (installed copies, runtime) |
| `~/.claude/plans/*.md` | Plan mode output — raw plan markdown files (legacy) |
| `<project>/.plans/<id>/` | Local storage — plan JSON, markdown, CLAUDE.md, phases/ |
| `~/.plan-bridge/plans/*.json` | Global storage — legacy plan JSON files (backward compatible) |

## Plan JSON Structure

```json
{
  "id": "uuid",
  "name": "descriptive-name",
  "content": "# Full plan markdown...",
  "status": "submitted|in_progress|review_requested|needs_fixes|completed",
  "source": "claude-code",
  "project_path": "/absolute/path/to/project",
  "storage_mode": "local|global",
  "is_phased": true,
  "current_phase_id": "uuid",
  "phases": [
    {
      "id": "uuid",
      "phase_number": 1,
      "name": "Setup & Configuration",
      "description": "...",
      "dependencies": [],
      "content": "# Phase-specific markdown...",
      "status": "submitted|in_progress|review_requested|needs_fixes|completed",
      "reviews": [...],
      "fix_reports": [...],
      "created_at": "ISO",
      "updated_at": "ISO"
    }
  ],
  "created_at": "ISO timestamp",
  "updated_at": "ISO timestamp",
  "reviews": [],
  "fix_reports": []
}
```

**Notes:**
- `storage_mode`: "local" (default) stores at `<project>/.plans/<id>/`, "global" stores at `~/.plan-bridge/plans/`
- `is_phased`: true if plan was split into phases based on complexity
- `phases`: Array of Phase objects, each with own reviews and fix_reports
- For phased plans, reviews/fixes go on phases, not plan level
- `current_phase_id`: The active phase being implemented/reviewed


<claude-mem-context>
# Recent Activity

<!-- This section is auto-generated by claude-mem. Edit content outside the tags. -->

### Feb 9, 2026

| ID | Time | T | Title | Read |
|----|------|---|-------|------|
| #3384 | 2:18 PM | ✅ | Gitignore Added for Plan-Bridge Project | ~437 |
</claude-mem-context>
