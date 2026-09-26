// Encryption at rest for linked Moodle credentials. Deliberately NOT a reuse
// of file-id-store.ts's token-derived-key scheme: that scheme derives its key
// from the live Moodle token itself (correct for short-lived, per-request
// file IDs), whereas a stored credential must be decryptable *before* we have
// a live token — a different lifecycle, so it gets its own key and envelope.
//
// AES-256-GCM with a fresh random IV per encryption. The additional
// authenticated data (AAD) binds the ciphertext to the user id AND the
// normalized Moodle base URL it was encrypted for, so a database-level edit
// to either column (e.g. pointing a row at a different host, or splicing one
// user's ciphertext onto another user's row) makes decryption fail
// authentication rather than silently "working" against the wrong identity
// or host.

const AAD_PREFIX = "stemlearn-mcp:moodle-credential:v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const VERSION = 1;

export class CredentialKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialKeyError";
  }
}

export class CredentialDecryptionError extends Error {
  constructor() {
    super("Stored credential could not be verified.");
    this.name = "CredentialDecryptionError";
  }
}

// Explicit Uint8Array<ArrayBuffer> (not the bare `Uint8Array` alias): @types/node
// widens Uint8Array's default buffer-type generic to ArrayBufferLike, which
// isn't assignable to the stricter DOM BufferSource (ArrayBuffer only) that
// Web Crypto's encrypt/decrypt/importKey expect.
function unb64u(s: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const std = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64u(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function aad(userId: string, normalizedBaseUrl: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${AAD_PREFIX}:${userId}:${normalizedBaseUrl}`);
}

/**
 * Import the CREDENTIAL_ENCRYPTION_KEY Worker secret. Expected format:
 * base64url of exactly 32 random bytes. Fails safely (generic error, no key
 * material in the message) if the configured value doesn't decode to exactly
 * 32 bytes.
 */
export async function importCredentialKey(rawSecret: string | undefined): Promise<CryptoKey> {
  if (!rawSecret) {
    throw new CredentialKeyError("Credential encryption key is not configured.");
  }
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = unb64u(rawSecret);
  } catch {
    throw new CredentialKeyError("Credential encryption key is misconfigured.");
  }
  if (bytes.length !== KEY_BYTES) {
    throw new CredentialKeyError("Credential encryption key is misconfigured.");
  }
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Encrypt a Moodle token for storage. Returns a versioned, self-contained envelope string. */
export async function encryptCredential(
  key: CryptoKey,
  userId: string,
  normalizedBaseUrl: string,
  plaintext: string,
): Promise<string> {
  const iv: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad(userId, normalizedBaseUrl) },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  const blob = new Uint8Array(1 + iv.length + ciphertext.length);
  blob[0] = VERSION;
  blob.set(iv, 1);
  blob.set(ciphertext, 1 + iv.length);
  return b64u(blob);
}

/**
 * Decrypt a stored envelope. Throws CredentialDecryptionError (generic, no
 * sensitive detail) on any failure: wrong version, tampered ciphertext, or a
 * userId/baseUrl that doesn't match what it was encrypted for.
 */
export async function decryptCredential(
  key: CryptoKey,
  userId: string,
  normalizedBaseUrl: string,
  envelope: string,
): Promise<string> {
  let blob: Uint8Array<ArrayBuffer>;
  try {
    blob = unb64u(envelope);
  } catch {
    throw new CredentialDecryptionError();
  }
  if (blob.length < 1 + IV_BYTES + 16 || blob[0] !== VERSION) {
    throw new CredentialDecryptionError();
  }
  const iv: Uint8Array<ArrayBuffer> = blob.slice(1, 1 + IV_BYTES);
  const ciphertext: Uint8Array<ArrayBuffer> = blob.slice(1 + IV_BYTES);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: aad(userId, normalizedBaseUrl) },
      key,
      ciphertext,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new CredentialDecryptionError();
  }
}
