import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The build script runs TypeScript 7 before Next.js. Next still needs the
  // older TypeScript compiler API for configuration and editor tooling.
  typescript: {
    ignoreBuildErrors: true,
  },
  // Capy previews serve `pnpm dev` from *.capysandbox.net. Without this, Next blocks the dev
  // scripts from that origin and the page never hydrates (no click handlers run).
  allowedDevOrigins: ["*.capysandbox.net"],
  // The same proxy forwards a different host than the browser's origin, so Server Actions
  // (Clerk keyless uses them) are rejected unless the preview origin is allowed.
  experimental: {
    serverActions: { allowedOrigins: ["*.capysandbox.net"] },
  },
};

export default nextConfig;
