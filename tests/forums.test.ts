import { describe, it, expect, vi, beforeEach } from "vitest";
import { MoodleClient } from "../src/moodle-client.js";
import { listForumsRaw, getDiscussionsRaw, getForumDiscussions, listForums } from "../src/tools/forums.js";
import { FORUM_LIST_POLICY, TEXT_OUTPUT_POLICY } from "../src/policy.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockOkJson(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

async function makeClient(supportedFunctions: string[]) {
  mockFetch.mockResolvedValueOnce(
    mockOkJson({
      userid: 1,
      username: "student",
      sitename: "STEMLearn",
      fullname: "Test Student",
      release: "4.5.8",
      functions: supportedFunctions.map((name) => ({ name, version: "1" })),
    }),
  );
  return MoodleClient.create({ baseUrl: "https://stemlearn.sun.ac.za", auth: { kind: "token", token: "tok" } });
}

describe("listForumsRaw", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls mod_forum_get_forums_by_courses, not core_course_get_contents", async () => {
    const client = await makeClient(["mod_forum_get_forums_by_courses"]);
    mockFetch.mockResolvedValueOnce(
      mockOkJson([{ id: 4445, cmid: 92947, course: 2722, name: "Announcements", type: "news", numdiscussions: 3 }]),
    );

    const forums = await listForumsRaw(client, 2722);

    expect(forums).toHaveLength(1);
    // Regression: must expose the real forum id (4445), distinct from cmid
    // (92947) — mod_forum_get_forum_discussions needs the former.
    expect(forums[0].id).toBe(4445);
    expect(forums[0].cmid).toBe(92947);

    const calledBody = mockFetch.mock.calls.at(-1)?.[1]?.body as URLSearchParams;
    expect(calledBody.get("wsfunction")).toBe("mod_forum_get_forums_by_courses");
  });

  it("returns an empty list when the function isn't supported, rather than erroring", async () => {
    // A non-empty functions list that excludes our target: MoodleClient.supports()
    // only returns false once it actually knows the server's function list
    // (an empty list means "unknown", and it assumes available).
    const client = await makeClient(["core_webservice_get_site_info"]);
    const forums = await listForumsRaw(client, 2722);
    expect(forums).toEqual([]);
  });
});

describe("getDiscussionsRaw", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls with the real forum id and never sends sortby/sortdirection", async () => {
    const client = await makeClient(["mod_forum_get_forum_discussions"]);
    mockFetch.mockResolvedValueOnce(mockOkJson({ discussions: [] }));

    await getDiscussionsRaw(client, 4445);

    const calledBody = mockFetch.mock.calls.at(-1)?.[1]?.body as URLSearchParams;
    expect(calledBody.get("forumid")).toBe("4445");
    // Regression: these params are rejected with invalidparameter on real
    // Moodle servers (confirmed against STEMLearn, Moodle 4.5.8) — must
    // never be sent, sort client-side instead.
    expect(calledBody.has("sortby")).toBe(false);
    expect(calledBody.has("sortdirection")).toBe(false);
  });

  it("sorts discussions by timemodified descending client-side", async () => {
    const client = await makeClient(["mod_forum_get_forum_discussions"]);
    mockFetch.mockResolvedValueOnce(
      mockOkJson({
        discussions: [
          { id: 1, discussion: 1, name: "Older", userfullname: "A", numreplies: 0, timemodified: 100, pinned: false },
          { id: 2, discussion: 2, name: "Newer", userfullname: "B", numreplies: 0, timemodified: 200, pinned: false },
        ],
      }),
    );

    const discussions = await getDiscussionsRaw(client, 4445);
    expect(discussions.map((d) => d.name)).toEqual(["Newer", "Older"]);
  });
});

describe("getForumDiscussions (formatted output)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the real author name, not \"undefined\"", async () => {
    const client = await makeClient(["mod_forum_get_forum_discussions"]);
    mockFetch.mockResolvedValueOnce(
      mockOkJson({
        discussions: [
          { id: 1, discussion: 1, name: "A post", userfullname: "Jane Lecturer", numreplies: 2, timemodified: 1788159040, pinned: false },
        ],
      }),
    );

    const text = await getForumDiscussions(client, 4445);
    expect(text).toContain("Jane Lecturer");
    expect(text).not.toContain("undefined");
  });

  it("renders the post body, stripped of HTML", async () => {
    const client = await makeClient(["mod_forum_get_forum_discussions"]);
    mockFetch.mockResolvedValueOnce(
      mockOkJson({
        discussions: [
          {
            id: 1,
            discussion: 1,
            name: "Week 08",
            userfullname: "Nick Hale",
            numreplies: 0,
            timemodified: 1788159040,
            pinned: false,
            message: "<p>The tut test will cover <strong>Lectures 01 and 02</strong>.</p>",
          },
        ],
      }),
    );

    const text = await getForumDiscussions(client, 4445);
    expect(text).toContain("The tut test will cover Lectures 01 and 02.");
    expect(text).not.toContain("<p>");
    expect(text).not.toContain("<strong>");
  });

  it("bounds an oversized forum post while preserving a truncation marker", async () => {
    const client = await makeClient(["mod_forum_get_forum_discussions"]);
    mockFetch.mockResolvedValueOnce(mockOkJson({
      discussions: [{
        id: 1, discussion: 1, name: "Large post", userfullname: "Lecturer", numreplies: 0,
        timemodified: 1, pinned: false, message: `<p>${"x".repeat(TEXT_OUTPUT_POLICY.maxForumPostCharacters + 1)}</p>`,
      }],
    }));

    const text = await getForumDiscussions(client, 1);
    expect(text).toContain("Text truncated after");
    expect(text).not.toContain("<p>");
  });
});

describe("forum output caps", () => {
  beforeEach(() => vi.clearAllMocks());

  it("caps rendered forum entries from a large response", async () => {
    const client = await makeClient(["mod_forum_get_forums_by_courses"]);
    const forums = Array.from({ length: FORUM_LIST_POLICY.maxRenderedForums + 1 }, (_, index) => ({
      id: index + 1, cmid: index + 1, course: 1, name: `Forum ${index + 1}`, type: "general",
    }));
    mockFetch.mockResolvedValueOnce(mockOkJson(forums));

    const text = await listForums(client, 1);
    expect((text.match(/use with moodle_get_forum_discussions/g) ?? [])).toHaveLength(FORUM_LIST_POLICY.maxRenderedForums);
    expect(text).toContain("Showing the first");
  });
});
