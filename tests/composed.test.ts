import { describe, it, expect, vi, beforeEach } from "vitest";
import { MoodleClient, MoodleValidationError } from "../src/moodle-client.js";
import { courseOverview, upcomingAndOverdue } from "../src/tools/composed.js";
import { COMPOSED_TASK_POLICY } from "../src/policy.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

/** Routes each call by wsfunction, regardless of call order (composed tools issue concurrent calls). */
function routedFetchMock(routes: Record<string, unknown>) {
  return (_url: string, init: RequestInit) => {
    const body = init.body as URLSearchParams;
    const fn = body.get("wsfunction")!;
    if (!(fn in routes)) throw new Error(`Unexpected wsfunction in test: ${fn}`);
    return jsonResponse(routes[fn]);
  };
}

const ALL_FUNCTIONS = [
  "core_enrol_get_users_courses",
  "mod_assign_get_assignments",
  "mod_assign_get_submission_status",
  "gradereport_user_get_grade_items",
  "mod_forum_get_forums_by_courses",
  "mod_forum_get_forum_discussions",
];

async function makeClient() {
  mockFetch.mockResolvedValueOnce(
    jsonResponse({
      userid: 1,
      username: "student",
      sitename: "STEMLearn",
      fullname: "Test Student",
      release: "4.5.8",
      functions: ALL_FUNCTIONS.map((name) => ({ name, version: "1" })),
    }),
  );
  return MoodleClient.create({ baseUrl: "https://stemlearn.sun.ac.za", auth: { kind: "token", token: "tok" } });
}

const COURSE = { id: 2722, fullname: "Intro to Widgets", shortname: "WIDG101", progress: 8.3 };

describe("courseOverview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("merges course identity, upcoming assignments, grade total, and announcements into one view", async () => {
    const client = await makeClient();
    const now = Math.floor(Date.now() / 1000);

    mockFetch.mockImplementation(
      routedFetchMock({
        core_enrol_get_users_courses: [COURSE],
        mod_assign_get_assignments: {
          courses: [
            {
              id: 2722,
              assignments: [{ id: 6326, coursemodule: 1, name: "Practical 2", duedate: now + 86400, grade: 100 }],
            },
          ],
        },
        gradereport_user_get_grade_items: {
          usergrades: [
            {
              courseid: 2722,
              gradeitems: [
                { itemtype: "course", gradeformatted: "75.00", grademax: 100, percentageformatted: "75%" },
              ],
            },
          ],
        },
        mod_forum_get_forums_by_courses: [{ id: 4445, cmid: 92947, course: 2722, name: "Announcements", type: "news" }],
        mod_forum_get_forum_discussions: {
          discussions: [
            { id: 1, discussion: 1, name: "Welcome post", userfullname: "Prof X", numreplies: 0, timemodified: now, pinned: false },
          ],
        },
      }),
    );

    const text = await courseOverview(client, 2722);

    expect(text).toContain("Intro to Widgets");
    expect(text).toContain("Practical 2");
    expect(text).toContain("75.00 / 100");
    expect(text).toContain("Welcome post");
    // Regression: the real Moodle field is `userfullname`, not `firstuserfullname`
    // (the latter doesn't exist and rendered "undefined" — confirmed against
    // a real server's mod_forum_get_forum_discussions response).
    expect(text).toContain("Prof X");
    expect(text).not.toContain("undefined");
  });

  it("reports course not found without throwing when courseId isn't in the student's enrolled courses", async () => {
    const client = await makeClient();
    mockFetch.mockImplementation(routedFetchMock({ core_enrol_get_users_courses: [COURSE] }));
    const text = await courseOverview(client, 9999);
    expect(text).toContain("not found");
  });
});

describe("upcomingAndOverdue", () => {
  beforeEach(() => vi.clearAllMocks());

  it("classifies assignments into overdue vs upcoming and sorts most-overdue first", async () => {
    const client = await makeClient();
    const now = Math.floor(Date.now() / 1000);

    mockFetch.mockImplementation(
      routedFetchMock({
        core_enrol_get_users_courses: [COURSE],
        mod_assign_get_assignments: {
          courses: [
            {
              id: 2722,
              assignments: [
                { id: 1, coursemodule: 1, name: "Very overdue", duedate: now - 10 * 86400, grade: 100 },
                { id: 2, coursemodule: 2, name: "Slightly overdue", duedate: now - 86400, grade: 100 },
                { id: 3, coursemodule: 3, name: "Far future", duedate: now + 30 * 86400, grade: 100 },
                { id: 4, coursemodule: 4, name: "No due date", duedate: 0, grade: 100 },
              ],
            },
          ],
        },
        mod_assign_get_submission_status: { lastattempt: { submission: { status: "submitted" }, gradingstatus: "graded" } },
      }),
    );

    const text = await upcomingAndOverdue(client);

    // "No due date" excluded entirely — this tool is a deadline view.
    expect(text).not.toContain("No due date");

    const overdueSection = text.split("### 🟢")[0];
    const veryIdx = overdueSection.indexOf("Very overdue");
    const slightIdx = overdueSection.indexOf("Slightly overdue");
    expect(veryIdx).toBeGreaterThan(-1);
    expect(slightIdx).toBeGreaterThan(-1);
    expect(veryIdx).toBeLessThan(slightIdx); // most overdue listed first

    expect(text).toContain("Far future");
    expect(text).toContain("submitted");
    expect(text).toContain("graded");
  });

  it("uses the shared assignment loader and safely rejects malformed assignment responses", async () => {
    const client = await makeClient();
    mockFetch.mockImplementation(routedFetchMock({
      core_enrol_get_users_courses: [COURSE],
      mod_assign_get_assignments: {
        courses: [{ id: COURSE.id, assignments: [{ id: "bad", coursemodule: 1, name: "Broken" }] }],
      },
    }));

    await expect(upcomingAndOverdue(client)).rejects.toBeInstanceOf(MoodleValidationError);
  });

  it("moves assignments past their cutoffdate into Closed instead of Overdue", async () => {
    const client = await makeClient();
    const now = Math.floor(Date.now() / 1000);

    mockFetch.mockImplementation(
      routedFetchMock({
        core_enrol_get_users_courses: [COURSE],
        mod_assign_get_assignments: {
          courses: [
            {
              id: 2722,
              assignments: [
                // A leftover from a reused course shell: due and cutoff both
                // long past — this is what showed up as a live-looking
                // "Overdue" item in practice (a Nov 2024 assignment).
                {
                  id: 1,
                  coursemodule: 1,
                  name: "Ancient prac",
                  duedate: now - 400 * 86400,
                  cutoffdate: now - 399 * 86400,
                  grade: 100,
                },
                // Genuinely overdue: due date passed but still submittable
                // (no cutoff, or cutoff still ahead).
                {
                  id: 2,
                  coursemodule: 2,
                  name: "Still submittable",
                  duedate: now - 86400,
                  cutoffdate: 0,
                  grade: 100,
                },
              ],
            },
          ],
        },
        mod_assign_get_submission_status: { lastattempt: { submission: { status: "not submitted" } } },
      }),
    );

    const text = await upcomingAndOverdue(client);

    const overdueSection = text.split("### ⚫")[0];
    expect(overdueSection).not.toContain("Ancient prac");
    expect(overdueSection).toContain("Still submittable");
    expect(text).toContain("⚫ Closed");
    expect(text).toContain("Ancient prac");
  });

  it("reports no courses cleanly rather than erroring", async () => {
    const client = await makeClient();
    mockFetch.mockImplementation(routedFetchMock({ core_enrol_get_users_courses: [] }));
    const text = await upcomingAndOverdue(client);
    expect(text).toContain("not enrolled in any courses");
  });

  it("caps tasks and bounds concurrent submission-status requests", async () => {
    const client = await makeClient();
    const now = Math.floor(Date.now() / 1000);
    const assignments = Array.from({ length: COMPOSED_TASK_POLICY.maxRendered + 5 }, (_, i) => ({
      id: i + 1, coursemodule: i + 1, name: `Task ${i + 1}`, duedate: now + i + 1, cutoffdate: 0, grade: 100,
    }));
    let active = 0;
    let peak = 0;
    mockFetch.mockImplementation((_url: string, init: RequestInit) => {
      const fn = (init.body as URLSearchParams).get("wsfunction");
      if (fn === "core_enrol_get_users_courses") return jsonResponse([COURSE]);
      if (fn === "mod_assign_get_assignments") return jsonResponse({ courses: [{ id: COURSE.id, assignments }] });
      if (fn === "mod_assign_get_submission_status") {
        active++;
        peak = Math.max(peak, active);
        return new Promise((resolve) => setTimeout(() => {
          active--;
          resolve(jsonResponse({ lastattempt: { submission: { status: "submitted" } } }));
        }, 2));
      }
      throw new Error(`Unexpected wsfunction: ${fn}`);
    });

    const text = await upcomingAndOverdue(client);
    expect(peak).toBeLessThanOrEqual(COMPOSED_TASK_POLICY.submissionStatusConcurrency);
    expect((text.match(/assignment ID:/g) ?? [])).toHaveLength(COMPOSED_TASK_POLICY.maxRendered);
    expect(text).toContain("additional assignments were omitted");
  });
});
