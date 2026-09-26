import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";

// The installed @cloudflare/workers-oauth-provider (1.1.0) does not yet ship
// a `describeConsent()` helper — that's documented on the library's
// unreleased development branch, ahead of the npm publish. This is the
// equivalent computed locally from `lookupClient()` + the validated
// AuthRequest, following the same "what the consent page must show" guidance
// (client name, verified CIMD domain, redirect host, loopback warning).

export interface ConsentDescription {
  clientName: string;
  clientDomain: string | undefined;
  redirectHost: string;
  redirectIsLoopback: boolean;
  scope: string[];
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export async function describeConsent(oauth: OAuthHelpers, authRequest: AuthRequest): Promise<ConsentDescription> {
  const client = await oauth.lookupClient(authRequest.clientId);
  const redirectHost = new URL(authRequest.redirectUri).hostname;

  // CIMD clients use an HTTPS metadata-document URL as their client_id; DCR
  // clients get an opaque generated id. This distinguishes them without
  // needing a dedicated library flag.
  let clientDomain: string | undefined;
  try {
    const clientIdUrl = new URL(authRequest.clientId);
    if (clientIdUrl.protocol === "https:") clientDomain = clientIdUrl.hostname;
  } catch {
    // Not a URL — a normal DCR client id, not CIMD.
  }

  return {
    clientName: client?.clientName || authRequest.clientId,
    clientDomain,
    redirectHost,
    redirectIsLoopback: LOOPBACK_HOSTS.has(redirectHost),
    scope: authRequest.scope,
  };
}
