import { describe, expect, it, vi, beforeEach } from "vitest";
import worker, { workerErrorResponse } from "../src/worker.js";
import { MoodleTimeoutError } from "../src/moodle-client.js";

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

const ENV = {
  MOODLE_URL: "https://moodle.uni.edu",
  MOODLE_TOKEN: "moodle-secret-token",
  MCP_ACCESS_TOKEN: "worker-bearer-secret",
};

const ACCEPT_HEADERS = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

function initializeBody() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    },
  };
}

describe("Worker error serialization", () => {
  it("does not serialize arbitrary upstream error details", async () => {
    const response = workerErrorResponse(new Error("https://moodle.test/pluginfile.php/x?token=secret"));
    expect(await response.json()).toEqual({ error: "Moodle request failed. Please try again.", code: "moodle_request_failed" });
  });

  it("returns a stable timeout code", async () => {
    const response = workerErrorResponse(new MoodleTimeoutError());
    expect(await response.json()).toEqual({ error: "Moodle request timed out. Please try again.", code: "moodle_timeout" });
  });
});

describe("Worker HTTP surface", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET /health returns ok without contacting Moodle", async () => {
    const response = await worker.fetch(new Request("https://worker.test/health"), ENV);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects unknown paths with a generic 404", async () => {
    const response = await worker.fetch(new Request("https://worker.test/nope"), ENV);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found", code: "not_found" });
  });

  it("rejects /mcp with no Authorization header", async () => {
    const response = await worker.fetch(
      new Request("https://worker.test/mcp", { method: "POST", headers: ACCEPT_HEADERS, body: JSON.stringify(initializeBody()) }),
      ENV,
    );
    expect(response.status).toBe(401);
    const body = await response.text();
    expect(body).not.toContain(ENV.MCP_ACCESS_TOKEN);
    expect(body).not.toContain(ENV.MOODLE_TOKEN);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects /mcp with the wrong bearer token", async () => {
    const response = await worker.fetch(
      new Request("https://worker.test/mcp", {
        method: "POST",
        headers: { ...ACCEPT_HEADERS, Authorization: "Bearer wrong-token" },
        body: JSON.stringify(initializeBody()),
      }),
      ENV,
    );
    expect(response.status).toBe(401);
    const body = await response.text();
    expect(body).not.toContain(ENV.MCP_ACCESS_TOKEN);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fails closed (401) when MCP_ACCESS_TOKEN itself is not configured", async () => {
    const envWithoutSecret = { MOODLE_URL: ENV.MOODLE_URL, MOODLE_TOKEN: ENV.MOODLE_TOKEN, MCP_ACCESS_TOKEN: "" };
    const response = await worker.fetch(
      new Request("https://worker.test/mcp", {
        method: "POST",
        headers: { ...ACCEPT_HEADERS, Authorization: "Bearer anything" },
        body: JSON.stringify(initializeBody()),
      }),
      envWithoutSecret,
    );
    expect(response.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("accepts an authorized initialize request and returns server info", async () => {
    mockFetch.mockResolvedValueOnce(mockOkJson(SITE_INFO));

    const response = await worker.fetch(
      new Request("https://worker.test/mcp", {
        method: "POST",
        headers: { ...ACCEPT_HEADERS, Authorization: `Bearer ${ENV.MCP_ACCESS_TOKEN}` },
        body: JSON.stringify(initializeBody()),
      }),
      ENV,
    );

    expect(response.status).toBe(200);
    const result = (await response.json()) as { result: { serverInfo: { name: string } } };
    expect(result.result.serverInfo).toEqual({ name: "stemlearn-mcp", version: "0.1.0" });
    // Valid MCP initialization still creates the client normally.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("fails safely on a malformed JSON body without leaking internals or contacting Moodle", async () => {
    const response = await worker.fetch(
      new Request("https://worker.test/mcp", {
        method: "POST",
        headers: { ...ACCEPT_HEADERS, Authorization: `Bearer ${ENV.MCP_ACCESS_TOKEN}` },
        body: "{not json",
      }),
      ENV,
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error: Invalid JSON" }, id: null });
    expect(JSON.stringify(body)).not.toContain(ENV.MOODLE_TOKEN);
    expect(JSON.stringify(body)).not.toContain(ENV.MCP_ACCESS_TOKEN);
    // The malformed body is rejected before any live Moodle round-trip.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not bypass file authorization for a bogus fileId over HTTP", async () => {
    mockFetch.mockResolvedValueOnce(mockOkJson(SITE_INFO));

    const response = await worker.fetch(
      new Request("https://worker.test/mcp", {
        method: "POST",
        headers: { ...ACCEPT_HEADERS, Authorization: `Bearer ${ENV.MCP_ACCESS_TOKEN}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "moodle_download_file", arguments: { fileId: "bogus" } },
        }),
      }),
      ENV,
    );

    expect(response.status).toBe(200);
    const result = (await response.json()) as { result: { isError: boolean; content: { type: string; text: string }[] } };
    expect(result.result.isError).toBe(true);
    expect(result.result.content[0]!.text).toContain("fileId is invalid, expired, or was not issued to the current user");
  });
});
