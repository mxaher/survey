/**
 * Thin client-side fetch helper for employee endpoints.
 *
 * - Always sends `Cache-Control: no-store` semantics by passing
 *   `cache: "no-store"` to `fetch`.
 * - Throws `ApiError` (with HTTP status) when the server returns a non-2xx
 *   status OR an envelope with `ok: false`. The wizard uses the status code
 *   to discriminate between 401 (not impersonated in dev mode), 409
 *   (duplicate submission), 400 (incomplete answers), and other failures.
 * - Returns the unwrapped `data` field on success.
 *
 * NEVER called from a server component — this is browser-only. All employee
 * endpoints are `force-dynamic` + `Cache-Control: no-store` server-side, so
 * the browser must always hit the network (the `cache: "no-store"` arg below
 * mirrors the server's `noStore()` helper).
 */
import { ApiError } from "./types";
import type { ApiEnvelope } from "./types";

export { ApiError } from "./types";

export async function fetchEmployeeApi<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
  });

  // 204 / empty body → return null as `T`.
  if (res.status === 204) return null as unknown as T;

  const json: ApiEnvelope<T> = await res.json().catch(() => ({
    ok: false,
    error: "حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى لاحقًا.",
  }));

  if (!res.ok || json.ok === false) {
    const message = json.error ?? "حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى لاحقًا.";
    // Throw the real `ApiError` class so callers can `instanceof ApiError`
    // (an anonymous class would break instanceof checks downstream).
    throw new ApiError(message, res.status);
  }

  return (json.data ?? null) as unknown as T;
}
