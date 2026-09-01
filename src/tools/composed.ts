import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "../moodle-client.js";
import { listForumsRaw, getDiscussionsRaw } from "./forums.js";

// Composed, read-only tools that merge a few raw Moodle calls into one
// normalized, student-shaped answer. Deterministic date/status merging only —
// no NLP/task-planning heuristics. Every raw wsfunction used here is the
// same one the primitive tools already use.

interface Course {
  id: number;
  fullname: string;
  shortname: string;
  progress: number | null;
}

interface AssignmentDetail {
  id: number;
  coursemodule: number;
  name: string;
  duedate: number;
  grade: number;
}

interface AssignmentsResponse {
  courses: { id: number; assignments: AssignmentDetail[] }[];
}

interface SubmissionStatus {
  lastattempt?: {
    submission?: { status: string };
    graded?: boolean;
    gradingstatus?: string;
  };
}

interface GradeItem {
  itemtype: string;
  gradeformatted: string;
  grademax: number;
  percentageformatted: string | null;
}

interface GradeReport {
  usergrades: { courseid: number; gradeitems: GradeItem[] }[];
}

function formatDate(ts: number): string {
  if (!ts) return "No due date";
  return new Date(ts * 1000).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
}

async function getCourseById(client: MoodleClient, courseId: number): Promise<Course | null> {
  const courses = await client.call<Course[]>("core_enrol_get_users_courses", {
    userid: client.userId,
  });
  return courses.find((c) => c.id === courseId) ?? null;
}

// ---------------------------------------------------------------------------
// course_overview
// ---------------------------------------------------------------------------

export async function courseOverview(client: MoodleClient, courseId: number): Promise<string> {
  const course = await getCourseById(client, courseId);
  if (!course) {
    return `Course ${courseId} not found among your enrolled courses. Use moodle_list_courses to see valid course IDs.`;
  }

  const lines: string[] = [
    `## Course Overview — ${course.fullname} (${course.shortname})`,
    `Course ID: \`${course.id}\``,
  ];

  if (course.progress != null) {
    lines.push(`Progress: ${Math.round(course.progress)}%`);
  }

  // Upcoming assignments/deadlines
  lines.push(``, `### Upcoming assignments`);
  try {
    if (client.supports("mod_assign_get_assignments")) {
      const assignData = await client.call<AssignmentsResponse>("mod_assign_get_assignments", {
        "courseids[0]": courseId,
      });
      const assignments = assignData.courses[0]?.assignments ?? [];
      const now = Math.floor(Date.now() / 1000);
      const upcoming = assignments
        .filter((a) => a.duedate > 0 && a.duedate >= now)
        .sort((a, b) => a.duedate - b.duedate);
      if (upcoming.length === 0) {
        lines.push("No upcoming assignment deadlines.");
      } else {
        for (const a of upcoming) {
          lines.push(`- **${a.name}** — due ${formatDate(a.duedate)} (ID: \`${a.id}\`)`);
        }
      }
    } else {
      lines.push("Assignments API not available.");
    }
  } catch (err) {
    lines.push(`Could not fetch assignments: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  // Grades
  lines.push(``, `### Grade`);
  try {
    if (client.supports("gradereport_user_get_grade_items")) {
      const report = await client.call<GradeReport>("gradereport_user_get_grade_items", {
        courseid: courseId,
        userid: client.userId,
      });
      const items = report.usergrades[0]?.gradeitems ?? [];
      const total = items.find((i) => i.itemtype === "course");
      if (total) {
        lines.push(
          `Course total: ${total.gradeformatted} / ${total.grademax} (${total.percentageformatted ?? "—"})`,
        );
      } else {
        lines.push("No course total grade available yet.");
      }
    } else {
      lines.push("Grades API not available.");
    }
  } catch (err) {
    lines.push(`Could not fetch grades: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  // Recent announcements (cheap: one forum lookup + up to 3 discussions)
  lines.push(``, `### Recent announcements`);
  try {
    const forums = await listForumsRaw(client, courseId);
    const announcementsForum = forums.find((f) => f.type === "news") ?? forums[0];
    if (!announcementsForum) {
      lines.push("No forums in this course.");
    } else {
      const discussions = await getDiscussionsRaw(client, announcementsForum.id, 3);
      if (discussions.length === 0) {
        lines.push("No recent announcements.");
      } else {
        for (const d of discussions) {
          lines.push(`- **${d.name}** — ${d.userfullname}, ${formatDate(d.timemodified)}`);
        }
      }
    }
  } catch (err) {
    lines.push(`Could not fetch announcements: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// upcoming_and_overdue
// ---------------------------------------------------------------------------

const DUE_SOON_SECONDS = 3 * 24 * 60 * 60;

interface TaskItem {
  courseId: number;
  courseName: string;
  title: string;
  type: "assignment";
  assignmentId: number;
  dueDate: number;
  dueDateFormatted: string;
  state: "overdue" | "due_soon" | "upcoming";
  submissionStatus: string | null;
  gradingStatus: string | null;
}

export async function upcomingAndOverdue(client: MoodleClient): Promise<string> {
  if (!client.supports("mod_assign_get_assignments")) {
    return "Assignments API not available on this Moodle server.";
  }

  const courses = await client.call<Course[]>("core_enrol_get_users_courses", {
    userid: client.userId,
  });
  if (courses.length === 0) return "You are not enrolled in any courses.";

  const courseIdParams = Object.fromEntries(
    courses.map((c, i) => [`courseids[${i}]`, c.id]),
  );
  const assignData = await client.call<AssignmentsResponse>("mod_assign_get_assignments", courseIdParams);

  const courseNames = new Map(courses.map((c) => [c.id, c.fullname]));
  const now = Math.floor(Date.now() / 1000);

  const withDueDates = assignData.courses.flatMap((c) =>
    c.assignments
      .filter((a) => a.duedate > 0)
      .map((a) => ({ courseId: c.id, assignment: a })),
  );

  const tasks: TaskItem[] = await Promise.all(
    withDueDates.map(async ({ courseId, assignment }) => {
      let submissionStatus: string | null = null;
      let gradingStatus: string | null = null;
      if (client.supports("mod_assign_get_submission_status")) {
        try {
          const status = await client.call<SubmissionStatus>("mod_assign_get_submission_status", {
            assignid: assignment.id,
          });
          submissionStatus = status.lastattempt?.submission?.status ?? "not submitted";
          gradingStatus = status.lastattempt?.gradingstatus ?? null;
        } catch {
          // Leave status null if this particular lookup fails — don't fail the whole tool.
        }
      }

      const state: TaskItem["state"] =
        assignment.duedate < now
          ? "overdue"
          : assignment.duedate - now < DUE_SOON_SECONDS
            ? "due_soon"
            : "upcoming";

      return {
        courseId,
        courseName: courseNames.get(courseId) ?? `Course ${courseId}`,
        title: assignment.name,
        type: "assignment" as const,
        assignmentId: assignment.id,
        dueDate: assignment.duedate,
        dueDateFormatted: formatDate(assignment.duedate),
        state,
        submissionStatus,
        gradingStatus,
      };
    }),
  );

  // Within a state bucket, ascending due date puts the most urgent item
  // first either way: earliest (most overdue) first for "overdue", soonest
  // first for "due_soon"/"upcoming".
  const stateOrder = { overdue: 0, due_soon: 1, upcoming: 2 };
  tasks.sort((a, b) => {
    if (stateOrder[a.state] !== stateOrder[b.state]) return stateOrder[a.state] - stateOrder[b.state];
    return a.dueDate - b.dueDate;
  });

  if (tasks.length === 0) return "No assignments with due dates found across your courses.";

  const lines: string[] = ["## Upcoming & Overdue\n"];
  const groups: [TaskItem["state"], string][] = [
    ["overdue", "🔴 Overdue"],
    ["due_soon", "🟡 Due soon (next 3 days)"],
    ["upcoming", "🟢 Upcoming"],
  ];
  for (const [state, heading] of groups) {
    const items = tasks.filter((t) => t.state === state);
    if (items.length === 0) continue;
    lines.push(`### ${heading}`);
    for (const t of items) {
      const submission = t.submissionStatus ? ` — ${t.submissionStatus}` : "";
      const grading = t.gradingStatus ? `, grading: ${t.gradingStatus}` : "";
      lines.push(
        `- **${t.title}** (${t.courseName}) — due ${t.dueDateFormatted}${submission}${grading} — assignment ID: \`${t.assignmentId}\`, course ID: \`${t.courseId}\``,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function registerComposedTools(server: McpServer, client: MoodleClient): void {
  server.tool(
    "course_overview",
    "One-call summary of a course for the student: identity, upcoming deadlines, course grade total, and recent announcements. Use this instead of chaining moodle_get_course + moodle_list_assignments + moodle_get_grades + moodle_get_forum_discussions when the student just wants 'catch me up on this course'.",
    { courseId: z.number().describe("Course ID from moodle_list_courses") },
    async ({ courseId }) => ({
      content: [{ type: "text" as const, text: await courseOverview(client, courseId) }],
    }),
  );

  server.tool(
    "upcoming_and_overdue",
    "Cross-course deadline view for the student: every assignment with a due date, across all enrolled courses, merged and sorted into Overdue / Due soon / Upcoming, with submission and grading status already looked up. Use this instead of chaining moodle_list_courses + moodle_list_assignments + moodle_get_assignment per course when the student asks 'what's due' or 'am I behind on anything'.",
    {},
    async () => ({
      content: [{ type: "text" as const, text: await upcomingAndOverdue(client) }],
    }),
  );
}
