# Changes from upstream

Fork base: [1alexandrer/moodle-mcp](https://github.com/1alexandrer/moodle-mcp)
(MIT licensed, copyright Alexandre Ribeiro — see `LICENSE`, unchanged).

Scoped down to one Moodle site (STEMLearn) for one student account, with a
standalone auth flow and a few fixes/additions found through live testing
against a real account. Not published to npm, not deployed to Cloudflare —
local-only.

## Bug fixes (all found via live testing against a real STEMLearn account)

1. **Forum discussions used the wrong Moodle id.** `mod_forum_get_forum_discussions`
   needs the forum *instance* id (`forum.id`), not the course-module id
   (`cmid`) that `core_course_get_contents` and Moodle URLs use — these are
   different numbers. Upstream's `moodle_list_forums` sourced forum "IDs"
   from `core_course_get_contents`, which only has the cmid, so
   `moodle_get_forum_discussions` always failed
   (`"Unable to find forum with id <cmid>"`). Fixed by sourcing forum
   listings from `mod_forum_get_forums_by_courses` instead, which returns
   both the real `id` and the `cmid` (kept for building the "Open" link,
   since that one *does* want the cmid). `src/tools/forums.ts`.

2. **Boolean params were serialized as `"true"`/`"false"`, which Moodle
   rejects.** Moodle's `PARAM_BOOL` wants `"1"`/`"0"`. This broke
   `moodle_get_notifications` (`newestfirst: true`) and would have silently
   broken any other boolean param (e.g. quizzes' `includepreviews: false`).
   Fixed centrally in `MoodleClient.call()` so every tool benefits.
   `src/moodle-client.ts`.

3. **`mod_forum_get_forum_discussions` was called with `sortby`/
   `sortdirection` params that this Moodle version rejects outright**
   (`invalidparameter`, confirmed for either param alone, with otherwise
   plausible values). Found while re-testing fix #1 — the id was correct but
   the call still failed. Removed both params; discussions are now sorted
   client-side by `timemodified` descending instead, which works everywhere
   regardless of what a given Moodle version accepts. `src/tools/forums.ts`.

4. **Wrong field name for the discussion author.** The `Discussion`
   interface declared `firstuserfullname`; the real Moodle field is
   `userfullname`. This rendered "By undefined" in `moodle_get_forum_discussions`
   and in `course_overview`'s announcements section. Fixed in both places.
   `src/tools/forums.ts`, `src/tools/composed.ts`.

## Authentication

Upstream expected a token pasted into `MOODLE_TOKEN`, or a username/password
(which doesn't work for SSO-only accounts — STEMLearn has no separate Moodle
password). Added:

- `scripts/auth.mjs` (`npm run auth`): drives Moodle's official "Mobile SSO"
  browser flow (the same one the real Moodle app uses) to get a token via
  normal SSO + MFA, with zero credential handling by this tool. Standalone,
  no AI assistant involved at runtime.
- `.auth/token.json` as the primary, zero-config token source
  (`src/config.ts`'s `loadTokenFile()`), read automatically by the server —
  nothing to paste into an MCP client config. Env vars remain a secondary,
  per-field override (`MOODLE_MCP_TOKEN_FILE` also lets you point at a
  different token file path).
- Clearer `invalidtoken` error pointing at `npm run auth` instead of "check
  your MOODLE_TOKEN value".

## New tools

- **`course_overview`** — merges course identity, upcoming assignment
  deadlines, course grade total, and up to 3 recent announcements into one
  call.
- **`upcoming_and_overdue`** — every assignment with a due date across all
  enrolled courses, classified into Overdue / Due soon (3 days) / Upcoming,
  with submission and grading status already looked up per assignment.
  Deterministic date/status merging only, no NLP heuristics.

## Renamed/removed

- Package renamed `moodle-mcp` → `stemlearn-mcp`, marked `private: true`
  (not published to npm).
- `repository`/`homepage`/`bugs` fields (pointed at upstream's npm listing)
  removed since this isn't published under that identity.
- Tool descriptions rewritten to be explicitly student-oriented (e.g.
  "Check the student's own submission status" instead of a generic
  description), so an LLM picks the right tool for a student's question.
  The underlying Moodle wsfunction calls are unchanged — only descriptions
  and framing changed, not behavior.

## Kept as-is from upstream (already worked correctly)

`moodle_list_courses`, `moodle_get_course`, `moodle_list_resources` +
`moodle_download_file` (opaque signed fileId mechanism, host-pinned SSRF
protection, size cap), `moodle_list_assignments`, `moodle_get_assignment`,
`moodle_get_grades`, `moodle_get_calendar_events`, `moodle_list_quizzes` +
`moodle_get_quiz_attempts`, `moodle_get_site_info`, the MCP resource
(`moodle://files/{fileId}`) and prompt definitions, the Cloudflare Worker
deployment path (`worker.ts`, `wrangler.toml` — present but unused; this
fork runs local-only).
