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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function listResources(
  client: MoodleClient,
  courseId: number,
  filenameFilter?: string,
): Promise<string> {
  const sections = await client.call<CourseSection[]>("core_course_get_contents", {
    courseid: courseId,
  });

  // Sealing every file's fileId up front (one AES-GCM envelope per file,
  // ~300-400 chars each) blows the tool output token limit on courses with
  // many files — confirmed against a real course with 40+ resources across
  // its weekly sections. So: browsing (no filter) never seals IDs, it just
  // lists names/sizes. Passing filenameFilter narrows to matching files and
  // seals fileIds only for that (small) matching set.
  const needle = filenameFilter?.toLowerCase();

  const lines: string[] = [`## Files — Course ${courseId}\n`];
  let hasFiles = false;
  let matchCount = 0;

  for (const section of sections) {
    const fileMods = section.modules.filter((m) => FILE_MODS.has(m.modname));
    if (fileMods.length === 0) continue;

    const sectionLines: string[] = [];

    for (const mod of fileMods) {
      if (mod.modname === "url") {
        if (needle && !mod.name.toLowerCase().includes(needle)) continue;
        // External link (not a Moodle-hosted file). Safe to show as-is — it's
        // whatever the professor linked, and moodle_download_file cannot fetch it.
        if (mod.url) {
          sectionLines.push(`- 🔗 [${mod.name}](${mod.url}) *(external)*`);
        } else {
          sectionLines.push(`- 🔗 **${mod.name}** *(external)*`);
        }
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
        const size = formatSize(file.filesize);
        matchCount++;
        if (needle) {
          const mime = file.mimetype ?? "application/octet-stream";
          const fileId = await client.fileIdStore.seal({
            userId: client.userId,
            courseId,
            fileurl: file.fileurl,
            mime,
            filename: file.filename,
            filesize: file.filesize,
          });
          sectionLines.push(`- 📄 **${file.filename}** *(${size})* — fileId: \`${fileId}\``);
        } else {
          sectionLines.push(`- 📄 **${file.filename}** *(${size})*`);
        }
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

  if (needle) {
    lines.push(
      matchCount > 0
        ? "_Call `moodle_download_file` with a fileId above to read the file's contents._"
        : "",
    );
  } else {
    lines.push(
      "_This is a browsing view — fileIds aren't included here to keep the listing short._",
      '_Call `moodle_list_resources` again with `filenameFilter` set to (part of) a file\'s name to get its fileId for `moodle_download_file`._',
    );
  }
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
        .describe("Substring to match against file/link names (case-insensitive). Required to get a fileId back."),
    },
    async ({ courseId, filenameFilter }) => ({
      content: [{ type: "text" as const, text: await listResources(client, courseId, filenameFilter) }],
    }),
  );
}
