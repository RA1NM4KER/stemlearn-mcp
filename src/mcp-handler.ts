import type { OAuthResourceContext } from "@cloudflare/workers-oauth-provider";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { MoodleClient, MoodleTimeoutError } from "./moodle-client.js";
import { createStemLearnServer } from "./create-server.js";
import { resolveMoodleConfig, resolveMoodleConfigForOAuthUser, AccountLinkRequiredError, DEFAULT_USER_ID } from "./linking/resolve-config.js";
import type { Env, McpProps } from "./oauth/env.js";

// The actual MCP transport, wrapped by OAuthProvider as apiRoute "/mcp"
// (src/oauth/provider.ts). Reached only after either lane's auth succeeds:
// resolveExternalToken (legacy static bearer, ctx.props.legacy === true) or
// a real OAuth-issued token (ctx.props.userId is a derived stemlearn:... id).

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

function accountLinkRequiredResponse(): Response {
  return new Response(
    JSON.stringify({ error: "Connect your STEMLearn account before using this MCP.", code: "account_link_required" }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  );
}

/**
 * Mirrors the JSON-RPC 2.0 spec's standard parse-error shape (code -32700) —
 * this is the same response WebStandardStreamableHTTPServerTransport itself
 * returns for an unparsable POST body. Reproducing it here (for the early,
 * pre-Moodle-client check below) is safe because it's the wire-format
 * spec's error code, not an SDK-internal detail.
 */
function jsonRpcParseErrorResponse(): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error: Invalid JSON" }, id: null }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );
}

export async function handleMcpRequest(
  request: Request,
  env: Env,
  ctx: OAuthResourceContext<McpProps>,
): Promise<Response> {
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
    // Two clearly separated lanes, never confused: the legacy static bearer
    // (ctx.props.legacy, set only by our own resolveExternalToken) always
    // resolves DEFAULT_USER_ID with the env-secret fallback; a real OAuth
    // token always resolves its derived userId with NO fallback — a missing
    // credential there must never silently run as DEFAULT_USER_ID or the env
    // secret.
    const config = ctx.props.legacy
      ? await resolveMoodleConfig(DEFAULT_USER_ID, env)
      : await resolveMoodleConfigForOAuthUser(ctx.props.userId, env);
    const client = await MoodleClient.create(config);
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
    if (err instanceof AccountLinkRequiredError) return accountLinkRequiredResponse();
    return workerErrorResponse(err);
  }
}
