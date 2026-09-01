# stemlearn-mcp

A student-focused, **read-only** MCP (Model Context Protocol) server for
**STEMLearn** — Stellenbosch University's Moodle instance. Gives an MCP
client (e.g. Claude Code) access to your own enrolled courses, deadlines,
grades, and course files.

> Fork of [1alexandrer/moodle-mcp](https://github.com/1alexandrer/moodle-mcp)
> (MIT licensed — see `LICENSE`). This fork narrows scope to a single Moodle
> site, adds a standalone browser-based SSO auth flow, fixes a few bugs found
> during live testing against a real STEMLearn account, and adds two
> composed/aggregate tools. See `CHANGES.md` for the full list of changes
> from upstream.

**Local only.** This project is not deployed anywhere — it runs as a local
stdio process that your MCP client launches on your machine.

## What it does

Every tool call is a plain, read-only Moodle webservice request made on your
behalf, using a token that represents *your own* student account and its
existing permissions. It cannot do anything in Moodle that you couldn't
already do by browsing the site yourself — see **Read-only guarantee** below.

## Setup

```bash
npm install
npx playwright install chromium   # one-time, needed for `npm run auth`
```

### 1. Authenticate — `npm run auth`

```bash
npm run auth
```

This opens a real, visible browser window and takes you through STEMLearn's
normal sign-in: Microsoft SSO, then your Authenticator app approval — exactly
as if you'd opened the site yourself. Nothing about your credentials or MFA
is seen or touched by this tool.

Once you're signed in, Moodle hands back a token (via the same "Mobile SSO"
mechanism the official Moodle app uses), which is saved to `.auth/token.json`
— gitignored, `chmod 600`, never printed in full anywhere.

This is a standalone script — it does not require or involve any AI
assistant to run. Re-run it any time your token stops working.

### 2. Build

```bash
npm run build
```

### 3. Point your MCP client at it

No environment variables or config-file secrets needed — the server reads
`.auth/token.json` automatically.

**Claude Code:**
```bash
claude mcp add stemlearn -- node /absolute/path/to/stemlearn-mcp/dist/server.js
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`
on Mac, `%APPDATA%\Claude\claude_desktop_config.json` on Windows):
```json
{
  "mcpServers": {
    "stemlearn": {
      "command": "node",
      "args": ["/absolute/path/to/stemlearn-mcp/dist/server.js"]
    }
  }
}
```

Restart your MCP client after adding it.

## Available tools

| Tool | What it does |
|---|---|
| `moodle_list_courses` | List your enrolled courses |
| `moodle_get_course` | Full structure of one course — sections, activities |
| `moodle_list_resources` | List downloadable files/links in a course |
| `moodle_download_file` | Download one course file by its opaque `fileId` |
| `moodle_list_assignments` | Assignments in a course, with due dates |
| `moodle_get_assignment` | Your submission status + feedback for one assignment |
| `moodle_get_grades` | Your full grade report for a course |
| `moodle_get_calendar_events` | Upcoming deadlines/events, optionally per course |
| `moodle_list_quizzes` | Quizzes in a course (low priority — STEMLearn courses tested so far don't use quizzes) |
| `moodle_get_quiz_attempts` | Your attempt history for one quiz |
| `moodle_list_forums` | Forums in a course (e.g. Announcements) |
| `moodle_get_forum_discussions` | Recent posts in one forum |
| `moodle_get_notifications` | Your recent Moodle notifications |
| `moodle_get_site_info` | Site/account info + which APIs are enabled |
| `course_overview` | **Composed.** One-call summary of a course: identity, upcoming deadlines, grade total, recent announcements |
| `upcoming_and_overdue` | **Composed.** Every assignment with a due date across all your courses, merged into Overdue / Due soon / Upcoming, with submission + grading status already looked up |

The composed tools exist to save an LLM from chaining several raw calls and
re-deriving date/status logic itself each time — the merging is done
server-side, deterministically (no heuristic/NLP task-planning).

## Read-only guarantee

This server only ever calls Moodle `_get_*` webservice functions — nothing
that creates, updates, submits, posts, or deletes anything. It cannot submit
an assignment, post to a forum, send a message, change enrolment, or modify
grades or your profile, even though the underlying Moodle token technically
has access to some of those functions. Verified by auditing every
`client.call(...)` site in `src/` (see `CHANGES.md`) — grep for `client.call`
yourself if you want to check.

## Token & security model

- Token lives at `.auth/token.json`, `chmod 600`, listed in `.gitignore`.
- The server never prints the token; error messages reference it only by
  telling you to re-run `npm run auth`.
- File downloads use the token server-side only — it's never returned in any
  tool output. Files are referenced by an opaque, encrypted `fileId`
  (AES-GCM, keyed from the token) that expires after 24h and is bound to your
  user ID.
- If Moodle rejects the token (`invalidtoken`), the server raises a clear
  error telling you to run `npm run auth` again — there's no separate
  refresh-token flow to configure; Moodle webservice tokens don't have one.
- Environment variables (`MOODLE_URL`, `MOODLE_TOKEN`, or
  `MOODLE_USERNAME`/`MOODLE_PASSWORD`) remain supported as a secondary,
  per-field override of the token file — useful for CI or a non-default
  token location, not needed for normal use.

## Re-authenticating

Just run `npm run auth` again. It overwrites `.auth/token.json` with a fresh
token. This is the same command whether you're authenticating for the first
time or your token has expired/been revoked.

## Development

```bash
npm test          # run the test suite (config, client, forums fix, composed tools)
npm run build      # type-check and compile
npm run dev        # run via the MCP inspector for interactive debugging
```

## Scope note

This is deliberately narrow: one student's read access to one Moodle site.
It is not a general-purpose Moodle admin/teacher tool, and it is not
deployed anywhere (no Cloudflare Worker, no public endpoint) — everything
runs locally under your own STEMLearn login.
