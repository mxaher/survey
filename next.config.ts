import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Wires `next dev` to the local Miniflare/Wrangler platform proxy so
// `getCloudflareContext()` (and therefore `getDB()` / `readWorkerEnv()`)
// resolves on every API route during development. No-op outside `next dev`.
initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
