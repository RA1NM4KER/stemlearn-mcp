# STEMLearn MCP

Read-only local MCP server for a STEMLearn student account. It runs over
stdio and uses the Moodle permissions already attached to your token.

## Setup

```bash
npm install
npx playwright install chromium
npm run auth
npm run build
```

`npm run auth` opens the normal STEMLearn SSO flow and saves the resulting
Moodle token to `.auth/token.json` with restrictive permissions. The server
loads that file automatically. For CI, `MOODLE_URL` and `MOODLE_TOKEN` are
also supported; Moodle URLs must be HTTPS except `localhost`, `127.0.0.1`,
or `::1` development addresses.

Register the built server with an MCP client:

```bash
claude mcp add stemlearn -- node /absolute/path/to/stemlearn-mcp/dist/server.js
```

This repository supports two deployment modes, both built from the same
`createStemLearnServer(client)` registration:

- **Local (stdio)** — `src/server.ts`, using the local credential model above
  (`.auth/token.json` or `MOODLE_URL`/`MOODLE_TOKEN` env vars). This remains
  the primary supported mode.
- **Remote (Cloudflare Worker, Streamable HTTP)** — `src/worker.ts`, exposing
  `POST /mcp` and `GET /health`. `/mcp` is now **OAuth 2.1-protected**
  (authorization code + PKCE S256, via `@cloudflare/workers-oauth-provider`):
  a standards-compliant MCP client discovers `/.well-known/oauth-protected-resource/mcp`
  and `/.well-known/oauth-authorization-server`, registers via Dynamic Client
  Registration (`/oauth/register`) or a Client ID Metadata Document, and
  completes `/authorize` — which runs the STEMLearn account-linking flow as
  its authentication step — before receiving a token scoped to `stemlearn:read`
  (+ optional `offline_access` for refresh tokens). A legacy static-bearer
  lane (`Authorization: Bearer <MCP_ACCESS_TOKEN>`, constant-time compared)
  is preserved alongside it during migration, resolving only the original
  single fixed identity; the two lanes never share identity semantics.
  Required secrets: `MOODLE_URL`, `MOODLE_TOKEN`, `MCP_ACCESS_TOKEN`,
  `CREDENTIAL_ENCRYPTION_KEY` (set with `wrangler secret put <NAME>`);
  optional non-secret tunables: `MOODLE_MCP_MAX_FILE_MB`,
  `MOODLE_MCP_REQUEST_TIMEOUT_MS`. Requires a D1 database bound as `DB`
  (`wrangler.toml`, `migrations/*.sql`) and a KV namespace bound as
  `OAUTH_KV` (used only by the OAuth provider library for its own
  codes/tokens/clients/grants — separate from our D1 linking data). Deploy
  with `npm run deploy` (`wrangler deploy`).

### Account linking (STEMLearn → remote MCP)

`GET /connect` serves a 3-step page (sign in → copy connection link → paste
connection link) that lets a student link their own STEMLearn account without
ever giving this app their Stellenbosch/Microsoft password: they authenticate
entirely on official SU/Microsoft pages, then paste back the resulting
connection link. The link is verified (including a live
`core_webservice_get_site_info` call) before anything is persisted, and the
resulting Moodle token is stored AES-256-GCM-encrypted in D1, never in
plaintext. See `src/linking/*` and `AGENTS.md` for the design and its
current, explicitly single-user limitations — linking does not yet mean
multi-user or student-ready; every linked credential resolves to one fixed
identity until real OAuth identity is added.

### Continuous deployment

Pushes to `main` run `.github/workflows/deploy.yml`. The workflow installs
locked dependencies with `npm ci`, builds, tests, performs a minified Wrangler
dry run, and deploys only when every earlier step succeeds. It can also be run
manually with GitHub Actions' **Run workflow** control. Pull requests do not
deploy.

Before the first workflow run, add these repository secrets in GitHub under
**Settings → Secrets and variables → Actions → New repository secret**:

- `CLOUDFLARE_API_TOKEN`: a narrowly scoped Cloudflare API token with the
  Worker deploy/edit permissions required for this Worker, restricted to the
  relevant Cloudflare account where possible.
- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account ID that contains the
  `stemlearn-mcp` Worker.

GitHub Actions does not receive Moodle credentials or tokens,
`CREDENTIAL_ENCRYPTION_KEY`, or `MCP_ACCESS_TOKEN`. Those remain Cloudflare
Worker secrets configured with `wrangler secret put`; normal code deployments
continue using the remotely configured values.

## MCP surface

Tools cover enrolled courses and their structure, files, assignments,
grades, calendar events, quizzes, forums, notifications, site information,
and the composed `course_overview` and `upcoming_and_overdue` views.

`moodle_list_resources` returns bounded file listings with an opaque,
encrypted `fileId` and a matching `moodle://files/{fileId}` URI. Use either
that URI as an MCP resource or `moodle_download_file`; both paths re-check
current Moodle access before downloading. File IDs expire after 24 hours and
are bound to the authenticated user and token.

Prompts: `summarize-course`, `whats-due`, `build-study-notes`, `exam-prep`,
and `search-notes`. Prompts that read files use the URI returned by
`moodle_list_resources` rather than constructing one.

## Operational limits

Network requests time out after 20 seconds by default; set
`MOODLE_MCP_REQUEST_TIMEOUT_MS` (1000–120000) to change it. File downloads
default to 25 MB (`MOODLE_MCP_MAX_FILE_MB`). Listings are bounded (for
example, 25 files by default and 100 maximum) to avoid oversized MCP
responses. Rendered Moodle text is also bounded per field; oversized text and
text-file reads include a truncation notice. Binary resources over 5 MB are
not embedded into MCP responses.

The server never calls Moodle write APIs and never returns Moodle tokens,
raw file URLs, or filesystem paths.

## Development

```bash
npm test
npm run build
```
