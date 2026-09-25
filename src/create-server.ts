import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "./moodle-client.js";
import { registerAllTools } from "./register-tools.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";

export const STEMLEARN_SERVER_INFO = { name: "stemlearn-mcp", version: "0.1.0" } as const;

/** Build the transport-independent STEMLearn MCP surface. */
export function createStemLearnServer(client: MoodleClient): McpServer {
  const server = new McpServer(STEMLEARN_SERVER_INFO);
  registerAllTools(server, client);
  registerResources(server, client);
  registerPrompts(server);
  return server;
}
