import type { Config } from "./config.js";
import { DEFAULT_MAX_FILE_MB, DEFAULT_REQUEST_TIMEOUT_MS } from "./config.js";
import { FileIdStore, type FileRef } from "./file-id-store.js";
import { isMoodleFileContent, MoodleCourseContentsSchema, MoodleErrorResponseSchema, MoodleLoginResponseSchema, MoodleSiteInfoSchema } from "./moodle-api.js";
import type { z } from "zod";

export interface DownloadedFile {
  mime: string;
  bytes: Uint8Array;
}

export class MoodleClientError extends Error {
  constructor(message: string, readonly code: "timeout" | "network" | "authentication" | "api") {
    super(message);
    this.name = "MoodleClientError";
  }
}

export class MoodleTimeoutError extends MoodleClientError {
  constructor() { super("Moodle request timed out. Please try again.", "timeout"); this.name = "MoodleTimeoutError"; }
}

export class MoodleValidationError extends MoodleClientError {
  constructor() { super("Moodle returned an unexpected response. Please try again.", "api"); this.name = "MoodleValidationError"; }
}

export class MoodleClient {
  userId: number = 0;
  siteName: string = "";
  release: string = "";
  supportedFunctions: Set<string> = new Set();
  readonly fileIdStore: FileIdStore;

  private readonly baseHost: string;
  readonly maxFileBytes: number;
  readonly requestTimeoutMs: number;

  private constructor(
    readonly baseUrl: string,
    private readonly token: string,
    maxFileBytes = DEFAULT_MAX_FILE_MB * 1024 * 1024,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ) {
    this.baseHost = new URL(baseUrl).host;
    this.fileIdStore = new FileIdStore(token);
    this.maxFileBytes = maxFileBytes;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  /** Returns true if the WS function is available on this Moodle server. */
  supports(wsfunction: string): boolean {
    if (this.supportedFunctions.size === 0) return true;
    return this.supportedFunctions.has(wsfunction);
  }

  static async create(config: Config): Promise<MoodleClient> {
    const token = config.auth.kind === "token"
      ? config.auth.token
      : await MoodleClient.login(config.baseUrl, config.auth.username, config.auth.password, config.requestTimeoutMs);
    const client = new MoodleClient(config.baseUrl, token, config.maxFileBytes, config.requestTimeoutMs);
    const info = await client.call("core_webservice_get_site_info", {}, MoodleSiteInfoSchema);
    client.userId = info.userid;
    client.siteName = info.sitename;
    client.release = info.release ?? "";
    client.supportedFunctions = new Set(info.functions?.map((f) => f.name) ?? []);
    return client;
  }

  private async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new MoodleTimeoutError();
      }
      throw new MoodleClientError("Unable to reach Moodle. Please try again.", "network");
    } finally {
      clearTimeout(timer);
    }
  }

  private static async login(baseUrl: string, username: string, password: string, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<string> {
    const url = `${baseUrl}/login/token.php`;
    const body = new URLSearchParams({ username, password, service: "moodle_mobile_app" });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    let res: Response;
    try { res = await fetch(url, { method: "POST", body, signal: controller.signal }); }
    catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) throw new MoodleTimeoutError();
      throw new MoodleClientError("Unable to reach Moodle. Please try again.", "network");
    }
    finally { clearTimeout(timer); }
    const text = await res.text();
    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      throw new Error(
        "Moodle login returned an unexpected response. Your school may require SSO; use `npm run auth` or a Moodle token instead."
      );
    }
    const parsed = MoodleLoginResponseSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new Error("Moodle login returned an unexpected response. Use `npm run auth` or a Moodle token instead.");
    }
    const data = parsed.data;
    if (data.error) {
      throw new MoodleClientError("Moodle login failed. Check your credentials and Moodle URL.", "authentication");
    }
    if (!data.token) {
      throw new Error(
        "Moodle login failed: no token returned. Ensure the Moodle Mobile app service is enabled."
      );
    }
    return data.token;
  }

  async call<TSchema extends z.ZodTypeAny>(
    wsfunction: string,
    params: Record<string, string | number | boolean> = {},
    schema: TSchema,
  ): Promise<z.output<TSchema>> {
    const url = `${this.baseUrl}/webservice/rest/server.php`;
    const body = new URLSearchParams({
      wstoken: this.token,
      wsfunction,
      moodlewsrestformat: "json",
      // Moodle's PARAM_BOOL rejects the literal strings "true"/"false" that
      // String(v) would produce — it wants "1"/"0" (confirmed against a real
      // Moodle server: message_popup_get_popup_notifications with
      // newestfirst="true" -> invalidparameter; newestfirst="1" -> works).
      ...Object.fromEntries(
        Object.entries(params).map(([k, v]) => [
          k,
          typeof v === "boolean" ? (v ? "1" : "0") : String(v),
        ]),
      ),
    });
    const res = await this.fetch(url, { method: "POST", body });
    if (!res.ok) throw new Error("Moodle API request failed. Please try again.");
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new MoodleValidationError();
    }
    const moodleError = MoodleErrorResponseSchema.safeParse(data);
    if (moodleError.success) {
      if (moodleError.data.errorcode === "webservicesnotenabled") {
        throw new Error(
          "Web services are not enabled on this Moodle server. Contact your IT department to enable them."
        );
      }
      if (moodleError.data.errorcode === "invalidtoken") {
        throw new MoodleClientError("Invalid or expired Moodle token. Run `npm run auth` to sign in again and get a fresh one.", "authentication");
      }
      throw new MoodleClientError("Moodle API request was rejected. Check that you still have access.", "api");
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new MoodleValidationError();
    return parsed.data;
  }

  /**
   * Fetch a Moodle-managed file through the server. Only accepts pluginfile.php
   * URLs on this Moodle host — external `url` module targets are refused so we
   * don't become an SSRF relay. Caps the response at MAX_DOWNLOAD_BYTES.
   *
   * The Moodle WS token is attached to the outbound request only; it never
   * reappears in anything returned to the MCP client.
   */
  async downloadFile(fileurl: string): Promise<DownloadedFile> {
    this.assertSafeFileUrl(fileurl);
    const parsed = new URL(fileurl);
    parsed.searchParams.set("token", this.token);
    const res = await this.fetch(parsed.toString());
    return this.readDownloadedFile(res);
  }

  /** Validate a sealed file ref and re-check Moodle's current course access. */
  async authorizeFile(fileId: string): Promise<FileRef | null> {
    const ref = await this.fileIdStore.open(fileId, this.userId);
    if (!ref) return null;
    try { this.assertSafeFileUrl(ref.fileurl); } catch { return null; }
    try {
      const sections = await this.call("core_course_get_contents", { courseid: ref.courseId }, MoodleCourseContentsSchema);
      return sections.some((section) => section.modules.some((mod) =>
        (mod.contents ?? []).some((file) => isMoodleFileContent(file) && file.fileurl === ref.fileurl),
      )) ? ref : null;
    } catch (error) {
      if (error instanceof MoodleTimeoutError) throw error;
      return null;
    }
  }

  async downloadAuthorizedFile(fileId: string): Promise<{ ref: FileRef; downloaded: DownloadedFile } | null> {
    const ref = await this.authorizeFile(fileId);
    if (!ref) return null;
    return { ref, downloaded: await this.downloadFile(ref.fileurl) };
  }

  private assertSafeFileUrl(fileurl: string): void {
    let parsed: URL;
    try {
      parsed = new URL(fileurl);
    } catch {
      throw new Error("Invalid file URL");
    }
    if (parsed.host !== this.baseHost) {
      throw new Error("Refused: file URL is not on this Moodle host");
    }
    if (parsed.protocol !== new URL(this.baseUrl).protocol) {
      throw new Error("Refused: file URL does not use the configured Moodle protocol");
    }
    if (
      !parsed.pathname.includes("/pluginfile.php") &&
      !parsed.pathname.includes("/webservice/pluginfile.php")
    ) {
      throw new Error("Refused: only Moodle-managed pluginfile.php URLs can be fetched");
    }
  }

  private async readDownloadedFile(res: Response): Promise<DownloadedFile> {
    if (!res.ok) throw new Error(`Failed to fetch file: HTTP ${res.status}`);

    const maxMb = Math.round(this.maxFileBytes / 1024 / 1024);
    const lengthHeader = res.headers.get("content-length");
    if (lengthHeader && Number(lengthHeader) > this.maxFileBytes) {
      throw new Error(
        `File too large (${Math.round(Number(lengthHeader) / 1024 / 1024)} MB); max is ${maxMb} MB. Admins can raise the cap with MOODLE_MCP_MAX_FILE_MB.`,
      );
    }

    const buf = await res.arrayBuffer();
    if (buf.byteLength > this.maxFileBytes) {
      throw new Error(
        `File too large (${Math.round(buf.byteLength / 1024 / 1024)} MB); max is ${maxMb} MB. Admins can raise the cap with MOODLE_MCP_MAX_FILE_MB.`,
      );
    }

    const mime = res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
    return { mime, bytes: new Uint8Array(buf) };
  }
}
