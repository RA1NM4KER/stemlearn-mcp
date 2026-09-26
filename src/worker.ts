import type { D1Database } from "./linking/d1.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { MoodleClient, MoodleTimeoutError } from "./moodle-client.js";
import { createStemLearnServer } from "./create-server.js";
import { DEFAULT_USER_ID, resolveMoodleConfig } from "./linking/resolve-config.js";
import { handleLinkComplete, handleLinkDisconnect, handleLinkStart } from "./linking/routes.js";
import { CONNECT_PAGE_HTML } from "./linking/connect-page.js";

// Private, single-user remote transport. Gated by the MCP_ACCESS_TOKEN
// bearer secret below — this is temporary single-user authentication, not a
// multi-user/OAuth endpoint. Account linking (src/linking/*) lets the single
// fixed identity resolve a per-user Moodle credential from D1 instead of the
// env-secret fallback, but does not itself add multi-user support. See
// AGENTS.md before extending this file.

interface Env {
  MOODLE_URL: string;
  MOODLE_TOKEN: string;
  MOODLE_MCP_MAX_FILE_MB?: string;
  MOODLE_MCP_REQUEST_TIMEOUT_MS?: string;
  MCP_ACCESS_TOKEN: string;
  DB: D1Database;
  CREDENTIAL_ENCRYPTION_KEY?: string;
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function unauthorizedResponse(): Response {
  return jsonResponse(401, { error: "Unauthorized", code: "unauthorized" });
}

/**
 * Mirrors the JSON-RPC 2.0 spec's standard parse-error shape (code -32700) —
 * this is the same response WebStandardStreamableHTTPServerTransport itself
 * returns for an unparsable POST body. Reproducing it here (for the early,
 * pre-Moodle-client check below) is safe because it's the wire-format
 * spec's error code, not an SDK-internal detail.
 */
function jsonRpcParseErrorResponse(): Response {
  return jsonResponse(400, { jsonrpc: "2.0", error: { code: -32700, message: "Parse error: Invalid JSON" }, id: null });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time-ish comparison: compares fixed-length digests, never the raw secret, with no early exit. */
async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [digestA, digestB] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < digestA.length; i++) {
    diff |= digestA.charCodeAt(i) ^ digestB.charCodeAt(i);
  }
  return diff === 0 && digestA.length === digestB.length;
}

async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  if (!env.MCP_ACCESS_TOKEN) return false;
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return false;
  return constantTimeEqual(match[1]!, env.MCP_ACCESS_TOKEN);
}

async function handleMcpRequest(request: Request, env: Env): Promise<Response> {
  // Cheap pre-check, POST only (GET/DELETE carry no JSON-RPC body in this
  // transport): reject unparsable JSON before paying for a live Moodle
  // round-trip. Reads a *clone* — the original request's body is left
  // untouched, so on valid JSON the SDK below still does its own,
  // authoritative parse. This only checks JSON syntax, never JSON-RPC
  // message shape, so it can't diverge from or duplicate the SDK's parser.
  if (request.method === "POST") {
    try {
      await request.clone().json();
    } catch {
      return jsonRpcParseErrorResponse();
    }
  }

  try {
    const client = await MoodleClient.create(await resolveMoodleConfig(DEFAULT_USER_ID, env));
    const server = createStemLearnServer(client);
    // Stateless (no sessionIdGenerator) + JSON response mode: each request is
    // handled by a fresh transport/client, and the JSON-RPC response comes
    // back as a normal application/json body instead of an SSE stream — this
    // fits STEMLearn's request/response tool calls (no server-initiated
    // notifications) and avoids keeping a Worker connection open.
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch (err: unknown) {
    return workerErrorResponse(err);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return jsonResponse(200, { status: "ok" });
    }

    if (url.pathname === "/mcp") {
      if (!(await isAuthorized(request, env))) {
        return unauthorizedResponse();
      }
      // Only MOODLE_URL is required upfront: the Moodle token itself may come
      // from a linked D1 credential instead of MOODLE_TOKEN — see
      // resolveMoodleConfig. Both paths still need a configured Moodle host.
      if (!env.MOODLE_URL) {
        return jsonResponse(500, { error: "Moodle configuration is required.", code: "configuration_required" });
      }
      return handleMcpRequest(request, env);
    }

    if (url.pathname === "/connect" && request.method === "GET") {
      return new Response(CONNECT_PAGE_HTML, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    if (url.pathname === "/auth/stemlearn/start" && request.method === "POST") {
      if (!(await isAuthorized(request, env))) return unauthorizedResponse();
      return handleLinkStart(env);
    }

    if (url.pathname === "/auth/stemlearn/complete" && request.method === "POST") {
      // Intentionally not bearer-gated: the linking-session id itself, known
      // only to whoever /start handed it to, is this call's authority — see
      // src/linking/routes.ts.
      return handleLinkComplete(request, env);
    }

    if (url.pathname === "/auth/stemlearn/disconnect" && request.method === "POST") {
      if (!(await isAuthorized(request, env))) return unauthorizedResponse();
      return handleLinkDisconnect(env);
    }

    return jsonResponse(404, { error: "Not found", code: "not_found" });
  },
};
