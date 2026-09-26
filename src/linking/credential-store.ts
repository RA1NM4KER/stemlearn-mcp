import type { D1Database } from "./d1.js";
import type { MoodleCredential, MoodleCredentialResolver } from "./types.js";
import { decryptCredential, encryptCredential } from "./credential-crypto.js";
import { assertAllowedMoodleBaseUrl } from "./moodle-host-allowlist.js";

// Persists one encrypted Moodle credential per user. The stored
// moodle_base_url is re-validated against the host allowlist on every read
// and used only to reconstruct the AES-GCM AAD the row was encrypted with —
// it is never trusted as the destination for the decrypted token. That
// decision (always use this deployment's configured Moodle URL) lives in
// resolve-config.ts, not here, so a database edit to this column can only
// ever break decryption, never redirect where a token is sent.

interface CredentialRow {
  moodle_base_url: string;
  encrypted_token: string;
}

export class D1CredentialResolver implements MoodleCredentialResolver {
  /**
   * `getKey` is only invoked once a row is actually found — a misconfigured
   * CREDENTIAL_ENCRYPTION_KEY must not block the env-secret fallback for a
   * user who has never linked an account (no row to decrypt in the first
   * place), but must fail closed once a row does exist.
   */
  constructor(
    private readonly db: D1Database,
    private readonly getKey: () => Promise<CryptoKey>,
  ) {}

  async resolve(userId: string): Promise<MoodleCredential | null> {
    const row = await this.db
      .prepare("SELECT moodle_base_url, encrypted_token FROM moodle_credentials WHERE user_id = ?")
      .bind(userId)
      .first<CredentialRow>();
    if (!row) return null;

    // Any failure past this point (missing/invalid key, disallowed host,
    // tampered ciphertext, wrong AAD) throws — callers must fail closed, not
    // treat this as "no credential" and fall back to another config source.
    const key = await this.getKey();
    const baseUrl = assertAllowedMoodleBaseUrl(row.moodle_base_url);
    const token = await decryptCredential(key, userId, baseUrl, row.encrypted_token);
    return { token };
  }
}

export async function saveCredential(
  db: D1Database,
  key: CryptoKey,
  userId: string,
  trustedBaseUrl: string,
  token: string,
): Promise<void> {
  const baseUrl = assertAllowedMoodleBaseUrl(trustedBaseUrl);
  const encryptedToken = await encryptCredential(key, userId, baseUrl, token);
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO moodle_credentials (user_id, moodle_base_url, encrypted_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         moodle_base_url = excluded.moodle_base_url,
         encrypted_token = excluded.encrypted_token,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, baseUrl, encryptedToken, now, now)
    .run();
}

export async function deleteCredential(db: D1Database, userId: string): Promise<void> {
  await db.prepare("DELETE FROM moodle_credentials WHERE user_id = ?").bind(userId).run();
}
