import { describe, expect, it } from "vitest";
import { FakeD1 } from "./fakes/d1.js";
import { createLinkingSession, finalizeLinkingSession, loadActiveLinkingSession } from "../../src/linking/session-store.js";

describe("session-store", () => {
  it("creates a session that can be loaded while active", async () => {
    const db = new FakeD1();
    const created = await createLinkingSession(db, "user1");
    expect(await loadActiveLinkingSession(db, created.sessionId)).toEqual({ userId: "user1", passport: created.passport });
  });

  it("never stores the raw session id", async () => {
    const db = new FakeD1();
    const created = await createLinkingSession(db, "user1");
    for (const row of db.sessions.values()) {
      expect(JSON.stringify(row)).not.toContain(created.sessionId);
    }
  });

  it("generates a fresh random passport and session id each time", async () => {
    const db = new FakeD1();
    const a = await createLinkingSession(db, "user1");
    const b = await createLinkingSession(db, "user1");
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.passport).not.toBe(b.passport);
  });

  it("loading does not consume the session (can be loaded repeatedly)", async () => {
    const db = new FakeD1();
    const created = await createLinkingSession(db, "user1");
    await loadActiveLinkingSession(db, created.sessionId);
    expect(await loadActiveLinkingSession(db, created.sessionId)).not.toBeNull();
  });

  it("finalize consumes a session exactly once; a second finalize fails", async () => {
    const db = new FakeD1();
    const created = await createLinkingSession(db, "user1");
    expect(await finalizeLinkingSession(db, created.sessionId)).toBe(true);
    expect(await finalizeLinkingSession(db, created.sessionId)).toBe(false);
  });

  it("does not load a consumed session (replay protection)", async () => {
    const db = new FakeD1();
    const created = await createLinkingSession(db, "user1");
    await finalizeLinkingSession(db, created.sessionId);
    expect(await loadActiveLinkingSession(db, created.sessionId)).toBeNull();
  });

  it("does not load or finalize an expired session", async () => {
    const db = new FakeD1();
    const created = await createLinkingSession(db, "user1");
    for (const row of db.sessions.values()) row.expires_at = Date.now() - 1000;
    expect(await loadActiveLinkingSession(db, created.sessionId)).toBeNull();
    expect(await finalizeLinkingSession(db, created.sessionId)).toBe(false);
  });

  it("does not load or finalize an unknown session id", async () => {
    const db = new FakeD1();
    expect(await loadActiveLinkingSession(db, "nonexistent")).toBeNull();
    expect(await finalizeLinkingSession(db, "nonexistent")).toBe(false);
  });
});
