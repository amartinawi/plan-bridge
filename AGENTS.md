# Agents Guide: Plan Bridge Workflow

This document describes how AI agents (Claude Code and OpenCode) should interact with the plan-bridge MCP server.

## Roles

- **Claude Code** = Planner and Reviewer
- **OpenCode** = Executor and Fixer

## MCP Server

The `plan-bridge` MCP server runs as a stdio process. Both clients connect to the same server (each spawns its own process). Shared state is persisted as JSON files in `~/.plan-bridge/plans/`.

## Available MCP Tools

### submit_plan
- **Used by:** Claude Code
- **Params:** `name` (string), `content` (string, markdown), `project_path` (string), `source` (optional string)
- **Effect:** Creates a new plan with status `submitted`
- **Returns:** `{ id, status, name }`

### get_plan
- **Used by:** Both
- **Params:** `id` (optional string), `status` (optional enum)
- **Behavior:** If `id` provided, fetches that plan. Otherwise returns the latest plan, optionally filtered by status.
- **Returns:** Full plan JSON or "No plan found."

### list_plans
- **Used by:** Both
- **Params:** `status` (optional enum), `project_path` (optional string)
- **Returns:** Array of plan summaries (id, name, status, source, project_path, updated_at, reviews_count, fix_reports_count)

### update_plan_status
- **Used by:** Both
- **Params:** `id` (string), `status` (enum: submitted, in_progress, review_requested, needs_fixes, completed)
- **Effect:** Updates the plan's status and updated_at timestamp
- **Returns:** `{ id, status }`

### submit_review
- **Used by:** Claude Code
- **Params:** `plan_id` (string), `findings` (string array)
- **Effect:** Appends a review to the plan. Empty findings = approved, sets status to `completed`. Non-empty = sets status to `needs_fixes`.
- **Returns:** `{ review_id, plan_status, findings_count, approved }`

### get_review
- **Used by:** OpenCode
- **Params:** `plan_id` (string)
- **Returns:** Latest review object for the plan (id, timestamp, findings, status)

### submit_fix_report
- **Used by:** OpenCode
- **Params:** `plan_id` (string), `review_id` (string), `fixes_applied` (string array)
- **Effect:** Appends a fix report and auto-sets status to `review_requested`
- **Returns:** `{ fix_report_id, plan_status, fixes_count }`

### mark_complete
- **Used by:** Both
- **Params:** `id` (string)
- **Effect:** Force-sets status to `completed`
- **Returns:** `{ id, status }`

### wait_for_status
- **Used by:** Both
- **Params:** `plan_id` (string), `target_status` (enum), `timeout_seconds` (optional number, default 300)
- **Behavior:** Polls the plan file every 5 seconds. Blocks until the plan reaches the target status or the timeout expires. Returns early if the plan status becomes `completed` while waiting for a different status.
- **Returns:** `{ reached: boolean, plan_id, status, waited_seconds }` on success, or `{ reached: false, message }` on timeout

## Status Flow

```
submitted --> in_progress --> review_requested --> needs_fixes --> review_requested --> ... --> completed
```

| Status | Meaning |
|--------|---------|
| `submitted` | Plan created, waiting for executor to pick up |
| `in_progress` | Executor is actively implementing |
| `review_requested` | Implementation done, waiting for reviewer |
| `needs_fixes` | Reviewer found issues, waiting for executor to fix |
| `completed` | Reviewer approved (0 findings) or force-completed |

## Workflow for Claude Code (Planner/Reviewer)

### Submitting a plan (`/send-plan`)
1. Extract or compose the plan from the conversation
2. Call `submit_plan` with name, full markdown content, and project_path
3. Report the plan ID to the user

### Reviewing implementation (`/review-plan`)
1. Call `get_plan` with `status: "review_requested"`
2. Read the plan content to understand what should have been implemented
3. Read the actual project files and compare against the plan
4. Compile specific, actionable findings (include file paths and function names)
5. Call `submit_review` with the findings array (empty = approved)

### Review guidelines
- Focus on correctness, security, completeness, and real bugs
- Each finding should be specific enough for another AI to fix without ambiguity
- Format: `"file/path.ts: Description of the issue in functionName()"`
- Approve with empty findings if the implementation is solid

## Workflow for OpenCode (Executor/Fixer)

### Implementing a plan (`/get-plan`)
1. Call `get_plan` with `status: "submitted"` (fall back to `status: "needs_fixes"`)
2. Call `update_plan_status` to set `in_progress`
3. Implement everything described in the plan content
4. Call `update_plan_status` to set `review_requested`

### Fixing review findings (`/claude-review`)
1. Call `get_plan` with `status: "needs_fixes"`
2. Call `get_review` to get the latest review findings
3. Fix each finding in the codebase
4. Call `submit_fix_report` with the review_id and descriptions of each fix

### Force-completing (`/mark-done`)
1. Call `list_plans` to find the target plan
2. Call `mark_complete` with the plan ID

## Full-Cycle Workflow (Single Terminal)

Claude Code can orchestrate the entire plan→implement→review→fix cycle from a single terminal using `/full-cycle`. It triggers OpenCode non-interactively via `opencode run --command`.

### How it works
1. Claude Code submits the plan via `submit_plan`
2. Claude Code runs `opencode run --command get-plan "<plan-id>"` in background
3. Claude Code calls `wait_for_status("review_requested")` — blocks until OpenCode finishes implementing
4. Claude Code reviews the code, compiles findings, calls `submit_review`
5. If findings > 0:
   - Claude Code runs `opencode run --command claude-review "<plan-id>"` in background
   - Claude Code calls `wait_for_status("review_requested")` — blocks until OpenCode finishes fixing
   - Claude Code re-reviews → loop back to step 4
6. If findings = 0: plan is marked completed, both sides stop

### Key requirements
- `opencode` CLI must be installed and available in PATH
- OpenCode must have the plan-bridge MCP server configured in `~/.config/opencode/opencode.json`
- The `get-plan` and `claude-review` commands must be defined in OpenCode's config

## Data Model

### Plan
```
{
  id: string (UUID),
  name: string,
  content: string (markdown),
  status: PlanStatus,
  source: string ("claude-code" | "opencode"),
  project_path: string,
  created_at: string (ISO 8601),
  updated_at: string (ISO 8601),
  reviews: Review[],
  fix_reports: FixReport[]
}
```

### Review
```
{
  id: string (UUID),
  timestamp: string (ISO 8601),
  findings: string[],
  status: "needs_fixes" | "approved"
}
```

### FixReport
```
{
  id: string (UUID),
  timestamp: string (ISO 8601),
  review_id: string,
  fixes_applied: string[]
}
```

## Storage

Plans are stored as individual JSON files at `~/.plan-bridge/plans/{plan-id}.json`. The directory is auto-created on server startup. Each client spawns its own server process but reads/writes the same files, so state is always in sync.
