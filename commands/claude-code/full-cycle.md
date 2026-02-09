You are Claude Code acting as the **orchestrator** in the plan-bridge workflow.

Your task: submit a plan, trigger OpenCode to implement it, review the implementation, and loop the review cycle — all from this single terminal. The user does NOT need to switch terminals or interact with OpenCode directly.

## How Plans Are Created

Claude Code's plan mode saves plans as markdown files in `~/.claude/plans/`. When the user runs `/full-cycle`, you need to find the plan content from one of these sources (in priority order):

1. **Argument**: If `$ARGUMENTS` is provided, treat it as a plan name or file path. Search `~/.claude/plans/` for a matching file.
2. **Conversation**: If a plan was just discussed/created in this conversation, extract it.
3. **Latest plan file**: Read the most recently modified `.md` file from `~/.claude/plans/`.

## Available MCP Tools
- `list_plans` — List plans filtered by status and/or project_path
- `submit_plan` — Submit a new plan (name, content, project_path, source)
- `get_plan` — Get a specific plan by ID or latest by status
- `submit_review` — Submit review findings (empty array = approved)
- `wait_for_status` — Poll until plan reaches target status

## Steps

### Phase 1: Submit the Plan

1. **Find the plan content** (same logic as `/send-plan`):
   - If `$ARGUMENTS` is not empty, search for a plan file matching that name in `~/.claude/plans/`.
   - Otherwise, check if there's a detailed plan in the current conversation.
   - If neither, list files in `~/.claude/plans/` sorted by modification time and read the most recent one.
   - If no plan found: "No plan found. Please create a plan first (use plan mode or describe what you want to build)."

2. **Check for existing plans:**
   - Call `list_plans` with `project_path` set to the current working directory.
   - If there are active plans for this project, warn the user and list them. Ask if they want to submit a new plan or work with an existing one.

3. **Submit the plan:**
   - Call `submit_plan` with name, content, project_path (current working directory), and source "claude-code".
   - Save the plan ID — you'll need it for all subsequent steps.
   - Tell the user: "Plan submitted: [plan-id]. Triggering OpenCode to implement..."

### Phase 2: Trigger OpenCode to Implement

4. **Run OpenCode in background:**
   - Execute this bash command in the background:
     ```
     cd <project_path> && opencode run --command get-plan "<plan-id>"
     ```
   - Tell the user: "OpenCode is implementing the plan. Waiting for completion..."

5. **Wait for implementation:**
   - Call `wait_for_status` with the plan_id, target_status "review_requested", and timeout_seconds 600.
   - If timeout: tell the user "OpenCode timed out. Check the implementation status and retry."
   - If reached: tell the user "OpenCode finished implementing. Starting review..."

### Phase 3: Automated Review Loop

6. **Review the implementation:**
   - Read the plan content to understand every requirement.
   - Read the actual project files in the project_path. Examine:
     - Whether all planned features were implemented
     - Code quality and correctness
     - Security issues
     - Missing error handling
     - Deviations from the plan
     - Any bugs or logic errors

7. **Compile findings** as an array of specific, actionable strings. Include file paths and line numbers (e.g., "src/auth.ts:42 — Missing input validation on email in registerUser()").

8. **Submit the review:**
   - Call `submit_review` with the plan_id and findings array.
   - If findings is empty (0 issues):
     - Plan is approved and marked completed.
     - Report: "Plan APPROVED. 0 findings. Implementation is complete."
     - **Stop here.**
   - If findings exist:
     - Report findings count and summary to the user.
     - Continue to step 9.

9. **Trigger OpenCode to fix:**
   - Execute this bash command in the background:
     ```
     cd <project_path> && opencode run --command claude-review "<plan-id>"
     ```
   - Tell the user: "OpenCode is fixing [N] findings. Waiting for fixes..."

10. **Wait for fixes:**
    - Call `wait_for_status` with the plan_id, target_status "review_requested", and timeout_seconds 600.
    - If timeout: tell the user and stop.
    - If reached: tell the user "OpenCode finished fixing. Re-reviewing..."

11. **Go back to step 6** and re-review.
    - Repeat this loop until the review has 0 findings (step 8 approves the plan).

### Phase 4: Final Report

12. When the plan is approved, provide a summary:
    - Plan ID and name
    - Number of review rounds
    - Total findings across all rounds
    - Final status: COMPLETED
    - "The full cycle is complete. All code has been implemented and reviewed."

## Important
- Include ALL relevant details in review findings — file paths, line numbers, function names
- Be thorough but fair — focus on real issues, not style preferences
- Every finding should be specific enough for OpenCode to fix without ambiguity
- Report progress to the user at every phase transition
- If OpenCode times out, do NOT retry automatically — ask the user
- The `opencode run --command` syntax is: `opencode run --command <command-name> "<argument>"`
