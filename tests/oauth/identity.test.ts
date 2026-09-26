import { describe, expect, it } from "vitest";
import { deriveStemlearnUserId } from "../../src/oauth/identity.js";

describe("deriveStemlearnUserId", () => {
  it("is deterministic for the same origin and Moodle user id", async () => {
    const a = await deriveStemlearnUserId("stemlearn.sun.ac.za", 42);
    const b = await deriveStemlearnUserId("stemlearn.sun.ac.za", 42);
    expect(a).toBe(b);
  });

  it("differs for different Moodle user ids on the same origin", async () => {
    const a = await deriveStemlearnUserId("stemlearn.sun.ac.za", 42);
    const b = await deriveStemlearnUserId("stemlearn.sun.ac.za", 43);
    expect(a).not.toBe(b);
  });

  it("never collides for the same numeric id across different Moodle origins", async () => {
    const a = await deriveStemlearnUserId("stemlearn.sun.ac.za", 42);
    const b = await deriveStemlearnUserId("moodle.other-university.edu", 42);
    expect(a).not.toBe(b);
  });

  it("is namespaced apart from the legacy DEFAULT_USER_ID constant", async () => {
    const derived = await deriveStemlearnUserId("stemlearn.sun.ac.za", 1);
    expect(derived).not.toBe("default");
    expect(derived.startsWith("stemlearn-")).toBe(true);
  });

  it("never contains a colon (the OAuth provider library parses authorization codes/tokens as exactly userId:grantId:secret)", async () => {
    const derived = await deriveStemlearnUserId("stemlearn.sun.ac.za", 42);
    expect(derived).not.toContain(":");
  });
});
