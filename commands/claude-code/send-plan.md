You are Claude Code acting as the **planner** in the plan-bridge workflow.

Your task: submit an implementation plan to the plan-bridge MCP server so OpenCode can pick it up and implement it.

## How Plans Are Created

Claude Code's plan mode saves plans as markdown files in `~/.claude/plans/`. When the user runs `/send-plan`, you need to find the plan content from one of these sources (in priority order):

1. **Argument**: If `$ARGUMENTS` is provided, treat it as a plan name or file path. Search `~/.claude/plans/` for a matching file.
2. **Conversation**: If a plan was just discussed/created in this conversation, extract it.
3. **Latest plan file**: Read the most recently modified `.md` file from `~/.claude/plans/`.

## Steps

1. **Find the plan content:**
   - If `$ARGUMENTS` is not empty, search for a plan file matching that name in `~/.claude/plans/` (partial match on filename is OK). Read its content.
   - Otherwise, check if there's a detailed plan in the current conversation (look for structured content with headings, phases, file paths, implementation steps).
   - If neither, list files in `~/.claude/plans/` sorted by modification time and read the most recent one.
   - If no plan is found anywhere, tell the user: "No plan found. Please create a plan first (use plan mode or describe what you want to build)."

2. **Check for existing plans in this project:**
   - Call `list_plans` MCP tool with `project_path` set to the current working directory.
   - If there are already submitted/in_progress plans for this project, warn the user and list them. Ask if they want to submit a new plan or work with an existing one.

3. **Submit the plan:**
   - Call the `submit_plan` MCP tool with:
     - `name`: A short descriptive name derived from the plan content (e.g., "rest-api-auth", "calculator-glassmorphism")
     - `content`: The full plan content in markdown format
     - `project_path`: The absolute path to the current working directory
     - `source`: "claude-code"

4. **Report back to the user:**
   - The plan ID (important — needed to reference this specific plan)
   - The plan name
   - Instruct: "OpenCode can now run `/get-plan <plan-id>` to retrieve and implement this plan."
   - If there are multiple plans for this project, remind them to use the plan ID when running `/get-plan`.

## Available MCP Tools
- `list_plans` — List plans filtered by status and/or project_path
- `submit_plan` — Submit a new plan (name, content, project_path, source)
- `get_plan` — Get a specific plan by ID or latest by status

## Important
- Include ALL relevant details in the plan content — file paths, code snippets, architecture decisions, verification steps
- The plan should be self-contained enough for another AI to implement without additional context
- If the plan references specific files, include their full absolute paths
