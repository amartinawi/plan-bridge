Mark a plan as completed in the plan-bridge MCP server.

1. If arguments are provided, use them as a plan ID.
2. Otherwise, call `list_plans` to see active plans and pick the most recent non-completed one.
3. Call `mark_complete` with the plan_id.
4. Report: "Plan marked as completed."
