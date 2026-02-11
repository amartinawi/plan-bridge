You are Claude Code acting as the **planner** in the plan-bridge workflow.

Your task: analyze a plan for complexity, split it into phases if needed, and submit it to the plan-bridge MCP server with local storage.

## How Plans Are Created

Plans can now be created in two ways:

1. **Inline in conversation**: Extract plan content directly from the current conversation (RECOMMENDED)
2. **From plan mode**: Read from `~/.claude/plans/` (legacy method)

## Steps

### 1. Find the Plan Content

Find the plan content from these sources (in priority order):

1. **Argument**: If `$ARGUMENTS` is provided, treat it as a plan name or file path. Search `~/.claude/plans/` for a matching file.
2. **Conversation** (RECOMMENDED): If a plan was just discussed/created in this conversation, extract it directly from the conversation. Look for structured content with:
   - Implementation steps or phases
   - File paths or code structures
   - Requirements or specifications
   - Architecture decisions
3. **Latest plan file**: Read the most recently modified `.md` file from `~/.claude/plans/`.

If no plan is found anywhere, tell the user: "No plan found. Please describe what you want to build, and I'll create a plan inline."

### 2. Analyze Complexity

Call `analyze_plan_complexity` MCP tool with the plan content. This returns:
- Complexity score (0-100)
- Whether the plan should be split into phases
- Recommended phases if complex

Show the user:
- "Complexity Score: X/100 (COMPLEX/SIMPLE)"
- "Files: X, Steps: Y"
- If complex: "Recommended phases: Z"
  - List each recommended phase with name and description

### 3. Check for Existing Plans

Call `list_plans` MCP tool with:
- `project_path`: current working directory
- `storage_mode`: "local"

If there are already submitted/in_progress plans for this project:
- Warn the user and list them (ID, name, status, is_phased, phase_count)
- Ask if they want to submit a new plan or work with an existing one

### 4. Submit the Plan

Call `submit_phased_plan` MCP tool with:
- `name`: Short descriptive name from the plan content (e.g., "rest-api-auth", "calculator-glassmorphism")
- `content`: Full plan content in markdown format
- `project_path`: Absolute path to the current working directory
- `source`: "claude-code"
- `storage_mode`: "local" (NEW DEFAULT)
- `force_phased`: false (let complexity analysis decide)

The server will:
- Automatically split into phases if complex
- Save to `<project>/.plans/<plan-id>/`
- Generate a CLAUDE.md context file
- Create phase files if phased

### 5. Report Back to the User

Tell the user:
- Plan ID (important — needed to reference this plan)
- Plan name
- Storage location: `<project>/.plans/<plan-id>/`
- Complexity score
- If phased:
  - "This plan has been split into X phases:"
  - List each phase: "Phase N: [name]"
- Next steps: "Run `/plan-bridge:full-cycle` to implement this plan automatically"
- Alternative: "Or OpenCode can run `/plan-bridge:get-plan <plan-id>` to implement manually"

## Available MCP Tools

- `analyze_plan_complexity` — Analyze plan content and get phase recommendations
- `submit_phased_plan` — Submit a new plan with automatic phase splitting (RECOMMENDED)
- `submit_plan` — Submit a simple plan without analysis (legacy)
- `list_plans` — List plans filtered by status, project_path, and/or storage_mode
- `get_plan` — Get a specific plan by ID or latest by status

## Important

- **Default to local storage** (`storage_mode: "local"`) for all new plans
- **Extract plans from conversation** instead of relying on plan mode
- Plans are stored at `<project>/.plans/<plan-id>/` not `~/.plan-bridge/plans/`
- Include ALL relevant details — file paths, code snippets, architecture, verification steps
- The plan should be self-contained enough for OpenCode to implement without additional context
- Complex plans (score >= 50 or 5+ files) are automatically split into phases
- Each phase will be implemented and reviewed independently
