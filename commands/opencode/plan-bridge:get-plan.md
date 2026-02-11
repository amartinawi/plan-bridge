You are OpenCode acting as the **executor** in the plan-bridge workflow.

Retrieve and implement a plan (or current phase) from the plan-bridge MCP server.

## Available MCP Tools

- `list_plans` — List plans filtered by status, project_path, storage_mode
- `get_plan` — Get a specific plan by ID (include project_path)
- `get_current_phase` — Get the active phase for a phased plan
- `update_plan_status` — Change plan status (include project_path)
- `wait_for_status` — Poll until plan reaches target status (include project_path)

## Steps

### 1. Find the Plan

- If arguments are provided, treat them as a plan ID. Call `get_plan` with:
  - `id`: the plan ID
  - `project_path`: current working directory
- Otherwise, call `list_plans` with:
  - `status`: "submitted"
  - `project_path`: current working directory
  - `storage_mode`: "local"
- If multiple plans listed, show them (ID, name, is_phased, phase_count) and ask which to implement
- If exactly one plan, use it
- If no plans found: "No submitted plans found. Ask Claude Code to submit a plan first."
- Show the plan ID, name, project_path

### 2. Check if Phased

Check the plan's `is_phased` field:
- If `true`, call `get_current_phase` with plan_id and project_path
  - Show user: "This is a phased plan (X phases). Implementing Phase Y: [phase name]"
  - Use the PHASE CONTENT for implementation, not the full plan
  - Read the auto-generated `CLAUDE.md` at `<project>/.plans/<plan-id>/CLAUDE.md` for context
- If `false`, show: "Implementing full plan: [plan name]"
  - Use the full plan content

### 3. Set Status to in_progress

Call `update_plan_status` with:
- `id`: plan_id
- `status`: "in_progress"
- `project_path`: current working directory

### 4. Implement the Plan/Phase

For phased plans:
- **ONLY implement the current phase** — do NOT implement other phases
- Read the phase content from `get_current_phase` result
- Read `.plans/<plan-id>/CLAUDE.md` for full context
- Focus on files and requirements specified in this phase only

For non-phased plans:
- Read the full plan content
- Implement all requirements

Implementation:
- Change to the project directory specified in `project_path`
- Implement each step in order, exactly as specified
- Create or modify files as described
- Run any verification steps mentioned

### 5. Mark review_requested

Call `update_plan_status` with:
- `id`: plan_id
- `status`: "review_requested"
- `project_path`: current working directory

Tell the user:
- For phased plans: "Phase X implementation complete. Status set to review_requested."
- For non-phased plans: "Implementation complete. Status set to review_requested."
- "Claude Code will automatically review this when running `/plan-bridge:review-plan` or `/plan-bridge:full-cycle`"

## Important

- **For phased plans**: ONLY implement the current phase, not the entire plan
- **Include project_path** in all MCP tool calls for local storage lookup
- Plans are stored at `<project>/.plans/<plan-id>/` not `~/.plan-bridge/plans/`
- Read `CLAUDE.md` in the plan directory for full context and history
- Each phase is reviewed independently before the next phase begins
- Do NOT advance to the next phase yourself — Claude Code handles that after approval
