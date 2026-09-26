// Static, framework-free STEMLearn-linking step shown during GET /authorize,
// before consent. Unlike /connect's legacy page, this needs no developer
// access key: reaching this page at all already required a validated OAuth
// authorization request (parseAuthRequest() succeeded).
//
// Copy reflects what the real STEMLearn confirmation page actually does
// (verified live): it does NOT show the raw connection link as visible
// text. It renders a link labeled "Click here if the app does not open
// automatically" — clicking it attempts to open the Moodle mobile app, which
// does nothing useful here. The link's target URL must be copied instead,
// via right-click/long-press, never by clicking it.

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function renderAuthorizePage(stemlearnUrl: string, sessionId: string, errorMessage?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect STEMLearn</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 560px; margin: 40px auto; padding: 0 20px; line-height: 1.5; }
  h1 { font-size: 1.4rem; }
  .step { border: 1px solid #ccc4; border-radius: 10px; padding: 16px 20px; margin-bottom: 16px; }
  .step h2 { font-size: 1.05rem; margin: 0 0 8px; }
  .step p { margin: 0 0 12px; color: #666; }
  button { font-size: 1rem; padding: 10px 18px; border-radius: 8px; border: none; background: #6b2140; color: white; cursor: pointer; }
  a.button { display: inline-block; text-decoration: none; }
  textarea { width: 100%; box-sizing: border-box; padding: 10px; border-radius: 8px; border: 1px solid #ccc4; font-family: monospace; font-size: 0.9rem; min-height: 70px; }
  .error { color: #b3261e; margin-bottom: 16px; }
  .mobile-note { font-size: 0.85rem; color: #666; }
</style>
</head>
<body>
  <h1>Connect STEMLearn</h1>
  ${errorMessage ? `<p class="error">${escapeHtml(errorMessage)}</p>` : ""}

  <div class="step">
    <h2>Step 1: Sign in to STEMLearn</h2>
    <p>Sign in through the official Stellenbosch University login page. We never see your password.</p>
    <a class="button" href="${escapeHtml(stemlearnUrl)}" target="_blank" rel="noopener"><button type="button">Open STEMLearn</button></a>
  </div>

  <div class="step">
    <h2>Step 2: Copy your connection link</h2>
    <p>After you sign in, STEMLearn shows a confirmation page with a line that reads
    <strong>"Click here if the app does not open automatically."</strong></p>
    <p><strong>Don't click it</strong> — that tries to open the Moodle mobile app. Instead:</p>
    <ul>
      <li>On a computer: right-click (or Control-click on a Mac) that text and choose
      <strong>"Copy Link Address"</strong> (or "Copy Link").</li>
      <li class="mobile-note">On a phone or tablet: press and hold the text, then choose your
      browser's <strong>copy link</strong> option.</li>
    </ul>
  </div>

  <div class="step">
    <h2>Step 3: Paste your connection link</h2>
    <form method="post" action="/authorize/link">
      <input type="hidden" name="sessionId" value="${escapeHtml(sessionId)}">
      <textarea name="connectionLink" placeholder="Paste your STEMLearn connection link"></textarea>
      <div style="margin-top: 10px;">
        <button type="submit">Connect STEMLearn</button>
      </div>
    </form>
  </div>

  <p class="mobile-note">Login happens on official Stellenbosch/Microsoft pages. We never receive
  your university password. Account linking is normally required only once.</p>
</body>
</html>
`;
}
