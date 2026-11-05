import type { NextConfig } from "next";
import { SUPABASE_URL } from "./src/lib/supabase/env";

const dev = process.env.NODE_ENV !== "production";
const supabase = new URL(SUPABASE_URL);
// The local test stack (scripts/local-supabase) runs over plain http; a real deployment never does.
const plain = supabase.protocol === "http:";

// Next.js bootstraps with inline scripts, so 'unsafe-inline' stays for scripts; everything else is locked to this site.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabase.origin} ${plain ? "ws" : "wss"}://${supabase.host}${dev ? " ws:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  ...(dev || plain ? [] : ["upgrade-insecure-requests"]),
].join("; ");

export const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  // Import payloads (accounts x months) can exceed the 1 MB default; Vercel caps requests at 4.5 MB.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  // Headless Chromium for PDF export must stay out of the bundle.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
  poweredByHeader: false,
  // Company value was renamed Valuation: the old addresses keep working.
  async redirects() {
    return [
      { source: "/company/:id/value", destination: "/company/:id/valuation", permanent: true },
      { source: "/company/:id/value/:rest*", destination: "/company/:id/valuation/:rest*", permanent: true },
      { source: "/demo/value", destination: "/demo/valuation", permanent: true },
      { source: "/demo/value/:rest*", destination: "/demo/valuation/:rest*", permanent: true },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
