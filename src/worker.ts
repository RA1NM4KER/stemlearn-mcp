import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { normalizeUrl, parseMaxFileMb, parseRequestTimeoutMs } from "./config.js";
import { MoodleClient, MoodleTimeoutError } from "./moodle-client.js";
import { createStemLearnServer } from "./create-server.js";

// Experimental development transport only. STEMLearn supports local stdio
// for personal Moodle tokens; do not deploy this Worker as a token host.

interface Env {
  MOODLE_URL: string;
  MOODLE_TOKEN: string;
  MOODLE_MCP_MAX_FILE_MB?: string;
  MOODLE_MCP_REQUEST_TIMEOUT_MS?: string;
}

export function workerErrorResponse(error: unknown): Response {
  const code = error instanceof MoodleTimeoutError ? "moodle_timeout" : "moodle_request_failed";
  const message = error instanceof MoodleTimeoutError
    ? "Moodle request timed out. Please try again."
    : "Moodle request failed. Please try again.";
  return new Response(JSON.stringify({ error: message, code }), {
    status: 502,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.MOODLE_URL || !env.MOODLE_TOKEN) {
      return new Response(
        JSON.stringify({ error: "Moodle configuration is required.", code: "configuration_required" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    try {
      const maxFileBytes = Math.floor(parseMaxFileMb(env.MOODLE_MCP_MAX_FILE_MB) * 1024 * 1024);
      const requestTimeoutMs = parseRequestTimeoutMs(env.MOODLE_MCP_REQUEST_TIMEOUT_MS);
      const config = {
        baseUrl: normalizeUrl(env.MOODLE_URL),
        maxFileBytes,
        requestTimeoutMs,
        auth: { kind: "token" as const, token: env.MOODLE_TOKEN },
      };
      const client = await MoodleClient.create(config);

      const server = createStemLearnServer(client);

      const transport = new WebStandardStreamableHTTPServerTransport({});
      await server.connect(transport);
      return transport.handleRequest(request);
    } catch (err: unknown) {
      return workerErrorResponse(err);
    }
  },
};
