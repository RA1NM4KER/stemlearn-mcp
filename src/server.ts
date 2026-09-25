#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getConfig, loadTokenFile } from "./config.js";
import { MoodleClient } from "./moodle-client.js";
import { createStemLearnServer } from "./create-server.js";

const isConfigured = Boolean(process.env.MOODLE_URL || loadTokenFile());

if (process.stdin.isTTY && !isConfigured) {
  console.log(`
stemlearn-mcp v0.1.0 — STEMLearn (Moodle) MCP Server

This tool runs as a background server for an MCP client (e.g. Claude Code) —
you don't run it directly by hand.

━━━ First: authenticate ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  npm run auth

Opens a browser for STEMLearn SSO + Microsoft Authenticator sign-in, then
saves a token to .auth/token.json. No credentials are pasted anywhere.

━━━ Then: point your MCP client at this server ━━━━━━━━━━━━━━━━━━━
No env vars needed — the server reads .auth/token.json automatically.

Claude Code:
  claude mcp add stemlearn -- node ${process.cwd()}/dist/server.js

Claude Desktop config file:
  Mac:     ~/Library/Application Support/Claude/claude_desktop_config.json
  Windows: %APPDATA%\\Claude\\claude_desktop_config.json

  "mcpServers": {
    "stemlearn": {
      "command": "node",
      "args": ["${process.cwd()}/dist/server.js"]
    }
  }

(Env vars MOODLE_URL / MOODLE_TOKEN / MOODLE_USERNAME+MOODLE_PASSWORD still
work as a secondary option and override the token file per-field.)
`);
  process.exit(0);
}

async function main() {
  const config = getConfig();
  const client = await MoodleClient.create(config);

  const server = createStemLearnServer(client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Failed to start STEMLearn MCP:", err.message);
  process.exit(1);
});
