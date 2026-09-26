import { handleLinkComplete, handleLinkDisconnect, handleLinkStart } from "./linking/routes.js";
import { CONNECT_PAGE_HTML } from "./linking/connect-page.js";
import type { Env } from "./oauth/env.js";

// Routes that predate OAuth and remain exactly as they were: /health,
// /connect (legacy developer-key linking UI), and the bearer-gated legacy
// /auth/stemlearn/* endpoints. These live in the OAuthProvider's
// defaultHandler alongside the new OAuth routes (src/oauth/routes.ts).

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function unauthorizedResponse(): Response {
  return jsonResponse(401, { error: "Unauthorized", code: "unauthorized" });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time-ish comparison: compares fixed-length digests, never the raw secret, with no early exit. */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [digestA, digestB] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < digestA.length; i++) {
    diff |= digestA.charCodeAt(i) ^ digestB.charCodeAt(i);
  }
  return diff === 0 && digestA.length === digestB.length;
}

export async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  if (!env.MCP_ACCESS_TOKEN) return false;
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return false;
  return constantTimeEqual(match[1]!, env.MCP_ACCESS_TOKEN);
}

/** Returns a Response for any legacy route it recognizes, or null if the caller should try other routes. */
export async function handleLegacyRoute(request: Request, env: Env, pathname: string): Promise<Response | null> {
  if (pathname === "/health") {
    return jsonResponse(200, { status: "ok" });
  }

  if (pathname === "/connect" && request.method === "GET") {
    return new Response(CONNECT_PAGE_HTML, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  if (pathname === "/auth/stemlearn/start" && request.method === "POST") {
    if (!(await isAuthorized(request, env))) return unauthorizedResponse();
    return handleLinkStart(env);
  }

  if (pathname === "/auth/stemlearn/complete" && request.method === "POST") {
    // Intentionally not bearer-gated: the linking-session id itself, known
    // only to whoever /start handed it to, is this call's authority — see
    // src/linking/routes.ts.
    return handleLinkComplete(request, env);
  }

  if (pathname === "/auth/stemlearn/disconnect" && request.method === "POST") {
    if (!(await isAuthorized(request, env))) return unauthorizedResponse();
    return handleLinkDisconnect(env);
  }

  return null;
}
