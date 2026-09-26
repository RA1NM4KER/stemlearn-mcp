// Minimal local shape of the Cloudflare D1 binding — only what this codebase
// actually calls. Deliberately NOT importing `@cloudflare/workers-types`:
// that package's ambient `declare global` type augmentations (Request,
// Response, crypto, ...) collide with @types/node's own globals under this
// project's tsconfig (`types: ["node"]`), the same collision noted for why
// `configFromWorkerEnv` avoids Node-only APIs. The real D1 binding object
// Cloudflare provides at runtime satisfies this interface structurally.
export interface D1RunResult {
  meta: { changes: number };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<D1RunResult>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}
