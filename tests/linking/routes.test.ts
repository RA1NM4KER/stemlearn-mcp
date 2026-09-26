import { describe, expect, it, vi, beforeEach } from "vitest";
import { FakeD1 } from "./fakes/d1.js";
import { randomKeyB64Url } from "./fakes/key.js";
import { handleLinkComplete, handleLinkDisconnect, handleLinkStart, type LinkingEnv } from "../../src/linking/routes.js";
import { md5 } from "../../src/linking/md5.js";
import { DEFAULT_USER_ID } from "../../src/linking/resolve-config.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockOkJson(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

const SITE_INFO = {
  userid: 42,
  username: "student",
  sitename: "My Uni",
  fullname: "Alice Smith",
  release: "4.3.0",
  functions: [{ name: "core_webservice_get_site_info", version: "1" }],
};

const BASE_URL = "https://stemlearn.sun.ac.za";

function makeEnv(): LinkingEnv & { DB: FakeD1 } {
  return { MOODLE_URL: BASE_URL, DB: new FakeD1(), CREDENTIAL_ENCRYPTION_KEY: randomKeyB64Url() };
}

async function start(env: LinkingEnv) {
  const res = await handleLinkStart(env);
  const body = (await res.json()) as { sessionId: string; url: string };
  const passport = new URL(body.url).searchParams.get("passport")!;
  return { sessionId: body.sessionId, passport, url: body.url, status: res.status };
}

function connectionLink(passport: string, token: string, privateToken?: string): string {
  const parts = [md5(BASE_URL + passport), token, ...(privateToken ? [privateToken] : [])];
  return "moodlemobile://token=" + Buffer.from(parts.join(":::"), "utf8").toString("base64");
}

async function complete(env: LinkingEnv, body: unknown) {
  const res = await handleLinkComplete(
    new Request("https://worker.test/auth/stemlearn/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, body: (await res.json()) as { connected: boolean; error?: string } };
}

const SENSITIVE_TERMS = ["passport", "base64", "hash", "moodlemobile"];

describe("handleLinkStart", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a session and returns the official STEMLearn launch URL", async () => {
    const env = makeEnv();
    const { sessionId, url, status } = await start(env);
    expect(status).toBe(200);
    expect(sessionId).toBeTruthy();
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(`${BASE_URL}/admin/tool/mobile/launch.php`);
    expect(parsed.searchParams.get("service")).toBe("moodle_mobile_app");
    expect(parsed.searchParams.get("confirmed")).toBe("1");
    expect(parsed.searchParams.get("passport")).toBeTruthy();
  });
});

describe("handleLinkComplete", () => {
  beforeEach(() => vi.clearAllMocks());

  it("succeeds with a valid connection link and persists an encrypted credential", async () => {
    const env = makeEnv();
    const { sessionId, passport } = await start(env);
    mockFetch.mockResolvedValueOnce(mockOkJson(SITE_INFO));

    const { status, body } = await complete(env, { sessionId, connectionLink: connectionLink(passport, "real-moodle-token") });

    expect(status).toBe(200);
    expect(body).toEqual({ connected: true });
    const row = env.DB.credentials.get(DEFAULT_USER_ID);
    expect(row).toBeDefined();
    expect(row!.encrypted_token).not.toContain("real-moodle-token");
  });

  it("accepts a link with an optional private-token component", async () => {
    const env = makeEnv();
    const { sessionId, passport } = await start(env);
    mockFetch.mockResolvedValueOnce(mockOkJson(SITE_INFO));

    const { status, body } = await complete(env, {
      sessionId,
      connectionLink: connectionLink(passport, "real-moodle-token", "private-part"),
    });
    expect(status).toBe(200);
    expect(body).toEqual({ connected: true });
  });

  it("rejects a malformed connection link without burning the session", async () => {
    const env = makeEnv();
    const { sessionId, passport } = await start(env);

    const { status, body } = await complete(env, { sessionId, connectionLink: "not-a-connection-link" });
    expect(status).toBe(400);
    expect(body.error).toMatch(/isn't valid/);
    expect(mockFetch).not.toHaveBeenCalled();

    // Session must still be usable — retry with a correct link now succeeds.
    mockFetch.mockResolvedValueOnce(mockOkJson(SITE_INFO));
    const retry = await complete(env, { sessionId, connectionLink: connectionLink(passport, "real-moodle-token") });
    expect(retry.status).toBe(200);
  });

  it("rejects a passport mismatch (link from a different attempt) without burning the session", async () => {
    const env = makeEnv();
    const { sessionId, passport } = await start(env);
    const wrongPassportLink = connectionLink("some-other-passport-entirely", "real-moodle-token");

    const { status, body } = await complete(env, { sessionId, connectionLink: wrongPassportLink });
    expect(status).toBe(400);
    expect(body.error).toMatch(/different sign-in attempt/);
    expect(mockFetch).not.toHaveBeenCalled();

    mockFetch.mockResolvedValueOnce(mockOkJson(SITE_INFO));
    const retry = await complete(env, { sessionId, connectionLink: connectionLink(passport, "real-moodle-token") });
    expect(retry.status).toBe(200);
  });

  it("rejects an invalid/revoked Moodle token without burning the session", async () => {
    const env = makeEnv();
    const { sessionId, passport } = await start(env);
    mockFetch.mockResolvedValueOnce(
      Promise.resolve({ ok: true, json: () => Promise.resolve({ exception: "x", errorcode: "invalidtoken" }), text: () => Promise.resolve("{}") }),
    );

    const { status, body } = await complete(env, { sessionId, connectionLink: connectionLink(passport, "bad-token") });
    expect(status).toBe(400);
    expect(body.error).toMatch(/couldn't verify/);

    mockFetch.mockResolvedValueOnce(mockOkJson(SITE_INFO));
    const retry = await complete(env, { sessionId, connectionLink: connectionLink(passport, "real-moodle-token") });
    expect(retry.status).toBe(200);
  });

  it("rejects an expired session", async () => {
    const env = makeEnv();
    const { sessionId, passport } = await start(env);
    for (const row of env.DB.sessions.values()) row.expires_at = Date.now() - 1000;

    const { status, body } = await complete(env, { sessionId, connectionLink: connectionLink(passport, "real-moodle-token") });
    expect(status).toBe(400);
    expect(body.error).toMatch(/expired/);
  });

  it("rejects replay of an already-consumed session", async () => {
    const env = makeEnv();
    const { sessionId, passport } = await start(env);
    mockFetch.mockResolvedValueOnce(mockOkJson(SITE_INFO));
    const first = await complete(env, { sessionId, connectionLink: connectionLink(passport, "real-moodle-token") });
    expect(first.status).toBe(200);

    const replay = await complete(env, { sessionId, connectionLink: connectionLink(passport, "real-moodle-token") });
    expect(replay.status).toBe(400);
    expect(replay.body.error).toMatch(/expired/);
  });

  it("rejects an unknown session id", async () => {
    const env = makeEnv();
    const { status, body } = await complete(env, { sessionId: "nonexistent", connectionLink: connectionLink("x", "y") });
    expect(status).toBe(400);
    expect(body.error).toMatch(/expired/);
  });

  it("rejects malformed request bodies safely", async () => {
    const env = makeEnv();
    const res = await handleLinkComplete(new Request("https://worker.test/auth/stemlearn/complete", { method: "POST", body: "{not json" }), env);
    expect(res.status).toBe(400);
  });

  it("never leaks the pasted link, decoded parts, or protocol terminology in any response", async () => {
    const env = makeEnv();
    const { sessionId, passport } = await start(env);
    const secretLink = connectionLink(passport, "super-secret-token-value");
    mockFetch.mockResolvedValueOnce(
      Promise.resolve({ ok: true, json: () => Promise.resolve({ exception: "x", errorcode: "invalidtoken" }), text: () => Promise.resolve("{}") }),
    );
    const { body } = await complete(env, { sessionId, connectionLink: secretLink });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("super-secret-token-value");
    expect(serialized).not.toContain(secretLink);
    for (const term of SENSITIVE_TERMS) {
      expect(serialized.toLowerCase()).not.toContain(term);
    }
  });
});

describe("handleLinkDisconnect", () => {
  it("deletes the stored credential", async () => {
    const env = makeEnv();
    const { sessionId, passport } = await start(env);
    mockFetch.mockResolvedValueOnce(mockOkJson(SITE_INFO));
    await complete(env, { sessionId, connectionLink: connectionLink(passport, "real-moodle-token") });
    expect(env.DB.credentials.has(DEFAULT_USER_ID)).toBe(true);

    const res = await handleLinkDisconnect(env);
    expect(res.status).toBe(200);
    expect(env.DB.credentials.has(DEFAULT_USER_ID)).toBe(false);
  });
});
