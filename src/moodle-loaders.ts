import type { MoodleClient } from "./moodle-client.js";
import {
  MoodleAssignmentsResponseSchema, MoodleCalendarResponseSchema, MoodleCourseContentsSchema, MoodleCourseSchema,
  MoodleDiscussionsResponseSchema, MoodleForumSchema, MoodleGradeReportSchema, MoodleNotificationsResponseSchema,
  MoodleQuizAttemptsResponseSchema, MoodleQuizzesResponseSchema, MoodleSubmissionStatusSchema,
} from "./moodle-api.js";

export const loadEnrolledCourses = (client: MoodleClient) =>
  client.call("core_enrol_get_users_courses", { userid: client.userId }, MoodleCourseSchema.array());

export const loadCourseContents = (client: MoodleClient, courseId: number) =>
  client.call("core_course_get_contents", { courseid: courseId }, MoodleCourseContentsSchema);

export const loadAssignments = (client: MoodleClient, params: Record<string, number>) =>
  client.call("mod_assign_get_assignments", params, MoodleAssignmentsResponseSchema);

export const loadSubmissionStatus = (client: MoodleClient, assignmentId: number) =>
  client.call("mod_assign_get_submission_status", { assignid: assignmentId }, MoodleSubmissionStatusSchema);

export const loadGrades = (client: MoodleClient, courseId: number) =>
  client.call("gradereport_user_get_grade_items", { courseid: courseId, userid: client.userId }, MoodleGradeReportSchema);

export const loadQuizzes = (client: MoodleClient, courseId: number) =>
  client.call("mod_quiz_get_quizzes_by_courses", { "courseids[0]": courseId }, MoodleQuizzesResponseSchema);

export const loadQuizAttempts = (client: MoodleClient, quizId: number) =>
  client.call("mod_quiz_get_user_attempts", { quizid: quizId, status: "all", includepreviews: false }, MoodleQuizAttemptsResponseSchema);

export const loadForums = (client: MoodleClient, courseId: number) =>
  client.call("mod_forum_get_forums_by_courses", { "courseids[0]": courseId }, MoodleForumSchema.array());

export const loadForumDiscussions = (client: MoodleClient, forumId: number, perpage: number) =>
  client.call("mod_forum_get_forum_discussions", { forumid: forumId, page: 0, perpage }, MoodleDiscussionsResponseSchema);

export const loadActionCalendarEvents = (client: MoodleClient, from: number, to: number) =>
  client.call("core_calendar_get_action_events_by_timesort", { timesortfrom: from, timesortto: to, limitnum: 50 }, MoodleCalendarResponseSchema);

export const loadCalendarEvents = (client: MoodleClient, params: Record<string, number>) =>
  client.call("core_calendar_get_calendar_events", params, MoodleCalendarResponseSchema);

export const loadNotifications = (client: MoodleClient, limit: number) =>
  client.call("message_popup_get_popup_notifications", { useridto: client.userId, newestfirst: true, limit, offset: 0 }, MoodleNotificationsResponseSchema);
