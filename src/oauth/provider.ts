import { OAuthProvider, type OAuthResourceContext } from "@cloudflare/workers-oauth-provider";
import type { Env, McpProps } from "./env.js";
import { handleMcpRequest } from "../mcp-handler.js";
import { handleLegacyRoute, constantTimeEqual, jsonResponse } from "../legacy-routes.js";
import { handleAuthorize, handleAuthorizeLink, handleConsentSubmit } from "./routes.js";
import { DEFAULT_USER_ID } from "../linking/resolve-config.js";

// This deployment's exact resource identity — both the AS and the sole RS.
// Keep in sync with the actual deployed workers.dev URL.
const ISSUER_URL = "https://stemlearn-mcp.kefasa112.workers.dev";
const MCP_RESOURCE_URL = `${ISSUER_URL}/mcp`;

async function defaultHandlerFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/authorize" && request.method === "GET") {
    return handleAuthorize(request, env);
  }
  if (url.pathname === "/authorize/link" && request.method === "POST") {
    return handleAuthorizeLink(request, env);
  }
  if (url.pathname === "/authorize/consent" && request.method === "POST") {
    return handleConsentSubmit(request, env);
  }

  const legacy = await handleLegacyRoute(request, env, url.pathname);
  if (legacy) return legacy;

  return jsonResponse(404, { error: "Not found", code: "not_found" });
}

export const oauthProvider = new OAuthProvider<Env>({
  apiRoute: "/mcp",
  // OAuthProviderOptions.apiHandler is untyped for Props (it can't know ours
  // ahead of time) — this cast is the one, explicit place that boundary gap
  // is bridged; handleMcpRequest itself stays strongly typed on McpProps.
  apiHandler: {
    fetch: (request, env, ctx) => handleMcpRequest(request, env, ctx as OAuthResourceContext<McpProps>),
  },
  defaultHandler: { fetch: defaultHandlerFetch },
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register", // RFC 7591 DCR — ChatGPT/MCP Inspector fallback when CIMD isn't used
  clientIdMetadataDocumentEnabled: true, // current MCP-preferred client-id mechanism; needs global_fetch_strictly_public (wrangler.toml)
  scopesSupported: ["stemlearn:read", "offline_access"],
  resourceMetadata: {
    resource: MCP_RESOURCE_URL,
    authorization_servers: [ISSUER_URL],
    scopes_supported: ["stemlearn:read"],
    resource_name: "STEMLearn MCP",
  },
  // The legacy static-bearer lane, layered onto the same /mcp route the
  // library protects. Only ever recognizes the exact configured
  // MCP_ACCESS_TOKEN secret (constant-time compared); every other token
  // (including a malformed or unrecognized one) falls through to the
  // library's own OAuth-token validation, which will 401 it normally.
  resolveExternalToken: async ({ token, env }) => {
    if (!env.MCP_ACCESS_TOKEN) return null;
    if (!(await constantTimeEqual(token, env.MCP_ACCESS_TOKEN))) return null;
    return {
      props: { userId: DEFAULT_USER_ID, legacy: true },
      audience: MCP_RESOURCE_URL,
      scope: ["stemlearn:read"],
    };
  },
});
