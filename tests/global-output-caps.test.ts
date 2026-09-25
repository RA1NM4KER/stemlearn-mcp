import { beforeEach, describe, expect, it, vi } from "vitest";
import { MoodleClient } from "../src/moodle-client.js";
import { getCourse } from "../src/tools/courses.js";
import { listAssignments } from "../src/tools/assignments.js";
import { getGrades } from "../src/tools/grades.js";
import { listQuizzes } from "../src/tools/quizzes.js";
import {
  ASSIGNMENT_LIST_POLICY,
  COURSE_STRUCTURE_POLICY,
  GRADE_LIST_POLICY,
  QUIZ_LIST_POLICY,
} from "../src/policy.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const jsonResponse = (data: unknown) => ({ ok: true, json: async () => data, text: async () => JSON.stringify(data) });

const FUNCTIONS = [
  "core_course_get_contents",
  "mod_assign_get_assignments",
  "gradereport_user_get_grade_items",
  "mod_quiz_get_quizzes_by_courses",
];

async function makeClient() {
  mockFetch.mockResolvedValueOnce(jsonResponse({
    userid: 1, sitename: "STEMLearn", functions: FUNCTIONS.map((name) => ({ name })),
  }));
  return MoodleClient.create({ baseUrl: "https://moodle.test", auth: { kind: "token", token: "token" } });
}

function nestedModules(modname: string, count: number) {
  return Array.from({ length: 2 }, (_, section) => ({
    id: section + 1,
    name: `Week ${section + 1}`,
    modules: Array.from({ length: count / 2 }, (_, index) => ({
      id: section * (count / 2) + index + 1,
      name: `${modname} ${section}-${index}`,
      modname,
    })),
  }));
}

describe("global rendered output caps", () => {
  beforeEach(() => mockFetch.mockReset());

  it("caps deeply nested course modules globally", async () => {
    const client = await makeClient();
    const total = COURSE_STRUCTURE_POLICY.maxRenderedModules + 20;
    mockFetch.mockResolvedValueOnce(jsonResponse(nestedModules("resource", total)));

    const text = await getCourse(client, 1);
    expect((text.match(/`resource`/g) ?? [])).toHaveLength(COURSE_STRUCTURE_POLICY.maxRenderedModules);
    expect(text).toContain("20 activities were omitted");
  });

  it("caps assignments globally across sections", async () => {
    const client = await makeClient();
    const total = ASSIGNMENT_LIST_POLICY.maxRendered + 20;
    const assignmentModules = nestedModules("assign", total);
    const assignments = Array.from({ length: total }, (_, index) => ({
      id: index + 1, cmid: index + 1, name: `Assignment ${index + 1}`,
    }));
    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      const fn = init?.body instanceof URLSearchParams ? init.body.get("wsfunction") : undefined;
      if (!fn) return jsonResponse({ userid: 1, sitename: "STEMLearn" });
      if (fn === "core_course_get_contents") return jsonResponse(assignmentModules);
      return jsonResponse({ courses: [{ id: 1, assignments }] });
    });
    const assignmentsText = await listAssignments(client, 1);
    expect((assignmentsText.match(/ID: `\d+`/g) ?? [])).toHaveLength(ASSIGNMENT_LIST_POLICY.maxRendered);
    expect(assignmentsText).toContain("20 additional assignments were omitted");
  });

  it("caps quizzes globally across sections", async () => {
    const client = await makeClient();
    const quizModules = nestedModules("quiz", QUIZ_LIST_POLICY.maxRendered + 20);
    const quizzes = Array.from({ length: QUIZ_LIST_POLICY.maxRendered + 20 }, (_, index) => ({
      id: index + 1, coursemodule: index + 1, name: `Quiz ${index + 1}`,
    }));
    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      const fn = init?.body instanceof URLSearchParams ? init.body.get("wsfunction") : undefined;
      if (!fn) return jsonResponse({ userid: 1, sitename: "STEMLearn" });
      if (fn === "core_course_get_contents") return jsonResponse(quizModules);
      return jsonResponse({ quizzes });
    });
    const quizzesText = await listQuizzes(client, 1);
    expect((quizzesText.match(/Time limit:/g) ?? [])).toHaveLength(QUIZ_LIST_POLICY.maxRendered);
    expect(quizzesText).toContain("20 additional quizzes were omitted");
  });

  it("caps grade items globally across categories", async () => {
    const client = await makeClient();
    const total = GRADE_LIST_POLICY.maxRenderedItems + 20;
    const gradeitems = Array.from({ length: total }, (_, index) => ({
      itemtype: "manual", itemname: `Item ${index + 1}`, grademax: 100,
    }));
    mockFetch.mockResolvedValueOnce(jsonResponse({ usergrades: [{ courseid: 1, gradeitems }] }));

    const text = await getGrades(client, 1);
    expect((text.match(/\| Item \d+ \|/g) ?? [])).toHaveLength(GRADE_LIST_POLICY.maxRenderedItems);
    expect(text).toContain("20 additional items were omitted");
  });
});
