import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";
import { ensureStorage } from "./storage.js";

const server = new McpServer({
  name: "plan-bridge",
  version: "1.0.0",
});

ensureStorage();
registerTools(server);

const transport = new StdioServerTransport();
server.connect(transport);
