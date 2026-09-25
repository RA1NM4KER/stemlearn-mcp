// Moodle-authored HTML (forum posts, calendar/section descriptions, grade
// feedback) often carries its one actionable piece of information in a link
// href (a Zoom/WhatsApp invite, an external reading) — stripping it away
// loses that. Ordinary links are therefore preserved as "label (href)". The
// one exception is pluginfile.php URLs: those are Moodle's authenticated
// file-serving endpoint, and echoing one back would hand out a raw, direct
// path to course files that bypasses the sealed fileId flow (file-id-store.ts)
// this server otherwise enforces for every file access. Those hrefs are
// dropped; only the human-readable label (if any) survives.
const MOODLE_FILE_URL_PATTERN = /\/pluginfile\.php(?:[/?]|$)/i;

function isMoodleFileUrl(href: string): boolean {
  return MOODLE_FILE_URL_PATTERN.test(href);
}

export function stripHtml(html: string): string {
  return html
    .replace(/<a\s+[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_match, href: string, text: string) => {
      const label = text.replace(/<[^>]*>/g, "").trim();
      if (!href || isMoodleFileUrl(href)) {
        return label && !/^https?:\/\//i.test(label) ? label : "Link";
      }
      return label && label !== href ? `${label} (${href})` : href;
    })
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/** Truncate by Unicode code point, preserving surrogate pairs and signaling omission. */
export function truncateText(text: string, maxCharacters: number): string {
  let end = 0;
  let count = 0;
  for (const character of text) {
    if (count === maxCharacters) {
      return `${text.slice(0, end)}\n\n_[Text truncated after ${maxCharacters} characters.]_`;
    }
    end += character.length;
    count++;
  }
  return text;
}

export function sanitizeAndTruncateHtml(html: string, maxCharacters: number): string {
  return truncateText(stripHtml(html), maxCharacters);
}
