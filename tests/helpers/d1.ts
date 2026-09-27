/**
 * Test doubles for Cloudflare D1.
 *
 * The report/scoring services accept the structural subset of the D1 API
 * they actually use (`prepare().bind().first()/all()`), so the same code
 * runs unchanged against the real binding in Workers and against a local
 * `bun:sqlite` database in tests.
 */
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean }>;
}

export interface D1Like {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown>;
}

export function openMemoryDb(): Database {
  return new Database(":memory:");
}

export const MIGRATIONS_DIR = join(import.meta.dir, "..", "..", "migrations");

/** Applies every migration file in lexical order (same order as wrangler). */
export function applyMigrations(db: Database): string[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  return files;
}

/** Applies a single migration file (used for idempotency checks). */
export function applyMigration(db: Database, file: string): void {
  db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
}

export function toD1(db: Database): D1Like {
  return {
    prepare(sql: string): D1Statement {
      const stmt = db.prepare(sql);
      let params: unknown[] = [];
      const wrapper: D1Statement = {
        bind(...values: unknown[]) {
          params = values;
          return wrapper;
        },
        async first<T>() {
          const row = stmt.get(...(params as never[])) as T | undefined;
          return row ?? null;
        },
        async all<T>() {
          return { results: stmt.all(...(params as never[])) as T[] };
        },
        async run() {
          stmt.run(...(params as never[]));
          return { success: true };
        },
      };
      return wrapper;
    },
    async batch(statements: D1Statement[]) {
      db.exec("BEGIN");
      try {
        for (const statement of statements) await statement.run();
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return statements.map(() => ({ success: true }));
    },
  };
}
