import { describe, expect, it, vi, beforeEach } from "vitest";
import { handleMcpRequest, workerErrorResponse } from "../src/mcp-handler.js";
import { MoodleTimeoutError } from "../src/moodle-client.js";
import { DEFAULT_USER_ID } from "../src/linking/resolve-config.js";
import { saveCredential } from "../src/linking/credential-store.js";
import { importCredentialKey } from "../src/linking/credential-crypto.js";
import { deriveStemlearnUserId } from "../src/oauth/identity.js";
import { FakeD1 } from "./linking/fakes/d1.js";
import { randomKeyB64Url } from "./linking/fakes/key.js";
import type { Env, McpProps } from "../src/oauth/env.js";

// mcp-handler.ts only imports the OAuthResourceContext *type* from
// @cloudflare/workers-oauth-provider (erased at compile time), so — unlike
// src/oauth/provider.ts and src/oauth/routes.ts, which import real values
// from that package and therefore need its `cloudflare:workers` runtime
// import (only resolvable inside an actual Workers/workerd runtime) — this
// module can be exercised directly under plain Vitest. Full OAuth-protocol
// behavior (PKCE, DCR, discovery, the real /authorize flow) is verified
// instead via the live MCP Inspector acceptance test, not here.

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

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    MOODLE_URL: BASE_URL,
    MOODLE_TOKEN: "moodle-secret-token",
    MCP_ACCESS_TOKEN: "worker-bearer-secret",
    DB: new FakeD1() as unknown as Env["DB"],
    CREDENTIAL_ENCRYPTION_KEY: randomKeyB64Url(),
    OAUTH_KV: undefined as unknown as Env["OAUTH_KV"],
    ...overrides,
  };
}

function fakeCtx(props: McpProps) {
  return { props, auth: { token: "x", audience: "https://x/mcp", scope: [] } } as any;
}

const ACCEPT_HEADERS = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

function initializeBody() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-client", version: "1.0.0" } },
  };
}

describe("workerErrorResponse", () => {
  it("does not serialize arbitrary upstream error details", async () => {
    const response = workerErrorResponse(new Error("https://moodle.test/pluginfile.php/x?token=secret"));
    expect(await response.json()).toEqual({ error: "Moodle request failed. Please try again.", code: "moodle_request_failed" });
  });

  it("returns a stable timeout code", async () => {
    const response = workerErrorResponse(new MoodleTimeoutError());
    expect(await response.json()).toEqual({ error: "Moodle request timed out. Please try again.", code: "moodle_timeout" });
  });
});

describe("handleMcpRequest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fails safely on a malformed JSON body without contacting Moodle", async () => {
    const env = makeEnv();
    const response = await handleMcpRequest(
      new Request("https://worker.test/mcp", { method: "POST", headers: ACCEPT_HEADERS, body: "{not json" }),
      env,
      fakeCtx({ userId: DEFAULT_USER_ID, legacy: true }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error: Invalid JSON" }, id: null });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("legacy lane: resolves DEFAULT_USER_ID via the env-secret fallback", async () => {
    mockFetch.mockResolvedValueOnce(mockOkJson(SITE_INFO));
    const env = makeEnv();
    const response = await handleMcpRequest(
      new Request("https://worker.test/mcp", { method: "POST", headers: ACCEPT_HEADERS, body: JSON.stringify(initializeBody()) }),
      env,
      fakeCtx({ userId: DEFAULT_USER_ID, legacy: true }),
    );
    expect(response.status).toBe(200);
    const result = (await response.json()) as { result: { serverInfo: { name: string } } };
    expect(result.result.serverInfo).toEqual({ name: "stemlearn-mcp", version: "0.1.0" });
    const [, requestInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(String(requestInit.body)).toContain(`wstoken=${env.MOODLE_TOKEN}`);
  });

  it("OAuth lane: resolves the derived user's own D1 credential, never the env secret", async () => {
    const env = makeEnv();
    const userId = await deriveStemlearnUserId("stemlearn.sun.ac.za", 7);
    const key = await importCredentialKey(env.CREDENTIAL_ENCRYPTION_KEY);
    await saveCredential(env.DB, key, userId, BASE_URL, "oauth-linked-token");
    mockFetch.mockResolvedValueOnce(mockOkJson(SITE_INFO));

    const response = await handleMcpRequest(
      new Request("https://worker.test/mcp", { method: "POST", headers: ACCEPT_HEADERS, body: JSON.stringify(initializeBody()) }),
      env,
      fakeCtx({ userId }),
    );
    expect(response.status).toBe(200);
    const [, requestInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(String(requestInit.body)).toContain("wstoken=oauth-linked-token");
    expect(String(requestInit.body)).not.toContain(env.MOODLE_TOKEN);
  });

  it("OAuth lane: a token with no linked credential gets account-link-required, never the env secret or another user's credential", async () => {
    const env = makeEnv();
    const otherUserId = await deriveStemlearnUserId("stemlearn.sun.ac.za", 99);
    const key = await importCredentialKey(env.CREDENTIAL_ENCRYPTION_KEY);
    await saveCredential(env.DB, key, otherUserId, BASE_URL, "other-users-token");

    const unlinkedUserId = await deriveStemlearnUserId("stemlearn.sun.ac.za", 1);
    const response = await handleMcpRequest(
      new Request("https://worker.test/mcp", { method: "POST", headers: ACCEPT_HEADERS, body: JSON.stringify(initializeBody()) }),
      env,
      fakeCtx({ userId: unlinkedUserId }),
    );
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe("account_link_required");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("OAuth lane: user A's token never resolves user B's credential", async () => {
    const env = makeEnv();
    const userA = await deriveStemlearnUserId("stemlearn.sun.ac.za", 1);
    const userB = await deriveStemlearnUserId("stemlearn.sun.ac.za", 2);
    const key = await importCredentialKey(env.CREDENTIAL_ENCRYPTION_KEY);
    await saveCredential(env.DB, key, userA, BASE_URL, "user-a-token");
    await saveCredential(env.DB, key, userB, BASE_URL, "user-b-token");

    mockFetch.mockResolvedValueOnce(mockOkJson(SITE_INFO));
    await handleMcpRequest(
      new Request("https://worker.test/mcp", { method: "POST", headers: ACCEPT_HEADERS, body: JSON.stringify(initializeBody()) }),
      env,
      fakeCtx({ userId: userA }),
    );
    const [, requestInitA] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(String(requestInitA.body)).toContain("wstoken=user-a-token");
    expect(String(requestInitA.body)).not.toContain("user-b-token");
  });

  it("does not bypass file authorization for a bogus fileId over HTTP", async () => {
    mockFetch.mockResolvedValueOnce(mockOkJson(SITE_INFO));
    const env = makeEnv();
    const response = await handleMcpRequest(
      new Request("https://worker.test/mcp", {
        method: "POST",
        headers: ACCEPT_HEADERS,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "moodle_download_file", arguments: { fileId: "bogus" } } }),
      }),
      env,
      fakeCtx({ userId: DEFAULT_USER_ID, legacy: true }),
    );
    expect(response.status).toBe(200);
    const result = (await response.json()) as { result: { isError: boolean; content: { type: string; text: string }[] } };
    expect(result.result.isError).toBe(true);
    expect(result.result.content[0]!.text).toContain("fileId is invalid, expired, or was not issued to the current user");
  });
});
