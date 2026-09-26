import { sha256Hex } from "../linking/hash.js";

/**
 * Derives this deployment's stable OAuth user id from a *verified* Moodle
 * identity — never from email, display name, username, or anything else a
 * caller could supply. Deterministic and collision-resistant: the Moodle
 * origin scopes the numeric id, which Moodle itself already guarantees is
 * unique within that origin, so the same numeric id on two different (each
 * individually allowlisted) Moodle origins never collides.
 *
 * Hashed rather than left as a plain "stemlearn:<origin>:<id>" string: a
 * live test against the real @cloudflare/workers-oauth-provider found it
 * parses authorization codes/tokens as exactly `userId:grantId:secret`
 * (`code.split(":")`, requires precisely 3 parts) — a userId containing its
 * own colons breaks that parsing outright ("Invalid authorization code
 * format"). SHA-256 hex output is colon-free by construction, sidestepping
 * that (and any similar future) delimiter collision, while staying fully
 * deterministic. The "stemlearn-" prefix is just for readability in D1/KV
 * data, not for uniqueness.
 */
export async function deriveStemlearnUserId(normalizedMoodleOrigin: string, moodleUserId: number): Promise<string> {
  const hash = await sha256Hex(`${normalizedMoodleOrigin}|${moodleUserId}`);
  return `stemlearn-${hash}`;
}
