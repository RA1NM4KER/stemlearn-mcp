// Manual live acceptance test — real MCP stdio protocol, real Moodle token,
// read-only calls only. Not part of `npm test` (needs a live token and
// network access, plus a course/assignment ID that exists on *your* Moodle
// account). Not a generic example — fill in the placeholders below with IDs
// from your own `moodle_list_courses` / `moodle_list_assignments` output
// before running.
//
// Run with: node scripts/live-acceptance-test.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Fill these in from your own account (see moodle_list_courses /
// moodle_list_assignments) — or pass as env vars.
const TEST_COURSE_ID = Number(process.env.TEST_COURSE_ID ?? 0);
const TEST_ASSIGNMENT_ID = Number(process.env.TEST_ASSIGNMENT_ID ?? 0);

if (!TEST_COURSE_ID || !TEST_ASSIGNMENT_ID) {
  console.error(
    "Set TEST_COURSE_ID and TEST_ASSIGNMENT_ID (env vars) to IDs from your own account first.\n" +
      "e.g. TEST_COURSE_ID=123 TEST_ASSIGNMENT_ID=456 node scripts/live-acceptance-test.mjs",
  );
  process.exit(1);
}

const client = new Client({ name: "stemlearn-mcp-live-test", version: "0.0.1" });
const transport = new StdioClientTransport({
  command: "node",
  args: [path.join(REPO_ROOT, "dist", "server.js")],
  cwd: REPO_ROOT,
});

await client.connect(transport);

const toolsList = await client.listTools();
console.log("=== TOOLS EXPOSED ===");
for (const t of toolsList.tools) console.log(" -", t.name);

async function callTool(name, args = {}) {
  console.log(`\n=== CALL ${name}(${JSON.stringify(args)}) ===`);
  try {
    const res = await client.callTool({ name, arguments: args });
    const text = res.content?.map((c) => c.text ?? `[${c.type} content block]`).join("\n") ?? JSON.stringify(res);
    console.log(text.length > 1200 ? text.slice(0, 1200) + "\n...[truncated]" : text);
    return text;
  } catch (e) {
    console.log("ERROR:", e.message);
    return "";
  }
}

// 1. list enrolled courses
await callTool("moodle_list_courses");

// 2. upcoming deadlines for one course
await callTool("moodle_get_calendar_events", { courseId: TEST_COURSE_ID });

// 3. assignments for that course
await callTool("moodle_list_assignments", { courseId: TEST_COURSE_ID });

// 4. submission status for one assignment
await callTool("moodle_get_assignment", { assignmentId: TEST_ASSIGNMENT_ID });

// 5. detailed grade items
await callTool("moodle_get_grades", { courseId: TEST_COURSE_ID });

// 6. list course resources
const resourcesText = await callTool("moodle_list_resources", { courseId: TEST_COURSE_ID });

// 7. download a real authorised file
const fileIdMatch = resourcesText.match(/fileId: `([^`]+)`/);
if (fileIdMatch) {
  await callTool("moodle_download_file", { fileId: fileIdMatch[1] });
} else {
  console.log("\n(no fileId found to test download with)");
}

// 8. list forums for that course
const forumsText = await callTool("moodle_list_forums", { courseId: TEST_COURSE_ID });

// 9. discussions in the first forum found (exercises the forum-id fix)
const forumIdMatch = forumsText.match(/ID: `(\d+)`/);
if (forumIdMatch) {
  await callTool("moodle_get_forum_discussions", { forumId: Number(forumIdMatch[1]) });
} else {
  console.log("\n(no forum id found to test discussions with)");
}

// 10. notifications (exercises the boolean-param fix)
await callTool("moodle_get_notifications", {});

// 11. course_overview composed tool
await callTool("course_overview", { courseId: TEST_COURSE_ID });

// 12. upcoming_and_overdue composed tool, cross-course
await callTool("upcoming_and_overdue", {});

await client.close();
process.exit(0);
