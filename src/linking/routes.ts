import { z } from "zod";
import type { D1Database } from "./d1.js";
import { DEFAULT_MAX_FILE_MB, DEFAULT_REQUEST_TIMEOUT_MS } from "../config.js";
import { MoodleClient } from "../moodle-client.js";
import { parseConnectionLink } from "./connection-link.js";
import { createLinkingSession, finalizeLinkingSession, loadActiveLinkingSession, LINKING_SESSION_TTL_MS } from "./session-store.js";
import { deleteCredential, saveCredential } from "./credential-store.js";
import { importCredentialKey } from "./credential-crypto.js";
import { assertAllowedMoodleBaseUrl } from "./moodle-host-allowlist.js";
import { md5 } from "./md5.js";
import { DEFAULT_USER_ID } from "./resolve-config.js";

// User-facing linking endpoints. Every failure path here returns one of a
// fixed set of plain-language messages — never a Moodle error, never any
// part of the pasted link, never base64/hash/token terminology. See
// AGENTS.md's "never leak raw upstream error text" invariant, extended here
// to the linking flow's own inputs.

export interface LinkingEnv {
  MOODLE_URL?: string;
  DB: D1Database;
  CREDENTIAL_ENCRYPTION_KEY?: string;
}

export const LINK_ISNT_VALID = "This connection link isn't valid. Please copy the full link from STEMLearn.";
export const LINK_EXPIRED = "This connection link has expired. Start again to connect STEMLearn.";
export const COULD_NOT_VERIFY = "We couldn't verify your STEMLearn account. Please try signing in again.";
export const DIFFERENT_ATTEMPT = "This connection link was created for a different sign-in attempt. Start again.";
export const SOMETHING_WENT_WRONG = "Something went wrong. Please try again.";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fail(status: number, message: string): Response {
  return jsonResponse(status, { connected: false, error: message });
}

export type ConnectionLinkVerificationResult =
  | { ok: true; token: string; moodleUserId: number }
  | { ok: false; status: number; message: string };

/**
 * Shared by both the legacy and OAuth linking-completion handlers: parse the
 * pasted link, verify the Moodle passport correlation against this session's
 * passport, then verify the token actually works against live Moodle
 * (reusing the existing Zod-validated site-info path — no new Moodle-calling
 * code). Returns the verified token AND the real Moodle numeric user id
 * (needed to derive OAuth identity), or a safe, generic failure to render.
 * Never touches session consumption or credential storage — callers decide
 * what to do with a successful verification.
 */
export async function verifyConnectionLink(
  passport: string,
  connectionLink: string,
  trustedBaseUrl: string,
): Promise<ConnectionLinkVerificationResult> {
  const parsedLink = parseConnectionLink(connectionLink);
  if (!parsedLink.ok) return { ok: false, status: 400, message: LINK_ISNT_VALID };

  // Moodle computes md5($CFG->wwwroot . $passport); wwwroot's trailing slash
  // is not guaranteed, so check both normalized forms (verified live).
  const expected = [trustedBaseUrl, `${trustedBaseUrl}/`].map((root) => md5(root + passport));
  if (!expected.includes(parsedLink.value.siteHash)) {
    return { ok: false, status: 400, message: DIFFERENT_ATTEMPT };
  }

  try {
    const client = await MoodleClient.create({
      baseUrl: trustedBaseUrl,
      maxFileBytes: DEFAULT_MAX_FILE_MB * 1024 * 1024,
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      auth: { kind: "token", token: parsedLink.value.token },
    });
    return { ok: true, token: parsedLink.value.token, moodleUserId: client.userId };
  } catch {
    return { ok: false, status: 400, message: COULD_NOT_VERIFY };
  }
}

export const CompleteRequestSchema = z.object({
  sessionId: z.string().min(1).max(128),
  connectionLink: z.string().min(1).max(4096),
}).strict();

export async function handleLinkStart(env: LinkingEnv): Promise<Response> {
  let trustedBaseUrl: string;
  try {
    trustedBaseUrl = assertAllowedMoodleBaseUrl(env.MOODLE_URL ?? "");
  } catch {
    return fail(500, SOMETHING_WENT_WRONG);
  }

  try {
    const session = await createLinkingSession(env.DB, DEFAULT_USER_ID);
    const url = new URL("/admin/tool/mobile/launch.php", trustedBaseUrl);
    url.searchParams.set("service", "moodle_mobile_app");
    url.searchParams.set("passport", session.passport);
    url.searchParams.set("confirmed", "1");
    return jsonResponse(200, {
      sessionId: session.sessionId,
      url: url.toString(),
      expiresInSeconds: Math.floor(LINKING_SESSION_TTL_MS / 1000),
    });
  } catch {
    return fail(500, SOMETHING_WENT_WRONG);
  }
}

export async function handleLinkComplete(request: Request, env: LinkingEnv): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return fail(400, LINK_ISNT_VALID);
  }
  const parsedBody = CompleteRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) return fail(400, LINK_ISNT_VALID);
  const { sessionId, connectionLink } = parsedBody.data;

  const session = await loadActiveLinkingSession(env.DB, sessionId);
  if (!session) return fail(400, LINK_EXPIRED);
  // Defense in depth: a session created by GET /authorize belongs to the
  // OAuth completion endpoint (src/oauth/routes.ts), never this one.
  if (session.oauthRequestJson) return fail(400, LINK_ISNT_VALID);

  let trustedBaseUrl: string;
  try {
    trustedBaseUrl = assertAllowedMoodleBaseUrl(env.MOODLE_URL ?? "");
  } catch {
    return fail(500, COULD_NOT_VERIFY);
  }

  // A malformed paste or a transient Moodle hiccup leaves the session
  // untouched below, so the student can just try again without redoing SSO.
  const verified = await verifyConnectionLink(session.passport, connectionLink, trustedBaseUrl);
  if (!verified.ok) return fail(verified.status, verified.message);

  // Only the request that wins this atomic consume may persist a credential.
  // Legacy sessions always finalize under the same DEFAULT_USER_ID they were
  // created with — this write-back only matters for the OAuth flow, which
  // doesn't know its real userId until this point.
  const won = await finalizeLinkingSession(env.DB, sessionId, session.userId);
  if (!won) return fail(400, LINK_EXPIRED);

  try {
    const key = await importCredentialKey(env.CREDENTIAL_ENCRYPTION_KEY);
    await saveCredential(env.DB, key, session.userId, trustedBaseUrl, verified.token);
  } catch {
    return fail(500, SOMETHING_WENT_WRONG);
  }

  return jsonResponse(200, { connected: true });
}

export async function handleLinkDisconnect(env: LinkingEnv): Promise<Response> {
  try {
    await deleteCredential(env.DB, DEFAULT_USER_ID);
    return jsonResponse(200, { disconnected: true });
  } catch {
    return fail(500, SOMETHING_WENT_WRONG);
  }
}
