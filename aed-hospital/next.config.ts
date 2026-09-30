import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // pdfkit reads its font metric files from disk at runtime, so it must not be bundled.
  serverExternalPackages: ["pdfkit", "exceljs", "xlsx", "bcryptjs"],
  poweredByHeader: false,
  // pdfkit loads its font metrics (.afm) from disk at runtime; make sure Vercel bundles them.
  outputFileTracingIncludes: {
    "/api/reports/[type]": ["./node_modules/pdfkit/js/data/**/*"],
  },
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
