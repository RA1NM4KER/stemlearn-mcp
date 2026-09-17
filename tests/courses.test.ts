import { describe, it, expect, vi } from "vitest";
import { MoodleClient } from "../src/moodle-client.js";
import { getCourse } from "../src/tools/courses.js";

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
  mockFetch.mockResolvedValueOnce(
    jsonResponse({
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

describe("getCourse", () => {
  it("renders a section's summary text alongside its modules", async () => {
    const client = await makeClient();
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 10,
          name: "Week 7",
          summary: "<p>Practical 2 begins this week. <strong>Report due 25 Sept.</strong></p>",
          modules: [{ id: 1, name: "Practical 2 2026.pdf", modname: "resource", url: "https://x/1" }],
        },
      ]),
    );

    const result = await getCourse(client, 2722);

    expect(result).toContain("### Week 7");
    expect(result).toContain("Practical 2 begins this week. Report due 25 Sept.");
    expect(result).not.toContain("<p>");
    expect(result).not.toContain("<strong>");
    expect(result).toContain("Practical 2 2026.pdf");
  });

  it("still shows a section with only a summary and no modules", async () => {
    const client = await makeClient();
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        { id: 11, name: "Week 8", summary: "<p>Continue Practical 2 this week.</p>", modules: [] },
      ]),
    );

    const result = await getCourse(client, 2722);

    expect(result).toContain("### Week 8");
    expect(result).toContain("Continue Practical 2 this week.");
  });

  it("skips sections with neither summary nor modules", async () => {
    const client = await makeClient();
    mockFetch.mockResolvedValueOnce(
      jsonResponse([{ id: 12, name: "Week 9", summary: "", modules: [] }]),
    );

    const result = await getCourse(client, 2722);

    expect(result).toBe("This course has no content.");
  });
});
