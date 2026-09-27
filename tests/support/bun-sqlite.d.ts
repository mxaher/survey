/**
 * Ambient declarations for `bun:sqlite` and Bun's `import.meta.dir`, so the
 * test database helper type-checks under `tsc --noEmit` without pulling the
 * whole `bun-types` package (which clashes with `@types/node` from Next.js).
 * The runtime is Bun's own implementation — these declarations only describe
 * the subset the test helpers use.
 */
declare module "bun:sqlite" {
  export class Database {
    constructor(path?: string, options?: unknown);
    prepare(sql: string): Statement;
    exec(sql: string): void;
    close(force?: boolean): void;
  }

  export interface Statement {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    finalize(): void;
  }
}

interface ImportMeta {
  /** Absolute directory of the current module (Bun). */
  dir: string;
}
