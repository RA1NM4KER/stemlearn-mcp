# Changelog

## 0.1.0

- Initial STEMLearn read-only MCP release: courses, materials, assignments,
  grades, calendar, quizzes, forums, notifications, site information, and
  composed deadline/course-overview tools.
- Files use encrypted, user-bound, expiring IDs and the
  `moodle://files/{fileId}` resource template.

## Unreleased

- Unified tool and resource file authorization, including current Moodle
  visibility and Moodle-hosted plugin-file validation.
- Added HTTPS-only Moodle configuration (local HTTP development exception),
  centralized request deadlines, and bounded listing inputs/results.
- Corrected prompts and project metadata to match the local stdio server.
