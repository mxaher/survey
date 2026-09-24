import { NextResponse } from "next/server";

/** Standard JSON success helper. */
export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

/** Standard JSON error helper. Always returns Arabic copy from MESSAGES. */
export function fail(
  message: string,
  status = 400,
  extra?: Record<string, unknown>
) {
  return NextResponse.json(
    { ok: false, error: message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

/** `Cache-Control: no-store` for any employee/submission endpoint (spec §18). */
export function noStore<T>(data: T, status = 200) {
  return NextResponse.json(
    { ok: true, data },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

/** Convenience: wrap an async handler so unhandled errors become 500s. */
export function apiHandler<TArgs extends unknown[]>(
  fn: (...args: TArgs) => Promise<NextResponse>
): (...args: TArgs) => Promise<NextResponse> {
  return async (...args: TArgs) => {
    try {
      return await fn(...args);
    } catch (err) {
      console.error("[api] unhandled", err);
      return fail("حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى لاحقًا.", 500);
    }
  };
}
