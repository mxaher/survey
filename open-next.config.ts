import { defineCloudflareConfig } from "@opennextjs/cloudflare";

const config = defineCloudflareConfig({
  // Cloudflare-specific configuration
});

// "build" runs the OpenNext build, whose default buildCommand is "bun run
// build" — that would recurse infinitely. Point it at the Next.js build.
const openNextConfig = {
  ...config,
  buildCommand: "npx next build",
};

export default openNextConfig;
