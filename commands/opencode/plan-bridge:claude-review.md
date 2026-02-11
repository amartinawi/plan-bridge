You are OpenCode acting as the **executor** in the plan-bridge workflow.

Your task: get review findings from Claude Code for the current phase, apply fixes, and loop until approved.

## Available MCP Tools

- `list_plans` — List plans filtered by status, project_path, storage_mode
- `get_plan` — Get a specific plan by ID (include project_path)
- `get_current_phase` — Get the active phase for a phased plan
- `get_review` — Get the latest review findings for plan or current phase (include project_path)
- `submit_fix_report` — Report fixes applied (auto-sets status to review_requested, include project_path)
- `wait_for_status` — Poll until plan reaches target status (include project_path)

## Steps

### 1. Find the Plan

- If arguments are provided, use them as a plan ID
  - Call `get_plan` with id and project_path (current working directory)
- Otherwise, call `list_plans` with:
  - `status`: "needs_fixes"
  - `project_path`: current working directory
  - `storage_mode`: "local"
- If multiple plans listed, show them (ID, name, is_phased, phase_count) and ask which to work on
- If none found, try `list_plans` with `status: "review_requested"` — tell user to wait for Claude Code to review first
- If none found at all: "No plans need attention."

### 2. Check if Phased

Check the plan's `is_phased` field:
- If `true`, call `get_current_phase` to see which phase you're fixing
  - Show user: "Fixing findings for Phase X/Y: [phase name]"
- If `false`, show: "Fixing findings for plan: [plan name]"

### 3. Get the Review Findings

Call `get_review` with:
- `plan_id`: the plan ID
- `project_path`: current working directory

For phased plans:
- The findings are scoped to the CURRENT PHASE only
- Do NOT fix issues in other phases

Read each finding carefully and show the user the findings list.

### 4. Apply Fixes

For each finding:
- Implement the fix in the codebase at the specified file/location
- Be precise — the finding includes file paths and line numbers
- Focus only on what the finding describes

For phased plans:
- Only fix issues related to the current phase
- Read `.plans/<plan-id>/CLAUDE.md` for context if needed

### 5. Submit Fix Report

Call `submit_fix_report` with:
- `plan_id`: the plan ID
- `review_id`: the review ID from step 3
- `fixes_applied`: array describing each fix you made
- `project_path`: current working directory

This auto-sets the plan/phase to "review_requested".

### 6. AUTOMATED LOOP — Wait for Re-Review

Tell the user:
- For phased plans: "Fixes submitted for Phase X. Waiting for Claude Code to re-review..."
- For non-phased plans: "Fixes submitted. Waiting for Claude Code to re-review..."

Call `wait_for_status` with:
- `plan_id`: the plan ID
- `target_status`: "needs_fixes"
- `timeout_seconds`: 1200
- `project_path`: current working directory

Check the result:
- If plan status is "completed":
  - For phased plans: "Phase X approved! All findings resolved."
  - For non-phased plans: "Plan approved! All findings resolved."
  - **Stop.**
- If status is "needs_fixes":
  - New findings from re-review
  - **Go back to step 3** and fix the new findings
  - Repeat the loop
- If timeout:
  - Tell user to check Claude Code and retry

### 7. Repeat until approved

The loop continues automatically until the phase/plan is approved (0 findings).

## Important

- **For phased plans**: Only fix findings for the current phase
- **Include project_path** in all MCP tool calls for local storage lookup
- Plans are stored at `<project>/.plans/<plan-id>/` not `~/.plan-bridge/plans/`
- Fix exactly what the finding says — don't add extra changes
- If a finding is unclear, implement the most reasonable interpretation
- The automated loop handles re-reviews — no need to switch terminals
- Each phase is fixed and approved independently before advancing
