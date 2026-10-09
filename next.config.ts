import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Headless Chromium for PDF export must stay out of the bundle.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
