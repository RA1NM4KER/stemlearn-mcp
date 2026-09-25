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

This repository supports local stdio use. `src/worker.ts` is an experimental
development transport that shares the same MCP registration, but remote
deployment is not supported for hosting a personal Moodle token.

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
