import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "../moodle-client.js";
import { listForumsRaw, getDiscussionsRaw } from "./forums.js";
import { getCourseNoticesRaw, hasConflictingNoticeDates } from "./courses.js";
import { ASSIGNMENT_LIST_POLICY, COMPOSED_TASK_POLICY, TEXT_OUTPUT_POLICY, mapWithConcurrency } from "../policy.js";
import { loadAssignments, loadEnrolledCourses, loadGrades, loadSubmissionStatus } from "../moodle-loaders.js";
import type { MoodleAssignment } from "../moodle-api.js";
import { truncateText } from "../text.js";

// Composed, read-only tools that merge a few raw Moodle calls into one
// normalized, student-shaped answer. Deterministic date/status merging only —
// no NLP/task-planning heuristics. Every raw wsfunction used here is the
// same one the primitive tools already use.

function formatDate(ts: number): string {
  if (!ts) return "No due date";
  return new Date(ts * 1000).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
}

async function getCourseById(client: MoodleClient, courseId: number) {
  const courses = await loadEnrolledCourses(client);
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
    `## Course Overview — ${truncateText(course.fullname, TEXT_OUTPUT_POLICY.maxLabelCharacters)} (${truncateText(course.shortname, TEXT_OUTPUT_POLICY.maxLabelCharacters)})`,
    `Course ID: \`${course.id}\``,
  ];

  if (course.progress != null) {
    lines.push(`Progress: ${Math.round(course.progress)}%`);
  }

  lines.push("", "### Current course notices");
  try {
    const notices = await getCourseNoticesRaw(client, courseId);
    if (notices.length === 0) {
      lines.push("No current deadline or practical notices found in course-section summaries.");
    } else {
      if (hasConflictingNoticeDates(notices)) {
        lines.push("⚠️ **Conflicting deadline dates appear in current course notices; verify the applicable date with the lecturer.**");
      }
      for (const notice of notices.slice(0, 3)) {
        lines.push(`- **${notice.sectionName}:** ${notice.text}`);
      }
      lines.push("_Use current course notices to verify conflicts with older PDFs or forum posts._");
    }
  } catch {
    lines.push("Current course notices unavailable.");
  }

  // Upcoming assignments/deadlines
  lines.push(``, `### Upcoming assignments`);
  try {
    if (client.supports("mod_assign_get_assignments")) {
      const assignData = await loadAssignments(client, {
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
        for (const a of upcoming.slice(0, ASSIGNMENT_LIST_POLICY.maxRendered)) {
          lines.push(`- **${truncateText(a.name, TEXT_OUTPUT_POLICY.maxLabelCharacters)}** — due ${formatDate(a.duedate)} (ID: \`${a.id}\`)`);
        }
        if (upcoming.length > ASSIGNMENT_LIST_POLICY.maxRendered) {
          lines.push(`_Showing the first ${ASSIGNMENT_LIST_POLICY.maxRendered} upcoming assignments._`);
        }
      }
    } else {
      lines.push("Assignments API not available.");
    }
  } catch {
    lines.push("Could not fetch assignments.");
  }

  // Grades
  lines.push(``, `### Grade`);
  try {
    if (client.supports("gradereport_user_get_grade_items")) {
      const report = await loadGrades(client, courseId);
      const items = report.usergrades[0]?.gradeitems ?? [];
      const total = items.find((i) => i.itemtype === "course");
      if (total) {
        lines.push(
          `Course total: ${truncateText(total.gradeformatted, TEXT_OUTPUT_POLICY.maxLabelCharacters)} / ${total.grademax} (${truncateText(total.percentageformatted ?? "—", TEXT_OUTPUT_POLICY.maxLabelCharacters)})`,
        );
      } else {
        lines.push("No course total grade available yet.");
      }
    } else {
      lines.push("Grades API not available.");
    }
  } catch {
    lines.push("Could not fetch grades.");
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
          lines.push(`- **${truncateText(d.name, TEXT_OUTPUT_POLICY.maxLabelCharacters)}** — ${truncateText(d.userfullname, TEXT_OUTPUT_POLICY.maxLabelCharacters)}, ${formatDate(d.timemodified)}`);
        }
      }
    }
  } catch {
    lines.push("Could not fetch announcements.");
  }

  return truncateText(lines.join("\n"), TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
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
  state: "overdue" | "due_soon" | "upcoming" | "closed";
  submissionStatus: string | null;
  gradingStatus: string | null;
}

interface TaskCandidate {
  courseId: number;
  assignment: MoodleAssignment;
  state: TaskItem["state"];
}

function taskState(assignment: MoodleAssignment, now: number): TaskItem["state"] {
  if (assignment.cutoffdate > 0 && assignment.cutoffdate < now) return "closed";
  if (assignment.duedate < now) return "overdue";
  return assignment.duedate - now < DUE_SOON_SECONDS ? "due_soon" : "upcoming";
}

const TASK_STATE_ORDER: Record<TaskItem["state"], number> = {
  overdue: 0, due_soon: 1, upcoming: 2, closed: 3,
};

export async function upcomingAndOverdue(client: MoodleClient): Promise<string> {
  if (!client.supports("mod_assign_get_assignments")) {
    return "Assignments API not available on this Moodle server.";
  }

  const courses = await loadEnrolledCourses(client);
  if (courses.length === 0) return "You are not enrolled in any courses.";

  const courseIdParams = Object.fromEntries(
    courses.map((c, i) => [`courseids[${i}]`, c.id]),
  );
  const assignData = await loadAssignments(client, courseIdParams);

  const courseNames = new Map(courses.map((c) => [c.id, c.fullname]));
  const now = Math.floor(Date.now() / 1000);

  const candidates = assignData.courses.flatMap((c) =>
    c.assignments
      .filter((a) => a.duedate > 0)
      .map((assignment): TaskCandidate => ({ courseId: c.id, assignment, state: taskState(assignment, now) })),
  ).sort((a, b) => TASK_STATE_ORDER[a.state] - TASK_STATE_ORDER[b.state] || a.assignment.duedate - b.assignment.duedate);
  const omittedTasks = Math.max(0, candidates.length - COMPOSED_TASK_POLICY.maxRendered);

  const tasks = await mapWithConcurrency(
    candidates.slice(0, COMPOSED_TASK_POLICY.maxRendered),
    COMPOSED_TASK_POLICY.submissionStatusConcurrency,
    async ({ courseId, assignment, state }): Promise<TaskItem> => {
      let submissionStatus: string | null = null;
      let gradingStatus: string | null = null;
      if (client.supports("mod_assign_get_submission_status")) {
        try {
          const status = await loadSubmissionStatus(client, assignment.id);
          submissionStatus = status.lastattempt?.submission?.status ?? "not submitted";
          gradingStatus = status.lastattempt?.gradingstatus ?? null;
        } catch {
          // Leave status null if this particular lookup fails — don't fail the whole tool.
        }
      }

      return {
        courseId,
        courseName: truncateText(courseNames.get(courseId) ?? `Course ${courseId}`, TEXT_OUTPUT_POLICY.maxLabelCharacters),
        title: truncateText(assignment.name, TEXT_OUTPUT_POLICY.maxLabelCharacters),
        type: "assignment" as const,
        assignmentId: assignment.id,
        dueDate: assignment.duedate,
        dueDateFormatted: formatDate(assignment.duedate),
        state,
        submissionStatus,
        gradingStatus,
      };
    },
  );

  // Within a state bucket, ascending due date puts the most urgent item
  // first either way: earliest (most overdue) first for "overdue", soonest
  // first for "due_soon"/"upcoming".
  tasks.sort((a, b) => {
    if (TASK_STATE_ORDER[a.state] !== TASK_STATE_ORDER[b.state]) return TASK_STATE_ORDER[a.state] - TASK_STATE_ORDER[b.state];
    return a.dueDate - b.dueDate;
  });

  if (tasks.length === 0) return "No assignments with due dates found across your courses.";

  const lines: string[] = ["## Upcoming & Overdue\n"];
  if (omittedTasks) lines.push(`_Showing the highest-priority ${COMPOSED_TASK_POLICY.maxRendered} assignments; ${omittedTasks} additional assignments were omitted._`, "");
  const groups: [TaskItem["state"], string][] = [
    ["overdue", "🔴 Overdue"],
    ["due_soon", "🟡 Due soon (next 3 days)"],
    ["upcoming", "🟢 Upcoming"],
    ["closed", "⚫ Closed (past cutoff — can no longer be submitted)"],
  ];
  for (const [state, heading] of groups) {
    const items = tasks.filter((t) => t.state === state);
    if (items.length === 0) continue;
    lines.push(`### ${heading}`);
    for (const t of items) {
      const submission = t.submissionStatus ? ` — ${truncateText(t.submissionStatus, TEXT_OUTPUT_POLICY.maxLabelCharacters)}` : "";
      const grading = t.gradingStatus ? `, grading: ${truncateText(t.gradingStatus, TEXT_OUTPUT_POLICY.maxLabelCharacters)}` : "";
      lines.push(
        `- **${t.title}** (${t.courseName}) — due ${t.dueDateFormatted}${submission}${grading} — assignment ID: \`${t.assignmentId}\`, course ID: \`${t.courseId}\``,
      );
    }
    lines.push("");
  }

  return truncateText(lines.join("\n"), TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
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
