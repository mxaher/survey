import { defineCloudflareConfig } from "@opennextjs/cloudflare";

const config = defineCloudflareConfig({
  // Cloudflare-specific configuration
});

export default {
  ...config,
  // "build" runs the OpenNext build, so the default ("bun run build") would
  // recurse infinitely. Point the OpenNext build at the Next.js build instead.
  buildCommand: "npx next build",
};
