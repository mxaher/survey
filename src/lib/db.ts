import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Get the D1 database binding for the current request.
 * Must be called within a Cloudflare Workers request context.
 */
export function getDB() {
  const { env } = getCloudflareContext();
  return env.DB;
}
