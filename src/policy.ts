/** Limits that bound MCP response size and Moodle request fan-out. */
export const RESOURCE_LIST_POLICY = {
  maxCourses: 25,
  defaultEntries: 25,
  maxEntries: 100,
} as const;

export const COURSE_STRUCTURE_POLICY = { maxRenderedSections: 100, maxRenderedModules: 100 } as const;
export const ASSIGNMENT_LIST_POLICY = { maxRendered: 100 } as const;
export const QUIZ_ATTEMPT_POLICY = { maxRendered: 100 } as const;
export const QUIZ_LIST_POLICY = { maxRendered: 100 } as const;
export const FORUM_LIST_POLICY = { maxRenderedForums: 100, maxRenderedDiscussions: 100 } as const;
export const GRADE_LIST_POLICY = { maxRenderedItems: 100 } as const;
export const CALENDAR_EVENT_POLICY = { maxRendered: 100 } as const;
export const COURSE_NOTICE_POLICY = { maxRendered: 10 } as const;
export const COMPOSED_TASK_POLICY = {
  maxRendered: 100,
  submissionStatusConcurrency: 4,
} as const;

/** Per-field and embedded-content limits for MCP-safe text rendering. */
export const TEXT_OUTPUT_POLICY = {
  maxMcpResponseCharacters: 100_000,
  maxLabelCharacters: 300,
  maxCourseSummaryCharacters: 4_000,
  maxCourseNoticeCharacters: 600,
  maxForumPostCharacters: 4_000,
  maxCalendarDescriptionCharacters: 1_000,
  maxNotificationPreviewCharacters: 1_000,
  maxGradeFeedbackCharacters: 1_000,
  maxTextFileCharacters: 100_000,
  maxEmbeddedBinaryFileBytes: 5 * 1024 * 1024,
} as const;

/** Map items with a fixed number of active promises, preserving input order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
