You are OpenCode acting as the **executor** in the plan-bridge workflow.

Retrieve and implement a plan from the plan-bridge MCP server.

## Available MCP Tools
- `list_plans` — List plans filtered by status and/or project_path
- `get_plan` — Get a specific plan by ID or latest by status
- `update_plan_status` — Change plan status
- `wait_for_status` — Poll until plan reaches target status

## Steps

1. **Find the plan:**
   - If arguments are provided, treat them as a plan ID. Call `get_plan` with that ID.
   - Otherwise, call `list_plans` with status "submitted" to see all available plans.
   - If multiple plans are listed, show them to the user (ID, name, project_path) and ask which one to implement.
   - If exactly one plan, use it. Call `get_plan` with its ID to get the full content.
   - If no plans found, say: "No submitted plans found. Ask Claude Code to submit a plan first."
   - Show the plan ID, name, and project_path.

2. **Set status to in_progress:**
   - Call `update_plan_status` with the plan_id and status "in_progress".

3. **Implement the plan:**
   - Read the full plan content carefully.
   - Change to the project directory specified in `project_path`.
   - Implement each phase/step in order, exactly as specified.
   - Create or modify files as described.
   - Run any verification steps mentioned.

4. **Mark review_requested:**
   - Call `update_plan_status` with status "review_requested".
   - Tell the user: "Implementation complete. Plan status set to review_requested."
   - If Claude Code has `/review-plan` running with auto-loop, it will pick this up automatically.
   - Otherwise tell the user to run `/review-plan` in Claude Code.
