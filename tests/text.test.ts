import { describe, it, expect } from "vitest";
import { stripHtml } from "../src/text.js";

describe("stripHtml", () => {
  it("keeps the href of a link instead of discarding it with the tag", () => {
    // Regression: a real forum post ("Join our Whatsapp Group with link or
    // QR") linked its invite as <a href="...">this link</a> — the old
    // implementation stripped the tag and kept only "this link", losing the
    // one piece of information the post existed to share.
    const html = 'Join via <a href="https://chat.whatsapp.com/abc123">this link</a>.';
    const text = stripHtml(html);
    expect(text).toContain("https://chat.whatsapp.com/abc123");
    expect(text).toContain("this link");
  });

  it("falls back to the bare href when the link has no distinct label", () => {
    const html = '<a href="https://chat.whatsapp.com/abc123">https://chat.whatsapp.com/abc123</a>';
    const text = stripHtml(html);
    expect(text).toBe("https://chat.whatsapp.com/abc123");
  });

  it("still strips ordinary formatting tags", () => {
    const text = stripHtml("<p>The tut test will cover <strong>Lectures 01 and 02</strong>.</p>");
    expect(text).toBe("The tut test will cover Lectures 01 and 02.");
  });

  it("still converts &nbsp; to a space", () => {
    expect(stripHtml("a&nbsp;b")).toBe("a b");
  });
});
