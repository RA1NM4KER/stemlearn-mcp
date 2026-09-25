import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "../moodle-client.js";

interface ModuleContent {
  type: string;
  filename: string;
  fileurl: string;
  filesize: number;
  mimetype?: string;
}

interface CourseModule {
  id: number;
  name: string;
  modname: string;
  url?: string;
  contents?: ModuleContent[];
}

interface CourseSection {
  id: number;
  name: string;
  modules: CourseModule[];
}

const FILE_MODS = new Set(["resource", "url", "folder"]);
const DEFAULT_FILE_LIMIT = 25;
const MAX_FILE_LIMIT = 100;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function listResources(
  client: MoodleClient,
  courseId: number,
  filenameFilter?: string,
  limit = DEFAULT_FILE_LIMIT,
): Promise<string> {
  const sections = await client.call<CourseSection[]>("core_course_get_contents", {
    courseid: courseId,
  });

  const needle = filenameFilter?.toLowerCase();

  const lines: string[] = [`## Files — Course ${courseId}\n`];
  let hasFiles = false;
  let matchCount = 0;
  let omitted = 0;

  for (const section of sections) {
    const fileMods = section.modules.filter((m) => FILE_MODS.has(m.modname));
    if (fileMods.length === 0) continue;

    const sectionLines: string[] = [];

    for (const mod of fileMods) {
      if (mod.modname === "url") {
        if (needle && !mod.name.toLowerCase().includes(needle)) continue;
        sectionLines.push(`- 🔗 **${mod.name}** *(external link; not downloadable)*`);
        continue;
      }
      if (!mod.contents || mod.contents.length === 0) {
        if (needle && !mod.name.toLowerCase().includes(needle)) continue;
        sectionLines.push(`- 📁 **${mod.name}** *(empty)*`);
        continue;
      }
      for (const file of mod.contents) {
        if (file.type !== "file") continue;
        if (needle && !file.filename.toLowerCase().includes(needle)) continue;
        if (matchCount >= limit) { omitted++; continue; }
        const size = formatSize(file.filesize);
        matchCount++;
        const mime = file.mimetype ?? "application/octet-stream";
        const fileId = await client.fileIdStore.seal({ userId: client.userId, courseId, fileurl: file.fileurl, mime, filename: file.filename, filesize: file.filesize });
        sectionLines.push(`- 📄 **${file.filename}** *(${size})* — fileId: \`${fileId}\` — resource: \`moodle://files/${fileId}\``);
      }
    }

    if (sectionLines.length === 0) continue;
    lines.push(`### ${section.name || "General"}`, ...sectionLines, "");
    hasFiles = true;
  }

  if (!hasFiles) {
    return needle
      ? `No files matching "${filenameFilter}" found in this course.`
      : "No downloadable files found in this course.";
  }

  if (omitted) lines.push(`_Showing the first ${limit} matching files. Refine filenameFilter to find other materials._`);
  lines.push("_Use a listed fileId with `moodle_download_file`, or read its `moodle://files/{fileId}` resource URI._");
  return lines.join("\n");
}

export function registerFileTools(server: McpServer, client: MoodleClient): void {
  server.tool(
    "moodle_list_resources",
    "List the course materials (lecture slides, PDFs, notes, links) available to the student in a course, grouped by the course's own sections (weeks, chapters, topics — as defined by the lecturer). Without filenameFilter, this is a lightweight browsing view (names/sizes only, no fileId — courses with many files would otherwise blow the response size). Pass filenameFilter (part of a file's name) to narrow to matching files and get their opaque fileId for moodle_download_file. External URL-module links are shown as-is.",
    {
      courseId: z.number().describe("Course ID from moodle_list_courses"),
      filenameFilter: z
        .string()
        .optional()
        .describe("Substring to match against file/link names (case-insensitive)."),
      limit: z.number().int().min(1).max(MAX_FILE_LIMIT).optional().describe("Maximum downloadable files to return (default: 25, max: 100)."),
    },
    async ({ courseId, filenameFilter, limit }) => ({
      content: [{ type: "text" as const, text: await listResources(client, courseId, filenameFilter, limit) }],
    }),
  );
}
