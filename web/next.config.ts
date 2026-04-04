import type { NextConfig } from "next";
import { resolve } from "path";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "xrpl",
    "mpcp-service",
    "mpcp-gateway-client",
    "@mpcp/agent",
  ],
  outputFileTracingRoot: resolve(__dirname, ".."),
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@hashgraph/sdk": resolve(__dirname, "lib/hashgraph-stub.ts"),
    };
    return config;
  },
};

export default nextConfig;
