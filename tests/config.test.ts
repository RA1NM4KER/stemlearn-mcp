import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeUrl, getConfig, loadTokenFile, configFromWorkerEnv } from "../src/config.js";

describe("normalizeUrl", () => {
  it("returns the origin of a base URL", () => {
    expect(normalizeUrl("https://moodle.uni.edu")).toBe("https://moodle.uni.edu");
  });

  it("strips trailing slash", () => {
    expect(normalizeUrl("https://moodle.uni.edu/")).toBe("https://moodle.uni.edu");
  });

  it("strips path from a full course URL", () => {
    expect(normalizeUrl("https://moodle.uni.edu/course/view.php?id=5")).toBe("https://moodle.uni.edu");
  });

  it("strips path and query params", () => {
    expect(normalizeUrl("https://moodle.uni.edu/mod/assign/view.php?id=99")).toBe("https://moodle.uni.edu");
  });

  it("throws on invalid URL", () => {
    expect(() => normalizeUrl("not-a-url")).toThrow("Invalid MOODLE_URL");
  });

  it("requires HTTPS except for explicit local development hosts", () => {
    expect(() => normalizeUrl("http://moodle.uni.edu")).toThrow(/HTTPS/);
    expect(normalizeUrl("http://localhost:8080")).toBe("http://localhost:8080");
    expect(normalizeUrl("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
  });
});

describe("getConfig", () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
    // Point at a path that can't exist, so these tests are isolated from
    // any real .auth/token.json a developer has authenticated with.
    process.env.MOODLE_MCP_TOKEN_FILE = "/nonexistent/.auth/token.json";
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it("throws when MOODLE_URL is missing", () => {
    delete process.env.MOODLE_URL;
    expect(() => getConfig()).toThrow("MOODLE_URL");
  });

  it("accepts token-only auth", () => {
    process.env.MOODLE_URL = "https://moodle.uni.edu";
    process.env.MOODLE_TOKEN = "abc123";
    delete process.env.MOODLE_USERNAME;
    delete process.env.MOODLE_PASSWORD;
    const config = getConfig();
    expect(config.baseUrl).toBe("https://moodle.uni.edu");
    expect(config.auth).toEqual({ kind: "token", token: "abc123" });
  });

  it("accepts username+password auth", () => {
    process.env.MOODLE_URL = "https://moodle.uni.edu";
    delete process.env.MOODLE_TOKEN;
    process.env.MOODLE_USERNAME = "student@uni.edu";
    process.env.MOODLE_PASSWORD = "secret";
    const config = getConfig();
    expect(config.auth).toEqual({ kind: "password", username: "student@uni.edu", password: "secret" });
  });

  it("throws when neither token nor credentials provided", () => {
    process.env.MOODLE_URL = "https://moodle.uni.edu";
    delete process.env.MOODLE_TOKEN;
    delete process.env.MOODLE_USERNAME;
    delete process.env.MOODLE_PASSWORD;
    expect(() => getConfig()).toThrow("MOODLE_TOKEN");
  });

  it("rejects incomplete username/password authentication", () => {
    process.env.MOODLE_URL = "https://moodle.uni.edu";
    delete process.env.MOODLE_TOKEN;
    process.env.MOODLE_USERNAME = "student";
    delete process.env.MOODLE_PASSWORD;
    expect(() => getConfig()).toThrow("MOODLE_TOKEN");
  });

  it("normalizes a full course URL", () => {
    process.env.MOODLE_URL = "https://moodle.uni.edu/course/view.php?id=5";
    process.env.MOODLE_TOKEN = "abc123";
    const config = getConfig();
    expect(config.baseUrl).toBe("https://moodle.uni.edu");
  });
});

describe("getConfig with .auth/token.json (npm run auth output)", () => {
  const origEnv = process.env;
  const tmpFile = path.join(os.tmpdir(), `moodle-mcp-config-test-${process.pid}.json`);

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.MOODLE_URL;
    delete process.env.MOODLE_TOKEN;
    delete process.env.MOODLE_USERNAME;
    delete process.env.MOODLE_PASSWORD;
    process.env.MOODLE_MCP_TOKEN_FILE = tmpFile;
  });

  afterEach(() => {
    process.env = origEnv;
    fs.rmSync(tmpFile, { force: true });
  });

  it("uses site + token from the token file when no env vars are set", () => {
    fs.writeFileSync(tmpFile, JSON.stringify({ site: "https://moodle.uni.edu", token: "filetoken" }));
    const config = getConfig();
    expect(config.baseUrl).toBe("https://moodle.uni.edu");
    expect(config.auth).toEqual({ kind: "token", token: "filetoken" });
  });

  it("lets MOODLE_TOKEN override the token file's token", () => {
    fs.writeFileSync(tmpFile, JSON.stringify({ site: "https://moodle.uni.edu", token: "filetoken" }));
    process.env.MOODLE_TOKEN = "envtoken";
    const config = getConfig();
    expect(config.auth).toEqual({ kind: "token", token: "envtoken" });
  });

  it("throws with a `npm run auth` hint when the token file is missing and no env vars are set", () => {
    expect(() => getConfig()).toThrow(/npm run auth/);
  });

  it("ignores a malformed token file and falls through to the missing-config error", () => {
    fs.writeFileSync(tmpFile, "not json");
    expect(() => getConfig()).toThrow(/npm run auth/);
  });

  it("validates token-file structure while tolerating harmless extra fields", () => {
    fs.writeFileSync(tmpFile, JSON.stringify({ site: "https://moodle.uni.edu", token: "filetoken", issuedAt: "today" }));
    expect(loadTokenFile()).toMatchObject({ site: "https://moodle.uni.edu", token: "filetoken" });
  });

  it("rejects missing or incorrectly typed token fields without exposing their contents", () => {
    fs.writeFileSync(tmpFile, JSON.stringify({ site: "https://moodle.uni.edu" }));
    expect(loadTokenFile()).toBeNull();
    fs.writeFileSync(tmpFile, JSON.stringify({ site: 42, token: "secret-token" }));
    expect(loadTokenFile()).toBeNull();
  });
});

describe("configFromWorkerEnv", () => {
  it("builds a token-auth Config from Worker env bindings", () => {
    const config = configFromWorkerEnv({
      MOODLE_URL: "https://moodle.uni.edu",
      MOODLE_TOKEN: "worker-token",
    });
    expect(config.baseUrl).toBe("https://moodle.uni.edu");
    expect(config.auth).toEqual({ kind: "token", token: "worker-token" });
    expect(config.maxFileBytes).toBe(25 * 1024 * 1024);
    expect(config.requestTimeoutMs).toBe(20_000);
  });

  it("normalizes a full course URL from env", () => {
    const config = configFromWorkerEnv({
      MOODLE_URL: "https://moodle.uni.edu/course/view.php?id=5",
      MOODLE_TOKEN: "worker-token",
    });
    expect(config.baseUrl).toBe("https://moodle.uni.edu");
  });

  it("applies the tunable overrides when set", () => {
    const config = configFromWorkerEnv({
      MOODLE_URL: "https://moodle.uni.edu",
      MOODLE_TOKEN: "worker-token",
      MOODLE_MCP_MAX_FILE_MB: "10",
      MOODLE_MCP_REQUEST_TIMEOUT_MS: "5000",
    });
    expect(config.maxFileBytes).toBe(10 * 1024 * 1024);
    expect(config.requestTimeoutMs).toBe(5000);
  });

  it("throws when MOODLE_URL is missing", () => {
    expect(() => configFromWorkerEnv({ MOODLE_TOKEN: "worker-token" })).toThrow("MOODLE_URL");
  });

  it("throws when MOODLE_TOKEN is missing", () => {
    expect(() => configFromWorkerEnv({ MOODLE_URL: "https://moodle.uni.edu" })).toThrow("MOODLE_TOKEN");
  });
});
