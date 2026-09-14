import type { NextConfig } from "next";
import { LOCAL_BROWSER_HOSTS } from "./lib/auth/origins";

const nextConfig: NextConfig = {
  agentRules: false,
  allowedDevOrigins: LOCAL_BROWSER_HOSTS,
};
export default nextConfig;
