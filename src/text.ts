export function stripHtml(html: string): string {
  return html
    .replace(/<a\s+[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_match, href, text) => {
      const label = text.replace(/<[^>]*>/g, "").trim();
      return label && label !== href ? `${label} (${href})` : href;
    })
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}
