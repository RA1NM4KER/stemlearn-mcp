/** A short-lived, single-use STEMLearn account-linking attempt. */
export interface LinkingSession {
  userId: string;
  passport: string;
}

/** A decrypted, ready-to-use Moodle credential for one linked user. */
export interface MoodleCredential {
  token: string;
}

/**
 * Resolves a linked Moodle credential for a user id. Returns null when no
 * credential has been linked yet (callers may fall back to another config
 * source). Throws when a credential row exists but fails integrity/decryption
 * checks — callers must NOT fall back to another source in that case, since
 * that could silently run requests as the wrong identity.
 */
export interface MoodleCredentialResolver {
  resolve(userId: string): Promise<MoodleCredential | null>;
}
