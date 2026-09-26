import { z } from "zod";

// Moodle adds fields between versions. These schemas validate only fields this
// server consumes and retain harmless upstream additions.
const MoodleObject = z.object({}).passthrough();

export const MoodleErrorResponseSchema = MoodleObject.extend({
  exception: z.string(),
  errorcode: z.string().optional(),
  message: z.string().optional(),
});

export const MoodleLoginResponseSchema = MoodleObject.extend({
  token: z.string().optional(),
  error: z.string().optional(),
});

export const MoodleSiteInfoSchema = MoodleObject.extend({
  userid: z.number(),
  username: z.string().optional(),
  sitename: z.string(),
  fullname: z.string().optional(),
  release: z.string().optional(),
  functions: z.array(MoodleObject.extend({ name: z.string(), version: z.string().optional() })).optional(),
});
export type MoodleSiteInfo = z.infer<typeof MoodleSiteInfoSchema>;

export const MoodleCourseSchema = MoodleObject.extend({
  id: z.number(),
  fullname: z.string(),
  shortname: z.string(),
  progress: z.number().nullable().optional(),
});
export type MoodleCourse = z.infer<typeof MoodleCourseSchema>;

export const MoodleFileContentSchema = MoodleObject.extend({
  type: z.literal("file"),
  filename: z.string(),
  fileurl: z.string(),
  filesize: z.number(),
  mimetype: z.string().optional(),
});
export type MoodleFileContent = z.infer<typeof MoodleFileContentSchema>;

const MoodleNonFileContentSchema = MoodleObject.extend({
  type: z.string(),
}).refine((content) => content.type !== "file");

export const MoodleModuleContentSchema = z.union([
  MoodleFileContentSchema,
  MoodleNonFileContentSchema,
]);
export type MoodleModuleContent = z.infer<typeof MoodleModuleContentSchema>;

export function isMoodleFileContent(content: MoodleModuleContent): content is MoodleFileContent {
  return content.type === "file";
}

export const MoodleCourseModuleSchema = MoodleObject.extend({
  id: z.number(),
  name: z.string(),
  modname: z.string(),
  contents: z.array(MoodleModuleContentSchema).optional(),
});
export type MoodleCourseModule = z.infer<typeof MoodleCourseModuleSchema>;

export const MoodleCourseSectionSchema = MoodleObject.extend({
  id: z.number(),
  name: z.string().optional().default(""),
  summary: z.string().optional().default(""),
  modules: z.array(MoodleCourseModuleSchema).optional().default([]),
});
export const MoodleCourseContentsSchema = z.array(MoodleCourseSectionSchema);
export type MoodleCourseSection = z.infer<typeof MoodleCourseSectionSchema>;

export const MoodleAssignmentSchema = MoodleObject.extend({
  id: z.number(),
  // mod_assign_get_assignments names the course-module id "cmid" — unlike
  // mod_quiz_get_quizzes_by_courses, which genuinely uses "coursemodule".
  // Confirmed against a real Moodle server (4.5.8); do not rename to match
  // MoodleQuizSchema.
  cmid: z.number(),
  name: z.string(),
  duedate: z.number().optional().default(0),
  cutoffdate: z.number().optional().default(0),
  grade: z.number().optional().default(0),
});
export type MoodleAssignment = z.infer<typeof MoodleAssignmentSchema>;
export const MoodleAssignmentsResponseSchema = MoodleObject.extend({
  courses: z.array(MoodleObject.extend({ id: z.number(), assignments: z.array(MoodleAssignmentSchema).optional().default([]) })),
});
export type MoodleAssignmentsResponse = z.infer<typeof MoodleAssignmentsResponseSchema>;

export const MoodleSubmissionStatusSchema = MoodleObject.extend({
  lastattempt: MoodleObject.extend({
    submission: MoodleObject.extend({ status: z.string(), timemodified: z.number().optional() }).optional(),
    graded: z.boolean().optional(),
    gradingstatus: z.string().optional(),
  }).optional(),
  feedback: MoodleObject.extend({ gradefordisplay: z.string().optional(), gradeddate: z.number().optional(), grade: MoodleObject.extend({ grade: z.string() }).optional() }).optional(),
});
export type MoodleSubmissionStatus = z.infer<typeof MoodleSubmissionStatusSchema>;

export const MoodleGradeItemSchema = MoodleObject.extend({
  itemtype: z.string(),
  itemname: z.string().nullable().optional(),
  // Course and category grade items have no backing activity module, and
  // Moodle's core grade report serializes that absence as null.
  itemmodule: z.string().nullable().optional(),
  grademax: z.number().optional().default(0),
  gradeformatted: z.string().optional().default(""),
  percentageformatted: z.string().nullable().optional(),
  feedback: z.string().nullable().optional(),
  categoryid: z.number().nullable().optional(),
});
export type MoodleGradeItem = z.infer<typeof MoodleGradeItemSchema>;
export const MoodleGradeReportSchema = MoodleObject.extend({
  usergrades: z.array(MoodleObject.extend({
    courseid: z.number(),
    gradeitems: z.array(MoodleGradeItemSchema).optional().default([]),
    gradecategories: z.array(MoodleObject.extend({ id: z.number(), fullname: z.string() })).optional(),
  })),
});
export type MoodleGradeReport = z.infer<typeof MoodleGradeReportSchema>;

export const MoodleQuizSchema = MoodleObject.extend({
  id: z.number(), coursemodule: z.number(), name: z.string(), timelimit: z.number().optional().default(0),
  attempts: z.number().optional().default(0), timeopen: z.number().optional().default(0), timeclose: z.number().optional().default(0),
});
export const MoodleQuizzesResponseSchema = MoodleObject.extend({ quizzes: z.array(MoodleQuizSchema) });
export type MoodleQuizzesResponse = z.infer<typeof MoodleQuizzesResponseSchema>;
export const MoodleQuizAttemptSchema = MoodleObject.extend({
  attempt: z.number(), state: z.string(), timestart: z.number().optional().default(0), timefinish: z.number().optional().default(0), sumgrades: z.number().nullable().optional(),
});
export const MoodleQuizAttemptsResponseSchema = MoodleObject.extend({ attempts: z.array(MoodleQuizAttemptSchema) });
export type MoodleQuizAttemptsResponse = z.infer<typeof MoodleQuizAttemptsResponseSchema>;

export const MoodleForumSchema = MoodleObject.extend({ id: z.number(), cmid: z.number(), course: z.number(), name: z.string(), type: z.string(), numdiscussions: z.number().optional() });
export type MoodleForum = z.infer<typeof MoodleForumSchema>;
export const MoodleDiscussionSchema = MoodleObject.extend({
  id: z.number(), discussion: z.number(), name: z.string(), userfullname: z.string().optional().default("Unknown"), numreplies: z.number().optional().default(0), timemodified: z.number().optional().default(0), pinned: z.boolean().optional().default(false), message: z.string().optional(),
});
export type MoodleDiscussion = z.infer<typeof MoodleDiscussionSchema>;
export const MoodleDiscussionsResponseSchema = MoodleObject.extend({ discussions: z.array(MoodleDiscussionSchema) });
export type MoodleDiscussionsResponse = z.infer<typeof MoodleDiscussionsResponseSchema>;

export const MoodleCalendarEventSchema = MoodleObject.extend({
  id: z.number(), name: z.string(), courseid: z.number(), timestart: z.number(), timeduration: z.number().optional().default(0), eventtype: z.string().optional().default(""),
  course: MoodleObject.extend({ id: z.number(), shortname: z.string().optional(), fullname: z.string().optional() }).optional(), description: z.string().optional(),
});
export type MoodleCalendarEvent = z.infer<typeof MoodleCalendarEventSchema>;
export const MoodleCalendarResponseSchema = MoodleObject.extend({ events: z.array(MoodleCalendarEventSchema) });
export type MoodleCalendarResponse = z.infer<typeof MoodleCalendarResponseSchema>;

export const MoodleNotificationSchema = MoodleObject.extend({ subject: z.string(), text: z.string(), timecreated: z.number(), read: z.boolean().optional().default(false) });
export const MoodleNotificationsResponseSchema = MoodleObject.extend({ notifications: z.array(MoodleNotificationSchema), unreadcount: z.number().optional().default(0) });
export type MoodleNotificationsResponse = z.infer<typeof MoodleNotificationsResponseSchema>;
