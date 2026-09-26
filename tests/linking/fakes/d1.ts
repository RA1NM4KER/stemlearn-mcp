import type { D1Database, D1PreparedStatement, D1RunResult } from "../../../src/linking/d1.js";

export interface FakeCredentialRow {
  user_id: string;
  moodle_base_url: string;
  encrypted_token: string;
  created_at: number;
  updated_at: number;
}

export interface FakeSessionRow {
  session_hash: string;
  user_id: string;
  passport: string;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
}

/**
 * A minimal in-memory stand-in for the real D1 binding, pattern-matching on
 * the exact statements src/linking/* issues (this repo's query surface is
 * small and fixed, so a full SQL engine isn't needed). Sufficient to exercise
 * real single-use/atomicity/isolation logic without a live Cloudflare D1.
 */
export class FakeD1 implements D1Database {
  credentials = new Map<string, FakeCredentialRow>();
  sessions = new Map<string, FakeSessionRow>();

  prepare(sql: string): D1PreparedStatement {
    return new FakeStatement(this, sql);
  }
}

class FakeStatement implements D1PreparedStatement {
  private args: unknown[] = [];
  constructor(private readonly db: FakeD1, private readonly sql: string) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.args = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("FROM moodle_credentials")) {
      const [userId] = this.args as [string];
      const row = this.db.credentials.get(userId);
      if (!row) return null;
      return { moodle_base_url: row.moodle_base_url, encrypted_token: row.encrypted_token } as unknown as T;
    }
    if (this.sql.includes("FROM linking_sessions")) {
      const [sessionHash, now] = this.args as [string, number];
      const row = this.db.sessions.get(sessionHash);
      if (!row || row.consumed_at !== null || row.expires_at <= now) return null;
      return { user_id: row.user_id, passport: row.passport } as unknown as T;
    }
    throw new Error(`FakeD1: unhandled first() query: ${this.sql}`);
  }

  async run(): Promise<D1RunResult> {
    if (this.sql.startsWith("INSERT INTO linking_sessions")) {
      const [sessionHash, userId, passport, createdAt, expiresAt] = this.args as [string, string, string, number, number];
      this.db.sessions.set(sessionHash, {
        session_hash: sessionHash, user_id: userId, passport, created_at: createdAt, expires_at: expiresAt, consumed_at: null,
      });
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("UPDATE linking_sessions")) {
      const [consumedAt, sessionHash, now] = this.args as [number, string, number];
      const row = this.db.sessions.get(sessionHash);
      if (!row || row.consumed_at !== null || row.expires_at <= now) return { meta: { changes: 0 } };
      row.consumed_at = consumedAt;
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("INSERT INTO moodle_credentials")) {
      const [userId, baseUrl, encryptedToken, createdAt, updatedAt] = this.args as [string, string, string, number, number];
      this.db.credentials.set(userId, {
        user_id: userId, moodle_base_url: baseUrl, encrypted_token: encryptedToken, created_at: createdAt, updated_at: updatedAt,
      });
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("DELETE FROM moodle_credentials")) {
      const [userId] = this.args as [string];
      const existed = this.db.credentials.delete(userId);
      return { meta: { changes: existed ? 1 : 0 } };
    }
    throw new Error(`FakeD1: unhandled run() query: ${this.sql}`);
  }
}
