import { describe, expect, it, vi } from "vitest";
import { MoodleClient } from "../src/moodle-client.js";
import { getQuizAttempts } from "../src/tools/quizzes.js";
import { QUIZ_ATTEMPT_POLICY } from "../src/policy.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
const jsonResponse = (data: unknown) => ({ ok: true, json: async () => data, text: async () => JSON.stringify(data) });

async function makeClient() {
  mockFetch.mockResolvedValueOnce(jsonResponse({
    userid: 1, username: "student", sitename: "STEMLearn", fullname: "Student", release: "4",
    functions: [{ name: "mod_quiz_get_user_attempts", version: "1" }],
  }));
  return MoodleClient.create({ baseUrl: "https://moodle.test", auth: { kind: "token", token: "token" } });
}

describe("moodle_get_quiz_attempts", () => {
  it("caps rendered attempts from a large Moodle response", async () => {
    const client = await makeClient();
    const attempts = Array.from({ length: QUIZ_ATTEMPT_POLICY.maxRendered + 1 }, (_, i) => ({
      id: i, attempt: i + 1, state: "finished", timestart: 1, timefinish: 2, sumgrades: 1,
    }));
    mockFetch.mockResolvedValueOnce(jsonResponse({ attempts }));
    const text = await getQuizAttempts(client, 1);
    expect((text.match(/\| finished \|/g) ?? [])).toHaveLength(QUIZ_ATTEMPT_POLICY.maxRendered);
    expect(text).toContain("Showing the first");
  });
});
