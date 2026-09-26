// Entry point only. The remote transport is now OAuth 2.1-protected
// (src/oauth/provider.ts, backed by @cloudflare/workers-oauth-provider) with
// a legacy static-bearer lane preserved alongside it during migration — see
// AGENTS.md before extending this file. Actual route/handler logic lives in
// src/mcp-handler.ts (the /mcp transport), src/legacy-routes.ts
// (/health, /connect, legacy /auth/stemlearn/*), and src/oauth/routes.ts
// (/authorize, /authorize/link, /authorize/consent).
export { oauthProvider as default } from "./oauth/provider.js";
