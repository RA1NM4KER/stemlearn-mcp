import { AuthorizationError, type AuthRequest } from "@cloudflare/workers-oauth-provider";
import { oauthHelpers, type Env } from "./env.js";
import { assertAllowedMoodleBaseUrl } from "../linking/moodle-host-allowlist.js";
import {
  createLinkingSession,
  finalizeLinkingSession,
  loadActiveLinkingSession,
  loadLinkingSessionUserId,
} from "../linking/session-store.js";
import { verifyConnectionLink, LINK_EXPIRED, SOMETHING_WENT_WRONG } from "../linking/routes.js";
import { saveCredential } from "../linking/credential-store.js";
import { importCredentialKey } from "../linking/credential-crypto.js";
import { deriveStemlearnUserId } from "./identity.js";
import { describeConsent } from "./describe-consent.js";
import { renderAuthorizePage } from "./authorize-page.js";
import { renderConsentPage } from "./consent-page.js";

// GET /authorize, POST /authorize/link, POST /authorize/consent — the OAuth
// authentication+consent flow. STEMLearn linking (the long external detour
// through Microsoft/SU login) IS how a student authenticates here; consent
// is a short same-session round trip handled by the library's own
// beginConsent/approveConsent/denyConsent afterward.

// Never a real derivable identity — real ones are always "stemlearn:...".
// Only a placeholder for the row's user_id column until linking succeeds and
// finalizeLinkingSession() writes the real derived id in the same atomic step.
const OAUTH_SESSION_PLACEHOLDER_USER = "oauth-pending";

function htmlResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function plainTextResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/** Builds the standard OAuth error redirect (error, error_description, state, iss) for a validated redirect URI. */
function authorizationErrorRedirectUrl(error: AuthorizationError): string {
  const url = new URL(error.redirectUri!);
  url.searchParams.set("error", error.code);
  url.searchParams.set("error_description", error.description);
  if (error.state) url.searchParams.set("state", error.state);
  if (error.issuer) url.searchParams.set("iss", error.issuer);
  return url.toString();
}

/** Per the library's documented rule: redirect only when redirectUri was validated; otherwise render locally, never redirect. */
function renderAuthorizationError(error: AuthorizationError): Response {
  if (error.redirectUri) return Response.redirect(authorizationErrorRedirectUrl(error), 302);
  return plainTextResponse(400, error.description);
}

function buildLaunchUrl(trustedBaseUrl: string, passport: string): string {
  const url = new URL("/admin/tool/mobile/launch.php", trustedBaseUrl);
  url.searchParams.set("service", "moodle_mobile_app");
  url.searchParams.set("passport", passport);
  url.searchParams.set("confirmed", "1");
  return url.toString();
}

export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const oauth = oauthHelpers(env);
  let authRequest: AuthRequest;
  try {
    authRequest = await oauth.parseAuthRequest(request);
  } catch (err) {
    if (err instanceof AuthorizationError) return renderAuthorizationError(err);
    throw err;
  }

  let trustedBaseUrl: string;
  try {
    trustedBaseUrl = assertAllowedMoodleBaseUrl(env.MOODLE_URL ?? "");
  } catch {
    return plainTextResponse(500, "This server is misconfigured.");
  }

  const session = await createLinkingSession(env.DB, OAUTH_SESSION_PLACEHOLDER_USER, JSON.stringify(authRequest));
  return htmlResponse(200, renderAuthorizePage(buildLaunchUrl(trustedBaseUrl, session.passport), session.sessionId));
}

export async function handleAuthorizeLink(request: Request, env: Env): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const sessionId = form ? String(form.get("sessionId") ?? "") : "";
  const connectionLink = form ? String(form.get("connectionLink") ?? "") : "";
  if (!sessionId) return plainTextResponse(400, "Invalid request.");

  const session = await loadActiveLinkingSession(env.DB, sessionId);
  if (!session || !session.oauthRequestJson) return plainTextResponse(400, LINK_EXPIRED);

  let trustedBaseUrl: string;
  try {
    trustedBaseUrl = assertAllowedMoodleBaseUrl(env.MOODLE_URL ?? "");
  } catch {
    return plainTextResponse(500, SOMETHING_WENT_WRONG);
  }

  const verified = await verifyConnectionLink(session.passport, connectionLink, trustedBaseUrl);
  if (!verified.ok) {
    // Session survives a bad attempt (see verifyConnectionLink) — re-render
    // the same linking page, same session, so the student can retry the
    // paste without redoing university login.
    const retryUrl = buildLaunchUrl(trustedBaseUrl, session.passport);
    return htmlResponse(verified.status, renderAuthorizePage(retryUrl, sessionId, verified.message));
  }

  const userId = await deriveStemlearnUserId(new URL(trustedBaseUrl).host, verified.moodleUserId);

  // Only the request that wins this atomic consume may proceed to consent.
  const won = await finalizeLinkingSession(env.DB, sessionId, userId);
  if (!won) return plainTextResponse(400, LINK_EXPIRED);

  try {
    const key = await importCredentialKey(env.CREDENTIAL_ENCRYPTION_KEY);
    await saveCredential(env.DB, key, userId, trustedBaseUrl, verified.token);
  } catch {
    return plainTextResponse(500, SOMETHING_WENT_WRONG);
  }

  const authRequest = JSON.parse(session.oauthRequestJson) as AuthRequest;
  const oauth = oauthHelpers(env);
  const details = await describeConsent(oauth, authRequest);
  const consent = await oauth.beginConsent(authRequest);
  const headers = new Headers(consent.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  // Carries the opaque, unguessable (256-bit) session id — NEVER the derived
  // userId itself, which embeds Moodle's small sequential numeric user id
  // and would otherwise let a tampered form field claim someone else's
  // identity. See loadLinkingSessionUserId's doc comment.
  return new Response(renderConsentPage(details, consent.handle, sessionId), { status: 200, headers });
}

export async function handleConsentSubmit(request: Request, env: Env): Promise<Response> {
  const oauth = oauthHelpers(env);
  const form = await request.formData().catch(() => null);
  if (!form) return plainTextResponse(400, "Invalid request.");
  const handle = String(form.get("handle") ?? "");
  const linkingSessionId = String(form.get("sessionId") ?? "");
  const decision = String(form.get("decision") ?? "");
  if (!handle || !linkingSessionId) return plainTextResponse(400, "Invalid request.");

  try {
    if (decision !== "approve") {
      const denied = await oauth.denyConsent(request, handle);
      const headers = new Headers(denied.headers);
      headers.set("Location", denied.redirectTo);
      return new Response(null, { status: 302, headers });
    }

    const userId = await loadLinkingSessionUserId(env.DB, linkingSessionId);
    if (!userId || userId === OAUTH_SESSION_PLACEHOLDER_USER) return plainTextResponse(400, LINK_EXPIRED);

    const scope = form.getAll("scope").map(String);
    const approved = await oauth.approveConsent(request, handle, { scope });
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId,
      metadata: {},
      scope: approved.request.scope,
      props: { userId },
    });
    const headers = new Headers(approved.headers);
    headers.set("Location", redirectTo);
    return new Response(null, { status: 302, headers });
  } catch (err) {
    if (err instanceof AuthorizationError) return plainTextResponse(400, err.description);
    throw err;
  }
}
