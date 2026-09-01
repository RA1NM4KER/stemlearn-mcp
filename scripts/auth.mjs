#!/usr/bin/env node
// Standalone, non-AI STEMLearn (Moodle) authentication.
//
// Drives the same "Mobile SSO" flow the official Moodle Mobile app uses to
// get a webservice token when a site is set up for SSO-via-browser login.
// We open a REAL, visible browser. The human completes normal SSO +
// Authenticator MFA exactly as they would logging into the site manually —
// this script never sees or handles credentials, and never touches MFA. Once
// Moodle finishes auth it redirects to a custom URL scheme
// (`<urlscheme>://token=...`) carrying a base64 token package. We intercept
// that navigation at the network-route level (never letting the browser try
// to actually open it) and decode it.
//
// Source of the exact redirect format: Moodle core's
// public/admin/tool/mobile/launch.php:
//   $siteid = md5($CFG->wwwroot . $passport);
//   $apptoken = $siteid . ':::' . $token->token;
//   if ($privatetoken and is_https() and !$siteadmin) $apptoken .= ':::' . $privatetoken;
//   $apptoken = base64_encode($apptoken);
//   $location = "$urlscheme://token=$apptoken";
//
// Run with: npm run auth

import { chromium } from "playwright";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const SITE = process.env.MOODLE_URL || "https://stemlearn.sun.ac.za";
const SERVICE_SHORTNAME = "moodle_mobile_app"; // Moodle core built-in mobile service
const URL_SCHEME = "stemlearnmcp";
const OUT_FILE = path.join(REPO_ROOT, ".auth", "token.json"); // gitignored

function randomHex(n) {
  return crypto.randomBytes(n).toString("hex");
}

async function main() {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

  const passport = randomHex(16);
  const expectedSiteId = crypto.createHash("md5").update(SITE + passport).digest("hex");

  const launchUrl = new URL(SITE + "/admin/tool/mobile/launch.php");
  launchUrl.searchParams.set("service", SERVICE_SHORTNAME);
  launchUrl.searchParams.set("passport", passport);
  launchUrl.searchParams.set("urlscheme", URL_SCHEME);
  // confirmed=1 makes Moodle render an HTML page with a plain <a href="..."> link
  // instead of issuing a raw HTTP redirect to the (browser-unknown) custom
  // scheme. That raw-redirect path crashes some automated browser sessions
  // (an uncaught navigation error on the unhandled scheme); this avoids it.
  launchUrl.searchParams.set("confirmed", "1");

  console.log(`Site: ${SITE}`);
  console.log("Opening a browser window for STEMLearn sign-in...");
  console.log("You will need to: log in with your university account and approve the");
  console.log("Microsoft Authenticator prompt, exactly as normal.\n");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  let captured = null;
  await context.route(`${URL_SCHEME}://**`, async (route) => {
    captured = route.request().url();
    await route.abort();
  });

  try {
    await page.goto(launchUrl.toString(), { waitUntil: "domcontentloaded", timeout: 30000 });
  } catch {
    // A navigation error here is expected once Moodle redirects toward the
    // custom scheme — the route handler above already captured it by then.
  }

  if (!captured) {
    console.log(">>> Waiting for you to finish signing in (up to 5 minutes)...\n");
    const deadline = Date.now() + 5 * 60 * 1000;
    while (!captured && Date.now() < deadline) {
      await page.waitForTimeout(1000).catch(() => {});
      if (!browser.isConnected()) break;
    }
  }

  if (browser.isConnected()) await browser.close().catch(() => {});

  if (!captured) {
    console.error("Timed out waiting for sign-in to complete. Run `npm run auth` again.");
    process.exit(1);
  }

  const encoded = captured.replace(`${URL_SCHEME}://token=`, "");
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const [siteId, token, privateToken] = decoded.split(":::");

  if (siteId !== expectedSiteId) {
    console.error("Passport/siteid mismatch — refusing to trust this token package.");
    process.exit(1);
  }
  if (!token) {
    console.error("No token found in the response from Moodle. Run `npm run auth` again.");
    process.exit(1);
  }

  const record = {
    site: SITE,
    service: SERVICE_SHORTNAME,
    token,
    privateToken: privateToken || null,
    capturedAt: new Date().toISOString(),
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(record, null, 2), { mode: 0o600 });
  fs.chmodSync(OUT_FILE, 0o600);

  console.log("Signed in. Token saved to .auth/token.json (not printed here).");
  console.log(`token: ${token.slice(0, 4)}...${token.slice(-4)} (masked)`);
  console.log("\nYou can now run: npm start");
}

main().catch((err) => {
  console.error("Authentication failed:", err.message);
  process.exit(1);
});
