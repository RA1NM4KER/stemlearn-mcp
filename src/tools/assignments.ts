import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "../moodle-client.js";
import { loadAssignments, loadCourseContents, loadSubmissionStatus } from "../moodle-loaders.js";
import { ASSIGNMENT_LIST_POLICY, TEXT_OUTPUT_POLICY } from "../policy.js";
import { truncateText } from "../text.js";

function formatDate(ts: number): string {
  if (!ts) return "No due date";
  return new Date(ts * 1000).toLocaleString("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export async function listAssignments(client: MoodleClient, courseId: number): Promise<string> {
  if (!client.supports("mod_assign_get_assignments")) {
    return "Assignments API is not enabled on your Moodle. Ask your admin to enable the mod_assign web service.";
  }

  const [sections, assignData] = await Promise.all([
    loadCourseContents(client, courseId),
    loadAssignments(client, {
      "courseids[0]": courseId,
    }),
  ]);

  const assignments = assignData.courses[0]?.assignments ?? [];
  const byModule = new Map(assignments.map((a) => [a.coursemodule, a]));

  const lines: string[] = [`## Assignments — Course ${courseId}\n`];
  let hasAny = false;
  let renderedAssignments = 0;
  let omittedAssignments = 0;

  for (const section of sections) {
    const assignMods = section.modules.filter((m) => m.modname === "assign");
    if (assignMods.length === 0) continue;

    const sectionLines: string[] = [];
    for (const mod of assignMods) {
      if (renderedAssignments >= ASSIGNMENT_LIST_POLICY.maxRendered) {
        omittedAssignments++;
        continue;
      }
      renderedAssignments++;
      const detail = byModule.get(mod.id);
      if (!detail) {
        sectionLines.push(`- **${truncateText(mod.name, TEXT_OUTPUT_POLICY.maxLabelCharacters)}** *(details unavailable)*`);
        continue;
      }
      const due = detail.duedate ? `Due: ${formatDate(detail.duedate)}` : "No due date";
      const maxGrade = detail.grade > 0 ? ` | Max grade: ${detail.grade}` : "";
      sectionLines.push(`- **${truncateText(detail.name, TEXT_OUTPUT_POLICY.maxLabelCharacters)}** — ${due}${maxGrade}`);
      sectionLines.push(`  ID: \`${detail.id}\` (use with moodle_get_assignment)`);
    }
    if (sectionLines.length > 0) {
      lines.push(`### ${truncateText(section.name || "General", TEXT_OUTPUT_POLICY.maxLabelCharacters)}`, ...sectionLines, "");
      hasAny = true;
    }
  }

  if (!hasAny) return "No assignments found in this course.";
  if (omittedAssignments) lines.push(`_Showing the first ${ASSIGNMENT_LIST_POLICY.maxRendered} assignments; ${omittedAssignments} additional assignments were omitted._`);
  return truncateText(lines.join("\n"), TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
}

export async function getAssignment(client: MoodleClient, assignmentId: number): Promise<string> {
  if (!client.supports("mod_assign_get_submission_status")) {
    return "Assignment submission status API is not enabled on your Moodle.";
  }

  const status = await loadSubmissionStatus(client, assignmentId);

  const lines: string[] = [`## Assignment ${assignmentId} — Submission Status\n`];

  const submission = status.lastattempt?.submission;
  if (submission) {
    lines.push(`**Status:** ${truncateText(submission.status, TEXT_OUTPUT_POLICY.maxLabelCharacters)}`);
    if (submission.timemodified) {
      lines.push(`**Last modified:** ${formatDate(submission.timemodified)}`);
    }
  } else {
    lines.push("**Status:** Not submitted");
  }

  const graded = status.lastattempt?.graded;
  lines.push(`**Graded:** ${graded ? "Yes" : "No"}`);

  if (status.feedback) {
    lines.push(`\n**Grade:** ${truncateText(status.feedback.gradefordisplay ?? "—", TEXT_OUTPUT_POLICY.maxLabelCharacters)}`);
  }

  return lines.join("\n");
}

export function registerAssignmentTools(server: McpServer, client: MoodleClient): void {
  server.tool(
    "moodle_list_assignments",
    "List all assignments the student has in a course, with due dates and max grades. Use this to answer 'what assignments do I have' or 'when is X due'. Returns assignment IDs for use with moodle_get_assignment.",
    { courseId: z.number().describe("Course ID from moodle_list_courses") },
    async ({ courseId }) => ({
      content: [{ type: "text" as const, text: await listAssignments(client, courseId) }],
    })
  );

  server.tool(
    "moodle_get_assignment",
    "Check the student's own submission status and grade feedback for one assignment — 'have I submitted this', 'was it graded', 'what feedback did I get'.",
    { assignmentId: z.number().describe("Assignment ID from moodle_list_assignments") },
    async ({ assignmentId }) => ({
      content: [{ type: "text" as const, text: await getAssignment(client, assignmentId) }],
    })
  );
}
