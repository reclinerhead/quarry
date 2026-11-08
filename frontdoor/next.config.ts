import type { NextConfig } from "next";

// The Quarry's front door (issue #102): route handlers only, no pages, no
// React tree. Deployed as its own Vercel project with Root Directory set to
// this folder, the repo's one Vercel surface (frontdoor/README.md). The web
// app under web/ never knows this folder exists.
const nextConfig: NextConfig = {};

export default nextConfig;
