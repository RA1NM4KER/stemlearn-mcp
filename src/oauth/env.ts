import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { D1Database } from "../linking/d1.js";

// Shared Worker environment/bindings type — used by worker.ts and every
// src/oauth/* module, so it lives in its own file rather than being defined
// inside worker.ts (which would make oauth/* import from worker.ts and risk
// a cycle, since worker.ts also imports from oauth/*).
export interface Env {
  MOODLE_URL: string;
  MOODLE_TOKEN: string;
  MOODLE_MCP_MAX_FILE_MB?: string;
  MOODLE_MCP_REQUEST_TIMEOUT_MS?: string;
  MCP_ACCESS_TOKEN: string;
  DB: D1Database;
  CREDENTIAL_ENCRYPTION_KEY?: string;
  OAUTH_KV: KVNamespace;
}

/**
 * `ctx.props` for an authenticated /mcp request, set by resolveExternalToken
 * (legacy lane, `legacy: true`) or by the props stored at completeAuthorization
 * (OAuth lane, `legacy` absent). `userId` is DEFAULT_USER_ID for the legacy
 * lane or a derived `stemlearn:<origin>:<moodleUserId>` id for the OAuth
 * lane — these are disjoint namespaces by construction (see
 * src/linking/resolve-config.ts, src/oauth/identity.ts).
 */
export interface McpProps {
  userId: string;
  legacy?: boolean;
}

/**
 * Inside `defaultHandler` (and `apiHandler`), the OAuthProvider library
 * injects `env.OAUTH_PROVIDER` at runtime with the same OAuthHelpers a
 * split-role `getOAuthApi()` would return — it's not part of our own static
 * `Env` binding type, hence the cast here rather than a module-level import
 * of the constructed provider (which would create an import cycle between
 * this file's consumers and src/oauth/provider.ts).
 */
export function oauthHelpers(env: Env): OAuthHelpers {
  return (env as Env & { OAUTH_PROVIDER: OAuthHelpers }).OAUTH_PROVIDER;
}
