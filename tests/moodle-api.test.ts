import { describe, expect, it } from "vitest";
import {
  MoodleAssignmentSchema,
  MoodleAssignmentsResponseSchema,
  MoodleCalendarResponseSchema,
  MoodleCourseContentsSchema,
  MoodleDiscussionsResponseSchema,
  MoodleGradeReportSchema,
  MoodleNotificationsResponseSchema,
  MoodleQuizAttemptsResponseSchema,
  MoodleQuizzesResponseSchema,
} from "../src/moodle-api.js";

describe("Moodle course-content schema", () => {
  it("accepts file entries with the metadata needed for secure file access", () => {
    const result = MoodleCourseContentsSchema.safeParse([{ id: 1, modules: [{
      id: 2, name: "Notes", modname: "resource", contents: [{
        type: "file", filename: "notes.pdf", fileurl: "https://moodle.test/pluginfile.php/1/notes.pdf", filesize: 42,
      }],
    }] }]);

    expect(result.success).toBe(true);
  });

  it("accepts non-file content without file metadata and supports mixed content arrays", () => {
    const result = MoodleCourseContentsSchema.safeParse([{ id: 1, modules: [{
      id: 2,
      name: "Resources",
      modname: "folder",
      contents: [
        { type: "folder", filepath: "/week-1" },
        { type: "file", filename: "notes.pdf", fileurl: "https://moodle.test/pluginfile.php/1/notes.pdf", filesize: 42 },
      ],
    }] }]);

    expect(result.success).toBe(true);
  });

  it("rejects a file entry missing required file metadata", () => {
    const result = MoodleCourseContentsSchema.safeParse([{ id: 1, modules: [{
      id: 2, name: "Broken", modname: "resource", contents: [{ type: "file", filename: "notes.pdf" }],
    }] }]);

    expect(result.success).toBe(false);
  });
});

describe("critical Moodle collection responses", () => {
  it("accepts explicit empty collections while rejecting missing endpoint collections", () => {
    const collections = [
      [MoodleAssignmentsResponseSchema, { courses: [] }],
      [MoodleGradeReportSchema, { usergrades: [] }],
      [MoodleQuizzesResponseSchema, { quizzes: [] }],
      [MoodleQuizAttemptsResponseSchema, { attempts: [] }],
      [MoodleDiscussionsResponseSchema, { discussions: [] }],
      [MoodleCalendarResponseSchema, { events: [] }],
      [MoodleNotificationsResponseSchema, { notifications: [] }],
    ] as const;
    for (const [schema, valid] of collections) {
      expect(schema.safeParse(valid).success).toBe(true);
      expect(schema.safeParse({}).success).toBe(false);
    }
  });

  it("keeps legitimately optional nested assignment and notification fields tolerant", () => {
    expect(MoodleAssignmentsResponseSchema.safeParse({ courses: [{ id: 1 }] }).success).toBe(true);
    expect(MoodleNotificationsResponseSchema.safeParse({ notifications: [] }).success).toBe(true);
  });
});

describe("Moodle assignment schema", () => {
  it("accepts the real mod_assign_get_assignments course-module field name (cmid)", () => {
    // Regression: mod_assign_get_assignments names the course-module id
    // "cmid" — confirmed against a real Moodle server (4.5.8). This differs
    // from mod_quiz_get_quizzes_by_courses, which genuinely uses
    // "coursemodule". A schema requiring "coursemodule" here rejected every
    // real assignment response outright, breaking moodle_list_assignments
    // and upcoming_and_overdue against a live Moodle.
    const result = MoodleAssignmentSchema.safeParse({
      id: 6326, cmid: 92947, course: 2722, name: "Practical 2",
      duedate: 1758830340, cutoffdate: 0, grade: 100,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an assignment missing cmid", () => {
    expect(MoodleAssignmentSchema.safeParse({ id: 6326, name: "Practical 2" }).success).toBe(false);
  });
});
