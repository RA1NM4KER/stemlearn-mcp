import { normalizeUrl } from "../config.js";

// This deployment targets exactly one Moodle instance. A credential row's
// stored moodle_base_url is never trusted as the destination for a decrypted
// token (see resolve-config.ts) — this allowlist only gates what's allowed to
// be written to, and re-validated from, that column, so a database edit
// alone can never smuggle in a host we'd actually send a token to.
const ALLOWED_MOODLE_HOSTS = ["stemlearn.sun.ac.za"];

export class DisallowedMoodleHostError extends Error {
  constructor() {
    super("Moodle host is not on the supported list.");
    this.name = "DisallowedMoodleHostError";
  }
}

/** Normalize a Moodle base URL and verify it's HTTPS and on the supported host allowlist. */
export function assertAllowedMoodleBaseUrl(rawUrl: string): string {
  const normalized = normalizeUrl(rawUrl);
  const { protocol, hostname } = new URL(normalized);
  if (protocol !== "https:" || !ALLOWED_MOODLE_HOSTS.includes(hostname)) {
    throw new DisallowedMoodleHostError();
  }
  return normalized;
}
