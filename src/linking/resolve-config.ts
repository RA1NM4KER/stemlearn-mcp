import type { D1Database } from "./d1.js";
import type { Config } from "../config.js";
import { configFromWorkerEnv, normalizeUrl, parseMaxFileMb, parseRequestTimeoutMs } from "../config.js";
import { D1CredentialResolver } from "./credential-store.js";
import { importCredentialKey } from "./credential-crypto.js";

/**
 * The single fixed identity behind the legacy, static-bearer lane of this
 * deployment. See AGENTS.md. NEVER used on the OAuth lane — a derived
 * `stemlearn:<origin>:<moodleUserId>` id (src/oauth/identity.ts) is a
 * disjoint namespace from this constant by construction, so the two lanes
 * can never be confused with each other.
 */
export const DEFAULT_USER_ID = "default";

export interface MoodleResolverEnv {
  MOODLE_URL?: string;
  MOODLE_TOKEN?: string;
  MOODLE_MCP_MAX_FILE_MB?: string;
  MOODLE_MCP_REQUEST_TIMEOUT_MS?: string;
  DB: D1Database;
  CREDENTIAL_ENCRYPTION_KEY?: string;
}

/** Thrown by resolveMoodleConfigForOAuthUser when the authenticated OAuth user has no linked Moodle credential yet. */
export class AccountLinkRequiredError extends Error {
  constructor() {
    super("STEMLearn account linking is required before this MCP request can be completed.");
    this.name = "AccountLinkRequiredError";
  }
}

function buildConfig(env: MoodleResolverEnv, token: string): Config {
  if (!env.MOODLE_URL) {
    throw new Error("No Moodle URL configured. Set the MOODLE_URL secret.");
  }
  return {
    baseUrl: normalizeUrl(env.MOODLE_URL),
    maxFileBytes: Math.floor(parseMaxFileMb(env.MOODLE_MCP_MAX_FILE_MB) * 1024 * 1024),
    requestTimeoutMs: parseRequestTimeoutMs(env.MOODLE_MCP_REQUEST_TIMEOUT_MS),
    auth: { kind: "token", token },
  };
}

/**
 * Legacy lane only: resolve a linked D1 credential if one exists, otherwise
 * fall back to this deployment's env-secret mode (unchanged, for backward
 * compatibility with the pre-linking single-user setup). Never call this for
 * the OAuth lane — use resolveMoodleConfigForOAuthUser instead, which never
 * falls back.
 *
 * The resolved baseUrl ALWAYS comes from this deployment's own configured
 * MOODLE_URL — never from the credential row — so a database edit can never
 * redirect a decrypted token to a different host. If a linked credential
 * exists but fails integrity/decryption checks, this throws rather than
 * silently falling back, since that could otherwise run requests as the
 * wrong Moodle identity.
 */
export async function resolveMoodleConfig(userId: string, env: MoodleResolverEnv): Promise<Config> {
  const resolver = new D1CredentialResolver(env.DB, () => importCredentialKey(env.CREDENTIAL_ENCRYPTION_KEY));
  const credential = await resolver.resolve(userId);
  if (credential) return buildConfig(env, credential.token);
  return configFromWorkerEnv(env);
}

/**
 * OAuth lane only: resolve a linked D1 credential for the given derived
 * userId. Throws AccountLinkRequiredError when none exists — this MUST NOT
 * be caught and silently replaced with the env-secret token or
 * DEFAULT_USER_ID's credential; that would run an OAuth-authenticated
 * student's request as someone else's Moodle identity. A broken/tampered
 * credential still fails closed exactly like the legacy resolver.
 */
export async function resolveMoodleConfigForOAuthUser(userId: string, env: MoodleResolverEnv): Promise<Config> {
  const resolver = new D1CredentialResolver(env.DB, () => importCredentialKey(env.CREDENTIAL_ENCRYPTION_KEY));
  const credential = await resolver.resolve(userId);
  if (!credential) throw new AccountLinkRequiredError();
  return buildConfig(env, credential.token);
}
