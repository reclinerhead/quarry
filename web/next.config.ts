import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Unset on orchid and in dev; "/quarry" on a station, where the app lives
  // under a path beside the Aviary (#100). Set in web/.env.local by the
  // station install script. Dot access on purpose: basePath is fixed at
  // build time and lib/base-path.ts inlines the same value for the browser.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
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
