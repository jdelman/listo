import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  allowedDevOrigins: ["jdsrv", "jdsrv.local"],
};
export default nextConfig;
