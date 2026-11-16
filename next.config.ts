import type { NextConfig } from "next";
import { LOCAL_BROWSER_HOSTS, origin } from "./lib/auth/origins";

const nextConfig: NextConfig = {
  agentRules: false,
  allowedDevOrigins: [...LOCAL_BROWSER_HOSTS, new URL(origin()).hostname],
};
export default nextConfig;
