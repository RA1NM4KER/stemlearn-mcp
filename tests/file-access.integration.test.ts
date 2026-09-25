import { describe, expect, it, vi, beforeEach } from "vitest";
import { MoodleClient } from "../src/moodle-client.js";
import { FileIdStore } from "../src/file-id-store.js";
import { registerDownloadTool } from "../src/tools/download.js";
import { registerResources } from "../src/resources/index.js";
import { registerPrompts } from "../src/prompts/index.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
const fileUrl = "https://moodle.test/pluginfile.php/1/course/section/0/notes.txt";
const site = { userid: 1, username: "student", sitename: "STEMLearn", fullname: "Student", release: "4", functions: [{ name: "core_course_get_contents", version: "1" }] };
const response = (data: unknown) => ({ ok: true, json: async () => data, text: async () => JSON.stringify(data) });

async function client() {
  mockFetch.mockResolvedValueOnce(response(site));
  return MoodleClient.create({ baseUrl: "https://moodle.test", token: "token" } as never);
}

function capture(client: MoodleClient) {
  let tool: ((args: { fileId: string }) => Promise<unknown>) | undefined;
  let resource: ((uri: URL, vars: { fileId: string }) => Promise<unknown>) | undefined;
  const prompts = new Map<string, (args: Record<string, string>) => Promise<unknown>>();
  const server = {
    tool: (_name: string, _description: string, _schema: unknown, handler: typeof tool) => { tool = handler; },
    resource: (_name: string, _template: unknown, handler: typeof resource) => { resource = handler; },
    prompt: (name: string, _description: string, _schema: unknown, handler: (args: Record<string, string>) => Promise<unknown>) => prompts.set(name, handler),
  };
  registerDownloadTool(server as never, client);
  registerResources(server as never, client);
  registerPrompts(server as never);
  return { tool: tool!, resource: resource!, prompts };
}

function visibleFile() { return [{ modules: [{ contents: [{ type: "file", fileurl: fileUrl }] }] }]; }

describe("file MCP integration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the registered opaque resource URI in the prompt workflow", async () => {
    const c = await client();
    const { prompts } = capture(c);
    const prompt = await prompts.get("search-notes")!({ courseId: "5", query: "limits" }) as { messages: { content: { text: string } }[] };
    expect(prompt.messages[0].content.text).toContain("moodle://files/{fileId}");
    expect(prompt.messages[0].content.text).not.toContain("moodle://courses/");
  });

  it("applies identical current-access validation to tool and resource reads", async () => {
    const c = await client();
    const id = await c.fileIdStore.seal({ userId: 1, courseId: 5, fileurl: fileUrl, mime: "text/plain", filename: "notes.txt", filesize: 2 });
    const { tool, resource } = capture(c);
    mockFetch.mockResolvedValueOnce(response(visibleFile())).mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "text/plain" }), arrayBuffer: async () => new TextEncoder().encode("ok").buffer });
    const toolResult = await tool({ fileId: id }) as { isError?: boolean };
    expect(toolResult.isError).not.toBe(true);
    mockFetch.mockResolvedValueOnce(response(visibleFile())).mockResolvedValueOnce({ ok: true, headers: new Headers({ "content-type": "text/plain" }), arrayBuffer: async () => new TextEncoder().encode("ok").buffer });
    const resourceResult = await resource(new URL(`moodle://files/${id}`), { fileId: id }) as { contents: unknown[] };
    expect(resourceResult.contents).toHaveLength(1);
  });

  it("rejects expired, malformed, other-user, unauthorized, and unsafe file references", async () => {
    const c = await client();
    const { tool } = capture(c);
    expect((await tool({ fileId: "bad" }) as { isError: boolean }).isError).toBe(true);
    const expired = new FileIdStore("token", -1);
    const oldId = await expired.seal({ userId: 1, courseId: 5, fileurl: fileUrl, mime: "text/plain", filename: "x", filesize: 1 });
    expect((await tool({ fileId: oldId }) as { isError: boolean }).isError).toBe(true);
    const otherId = await c.fileIdStore.seal({ userId: 2, courseId: 5, fileurl: fileUrl, mime: "text/plain", filename: "x", filesize: 1 });
    expect((await tool({ fileId: otherId }) as { isError: boolean }).isError).toBe(true);
    const unsafeId = await c.fileIdStore.seal({ userId: 1, courseId: 5, fileurl: "https://evil.test/pluginfile.php/x", mime: "text/plain", filename: "x", filesize: 1 });
    expect((await tool({ fileId: unsafeId }) as { isError: boolean }).isError).toBe(true);
    const deniedId = await c.fileIdStore.seal({ userId: 1, courseId: 5, fileurl: fileUrl, mime: "text/plain", filename: "x", filesize: 1 });
    mockFetch.mockResolvedValueOnce(response([]));
    expect((await tool({ fileId: deniedId }) as { isError: boolean }).isError).toBe(true);
  });
});
