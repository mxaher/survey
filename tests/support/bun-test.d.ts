/**
 * Ambient declarations for the Bun test runner so `tsc --noEmit` can
 * type-check the test suite without pulling `bun-types` into the app's
 * global scope (which would clash with `@types/node` from Next.js).
 */
declare module "bun:test" {
  export type TestFn = () => void | Promise<void>;

  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: TestFn, timeout?: number): void;
  export function test(name: string, fn: TestFn, timeout?: number): void;
  export function expect<T>(actual: T): Matchers<T>;

  interface BaseMatchers<T> {
    toBe(expected: T): void;
    toEqual(expected: unknown): void;
    toStrictEqual(expected: unknown): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toBeDefined(): void;
    toBeArray(): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toContain(item: unknown): void;
    toHaveLength(length: number): void;
    toBeGreaterThan(n: number): void;
    toBeGreaterThanOrEqual(n: number): void;
    toBeLessThan(n: number): void;
    toBeLessThanOrEqual(n: number): void;
    toBeCloseTo(n: number, precision?: number): void;
    toThrow(expected?: unknown): void;
    toMatch(expected: string | RegExp): void;
  }

  interface Matchers<T> extends BaseMatchers<T> {
    not: BaseMatchers<T>;
    resolves: BaseMatchers<Awaited<T>>;
    rejects: BaseMatchers<unknown>;
  }
}
