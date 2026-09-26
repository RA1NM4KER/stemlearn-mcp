// Parses the "connection link" a student pastes from STEMLearn's confirmed
// mobile-launch page: `<scheme>://token=<base64(md5hash:::token[:::privatetoken])>`.
// Verified live against the real STEMLearn installation. Rejects anything
// that doesn't match this exact shape before any decoding happens.

const MAX_LINK_LENGTH = 4096;
const EXPECTED_SCHEME = "moodlemobile";
const LINK_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/token=([A-Za-z0-9+/=_-]+)$/;
const CONTROL_CHAR_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export interface ParsedConnectionLink {
  siteHash: string;
  token: string;
  privateToken: string | undefined;
}

export type ConnectionLinkParseError =
  | "empty"
  | "too_long"
  | "control_characters"
  | "unexpected_shape"
  | "wrong_scheme"
  | "malformed_base64"
  | "malformed_payload";

export type ConnectionLinkParseResult =
  | { ok: true; value: ParsedConnectionLink }
  | { ok: false; error: ConnectionLinkParseError };

function decodeBase64(value: string): string | null {
  try {
    return atob(decodeURIComponent(value));
  } catch {
    try {
      return atob(value);
    } catch {
      return null;
    }
  }
}

/** Parse and structurally validate a pasted connection link. Never throws. */
export function parseConnectionLink(raw: string): ConnectionLinkParseResult {
  if (typeof raw !== "string" || raw.length === 0) return { ok: false, error: "empty" };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, error: "empty" };
  if (trimmed.length > MAX_LINK_LENGTH) return { ok: false, error: "too_long" };
  if (CONTROL_CHAR_PATTERN.test(trimmed)) return { ok: false, error: "control_characters" };

  const match = LINK_PATTERN.exec(trimmed);
  if (!match) return { ok: false, error: "unexpected_shape" };
  const [, scheme, payload] = match;
  if (scheme !== EXPECTED_SCHEME) return { ok: false, error: "wrong_scheme" };

  const decoded = decodeBase64(payload!);
  if (decoded === null) return { ok: false, error: "malformed_base64" };
  if (CONTROL_CHAR_PATTERN.test(decoded.replace(/:::/g, ""))) return { ok: false, error: "malformed_payload" };

  const parts = decoded.split(":::");
  if (parts.length !== 2 && parts.length !== 3) return { ok: false, error: "malformed_payload" };
  const [siteHash, token, privateToken] = parts as [string, string, string | undefined];
  if (!siteHash || !token) return { ok: false, error: "malformed_payload" };

  return { ok: true, value: { siteHash, token, privateToken: privateToken || undefined } };
}
