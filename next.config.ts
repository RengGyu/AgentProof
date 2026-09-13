import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  outputFileTracingRoot: process.cwd(),
  outputFileTracingIncludes: {
    "/api/analyze": ["./scripts/trusted-typescript-assignability.mjs", "./node_modules/typescript/lib/**/*.js", "./node_modules/typescript/lib/lib*.d.ts", "./node_modules/typescript/package.json"]
  },
  eslint: {
    ignoreDuringBuilds: true
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" }
        ]
      },
      {
        source: "/reports/share",
        headers: [
          { key: "Cache-Control", value: "private, no-store" }
        ]
      }
    ];
  }
};

export default nextConfig;
