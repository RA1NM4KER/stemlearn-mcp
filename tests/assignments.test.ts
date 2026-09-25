import { describe, expect, it, vi } from "vitest";
import { MoodleClient } from "../src/moodle-client.js";
import { listAssignments } from "../src/tools/assignments.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
const jsonResponse = (data: unknown) => ({ ok: true, json: async () => data, text: async () => JSON.stringify(data) });

async function makeClient() {
  mockFetch.mockResolvedValueOnce(jsonResponse({
    userid: 1, sitename: "STEMLearn",
    functions: [{ name: "core_course_get_contents" }, { name: "mod_assign_get_assignments" }],
  }));
  return MoodleClient.create({ baseUrl: "https://moodle.test", auth: { kind: "token", token: "token" } });
}

describe("listAssignments", () => {
  it("matches an assignment to its course module via cmid, not coursemodule", async () => {
    // Regression: mod_assign_get_assignments names the course-module id
    // "cmid" on a real Moodle server. listAssignments must key its
    // assignment lookup off that real field, or every assignment renders as
    // "details unavailable" even though the API call succeeded.
    const client = await makeClient();
    mockFetch.mockResolvedValueOnce(jsonResponse([
      { id: 1, name: "Week 7", modules: [{ id: 92947, name: "Practical 2", modname: "assign" }] },
    ]));
    mockFetch.mockResolvedValueOnce(jsonResponse({
      courses: [{ id: 2722, assignments: [{ id: 6326, cmid: 92947, name: "Practical 2", duedate: 1758830340, grade: 100 }] }],
    }));

    const text = await listAssignments(client, 2722);

    expect(text).not.toContain("details unavailable");
    expect(text).toContain("Practical 2");
    expect(text).toContain("ID: `6326`");
  });
});
