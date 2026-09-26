import { describe, expect, it, vi, beforeEach } from "vitest";
import { handleLegacyRoute, isAuthorized, constantTimeEqual } from "../src/legacy-routes.js";
import { FakeD1 } from "./linking/fakes/d1.js";
import { randomKeyB64Url } from "./linking/fakes/key.js";
import type { Env } from "../src/oauth/env.js";

// legacy-routes.ts has no dependency on @cloudflare/workers-oauth-provider
// at all, so it's directly testable under plain Vitest (see mcp-handler.test.ts
// for why the OAuth-provider-wrapped routes aren't).

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    MOODLE_URL: "https://stemlearn.sun.ac.za",
    MOODLE_TOKEN: "moodle-secret-token",
    MCP_ACCESS_TOKEN: "worker-bearer-secret",
    DB: new FakeD1() as unknown as Env["DB"],
    CREDENTIAL_ENCRYPTION_KEY: randomKeyB64Url(),
    OAUTH_KV: undefined as unknown as Env["OAUTH_KV"],
    ...overrides,
  };
}

describe("constantTimeEqual / isAuthorized", () => {
  it("accepts a matching bearer token", async () => {
    const env = makeEnv();
    const request = new Request("https://worker.test/x", { headers: { Authorization: `Bearer ${env.MCP_ACCESS_TOKEN}` } });
    expect(await isAuthorized(request, env)).toBe(true);
  });

  it("rejects a wrong bearer token", async () => {
    const env = makeEnv();
    const request = new Request("https://worker.test/x", { headers: { Authorization: "Bearer wrong" } });
    expect(await isAuthorized(request, env)).toBe(false);
  });

  it("rejects a missing Authorization header", async () => {
    const env = makeEnv();
    expect(await isAuthorized(new Request("https://worker.test/x"), env)).toBe(false);
  });

  it("fails closed when MCP_ACCESS_TOKEN itself is unset", async () => {
    const env = makeEnv({ MCP_ACCESS_TOKEN: "" });
    const request = new Request("https://worker.test/x", { headers: { Authorization: "Bearer anything" } });
    expect(await isAuthorized(request, env)).toBe(false);
  });

  it("constantTimeEqual is a straightforward equality check", async () => {
    expect(await constantTimeEqual("abc", "abc")).toBe(true);
    expect(await constantTimeEqual("abc", "abd")).toBe(false);
  });
});

describe("handleLegacyRoute", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET /health returns ok without contacting Moodle", async () => {
    const env = makeEnv();
    const response = await handleLegacyRoute(new Request("https://worker.test/health"), env, "/health");
    expect(response?.status).toBe(200);
    expect(await response!.json()).toEqual({ status: "ok" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("GET /connect serves the linking page unauthenticated", async () => {
    const env = makeEnv();
    const response = await handleLegacyRoute(new Request("https://worker.test/connect"), env, "/connect");
    expect(response?.status).toBe(200);
    expect(response?.headers.get("Content-Type")).toContain("text/html");
    expect(await response!.text()).toContain("Connect STEMLearn");
  });

  it("returns null for an unrecognized path (caller falls through to 404)", async () => {
    const env = makeEnv();
    expect(await handleLegacyRoute(new Request("https://worker.test/nope"), env, "/nope")).toBeNull();
  });

  it("rejects /auth/stemlearn/start without a bearer token", async () => {
    const env = makeEnv();
    const response = await handleLegacyRoute(new Request("https://worker.test/auth/stemlearn/start", { method: "POST" }), env, "/auth/stemlearn/start");
    expect(response?.status).toBe(401);
  });

  it("rejects /auth/stemlearn/disconnect without a bearer token", async () => {
    const env = makeEnv();
    const response = await handleLegacyRoute(new Request("https://worker.test/auth/stemlearn/disconnect", { method: "POST" }), env, "/auth/stemlearn/disconnect");
    expect(response?.status).toBe(401);
  });

  it("accepts /auth/stemlearn/start with a valid bearer token", async () => {
    const env = makeEnv();
    const response = await handleLegacyRoute(
      new Request("https://worker.test/auth/stemlearn/start", { method: "POST", headers: { Authorization: `Bearer ${env.MCP_ACCESS_TOKEN}` } }),
      env,
      "/auth/stemlearn/start",
    );
    expect(response?.status).toBe(200);
    const body = (await response!.json()) as { sessionId: string; url: string };
    expect(body.sessionId).toBeTruthy();
    expect(body.url).toContain("admin/tool/mobile/launch.php");
  });

  it("/auth/stemlearn/complete is not bearer-gated (session id is the capability)", async () => {
    const env = makeEnv();
    const response = await handleLegacyRoute(
      new Request("https://worker.test/auth/stemlearn/complete", { method: "POST", body: JSON.stringify({ sessionId: "nonexistent", connectionLink: "x" }) }),
      env,
      "/auth/stemlearn/complete",
    );
    // No 401 — it's reachable without a bearer; it fails on the (nonexistent) session instead.
    expect(response?.status).toBe(400);
  });
});
