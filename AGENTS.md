# Agents Guide: Plan Bridge Workflow

## Build/Dev/Test Commands

```bash
cd plan-bridge-mcp
npm install
npm run build        # tsup -> build/index.cjs (CJS bundle)
npm run dev          # tsx -> run src/index.ts directly
```

**Node.js:** 18.0.0 or higher required

**Type checking:** No explicit typecheck command. Build with TypeScript implicitly type-checks.

**Testing:** No test framework configured. This project uses direct MCP tool interaction for validation.

## Code Style Guidelines

### Project Type
- **Language:** TypeScript with ES modules (`"type": "module"` in package.json)
- **Build target:** ES2022, bundled to CJS with tsup
- **Runtime:** Node.js 18+

### Imports and Modules
- Use ES module imports (not `require()`)
- **Always append `.js` extensions to local imports** (required for ES modules)
  ```ts
  import { loadPlan } from "./storage.js";
  import type { Plan, PlanStatus } from "./types.js";
  ```
- Third-party imports do not need extensions
  ```ts
  import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
  import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
  import { z } from "zod";
  ```

### Types and Interfaces
- Define interfaces in dedicated type files (e.g., `types.ts`)
- Use `type` for type aliases, `interface` for object shapes
- Use union types for string literals (e.g., `PlanStatus`)
- Import types explicitly: `import type { Plan, PlanStatus } from "./types.js";`
- Type assertions (`as`) are acceptable for external JSON parsing

### Naming Conventions
- **Files:** lowercase with hyphens for directories, `.ts` extension
- **Variables/functions:** camelCase (`savePlan`, `loadLatestPlan`)
- **Constants/Config:** UPPER_SNAKE_CASE (`STORAGE_DIR`, `pollInterval`)
- **Types/Interfaces:** PascalCase (`PlanStatus`, `Review`, `FixReport`)
- **MCP tools:** snake_case (follows MCP convention: `submit_plan`, `get_plan`)
- **Private/internal functions:** no prefix, just clean names

### Code Formatting
- **No enforced formatter** - follow TypeScript conventions
- Use 2-space indentation
- Use semicolons
- Use single quotes for string literals
- Align arrow function parameters when multiline

### Error Handling
- Keep error handling simple and minimal
- Return early with plain text messages from MCP tools:
  ```ts
  if (!plan) {
    return { content: [{ type: "text" as const, text: "Plan not found." }] };
  }
  ```
- For internal functions, return `null` for not-found cases (e.g., `loadPlan`)
- Do not throw errors unless critical - let the MCP layer handle it

### Logging
- Use `console.error()` for all logging (MCP stdio transport)
- Log important events with descriptive messages and emojis:
  ```ts
  console.error(`[plan-bridge] ✅ Plan submitted: ${plan.id} (${plan.name})`);
  console.error(`[plan-bridge] ⏳ Waiting for status: ${plan.name}`);
  console.error(`[plan-bridge] 🔧 Fixes submitted: ${plan.name}`);
  ```
- Log status transitions and key workflow events

### Async/Await
- Use `async/await` for all asynchronous operations
- File I/O uses sync operations from `fs` module (synchronous is acceptable here)
- Use `setTimeout` wrapped in Promise for delays:
  ```ts
  await new Promise((resolve) => setTimeout(resolve, pollInterval));
  ```

### Zod Validation
- All MCP tool parameters must use `zod` schemas
- Describe parameters clearly with `.describe()`
- Mark optional parameters with `.optional()`
- Use `.enum()` for known string values:
  ```ts
  status: z.enum(["submitted", "in_progress", ...]).optional()
  ```

### MCP Tool Patterns
- Register tools with `server.tool(name, description, schema, handler)`
- Handler receives destructured params: `async ({ id, status }) => { ... }`
- Always return `{ content: [{ type: "text" as const, text: JSON.stringify(...) }] }`
- Use `const` assertion for literals: `type: "text" as const`

### Server Initialization
- Entry point: `src/index.ts`
- Create `McpServer` instance, then `StdioServerTransport`
- Call `ensureStorage()` before registering tools:
  ```ts
  const server = new McpServer({ name: "plan-bridge", version: "1.0.0" });
  ensureStorage();
  registerTools(server);
  const transport = new StdioServerTransport();
  server.connect(transport);
  ```

### File Structure
- `src/index.ts` - Server entry point, initialization
- `src/tools.ts` - MCP tool definitions (all tools in one file)
- `src/storage.ts` - File persistence layer
- `src/types.ts` - Type definitions
- `build/index.cjs` - Compiled CJS bundle (output)

### Important Notes
- **Do NOT add comments** to code unless explicitly asked
- Storage directory is `~/.plan-bridge/plans/` (auto-created on startup)
- Use `randomUUID()` from `crypto` for IDs (Node.js built-in)
- ISO 8601 timestamps via `new Date().toISOString()`
- Plan status transitions: submitted → in_progress → review_requested → needs_fixes → review_requested → ... → completed
