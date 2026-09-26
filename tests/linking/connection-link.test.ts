import { describe, expect, it } from "vitest";
import { parseConnectionLink } from "../../src/linking/connection-link.js";

function makeLink(decoded: string): string {
  return "moodlemobile://token=" + Buffer.from(decoded, "utf8").toString("base64");
}

describe("parseConnectionLink", () => {
  it("parses a valid 2-part link", () => {
    expect(parseConnectionLink(makeLink("hash123:::token456"))).toEqual({
      ok: true,
      value: { siteHash: "hash123", token: "token456", privateToken: undefined },
    });
  });

  it("parses a valid 3-part link with a private token", () => {
    expect(parseConnectionLink(makeLink("hash123:::token456:::priv789"))).toEqual({
      ok: true,
      value: { siteHash: "hash123", token: "token456", privateToken: "priv789" },
    });
  });

  it("rejects an empty string", () => {
    expect(parseConnectionLink("")).toEqual({ ok: false, error: "empty" });
    expect(parseConnectionLink("   ")).toEqual({ ok: false, error: "empty" });
  });

  it("rejects oversized input", () => {
    expect(parseConnectionLink("moodlemobile://token=" + "A".repeat(5000))).toEqual({ ok: false, error: "too_long" });
  });

  it("rejects a wrong scheme", () => {
    const value = "https://token=" + Buffer.from("a:::b", "utf8").toString("base64");
    expect(parseConnectionLink(value)).toEqual({ ok: false, error: "wrong_scheme" });
  });

  it("rejects a missing payload", () => {
    expect(parseConnectionLink("moodlemobile://")).toEqual({ ok: false, error: "unexpected_shape" });
    expect(parseConnectionLink("not-a-uri-at-all")).toEqual({ ok: false, error: "unexpected_shape" });
  });

  it("rejects characters outside the expected payload alphabet", () => {
    expect(parseConnectionLink("moodlemobile://token=%%%not-base64%%%")).toEqual({ ok: false, error: "unexpected_shape" });
  });

  it("rejects a payload that matches the alphabet but isn't valid base64", () => {
    expect(parseConnectionLink("moodlemobile://token=A")).toEqual({ ok: false, error: "malformed_base64" });
  });

  it("rejects the wrong number of decoded components", () => {
    expect(parseConnectionLink(makeLink("onlyonepart"))).toEqual({ ok: false, error: "malformed_payload" });
    expect(parseConnectionLink(makeLink("a:::b:::c:::d"))).toEqual({ ok: false, error: "malformed_payload" });
    expect(parseConnectionLink(makeLink(":::"))).toEqual({ ok: false, error: "malformed_payload" });
  });

  it("rejects control characters", () => {
    expect(parseConnectionLink("moodlemobile://token=abc\u0000def")).toEqual({ ok: false, error: "control_characters" });
  });
});
