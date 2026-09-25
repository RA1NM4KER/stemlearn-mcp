import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

interface ConfigBase {
  baseUrl: string;
  /** Per-file download cap in bytes. Default 25 MB. */
  maxFileBytes: number;
  /** Per-request Moodle network timeout in milliseconds. Default 20 seconds. */
  requestTimeoutMs: number;
}

export type Config = ConfigBase & (
  | { auth: { kind: "token"; token: string } }
  | { auth: { kind: "password"; username: string; password: string } }
);

// Computed lazily inside loadTokenFile() rather than at module load: Cloudflare
// Workers' bundler leaves `import.meta.url` undefined, and this module is
// imported (for its Workers-safe exports) by src/worker.ts too. Evaluating
// fileURLToPath(import.meta.url) at the top level would throw there even
// though the Worker path never calls loadTokenFile().
function defaultTokenFilePath(): string {
  // src/config.ts (dev, tsx) -> repo root is one level up.
  // dist/config.js (built) -> repo root is also one level up.
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  return path.join(path.resolve(dirname, ".."), ".auth", "token.json");
}

const TokenFileSchema = z.object({
  site: z.string(),
  token: z.string(),
}).passthrough();
type TokenFile = z.infer<typeof TokenFileSchema>;

/**
 * Load the token minted by `npm run auth` (scripts/auth.mjs), if present.
 * This is the primary, zero-config auth path — no token ever needs to be
 * pasted into an MCP client config. Returns null if the file doesn't exist
 * or is malformed; callers fall back to env vars.
 *
 * Path defaults to .auth/token.json at the repo root; override with
 * MOODLE_MCP_TOKEN_FILE (also how tests isolate from a real token file).
 */
export function loadTokenFile(): TokenFile | null {
  const tokenFilePath = process.env.MOODLE_MCP_TOKEN_FILE ?? defaultTokenFilePath();
  try {
    const raw = fs.readFileSync(tokenFilePath, "utf8");
    const data: unknown = JSON.parse(raw);
    const parsed = TokenFileSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const DEFAULT_MAX_FILE_MB = 25;
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

export function parseMaxFileMb(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_MAX_FILE_MB;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(
      `MOODLE_MCP_MAX_FILE_MB must be a positive number; got "${raw}"`,
    );
  }
  return n;
}

export function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid MOODLE_URL: "${raw}" is not a valid URL`);
  }
  const localHttpHost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localHttpHost)) {
    throw new Error("Moodle must use HTTPS (HTTP is only permitted for localhost development)");
  }
  return url.origin;
}

export function parseRequestTimeoutMs(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_REQUEST_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1_000 || n > 120_000) {
    throw new Error("MOODLE_MCP_REQUEST_TIMEOUT_MS must be an integer between 1000 and 120000");
  }
  return n;
}

/**
 * Build a Config from Cloudflare Worker environment bindings (secrets/vars).
 * Mirrors getConfig()'s field precedence but never touches the filesystem —
 * Workers has no local disk, and secrets are supplied only through `env`.
 * Only the pre-minted token auth kind is supported remotely (no interactive
 * username/password login flow over HTTP).
 */
export function configFromWorkerEnv(env: {
  MOODLE_URL?: string;
  MOODLE_TOKEN?: string;
  MOODLE_MCP_MAX_FILE_MB?: string;
  MOODLE_MCP_REQUEST_TIMEOUT_MS?: string;
}): Config {
  if (!env.MOODLE_URL) {
    throw new Error("No Moodle URL configured. Set the MOODLE_URL secret.");
  }
  if (!env.MOODLE_TOKEN) {
    throw new Error("No Moodle token configured. Set the MOODLE_TOKEN secret.");
  }

  const baseUrl = normalizeUrl(env.MOODLE_URL);
  const maxFileBytes = Math.floor(parseMaxFileMb(env.MOODLE_MCP_MAX_FILE_MB) * 1024 * 1024);
  const requestTimeoutMs = parseRequestTimeoutMs(env.MOODLE_MCP_REQUEST_TIMEOUT_MS);

  return {
    baseUrl,
    maxFileBytes,
    requestTimeoutMs,
    auth: { kind: "token", token: env.MOODLE_TOKEN },
  };
}

export function getConfig(): Config {
  // Primary path: token minted by `npm run auth`, stored at .auth/token.json.
  // Env vars remain a secondary/compatibility option and take precedence
  // per-field when explicitly set (e.g. for CI, or a non-default token location).
  const tokenFile = loadTokenFile();

  const rawUrl = process.env.MOODLE_URL ?? tokenFile?.site;
  if (!rawUrl) {
    throw new Error(
      "No Moodle URL configured. Run `npm run auth` to authenticate, or set MOODLE_URL " +
        "(and MOODLE_TOKEN, or MOODLE_USERNAME/MOODLE_PASSWORD) as environment variables."
    );
  }

  const baseUrl = normalizeUrl(rawUrl);
  const token = process.env.MOODLE_TOKEN ?? tokenFile?.token;
  const username = process.env.MOODLE_USERNAME;
  const password = process.env.MOODLE_PASSWORD;
  const maxFileBytes = Math.floor(parseMaxFileMb(process.env.MOODLE_MCP_MAX_FILE_MB) * 1024 * 1024);
  const requestTimeoutMs = parseRequestTimeoutMs(process.env.MOODLE_MCP_REQUEST_TIMEOUT_MS);

  if (token) {
    return {
      baseUrl,
      maxFileBytes,
      requestTimeoutMs,
      auth: { kind: "token", token },
    };
  }

  if (!username || !password) {
    throw new Error(
      "No Moodle credentials found. Run `npm run auth` to authenticate (recommended), " +
        "or set MOODLE_TOKEN, or both MOODLE_USERNAME and MOODLE_PASSWORD."
    );
  }

  return {
    baseUrl,
    maxFileBytes,
    requestTimeoutMs,
    auth: { kind: "password", username, password },
  };
}
