import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Let a phone on the house Wi-Fi reach the dev server; Next blocks
  // cross-origin dev requests by default. Whole subnet, like the Conservatory.
  allowedDevOrigins: ["192.168.1.*"],
  // The repo root, not web/: globals.css imports ../../design/tokens.css,
  // and Turbopack refuses files outside its root (dev panics on every page;
  // the Conservatory learned this in its #31).
  turbopack: {
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
