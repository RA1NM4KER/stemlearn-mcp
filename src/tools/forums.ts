import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "../moodle-client.js";
import { stripHtml } from "../text.js";

// Moodle's `mod_forum_get_forum_discussions` wsfunction needs the forum
// *instance* id (`forum.id`, the row in mdl_forum) — NOT the course-module
// id (`cmid`, what core_course_get_contents' `modules[].id` and Moodle URLs
// like mod/forum/view.php?id= use). These are different numbers. Confirmed
// against a real Moodle server: calling with a cmid gives
// "Unable to find forum with id <cmid>"; the real forum.id works.
// So forum listing must come from mod_forum_get_forums_by_courses, which is
// the only function that returns the real forum id.
interface Forum {
  id: number;
  cmid: number;
  course: number;
  name: string;
  type: string;
  numdiscussions?: number;
}

interface Discussion {
  id: number;
  discussion: number;
  name: string;
  userfullname: string;
  numreplies: number;
  timemodified: number;
  pinned: boolean;
  message?: string;
}

interface DiscussionsResponse {
  discussions: Discussion[];
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString("en-CA", { dateStyle: "medium" });
}

export async function listForumsRaw(client: MoodleClient, courseId: number): Promise<Forum[]> {
  if (!client.supports("mod_forum_get_forums_by_courses")) return [];
  return client.call<Forum[]>("mod_forum_get_forums_by_courses", {
    "courseids[0]": courseId,
  });
}

export async function listForums(client: MoodleClient, courseId: number): Promise<string> {
  if (!client.supports("mod_forum_get_forums_by_courses")) {
    return "Forum API is not enabled on your Moodle. Ask your admin to enable mod_forum web services.";
  }

  const forums = await listForumsRaw(client, courseId);
  if (forums.length === 0) return "No forums found in this course.";

  const lines: string[] = [`## Forums — Course ${courseId}\n`];
  for (const forum of forums) {
    const discussionCount = forum.numdiscussions != null ? ` (${forum.numdiscussions} discussions)` : "";
    lines.push(`- **${forum.name}**${discussionCount} — ID: \`${forum.id}\` (use with moodle_get_forum_discussions)`);
    lines.push(`  [Open](${client.baseUrl}/mod/forum/view.php?id=${forum.cmid})`);
  }
  return lines.join("\n");
}

export async function getDiscussionsRaw(
  client: MoodleClient,
  forumId: number,
  perpage = 20,
): Promise<Discussion[]> {
  if (!client.supports("mod_forum_get_forum_discussions")) return [];
  // sortby/sortdirection are NOT accepted params on every Moodle version —
  // confirmed against a real server (4.5.8): either one alone triggers
  // invalidparameter, even with otherwise-plausible values ("timemodified",
  // "DESC"). Omit them and sort client-side instead, which works everywhere.
  const data = await client.call<DiscussionsResponse>("mod_forum_get_forum_discussions", {
    forumid: forumId,
    page: 0,
    perpage,
  });
  const discussions = data.discussions ?? [];
  return [...discussions].sort((a, b) => b.timemodified - a.timemodified);
}

export async function getForumDiscussions(client: MoodleClient, forumId: number): Promise<string> {
  if (!client.supports("mod_forum_get_forum_discussions")) {
    return "Forum discussions API is not enabled on your Moodle. Ask your admin to enable mod_forum web services.";
  }

  const discussions = await getDiscussionsRaw(client, forumId);
  if (discussions.length === 0) return `No discussions found in forum ${forumId}.`;

  const lines: string[] = [`## Forum ${forumId} — Recent Discussions\n`];

  for (const d of discussions) {
    const pinned = d.pinned ? " 📌" : "";
    lines.push(`- **${d.name}**${pinned}`);
    lines.push(`  By ${d.userfullname} | ${d.numreplies} replies | Last activity: ${formatDate(d.timemodified)}`);
    const body = d.message ? stripHtml(d.message) : "";
    if (body) lines.push(`  ${body}`);
  }

  return lines.join("\n");
}

export function registerForumTools(server: McpServer, client: MoodleClient): void {
  server.tool(
    "moodle_list_forums",
    "List the forums in one of the student's courses (e.g. the course's Announcements/News forum, discussion boards). Use this to find a forum's ID before reading its posts with moodle_get_forum_discussions.",
    { courseId: z.number().describe("Course ID from moodle_list_courses") },
    async ({ courseId }) => ({
      content: [{ type: "text" as const, text: await listForums(client, courseId) }],
    })
  );

  server.tool(
    "moodle_get_forum_discussions",
    "Read recent posts in a course forum — most useful for a course's Announcements forum, to see what the lecturer has posted (title, author, reply count, last activity, and the post body).",
    { forumId: z.number().describe("Forum ID from moodle_list_forums (the real forum id, not a course-module id)") },
    async ({ forumId }) => ({
      content: [{ type: "text" as const, text: await getForumDiscussions(client, forumId) }],
    })
  );
}
