import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { md5 } from "../../src/linking/md5.js";

describe("md5 (Moodle protocol compatibility only — see src/linking/md5.ts)", () => {
  it("matches standard known test vectors", () => {
    expect(md5("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5("The quick brown fox jumps over the lazy dog")).toBe("9e107d9d372bb6826bd81d3542a419d6");
  });

  it("matches Node's crypto.createHash('md5') across varied inputs", () => {
    const inputs = [
      "https://stemlearn.sun.ac.za",
      "https://stemlearn.sun.ac.za/",
      "a".repeat(200),
      "unicode café ☺",
      "x",
    ];
    for (const input of inputs) {
      const expected = crypto.createHash("md5").update(input, "utf8").digest("hex");
      expect(md5(input)).toBe(expected);
    }
  });
});
