import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "../moodle-client.js";
import { bytesToBase64, isTextMime } from "../content.js";
import { MoodleTimeoutError } from "../moodle-client.js";
import { TEXT_OUTPUT_POLICY } from "../policy.js";
import { truncateText } from "../text.js";

export function registerDownloadTool(server: McpServer, client: MoodleClient): void {
  server.tool(
    "moodle_download_file",
    "Download a Moodle course file by its opaque fileId (from moodle_list_resources). Returns text for text/JSON/XML files; returns the raw bytes as an embedded resource for binary formats like PDFs, DOCX, images. The server fetches the file — you never need to fetch Moodle URLs directly.",
    {
      fileId: z.string().describe("Opaque fileId returned by moodle_list_resources"),
    },
    async ({ fileId }) => {
      let authorized;
      try { authorized = await client.downloadAuthorizedFile(fileId); } catch (err) {
        const message = err instanceof MoodleTimeoutError
          ? err.message : "File download failed. Please try again.";
        return { isError: true, content: [{ type: "text" as const, text: message }] };
      }
      if (!authorized) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "fileId is invalid, expired, or was not issued to the current user. Re-run moodle_list_resources to get fresh IDs.",
            },
          ],
        };
      }

      const { ref, downloaded } = authorized;

      const mime = downloaded.mime || ref.mime || "application/octet-stream";
      const resourceUri = `moodle://files/${fileId}`;

      if (isTextMime(mime)) {
        const text = truncateText(
          new TextDecoder("utf-8", { fatal: false }).decode(downloaded.bytes),
          TEXT_OUTPUT_POLICY.maxTextFileCharacters,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `**${truncateText(ref.filename, TEXT_OUTPUT_POLICY.maxLabelCharacters)}** (${mime})\n\n${text}`,
            },
          ],
        };
      }

      if (downloaded.bytes.length > TEXT_OUTPUT_POLICY.maxEmbeddedBinaryFileBytes) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Binary file is too large to embed safely. The MCP binary limit is ${Math.round(TEXT_OUTPUT_POLICY.maxEmbeddedBinaryFileBytes / 1024 / 1024)} MB.`,
          }],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `**${truncateText(ref.filename, TEXT_OUTPUT_POLICY.maxLabelCharacters)}** (${mime}, ${downloaded.bytes.length} bytes) — embedded below.`,
          },
          {
            type: "resource" as const,
            resource: {
              uri: resourceUri,
              mimeType: mime,
              blob: bytesToBase64(downloaded.bytes),
            },
          },
        ],
      };
    },
  );
}
