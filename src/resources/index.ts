import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "../moodle-client.js";
import { bytesToBase64, isTextMime } from "../content.js";
import { RESOURCE_LIST_POLICY, TEXT_OUTPUT_POLICY } from "../policy.js";
import { loadCourseContents, loadEnrolledCourses } from "../moodle-loaders.js";
import { isMoodleFileContent } from "../moodle-api.js";
import { truncateText } from "../text.js";

export function registerResources(server: McpServer, client: MoodleClient): void {
  server.resource(
    "moodle-course-files",
    new ResourceTemplate("moodle://files/{fileId}", {
      list: async () => {
        const courses = (await loadEnrolledCourses(client)).slice(0, RESOURCE_LIST_POLICY.maxCourses);

        const resources: { uri: string; name: string; mimeType?: string; description?: string }[] = [];

        for (const course of courses) {
          try {
              const sections = await loadCourseContents(client, course.id);
              for (const section of sections) {
                for (const mod of section.modules) {
                  if (!["resource", "folder"].includes(mod.modname)) continue;
                  for (const file of mod.contents ?? []) {
                    if (resources.length >= RESOURCE_LIST_POLICY.maxEntries) break;
                    if (!isMoodleFileContent(file)) continue;
                    const mime = file.mimetype ?? "application/octet-stream";
                    const fileId = await client.fileIdStore.seal({
                      userId: client.userId,
                      courseId: course.id,
                      fileurl: file.fileurl,
                      mime,
                      filename: file.filename,
                      filesize: file.filesize,
                    });
                    resources.push({
                      uri: `moodle://files/${fileId}`,
                      name: `${truncateText(course.shortname, TEXT_OUTPUT_POLICY.maxLabelCharacters)} / ${truncateText(section.name || "General", TEXT_OUTPUT_POLICY.maxLabelCharacters)} / ${truncateText(file.filename, TEXT_OUTPUT_POLICY.maxLabelCharacters)}`,
                      mimeType: mime,
                      description: `${truncateText(course.fullname, TEXT_OUTPUT_POLICY.maxLabelCharacters)} — ${truncateText(section.name || "General", TEXT_OUTPUT_POLICY.maxLabelCharacters)}`,
                    });
                  }
                }
              }
          } catch {
            // Skip courses that fail (permission / API issues).
          }
          if (resources.length >= RESOURCE_LIST_POLICY.maxEntries) break;
        }

        return { resources };
      },
    }),
    async (uri, { fileId }) => {
      const id = Array.isArray(fileId) ? fileId[0] : fileId;
      if (!id) throw new Error("File access denied. Obtain a fresh fileId from moodle_list_resources.");
      const authorized = await client.downloadAuthorizedFile(id);
      if (!authorized) throw new Error("File access denied. Obtain a fresh fileId from moodle_list_resources.");
      const { ref, downloaded } = authorized;
      const mime = downloaded.mime || ref.mime || "application/octet-stream";

      if (isTextMime(mime)) {
        const text = truncateText(
          new TextDecoder("utf-8", { fatal: false }).decode(downloaded.bytes),
          TEXT_OUTPUT_POLICY.maxTextFileCharacters,
        );
        return { contents: [{ uri: uri.href, mimeType: mime, text }] };
      }
      if (downloaded.bytes.length > TEXT_OUTPUT_POLICY.maxEmbeddedBinaryFileBytes) {
        throw new Error("Binary file is too large to embed safely.");
      }
      return {
        contents: [{ uri: uri.href, mimeType: mime, blob: bytesToBase64(downloaded.bytes) }],
      };
    },
  );
}
