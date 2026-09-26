# AGENTS.md

Guidance for coding agents (Claude Code, Codex, etc.) working in this repo.

## What this is

STEMLearn MCP is a **read-only** MCP server over a student's Moodle account.
It never calls a Moodle write API and never exposes Moodle tokens,
authenticated Moodle file URLs, or filesystem paths. Local **stdio is the
primary supported deployment model** (`src/server.ts`). `src/worker.ts`
(Cloudflare Worker, `wrangler.toml`) is the remote Streamable HTTP transport
at `/mcp`, now **OAuth 2.1-protected** via `@cloudflare/workers-oauth-provider`
(`src/oauth/provider.ts`) — a genuine per-user authorization-code+PKCE flow,
with STEMLearn account linking (see below) as the authentication step. A
legacy static-bearer lane (`MCP_ACCESS_TOKEN`, `resolveExternalToken` in
`src/oauth/provider.ts`) is preserved alongside it during migration, resolving
only the fixed `DEFAULT_USER_ID` identity — the two lanes are deliberately
kept disjoint (see `src/linking/resolve-config.ts`'s two resolver functions)
and must never be allowed to share identity semantics. Do not weaken PKCE,
redirect-URI validation, or the OAuth resource/audience checks; do not add a
mode where `/mcp` serves any request unauthenticated by either lane.

`src/linking/*` implements STEMLearn account linking: a student completes
official SU/Microsoft login and pastes back the resulting connection link,
which is verified and stored as an encrypted, per-user Moodle credential in
D1. It now authenticates two different call sites: the legacy bearer-gated
`/connect` + `/auth/stemlearn/*` flow (fixed `DEFAULT_USER_ID`, for backward
compatibility) and the OAuth `/authorize` flow (`src/oauth/routes.ts`), which
derives a real per-student identity from verified Moodle site-info
(`src/oauth/identity.ts`'s `deriveStemlearnUserId` — **hashed, deliberately
colon-free**, since `@cloudflare/workers-oauth-provider` parses its own
authorization codes/tokens as exactly `userId:grantId:secret`; a `userId`
containing a colon breaks token exchange outright — confirmed by a live test
failure before this was fixed). Never let a database-stored `moodle_base_url`
become the actual destination for a decrypted token (see
`src/linking/resolve-config.ts` and `moodle-host-allowlist.ts`) — only this
deployment's own configured `MOODLE_URL` is trusted for that. The OAuth lane
(`resolveMoodleConfigForOAuthUser`) must never fall back to the env secret or
the legacy `DEFAULT_USER_ID` credential when a user has no linked account —
that would run their request as someone else's Moodle identity.

## Architecture — preserve this direction

```
Config/Auth (config.ts)
  → MoodleClient transport (moodle-client.ts)
  → Zod schemas (moodle-api.ts)
  → validated loaders (moodle-loaders.ts)
  → tools / resources / composed workflows (tools/*, resources/*)
  → MCP rendering (markdown/text returned to the client)
```

- Every Moodle HTTP response is validated at the boundary with a Zod schema
  in `moodle-api.ts` before anything downstream touches it. Do not
  reintroduce `client.call<T>(...)` unchecked-cast style calls, `any`, or
  `as unknown as`. If a wsfunction needs a new shape, add/extend a schema in
  `moodle-api.ts`, not a local interface in a tool file.
- Tools and resources consume `moodle-loaders.ts` loaders (or `MoodleClient`
  methods), never raw Moodle JSON. Add a new one-line loader there instead of
  calling `client.call` from inside a tool.
- Keep MCP rendering (markdown strings, tool schemas) out of
  `moodle-client.ts`/`moodle-loaders.ts`, and keep transport code (stdio vs.
  Worker specifics) out of tool/resource/prompt registration.
- Use `createStemLearnServer()` (`create-server.ts`) as the single place that
  registers tools, resources, and prompts. Do not duplicate that
  registration between `server.ts` and `worker.ts`.

## Security invariants

- File access only ever happens through the sealed, opaque `fileId` model
  (`file-id-store.ts`) — AES-GCM, per-user, TTL-bound. Never return a raw
  Moodle `fileurl` or token to an MCP client.
- Authenticated Moodle `pluginfile.php` URLs must not be exposed: links found
  in Moodle-authored HTML (forum posts, notices, descriptions) stay hidden
  behind the sealed `fileId` flow, not echoed back as a clickable URL
  (`stripHtml` in `text.ts` enforces this). Ordinary useful external links
  (Zoom, WhatsApp, course-reading links) should remain actionable and
  preserve their href.
- Preserve `assertSafeFileUrl`'s same-host/protocol/`pluginfile.php`-path
  checks and the course-membership re-check in `authorizeFile`.
- Never leak raw upstream error text, tokens, or credentials into a thrown
  error or MCP response — use the typed `MoodleClientError` subclasses and
  generic user-facing messages.

## Output bounding

- All caps live as named constants in `policy.ts` (`*_POLICY` objects,
  `TEXT_OUTPUT_POLICY`). Add a new limit there, don't scatter a magic number
  in a tool.
- Every collection-rendering tool caps what it renders, reports how much was
  omitted, and passes the final string through `truncateText(...,
  TEXT_OUTPUT_POLICY.maxMcpResponseCharacters)` so per-field and global caps
  compose. Follow this pattern for new tools.
- Fan-out requests must use bounded concurrency (`mapWithConcurrency` in
  `policy.ts`) or run sequentially. Don't add an unbounded
  `Promise.all(collection.map(...))` over an arbitrary-length Moodle
  collection.

## Style

- Prefer small, explicit helpers over generic abstraction frameworks. The
  one-line loaders in `moodle-loaders.ts` are intentional — don't collapse
  them back into the tools that call them.
- Don't abstract trivial duplicated formatting purely for aesthetics.

## Stability

- The MCP public contract (tool names, prompt names, `moodle://files/{fileId}`
  resource URIs) should stay stable unless a real correctness or security
  issue requires a change. Don't rename casually.
- Don't weaken `tsconfig.json`'s `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noUnusedLocals`, or `noUnusedParameters`.

## Tests & verification

- Tests should assert actual behavior (rendered content, counts, error
  types/messages), not just "doesn't throw."
- Add a regression test for every bug fix.
- Before considering work done, run `npm run build`, `npm test`, and
  `git diff --check`. Run a lint script only if `package.json` defines one
  (it currently doesn't).

## Process

- Don't stage, commit, tag, or push unless explicitly asked.
- Don't move, recreate, or rewrite the `v0.1.0` tag.

## Where to look first

| Changing...              | Start here                                    |
|---------------------------|-----------------------------------------------|
| A Moodle response shape   | `src/moodle-api.ts`                           |
| How data is fetched       | `src/moodle-loaders.ts`, `src/moodle-client.ts` |
| File access / security    | `src/file-id-store.ts`, `moodle-client.ts` (`assertSafeFileUrl`), `src/resources/index.ts`, `src/tools/download.ts` |
| Output size limits         | `src/policy.ts`, `src/text.ts`                |
| MCP server registration   | `src/create-server.ts`, `src/register-tools.ts` |
| Tests                      | `tests/*.test.ts` (one file per module; `tests/global-output-caps.test.ts` for cross-tool caps) |
