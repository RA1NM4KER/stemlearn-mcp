import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "../moodle-client.js";
import { sanitizeAndTruncateHtml, truncateText } from "../text.js";
import { loadNotifications } from "../moodle-loaders.js";
import { TEXT_OUTPUT_POLICY } from "../policy.js";

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export async function getNotifications(client: MoodleClient, limit = 20): Promise<string> {
  if (!client.supports("message_popup_get_popup_notifications")) {
    return "Notifications API is not enabled on your Moodle.";
  }

  const data = await loadNotifications(client, limit);

  const notifications = data.notifications;
  if (notifications.length === 0) return "No notifications found.";

  const lines: string[] = [
    `## Notifications (${data.unreadcount} unread)\n`,
  ];

  for (const n of notifications) {
    const status = n.read ? "" : " 🔵";
    const preview = sanitizeAndTruncateHtml(n.text, TEXT_OUTPUT_POLICY.maxNotificationPreviewCharacters);
    lines.push(`- **${truncateText(n.subject, TEXT_OUTPUT_POLICY.maxLabelCharacters)}**${status}`);
    lines.push(`  ${formatDate(n.timecreated)}`);
    if (preview) lines.push(`  ${preview}`);
    lines.push("");
  }

  return truncateText(lines.join("\n"), TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
}

export function registerNotificationTools(server: McpServer, client: MoodleClient): void {
  server.tool(
    "moodle_get_notifications",
    "Get the student's recent Moodle notifications (grade returns, assignment feedback, forum replies, deadline reminders, etc.). Unread items are marked with 🔵.",
    { limit: z.number().int().min(1).max(100).optional().describe("Number of notifications to fetch (default: 20, max: 100)") },
    async ({ limit }) => ({
      content: [{ type: "text" as const, text: await getNotifications(client, limit) }],
    })
  );
}
