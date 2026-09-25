import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "../moodle-client.js";
import { loadGrades } from "../moodle-loaders.js";
import type { MoodleGradeItem } from "../moodle-api.js";
import { GRADE_LIST_POLICY, TEXT_OUTPUT_POLICY } from "../policy.js";
import { sanitizeAndTruncateHtml, truncateText } from "../text.js";

export async function getGrades(client: MoodleClient, courseId: number): Promise<string> {
  if (!client.supports("gradereport_user_get_grade_items")) {
    return "Grades API is not enabled on your Moodle. Ask your admin to enable the gradereport_user web service.";
  }

  const report = await loadGrades(client, courseId);

  const userGrades = report.usergrades[0];
  if (!userGrades || userGrades.gradeitems.length === 0) {
    return "No grade items found for this course.";
  }

  const categories = new Map(
    (userGrades.gradecategories ?? []).map((c) => [c.id, c.fullname])
  );

  const lines: string[] = [`## Grades — Course ${courseId}\n`];
  const courseTotalItem = userGrades.gradeitems.find((item) => item.itemtype === "course");
  const detailItemLimit = courseTotalItem
    ? GRADE_LIST_POLICY.maxRenderedItems - 1
    : GRADE_LIST_POLICY.maxRenderedItems;

  // Group items by category
  const byCat = new Map<string, MoodleGradeItem[]>();
  for (const item of userGrades.gradeitems) {
    if (item.itemtype === "course") continue; // Skip the course total row, add at end
    const catName = item.categoryid != null
      ? (categories.get(item.categoryid) ?? "Uncategorized")
      : "Uncategorized";
    const categoryItems = byCat.get(catName);
    if (categoryItems) categoryItems.push(item);
    else byCat.set(catName, [item]);
  }

  let renderedItems = 0;
  let omittedItems = 0;
  for (const [catName, items] of byCat) {
    const rendered = items.filter(() => {
      if (renderedItems >= detailItemLimit) {
        omittedItems++;
        return false;
      }
      renderedItems++;
      return true;
    });
    if (rendered.length === 0) continue;
    lines.push(`### ${truncateText(catName, TEXT_OUTPUT_POLICY.maxLabelCharacters)}`);
    lines.push("| Item | Grade | Max | % | Feedback |");
    lines.push("|------|-------|-----|---|----------|");
    for (const item of rendered) {
      const name = truncateText(item.itemname ?? item.itemmodule ?? "—", TEXT_OUTPUT_POLICY.maxLabelCharacters);
      const grade = truncateText(item.gradeformatted || "—", TEXT_OUTPUT_POLICY.maxLabelCharacters);
      const max = item.grademax > 0 ? String(item.grademax) : "—";
      const pct = item.percentageformatted ?? "—";
      const feedback = sanitizeAndTruncateHtml(item.feedback ?? "", TEXT_OUTPUT_POLICY.maxGradeFeedbackCharacters).replace(/\n/g, " ") || "—";
      lines.push(`| ${name} | ${grade} | ${max} | ${pct} | ${feedback} |`);
    }
    lines.push("");
  }

  // Course total
  if (courseTotalItem) {
    lines.push(`**Course Total:** ${truncateText(courseTotalItem.gradeformatted, TEXT_OUTPUT_POLICY.maxLabelCharacters)} / ${courseTotalItem.grademax} (${truncateText(courseTotalItem.percentageformatted ?? "—", TEXT_OUTPUT_POLICY.maxLabelCharacters)})`);
  }
  if (omittedItems) lines.push(`\n_Showing the first ${GRADE_LIST_POLICY.maxRenderedItems} grade items; ${omittedItems} additional items were omitted._`);

  return truncateText(lines.join("\n"), TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
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
