import { describe, it, expect, vi, beforeEach } from "vitest";
import { MoodleClient } from "../src/moodle-client.js";
import { registerFileTools } from "../src/tools/files.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockOkJson(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

async function makeClient() {
  mockFetch.mockResolvedValueOnce(
    mockOkJson({
      userid: 1,
      username: "student",
      sitename: "STEMLearn",
      fullname: "Test Student",
      release: "4.5.8",
      functions: [{ name: "core_course_get_contents", version: "1" }],
    }),
  );
  return MoodleClient.create({ baseUrl: "https://stemlearn.sun.ac.za", token: "tok" });
}

// Minimal fake McpServer that just captures the registered tool handler.
function captureTool() {
  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
  const server = {
    tool: (name: string, _desc: string, _schema: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => {
      handlers.set(name, handler);
    },
  };
  return { server, handlers };
}

const MANY_FILES_COURSE = [
  {
    id: 1,
    name: "Week 1",
    modules: [
      {
        id: 1,
        name: "Lecture 1",
        modname: "resource",
        contents: [
          { type: "file", filename: "Lecture 1.pdf", fileurl: "https://x/1", filesize: 1000, mimetype: "application/pdf" },
        ],
      },
    ],
  },
  {
    id: 2,
    name: "Week 2",
    modules: [
      {
        id: 2,
        name: "Practical 2",
        modname: "resource",
        contents: [
          { type: "file", filename: "Practical 2.pdf", fileurl: "https://x/2", filesize: 2000, mimetype: "application/pdf" },
        ],
      },
    ],
  },
];

describe("moodle_list_resources", () => {
  beforeEach(() => vi.clearAllMocks());

  it("browsing without filenameFilter lists files but omits fileId", async () => {
    const client = await makeClient();
    const { server, handlers } = captureTool();
    registerFileTools(server as never, client);

    mockFetch.mockResolvedValueOnce(mockOkJson(MANY_FILES_COURSE));
    const result = (await handlers.get("moodle_list_resources")!({ courseId: 2722 })) as {
      content: { text: string }[];
    };
    const text = result.content[0].text;

    expect(text).toContain("Lecture 1.pdf");
    expect(text).toContain("Practical 2.pdf");
    // Regression: sealing a fileId per file for every file in a course blew
    // the tool output token limit on a real course with 40+ resources.
    // Browsing without a filter must never seal/print a fileId.
    expect(text).not.toContain("fileId:");
    expect(text).toContain("filenameFilter");
  });

  it("with filenameFilter, returns only matching files and includes their fileId", async () => {
    const client = await makeClient();
    const { server, handlers } = captureTool();
    registerFileTools(server as never, client);

    mockFetch.mockResolvedValueOnce(mockOkJson(MANY_FILES_COURSE));
    const result = (await handlers.get("moodle_list_resources")!({
      courseId: 2722,
      filenameFilter: "Practical",
    })) as { content: { text: string }[] };
    const text = result.content[0].text;

    expect(text).toContain("Practical 2.pdf");
    expect(text).toContain("fileId:");
    expect(text).not.toContain("Lecture 1.pdf");
  });
});
