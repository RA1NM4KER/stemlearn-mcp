import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "../moodle-client.js";
import { stripHtml } from "../text.js";

interface CalendarEvent {
  id: number;
  name: string;
  courseid: number;
  timestart: number;
  timeduration: number;
  eventtype: string;
  course?: { id: number; shortname: string; fullname: string };
  description?: string;
  url?: string;
}

interface CalendarResponse {
  events: CalendarEvent[];
}

interface EnrolledCourse {
  id: number;
  fullname: string;
}

// core_calendar_get_action_events_by_timesort only returns events with a
// student-facing "action" (submit, attempt, etc). It silently omits plain
// calendar entries with no action — lecture/attendance registers, PRAC
// session close times, quiz close reminders that aren't the primary due
// date — even though those show up on the Moodle dashboard calendar. Pull
// those in too via core_calendar_get_calendar_events, per enrolled course.
async function getPlainCalendarEvents(
  client: MoodleClient,
  courseIds: number[],
  timestart: number,
  timeend: number,
): Promise<CalendarEvent[]> {
  if (courseIds.length === 0 || !client.supports("core_calendar_get_calendar_events")) return [];
  const params: Record<string, number> = {
    "options[timestart]": timestart,
    "options[timeend]": timeend,
  };
  courseIds.forEach((id, i) => {
    params[`events[courseids][${i}]`] = id;
  });
  const data = await client.call<CalendarResponse>("core_calendar_get_calendar_events", params);
  return data.events ?? [];
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export async function getCalendarEvents(
  client: MoodleClient,
  courseId?: number,
  daysAhead = 30
): Promise<string> {
  if (!client.supports("core_calendar_get_action_events_by_timesort")) {
    return "Calendar API is not enabled on your Moodle. Ask your admin to enable core_calendar web services.";
  }

  const now = Math.floor(Date.now() / 1000);
  const until = now + daysAhead * 86400;

  const data = await client.call<CalendarResponse>(
    "core_calendar_get_action_events_by_timesort",
    {
      timesortfrom: now,
      timesortto: until,
      limitnum: 50,
    }
  );

  const courses = await client.call<EnrolledCourse[]>("core_enrol_get_users_courses", {
    userid: client.userId,
  });
  const courseNames = new Map(courses.map((c) => [c.id, c.fullname]));
  const plainCourseIds = courseId ? [courseId] : courses.map((c) => c.id);
  const plainEvents = await getPlainCalendarEvents(client, plainCourseIds, now, until);

  const seenIds = new Set<number>();
  let events = [...(data.events ?? []), ...plainEvents].filter((e) => {
    if (seenIds.has(e.id)) return false;
    seenIds.add(e.id);
    return true;
  });
  events.sort((a, b) => a.timestart - b.timestart);
  events = events.slice(0, 100);

  if (courseId) {
    events = events.filter((e) => e.courseid === courseId);
  }

  if (events.length === 0) {
    return courseId
      ? `No upcoming events in the next ${daysAhead} days for course ${courseId}.`
      : `No upcoming events in the next ${daysAhead} days.`;
  }

  // Group by course
  const byCourse = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = event.course?.fullname ?? courseNames.get(event.courseid) ?? `Course ${event.courseid}`;
    if (!byCourse.has(key)) byCourse.set(key, []);
    byCourse.get(key)!.push(event);
  }

  const lines: string[] = [`## Upcoming Events (next ${daysAhead} days)\n`];

  for (const [courseName, courseEvents] of byCourse) {
    lines.push(`### ${courseName}`);
    for (const e of courseEvents) {
      const type = e.eventtype ? `\`${e.eventtype}\`` : "";
      lines.push(`- **${e.name}** — ${formatDate(e.timestart)} ${type}`);
      const desc = e.description ? stripHtml(e.description).slice(0, 200) : "";
      if (desc) lines.push(`  ${desc}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function registerCalendarTools(server: McpServer, client: MoodleClient): void {
  server.tool(
    "moodle_get_calendar_events",
    "Get the student's upcoming deadlines and calendar events — assignments due, quizzes opening/closing, lecture/practical attendance registers, and other course calendar entries — across their courses, optionally filtered to one course. Good for 'what's coming up' / 'what's due this week' / 'what's on the calendar'. Defaults to the next 30 days.",
    {
      courseId: z.number().optional().describe("Filter to a specific course ID (optional)"),
      daysAhead: z.number().int().min(1).max(365).optional().describe("How many days ahead to look (default: 30, max: 365)"),
    },
    async ({ courseId, daysAhead }) => ({
      content: [{ type: "text" as const, text: await getCalendarEvents(client, courseId, daysAhead) }],
    })
  );
}
