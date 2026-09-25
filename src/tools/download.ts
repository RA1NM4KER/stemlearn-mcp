import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "../moodle-client.js";

const TEXT_MIMES = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-yaml",
  "application/yaml",
]);

function isTextMime(mime: string): boolean {
  return mime.startsWith("text/") || TEXT_MIMES.has(mime);
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
  }
  return btoa(s);
}

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
        const message = err instanceof Error && err.message === "Moodle request timed out. Please try again."
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
        const text = new TextDecoder("utf-8", { fatal: false }).decode(downloaded.bytes);
        return {
          content: [
            {
              type: "text" as const,
              text: `**${ref.filename}** (${mime})\n\n${text}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `**${ref.filename}** (${mime}, ${downloaded.bytes.length} bytes) — embedded below.`,
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
