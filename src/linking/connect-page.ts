// Static, framework-free "Connect STEMLearn" page. The normal, permanent
// student-facing flow is exactly: 1) Sign in 2) Copy connection link
// 3) Paste connection link 4) Connected. The "developer access" section
// below is private/development-only scaffolding for this pre-OAuth phase —
// it holds its value in memory only (never localStorage, never rendered back
// to the screen, never put in a URL) and is structurally separate from the
// normal flow so it can be deleted in one place once real OAuth identity
// exists.

export const CONNECT_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect STEMLearn</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 560px; margin: 40px auto; padding: 0 20px; line-height: 1.5; }
  h1 { font-size: 1.4rem; }
  .step { border: 1px solid #ccc4; border-radius: 10px; padding: 16px 20px; margin-bottom: 16px; }
  .step h2 { font-size: 1.05rem; margin: 0 0 8px; }
  .step p { margin: 0 0 12px; color: #666; }
  button { font-size: 1rem; padding: 10px 18px; border-radius: 8px; border: none; background: #6b2140; color: white; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button.secondary { background: transparent; color: #6b2140; border: 1px solid #6b2140; }
  textarea, input[type=password] { width: 100%; box-sizing: border-box; padding: 10px; border-radius: 8px; border: 1px solid #ccc4; font-family: monospace; font-size: 0.9rem; }
  textarea { min-height: 70px; }
  .error { color: #b3261e; margin-top: 8px; }
  .success { color: #1e7b34; font-weight: 600; }
  details { margin-top: 20px; font-size: 0.9rem; color: #666; }
  details.dev { border-top: 1px dashed #ccc4; padding-top: 12px; }
  .hidden { display: none; }
</style>
</head>
<body>
  <h1>Connect STEMLearn</h1>

  <div class="step" id="step-signin">
    <h2>Step 1: Sign in to STEMLearn</h2>
    <p>Sign in through the official Stellenbosch University login page. We never see your password.</p>
    <button id="open-stemlearn">Open STEMLearn</button>
    <div class="error hidden" id="start-error"></div>
  </div>

  <div class="step hidden" id="step-copy">
    <h2>Step 2: Copy your connection link</h2>
    <p>On the STEMLearn confirmation page, right-click "Click here if the app does not open
    automatically" and choose <strong>Copy Link Address</strong>. Then return here and paste it
    below. Don't click that text — it tries to open the Moodle mobile app.</p>
    <p style="font-size:0.85rem;color:#666;">On a phone or tablet: press and hold the text instead,
    then choose your browser's copy-link option.</p>
  </div>

  <div class="step hidden" id="step-paste">
    <h2>Step 3: Paste your connection link</h2>
    <textarea id="connection-link" placeholder="Paste your STEMLearn connection link"></textarea>
    <div style="margin-top: 10px;">
      <button id="connect-button">Connect STEMLearn</button>
    </div>
    <div class="error hidden" id="complete-error"></div>
  </div>

  <div class="step hidden" id="step-connected">
    <p class="success">STEMLearn connected</p>
  </div>

  <details>
    <summary>Where do I find the connection link?</summary>
    <p>After you finish signing in, STEMLearn opens a confirmation page with a line reading
    "Click here if the app does not open automatically." Don't click it — right-click it (or
    press and hold on mobile) and copy its link address instead, then paste that here.</p>
    <p>Login happens on official Stellenbosch/Microsoft pages. We never receive your university
    password. Account linking is normally required only once.</p>
  </details>

  <details class="dev">
    <summary>Developer access (private testing only)</summary>
    <p>This deployment is currently private and single-user. This key is not part of the normal
    student experience and will not exist once real sign-in is added.</p>
    <input type="password" id="dev-key" placeholder="Access key" autocomplete="off">
    <div style="margin-top: 8px;">
      <button class="secondary" id="set-dev-key">Set access key</button>
      <button class="secondary" id="disconnect-button">Disconnect STEMLearn</button>
    </div>
    <div class="success hidden" id="dev-key-status"></div>
    <div class="error hidden" id="disconnect-error"></div>
  </details>

<script>
(function () {
  // Memory-only, by design: never localStorage, never re-displayed, never in a URL.
  let devAccessKey = "";
  let sessionId = null;

  const $ = (id) => document.getElementById(id);
  function show(id) { $(id).classList.remove("hidden"); }
  function showError(id, message) { $(id).textContent = message; show(id); }
  function hideError(id) { $(id).classList.add("hidden"); }

  $("set-dev-key").addEventListener("click", () => {
    devAccessKey = $("dev-key").value;
    $("dev-key").value = "";
    const status = $("dev-key-status");
    status.textContent = devAccessKey ? "Access key set for this session." : "Access key cleared.";
    status.classList.remove("hidden");
  });

  $("open-stemlearn").addEventListener("click", async () => {
    hideError("start-error");
    if (!devAccessKey) {
      showError("start-error", "Enter the developer access key below first (private testing only).");
      return;
    }
    try {
      const res = await fetch("/auth/stemlearn/start", {
        method: "POST",
        headers: { Authorization: "Bearer " + devAccessKey },
      });
      if (!res.ok) {
        showError("start-error", "Something went wrong. Please try again.");
        return;
      }
      const data = await res.json();
      sessionId = data.sessionId;
      window.open(data.url, "_blank", "noopener");
      show("step-copy");
      show("step-paste");
    } catch {
      showError("start-error", "Something went wrong. Please try again.");
    }
  });

  $("connect-button").addEventListener("click", async () => {
    hideError("complete-error");
    const connectionLink = $("connection-link").value.trim();
    if (!connectionLink || !sessionId) {
      showError("complete-error", "Paste your STEMLearn connection link first.");
      return;
    }
    try {
      const res = await fetch("/auth/stemlearn/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, connectionLink }),
      });
      const data = await res.json();
      if (!res.ok || !data.connected) {
        showError("complete-error", data.error || "Something went wrong. Please try again.");
        return;
      }
      $("connection-link").value = "";
      show("step-connected");
    } catch {
      showError("complete-error", "Something went wrong. Please try again.");
    }
  });

  $("disconnect-button").addEventListener("click", async () => {
    hideError("disconnect-error");
    if (!devAccessKey) {
      showError("disconnect-error", "Enter the developer access key first.");
      return;
    }
    try {
      const res = await fetch("/auth/stemlearn/disconnect", {
        method: "POST",
        headers: { Authorization: "Bearer " + devAccessKey },
      });
      if (!res.ok) {
        showError("disconnect-error", "Something went wrong. Please try again.");
      }
    } catch {
      showError("disconnect-error", "Something went wrong. Please try again.");
    }
  });
})();
</script>
</body>
</html>
`;
