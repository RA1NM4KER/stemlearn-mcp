import type { ConsentDescription } from "./describe-consent.js";

// Plain-language permission categories for scopes we currently grant. No raw
// scope strings, no OAuth jargon, no tokens, no protocol internals — per the
// consent-page requirements. Extend this map if/when finer scopes are ever
// introduced; for V1 there is exactly one.
const SCOPE_DESCRIPTIONS: Record<string, string> = {
  "stemlearn:read": "View enrolled courses, course content and files, assignments, quizzes, grades, calendar and notifications",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function renderConsentPage(details: ConsentDescription, handle: string, linkingSessionId: string): string {
  const name = escapeHtml(details.clientName);
  const origin = details.clientDomain
    ? `Published by <strong>${escapeHtml(details.clientDomain)}</strong>.`
    : "This app registered itself; its name is not verified.";
  const permissionItems = details.scope
    .map((scope) => `<li>${escapeHtml(SCOPE_DESCRIPTIONS[scope] ?? scope)}</li>`)
    .join("");
  const scopeInputs = details.scope
    .map((scope) => `<input type="hidden" name="scope" value="${escapeHtml(scope)}">`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect STEMLearn</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 480px; margin: 60px auto; padding: 0 20px; line-height: 1.5; }
  h1 { font-size: 1.3rem; }
  ul { padding-left: 20px; }
  .note { color: #666; font-size: 0.9rem; }
  .warning { color: #b3261e; font-weight: 600; }
  button { font-size: 1rem; padding: 10px 20px; border-radius: 8px; border: none; cursor: pointer; margin-right: 10px; }
  button[name="decision"][value="approve"] { background: #6b2140; color: white; }
  button[name="decision"][value="deny"] { background: transparent; color: #6b2140; border: 1px solid #6b2140; }
</style>
</head>
<body>
  <h1>Connect STEMLearn</h1>
  <p><strong>${name}</strong> would like permission to access your STEMLearn information through this MCP.</p>
  <p class="note">${origin} For V1 this server is read-only.</p>
  <p>It would be able to:</p>
  <ul>${permissionItems}</ul>
  <p class="note">Access will be sent to <strong>${escapeHtml(details.redirectHost)}</strong>.</p>
  ${details.redirectIsLoopback ? '<p class="warning">This sends access to an app on your computer. Continue only if you just started signing in from it.</p>' : ""}
  <form method="post" action="/authorize/consent">
    <input type="hidden" name="handle" value="${escapeHtml(handle)}">
    <input type="hidden" name="sessionId" value="${escapeHtml(linkingSessionId)}">
    ${scopeInputs}
    <button name="decision" value="approve">Allow</button>
    <button name="decision" value="deny">Cancel</button>
  </form>
</body>
</html>
`;
}
