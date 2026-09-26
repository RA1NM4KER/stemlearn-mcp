import type { D1Database } from "./d1.js";
import type { Config } from "../config.js";
import { configFromWorkerEnv, normalizeUrl, parseMaxFileMb, parseRequestTimeoutMs } from "../config.js";
import { D1CredentialResolver } from "./credential-store.js";
import { importCredentialKey } from "./credential-crypto.js";

/** The single fixed identity behind this private, single-user deployment. See AGENTS.md. */
export const DEFAULT_USER_ID = "default";

export interface MoodleResolverEnv {
  MOODLE_URL?: string;
  MOODLE_TOKEN?: string;
  MOODLE_MCP_MAX_FILE_MB?: string;
  MOODLE_MCP_REQUEST_TIMEOUT_MS?: string;
  DB: D1Database;
  CREDENTIAL_ENCRYPTION_KEY?: string;
}

/**
 * Resolve the Moodle Config for a user: a linked D1 credential if one exists,
 * otherwise this deployment's env-secret mode (unchanged, for backward
 * compatibility with the pre-linking single-user setup).
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

  if (credential) {
    if (!env.MOODLE_URL) {
      throw new Error("No Moodle URL configured. Set the MOODLE_URL secret.");
    }
    return {
      baseUrl: normalizeUrl(env.MOODLE_URL),
      maxFileBytes: Math.floor(parseMaxFileMb(env.MOODLE_MCP_MAX_FILE_MB) * 1024 * 1024),
      requestTimeoutMs: parseRequestTimeoutMs(env.MOODLE_MCP_REQUEST_TIMEOUT_MS),
      auth: { kind: "token", token: credential.token },
    };
  }

  return configFromWorkerEnv(env);
}
