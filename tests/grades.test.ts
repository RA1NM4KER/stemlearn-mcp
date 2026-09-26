import { describe, expect, it, vi } from "vitest";
import { MoodleClient, MoodleValidationError } from "../src/moodle-client.js";
import { getGrades } from "../src/tools/grades.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

async function makeClient() {
  mockFetch.mockResolvedValueOnce(jsonResponse({
    userid: 1,
    sitename: "STEMLearn",
    functions: [{ name: "gradereport_user_get_grade_items", version: "1" }],
  }));
  return MoodleClient.create({ baseUrl: "https://stemlearn.sun.ac.za", auth: { kind: "token", token: "test-token" } });
}

describe("getGrades", () => {
  it("renders categories, items, and a course total when core grade items have null itemmodule", async () => {
    const client = await makeClient();
    mockFetch.mockResolvedValueOnce(jsonResponse({
      usergrades: [{
        courseid: 3062,
        gradecategories: [{ id: 10, fullname: "Assessment Framework 3" }],
        gradeitems: [
          { itemtype: "category", itemmodule: null, itemname: "Assessment Framework 3", categoryid: 10, gradeformatted: "", feedback: "" },
          { itemtype: "mod", itemmodule: "assign", itemname: "Assessment task", categoryid: 10, grademax: 100, gradeformatted: "80.00", percentageformatted: "80%", feedback: "Well done" },
          { itemtype: "course", itemmodule: null, categoryid: 10, grademax: 100, gradeformatted: "80.00", percentageformatted: "80%", feedback: "" },
        ],
      }],
    }));

    const text = await getGrades(client, 3062);

    expect(text).toContain("### Assessment Framework 3");
    expect(text).toContain("Assessment task");
    expect(text).toContain("Well done");
    expect(text).toContain("**Course Total:** 80.00 / 100 (80%)");
  });

  it("rejects a malformed itemmodule rather than rendering upstream data", async () => {
    const client = await makeClient();
    mockFetch.mockResolvedValueOnce(jsonResponse({
      usergrades: [{ courseid: 3062, gradeitems: [{ itemtype: "course", itemmodule: 7 }] }],
    }));

    await expect(getGrades(client, 3062)).rejects.toBeInstanceOf(MoodleValidationError);
  });
});
