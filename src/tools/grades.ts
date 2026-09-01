import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "../moodle-client.js";

interface GradeItem {
  id: number;
  itemname: string | null;
  itemtype: string;
  itemmodule?: string;
  graderaw: number | null;
  grademax: number;
  gradeformatted: string;
  percentageformatted: string | null;
  feedback: string | null;
  categoryid?: number | null;
}

interface GradeCategory {
  id: number;
  fullname: string;
}

interface GradeReport {
  usergrades: {
    courseid: number;
    gradeitems: GradeItem[];
    gradecategories?: GradeCategory[];
  }[];
}

export async function getGrades(client: MoodleClient, courseId: number): Promise<string> {
  if (!client.supports("gradereport_user_get_grade_items")) {
    return "Grades API is not enabled on your Moodle. Ask your admin to enable the gradereport_user web service.";
  }

  const report = await client.call<GradeReport>("gradereport_user_get_grade_items", {
    courseid: courseId,
    userid: client.userId,
  });

  const userGrades = report.usergrades[0];
  if (!userGrades || userGrades.gradeitems.length === 0) {
    return "No grade items found for this course.";
  }

  const categories = new Map(
    (userGrades.gradecategories ?? []).map((c) => [c.id, c.fullname])
  );

  const lines: string[] = [`## Grades — Course ${courseId}\n`];

  // Group items by category
  const byCat = new Map<string, GradeItem[]>();
  for (const item of userGrades.gradeitems) {
    if (item.itemtype === "course") continue; // Skip the course total row, add at end
    const catName = item.categoryid != null
      ? (categories.get(item.categoryid) ?? "Uncategorized")
      : "Uncategorized";
    if (!byCat.has(catName)) byCat.set(catName, []);
    byCat.get(catName)!.push(item);
  }

  for (const [catName, items] of byCat) {
    lines.push(`### ${catName}`);
    lines.push("| Item | Grade | Max | % | Feedback |");
    lines.push("|------|-------|-----|---|----------|");
    for (const item of items) {
      const name = item.itemname ?? item.itemmodule ?? "—";
      const grade = item.gradeformatted || "—";
      const max = item.grademax > 0 ? String(item.grademax) : "—";
      const pct = item.percentageformatted ?? "—";
      const feedback = (item.feedback ?? "").replace(/\n/g, " ").slice(0, 60) || "—";
      lines.push(`| ${name} | ${grade} | ${max} | ${pct} | ${feedback} |`);
    }
    lines.push("");
  }

  // Course total
  const courseTotalItem = userGrades.gradeitems.find((i) => i.itemtype === "course");
  if (courseTotalItem) {
    lines.push(`**Course Total:** ${courseTotalItem.gradeformatted} / ${courseTotalItem.grademax} (${courseTotalItem.percentageformatted ?? "—"})`);
  }

  return lines.join("\n");
}

export function registerGradeTools(server: McpServer, client: MoodleClient): void {
  server.tool(
    "moodle_get_grades",
    "Get the student's own grades for a course — every graded item (assignments, tests, quizzes), category, percentage, and feedback comment, plus the course total. Answers 'what's my grade in this course' or 'how did I do on X'.",
    { courseId: z.number().describe("Course ID from moodle_list_courses") },
    async ({ courseId }) => ({
      content: [{ type: "text" as const, text: await getGrades(client, courseId) }],
    })
  );
}
