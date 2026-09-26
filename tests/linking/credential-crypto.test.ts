import { describe, expect, it } from "vitest";
import {
  CredentialDecryptionError,
  CredentialKeyError,
  decryptCredential,
  encryptCredential,
  importCredentialKey,
} from "../../src/linking/credential-crypto.js";
import { randomKeyB64Url } from "./fakes/key.js";

const BASE_URL = "https://stemlearn.sun.ac.za";

describe("credential-crypto", () => {
  it("round-trips a plaintext token", async () => {
    const key = await importCredentialKey(randomKeyB64Url());
    const envelope = await encryptCredential(key, "user1", BASE_URL, "secret-token-value");
    expect(await decryptCredential(key, "user1", BASE_URL, envelope)).toBe("secret-token-value");
  });

  it("uses a fresh IV each time — two encryptions of the same plaintext differ", async () => {
    const key = await importCredentialKey(randomKeyB64Url());
    const a = await encryptCredential(key, "user1", BASE_URL, "same-value");
    const b = await encryptCredential(key, "user1", BASE_URL, "same-value");
    expect(a).not.toBe(b);
  });

  it("fails to decrypt under a different userId (AAD binding)", async () => {
    const key = await importCredentialKey(randomKeyB64Url());
    const envelope = await encryptCredential(key, "user1", BASE_URL, "secret");
    await expect(decryptCredential(key, "user2", BASE_URL, envelope)).rejects.toThrow(CredentialDecryptionError);
  });

  it("fails to decrypt under a different base URL (AAD binding)", async () => {
    const key = await importCredentialKey(randomKeyB64Url());
    const envelope = await encryptCredential(key, "user1", BASE_URL, "secret");
    await expect(decryptCredential(key, "user1", "https://other.example.edu", envelope)).rejects.toThrow(CredentialDecryptionError);
  });

  it("fails on tampered ciphertext", async () => {
    const key = await importCredentialKey(randomKeyB64Url());
    const envelope = await encryptCredential(key, "user1", BASE_URL, "secret");
    const flipped = envelope.slice(0, -1) + (envelope.at(-1) === "A" ? "B" : "A");
    await expect(decryptCredential(key, "user1", BASE_URL, flipped)).rejects.toThrow(CredentialDecryptionError);
  });

  it("rejects an encryption key of the wrong length", async () => {
    await expect(importCredentialKey("dG9vc2hvcnQ")).rejects.toThrow(CredentialKeyError);
  });

  it("rejects a missing encryption key", async () => {
    await expect(importCredentialKey(undefined)).rejects.toThrow(CredentialKeyError);
  });

  it("rejects an undecodable encryption key", async () => {
    await expect(importCredentialKey("not valid base64url!!! spaces")).rejects.toThrow(CredentialKeyError);
  });

  it("never includes the plaintext in the serialized envelope", async () => {
    const key = await importCredentialKey(randomKeyB64Url());
    const envelope = await encryptCredential(key, "user1", BASE_URL, "super-secret-marker-xyz");
    expect(envelope).not.toContain("super-secret-marker-xyz");
  });
});
