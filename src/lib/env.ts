import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Read a Worker environment variable or secret.
 *
 * Prefer the Cloudflare env binding — the same source `getDB()` uses for the
 * D1 binding — because `process.env` is only populated on Workers with a
 * compatibility date of 2025-04-01 or later (`nodejs_compat_populate_process_env`),
 * and this project pins an older date. `process.env` stays as the fallback for
 * local scripts and tests running outside a request context.
 */
export function readWorkerEnv(name: string): string | undefined {
  try {
    const { env } = getCloudflareContext() as unknown as {
      env: Record<string, unknown>;
    };
    const value = env[name];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  } catch {
    // Outside a request context — fall through to process.env.
  }

  const fallback = process.env[name];
  if (typeof fallback === "string" && fallback.trim().length > 0) {
    return fallback.trim();
  }
  return undefined;
}
