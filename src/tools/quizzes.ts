import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "../moodle-client.js";

interface QuizDetail {
  id: number;
  coursemodule: number;
  name: string;
  intro: string;
  timelimit: number;
  attempts: number;
  grademethod: number;
  timeopen: number;
  timeclose: number;
}

interface QuizzesResponse {
  quizzes: QuizDetail[];
}

interface CourseSection {
  id: number;
  name: string;
  modules: { id: number; name: string; modname: string; url?: string }[];
}

interface QuizAttempt {
  id: number;
  attempt: number;
  state: string;
  timestart: number;
  timefinish: number;
  sumgrades: number | null;
}

interface AttemptsResponse {
  attempts: QuizAttempt[];
}

function formatDate(ts: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
}

function formatDuration(seconds: number): string {
  if (!seconds) return "No limit";
  const m = Math.floor(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export async function listQuizzes(client: MoodleClient, courseId: number): Promise<string> {
  if (!client.supports("mod_quiz_get_quizzes_by_courses")) {
    return "Quiz API is not enabled on your Moodle. Ask your admin to enable mod_quiz web services.";
  }

  const [sections, quizData] = await Promise.all([
    client.call<CourseSection[]>("core_course_get_contents", { courseid: courseId }),
    client.call<QuizzesResponse>("mod_quiz_get_quizzes_by_courses", {
      "courseids[0]": courseId,
    }),
  ]);

  const byModule = new Map(quizData.quizzes.map((q) => [q.coursemodule, q]));
  const lines: string[] = [`## Quizzes — Course ${courseId}\n`];
  let hasAny = false;

  for (const section of sections) {
    const quizMods = section.modules.filter((m) => m.modname === "quiz");
    if (quizMods.length === 0) continue;

    lines.push(`### ${section.name || "General"}`);
    hasAny = true;

    for (const mod of quizMods) {
      const q = byModule.get(mod.id);
      if (!q) {
        lines.push(`- **${mod.name}** *(details unavailable)*`);
        continue;
      }
      lines.push(`- **${q.name}**`);
      lines.push(`  ID: \`${q.id}\` | Time limit: ${formatDuration(q.timelimit)} | Attempts: ${q.attempts === 0 ? "Unlimited" : q.attempts}`);
      if (q.timeopen) lines.push(`  Opens: ${formatDate(q.timeopen)}`);
      if (q.timeclose) lines.push(`  Closes: ${formatDate(q.timeclose)}`);
    }
    lines.push("");
  }

  if (!hasAny) return "No quizzes found in this course.";
  return lines.join("\n");
}

export async function getQuizAttempts(client: MoodleClient, quizId: number): Promise<string> {
  if (!client.supports("mod_quiz_get_user_attempts")) {
    return "Quiz attempts API is not enabled on your Moodle.";
  }

  const data = await client.call<AttemptsResponse>("mod_quiz_get_user_attempts", {
    quizid: quizId,
    status: "all",
    includepreviews: false,
  });

  const attempts = data.attempts ?? [];
  if (attempts.length === 0) return `No attempts found for quiz ${quizId}.`;

  const lines: string[] = [`## Quiz ${quizId} — Your Attempts\n`];
  lines.push("| # | State | Started | Finished | Grade |");
  lines.push("|---|-------|---------|----------|-------|");

  for (const a of attempts) {
    const finished = a.timefinish ? formatDate(a.timefinish) : "In progress";
    const grade = a.sumgrades != null ? String(a.sumgrades) : "—";
    lines.push(`| ${a.attempt} | ${a.state} | ${formatDate(a.timestart)} | ${finished} | ${grade} |`);
  }

  return lines.join("\n");
}

export function registerQuizTools(server: McpServer, client: MoodleClient): void {
  server.tool(
    "moodle_list_quizzes",
    "List the quizzes in one of the student's courses, with time limits, allowed attempts, and open/close dates.",
    { courseId: z.number().describe("Course ID from moodle_list_courses") },
    async ({ courseId }) => ({
      content: [{ type: "text" as const, text: await listQuizzes(client, courseId) }],
    })
  );

  server.tool(
    "moodle_get_quiz_attempts",
    "Get the student's own past attempt history for one quiz — grades, states, and timing.",
    { quizId: z.number().describe("Quiz ID from moodle_list_quizzes") },
    async ({ quizId }) => ({
      content: [{ type: "text" as const, text: await getQuizAttempts(client, quizId) }],
    })
  );
}
