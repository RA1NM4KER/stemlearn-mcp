import { describe, expect, it } from "vitest";
import { FakeD1 } from "./fakes/d1.js";
import { randomKeyB64Url } from "./fakes/key.js";
import { D1CredentialResolver, deleteCredential, saveCredential } from "../../src/linking/credential-store.js";
import { importCredentialKey } from "../../src/linking/credential-crypto.js";

const BASE_URL = "https://stemlearn.sun.ac.za";

describe("D1CredentialResolver / saveCredential / deleteCredential", () => {
  it("returns null when no credential is linked", async () => {
    const db = new FakeD1();
    const resolver = new D1CredentialResolver(db, () => importCredentialKey(randomKeyB64Url()));
    expect(await resolver.resolve("user1")).toBeNull();
  });

  it("does not need a valid encryption key when no row exists", async () => {
    const db = new FakeD1();
    const resolver = new D1CredentialResolver(db, () => importCredentialKey(undefined));
    expect(await resolver.resolve("user1")).toBeNull();
  });

  it("saves then resolves a credential", async () => {
    const db = new FakeD1();
    const keyB64 = randomKeyB64Url();
    const key = await importCredentialKey(keyB64);
    await saveCredential(db, key, "user1", BASE_URL, "moodle-token-value");
    const resolver = new D1CredentialResolver(db, () => importCredentialKey(keyB64));
    expect(await resolver.resolve("user1")).toEqual({ token: "moodle-token-value" });
  });

  it("never stores the plaintext token", async () => {
    const db = new FakeD1();
    const key = await importCredentialKey(randomKeyB64Url());
    await saveCredential(db, key, "user1", BASE_URL, "super-secret-marker-xyz");
    for (const row of db.credentials.values()) {
      expect(row.encrypted_token).not.toContain("super-secret-marker-xyz");
    }
  });

  it("fails closed (throws) if a row is copied to another user (AAD binding)", async () => {
    const db = new FakeD1();
    const keyB64 = randomKeyB64Url();
    const key = await importCredentialKey(keyB64);
    await saveCredential(db, key, "user1", BASE_URL, "user1-token");
    const row = db.credentials.get("user1")!;
    db.credentials.set("user2", { ...row, user_id: "user2" });

    const resolver = new D1CredentialResolver(db, () => importCredentialKey(keyB64));
    await expect(resolver.resolve("user2")).rejects.toThrow();
    expect(await resolver.resolve("user1")).toEqual({ token: "user1-token" });
  });

  it("rejects saving to a disallowed Moodle host", async () => {
    const db = new FakeD1();
    const key = await importCredentialKey(randomKeyB64Url());
    await expect(saveCredential(db, key, "user1", "https://evil.example.com", "token")).rejects.toThrow();
  });

  it("fails closed if the stored host is tampered to a disallowed value", async () => {
    const db = new FakeD1();
    const keyB64 = randomKeyB64Url();
    const key = await importCredentialKey(keyB64);
    await saveCredential(db, key, "user1", BASE_URL, "token");
    db.credentials.get("user1")!.moodle_base_url = "https://evil.example.com";

    const resolver = new D1CredentialResolver(db, () => importCredentialKey(keyB64));
    await expect(resolver.resolve("user1")).rejects.toThrow();
  });

  it("deletes a credential", async () => {
    const db = new FakeD1();
    const keyB64 = randomKeyB64Url();
    const key = await importCredentialKey(keyB64);
    await saveCredential(db, key, "user1", BASE_URL, "token");
    await deleteCredential(db, "user1");

    const resolver = new D1CredentialResolver(db, () => importCredentialKey(keyB64));
    expect(await resolver.resolve("user1")).toBeNull();
  });

  it("disconnecting one user leaves other users' credentials untouched", async () => {
    const db = new FakeD1();
    const keyB64 = randomKeyB64Url();
    const key = await importCredentialKey(keyB64);
    await saveCredential(db, key, "user1", BASE_URL, "user1-token");
    await saveCredential(db, key, "user2", BASE_URL, "user2-token");
    await deleteCredential(db, "user1");

    const resolver = new D1CredentialResolver(db, () => importCredentialKey(keyB64));
    expect(await resolver.resolve("user1")).toBeNull();
    expect(await resolver.resolve("user2")).toEqual({ token: "user2-token" });
  });
});
