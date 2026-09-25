import { describe, expect, it } from "vitest";
import { workerErrorResponse } from "../src/worker.js";
import { MoodleTimeoutError } from "../src/moodle-client.js";

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
