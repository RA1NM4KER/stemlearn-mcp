import { describe, expect, it, vi } from "vitest";
import { MoodleClient } from "../src/moodle-client.js";
import { RESOURCE_LIST_POLICY } from "../src/policy.js";
import { registerResources } from "../src/resources/index.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
const jsonResponse = (data: unknown) => ({ ok: true, json: async () => data, text: async () => JSON.stringify(data) });

describe("MCP resource enumeration", () => {
  it("applies a deterministic global resource cap without concurrent mutation", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ userid: 1, username: "student", sitename: "STEMLearn", fullname: "Student", release: "4" }));
    const client = await MoodleClient.create({ baseUrl: "https://moodle.test", auth: { kind: "token", token: "token" } });
    const courses = [{ id: 1, fullname: "One", shortname: "ONE" }, { id: 2, fullname: "Two", shortname: "TWO" }];
    mockFetch.mockImplementation((_url: string, init: RequestInit) => {
      const body = init.body as URLSearchParams;
      if (body.get("wsfunction") === "core_enrol_get_users_courses") return jsonResponse(courses);
      const courseId = Number(body.get("courseid"));
      const files = Array.from({ length: 75 }, (_, i) => ({ type: "file", filename: `${courseId}-${i}`, fileurl: `https://moodle.test/pluginfile.php/${courseId}/${i}`, filesize: 1 }));
      return jsonResponse([{ id: courseId, name: "General", modules: [{ id: courseId, name: "Files", modname: "folder", contents: files }] }]);
    });

    let template: { listCallback: () => Promise<{ resources: { name: string }[] }> } | undefined;
    const server = { resource: (_name: string, resourceTemplate: typeof template, _handler: unknown) => { template = resourceTemplate; } };
    registerResources(server as never, client);
    const result = await template!.listCallback();

    expect(result.resources).toHaveLength(RESOURCE_LIST_POLICY.maxEntries);
    expect(result.resources[0]!.name).toContain("ONE");
    expect(result.resources.at(-1)!.name).toContain("TWO");
  });
});
