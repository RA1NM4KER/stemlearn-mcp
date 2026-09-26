-- Per-user encrypted Moodle credentials. moodle_base_url is re-validated
-- against an explicit host allowlist and bound into the AES-GCM AAD on every
-- read (see src/linking/credential-store.ts) — it is never trusted as the
-- destination for the decrypted token; that always comes from this
-- deployment's own configured MOODLE_URL.
CREATE TABLE IF NOT EXISTS moodle_credentials (
  user_id TEXT PRIMARY KEY,
  moodle_base_url TEXT NOT NULL,
  encrypted_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Short-lived, single-use STEMLearn account-linking sessions. Only the
-- SHA-256 hash of the raw session id is stored (see src/linking/session-store.ts).
CREATE TABLE IF NOT EXISTS linking_sessions (
  session_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  passport TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
