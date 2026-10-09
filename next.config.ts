import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Import payloads (accounts x months) can exceed the 1 MB default; Vercel caps requests at 4.5 MB.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  // Headless Chromium for PDF export must stay out of the bundle.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
