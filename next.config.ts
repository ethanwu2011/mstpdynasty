import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local-only folders (dev fixture league data, the local store, review scratch, samples)
  // must never be traced into a server function, even on a CLI or --prebuilt deploy.
  outputFileTracingExcludes: {
    "*": ["fixtures/**", ".data/**", ".review/**", "docs/samples/**", ".env*"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
