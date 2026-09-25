import { describe, it, expect } from "vitest";
import { sanitizeAndTruncateHtml, stripHtml, truncateText } from "../src/text.js";

describe("stripHtml", () => {
  it("keeps an ordinary link's href alongside its readable label", () => {
    // Regression: a real forum post ("Join our Whatsapp Group with link or
    // QR") linked its invite as <a href="...">this link</a> — losing the
    // href here loses the one piece of information the post existed to share.
    const html = 'Join via <a href="https://chat.whatsapp.com/abc123">this link</a>.';
    const text = stripHtml(html);
    expect(text).toBe("Join via this link (https://chat.whatsapp.com/abc123).");
  });

  it("renders just the URL when the label is already the URL", () => {
    const html = '<a href="https://chat.whatsapp.com/abc123">https://chat.whatsapp.com/abc123</a>';
    const text = stripHtml(html);
    expect(text).toBe("https://chat.whatsapp.com/abc123");
  });

  it("keeps a Zoom-style invite link actionable", () => {
    const html = 'Lecture link: <a href="https://sun-ac-za.zoom.us/j/123456789">Join Zoom Meeting</a>';
    const text = stripHtml(html);
    expect(text).toBe("Lecture link: Join Zoom Meeting (https://sun-ac-za.zoom.us/j/123456789)");
  });

  it("strips nested formatting tags inside an anchor label", () => {
    const html = '<a href="https://example.com/reading">Read <strong>Chapter 3</strong> first</a>';
    const text = stripHtml(html);
    expect(text).toBe("Read Chapter 3 first (https://example.com/reading)");
  });

  it("does not leak an authenticated Moodle pluginfile.php URL", () => {
    // pluginfile.php is Moodle's authenticated file-serving endpoint; students
    // must go through the sealed fileId flow (file-id-store.ts) instead of a
    // raw link, so the href is dropped and only the readable label survives.
    const html = '<a href="https://moodle.test/pluginfile.php/5/mod_resource/content/1/notes.pdf?forcedownload=1">Course notes</a>';
    const text = stripHtml(html);
    expect(text).toBe("Course notes");
    expect(text).not.toContain("https://");
    expect(text).not.toContain("pluginfile");
  });

  it("does not leak a bare pluginfile.php URL used as its own anchor label", () => {
    const html = '<a href="https://moodle.test/webservice/pluginfile.php/5/x?token=secret">https://moodle.test/webservice/pluginfile.php/5/x?token=secret</a>';
    const text = stripHtml(html);
    expect(text).toBe("Link");
    expect(text).not.toContain("token");
    expect(text).not.toContain("https://");
  });

  it("still strips ordinary formatting tags", () => {
    const text = stripHtml("<p>The tut test will cover <strong>Lectures 01 and 02</strong>.</p>");
    expect(text).toBe("The tut test will cover Lectures 01 and 02.");
  });

  it("still converts &nbsp; to a space", () => {
    expect(stripHtml("a&nbsp;b")).toBe("a b");
  });
});

describe("truncateText", () => {
  it("leaves normal text unchanged", () => {
    expect(truncateText("ordinary text", 100)).toBe("ordinary text");
  });

  it("marks oversized text as truncated without splitting Unicode code points", () => {
    const text = truncateText("A😀BC", 2);
    expect(text).toContain("A😀");
    expect(text).toContain("Text truncated after 2 characters");
    expect(text).not.toContain("\uFFFD");
  });

  it("sanitizes HTML before truncating", () => {
    const text = sanitizeAndTruncateHtml('<p><a href="https://moodle.test/secret">Visible label</a> extra text</p>', 7);
    expect(text).toContain("Visible");
    expect(text).toContain("Text truncated");
    expect(text).not.toContain("https://");
    expect(text).not.toContain("<a");
  });
});
