import { describe, it, expect, vi, beforeEach } from "vitest";
import { MoodleClient } from "../src/moodle-client.js";
import { getCalendarEvents } from "../src/tools/calendar.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

/** Routes each call by wsfunction, regardless of call order. */
function routedFetchMock(routes: Record<string, unknown>) {
  return (_url: string, init: RequestInit) => {
    const body = init.body as URLSearchParams;
    const fn = body.get("wsfunction")!;
    if (!(fn in routes)) throw new Error(`Unexpected wsfunction in test: ${fn}`);
    return jsonResponse(routes[fn]);
  };
}

const ALL_FUNCTIONS = [
  "core_calendar_get_action_events_by_timesort",
  "core_calendar_get_calendar_events",
  "core_enrol_get_users_courses",
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
  return MoodleClient.create({ baseUrl: "https://stemlearn.sun.ac.za", token: "tok" });
}

const COURSE = { id: 2722, fullname: "Systems And Signals 244" };

beforeEach(() => vi.clearAllMocks());

describe("getCalendarEvents", () => {
  it("surfaces plain calendar entries (e.g. attendance registers) that action-events omits", async () => {
    const client = await makeClient();
    mockFetch.mockImplementation(
      routedFetchMock({
        core_calendar_get_action_events_by_timesort: { events: [] },
        core_enrol_get_users_courses: [COURSE],
        core_calendar_get_calendar_events: {
          events: [
            {
              id: 61873,
              name: "Lecture class attendance register",
              courseid: 2722,
              timestart: 1789974000,
              timeduration: 4200,
              eventtype: "attendance",
              description: "<p>Group 3 lecture class</p>",
            },
          ],
        },
      }),
    );

    const result = await getCalendarEvents(client, undefined, 14);

    expect(result).toContain("Systems And Signals 244");
    expect(result).toContain("Lecture class attendance register");
    expect(result).toContain("Group 3 lecture class");
    expect(result).not.toContain("<p>");
  });

  it("dedupes an event present in both the action-events and plain-calendar responses", async () => {
    const client = await makeClient();
    const shared = {
      id: 42764,
      name: "QUIZ: Metamorphic rocks closes",
      courseid: 2722,
      timestart: 1790175600,
      timeduration: 0,
      eventtype: "close",
    };
    mockFetch.mockImplementation(
      routedFetchMock({
        core_calendar_get_action_events_by_timesort: { events: [shared] },
        core_enrol_get_users_courses: [COURSE],
        core_calendar_get_calendar_events: { events: [shared] },
      }),
    );

    const result = await getCalendarEvents(client, undefined, 14);

    expect(result.match(/QUIZ: Metamorphic rocks closes/g)).toHaveLength(1);
  });

  it("still reports no events when both sources are empty", async () => {
    const client = await makeClient();
    mockFetch.mockImplementation(
      routedFetchMock({
        core_calendar_get_action_events_by_timesort: { events: [] },
        core_enrol_get_users_courses: [COURSE],
        core_calendar_get_calendar_events: { events: [] },
      }),
    );

    const result = await getCalendarEvents(client, undefined, 14);

    expect(result).toContain("No upcoming events");
  });
});
