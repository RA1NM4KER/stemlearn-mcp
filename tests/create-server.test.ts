import { describe, expect, it } from "vitest";
import { createStemLearnServer, STEMLEARN_SERVER_INFO } from "../src/create-server.js";
import type { MoodleClient } from "../src/moodle-client.js";

type RegisteredSurface = {
  _registeredTools: Record<string, unknown>;
  _registeredPrompts: Record<string, unknown>;
  _registeredResourceTemplates: Record<string, unknown>;
};

describe("shared MCP server factory", () => {
  it("builds the complete transport-independent STEMLearn surface", () => {
    const server = createStemLearnServer({} as MoodleClient) as unknown as RegisteredSurface;

    expect(STEMLEARN_SERVER_INFO).toEqual({ name: "stemlearn-mcp", version: "0.1.0" });
    expect(Object.keys(server._registeredTools)).toContain("moodle_list_courses");
    expect(Object.keys(server._registeredTools)).toContain("moodle_download_file");
    expect(Object.keys(server._registeredTools)).toContain("upcoming_and_overdue");
    expect(Object.keys(server._registeredPrompts)).toEqual(expect.arrayContaining([
      "summarize-course", "whats-due", "build-study-notes", "exam-prep", "search-notes",
    ]));
    expect(Object.keys(server._registeredResourceTemplates)).toContain("moodle-course-files");
  });
});
