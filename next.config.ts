import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The SDK resolves its platform-specific Codex CLI package at runtime.
  // Bundling it rewrites createRequire() and prevents the native binary lookup.
  serverExternalPackages: ["@openai/codex-sdk"],
  turbopack: { root: process.cwd() },
};

export default nextConfig;
