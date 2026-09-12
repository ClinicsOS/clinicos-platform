/** @type {import('next').NextConfig} */

// In dev, Next.js's fast-refresh/HMR uses eval(), so 'unsafe-eval' is required
// or the whole app fails to boot. In production it's not needed, so we drop it
// there for a tighter policy.
const isDev = process.env.NODE_ENV !== "production";

// The backend API origin the frontend talks to (Render). Read from the same env
// var the axios client uses so connect-src always matches wherever the API lives.
const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
let apiOrigin = "http://localhost:5000";
try {
  apiOrigin = new URL(apiUrl).origin;
} catch {
  // keep the localhost fallback if the env var is malformed
}

// Third-party origins the app legitimately loads.
// - Google Tag Manager / gtag come from @next/third-parties.
// - Google Fonts (fonts.googleapis.com for CSS, fonts.gstatic.com for the files).
const gtm = "https://www.googletagmanager.com";
const gaCollect = "https://www.google-analytics.com https://region1.google-analytics.com";

const scriptSrc = [
  "'self'",
  "'unsafe-inline'", // Next.js injects inline bootstrap scripts
  isDev ? "'unsafe-eval'" : "", // dev-only: required by fast refresh
  gtm,
]
  .filter(Boolean)
  .join(" ");

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  `script-src ${scriptSrc}`,
  `connect-src 'self' ${apiOrigin} ${gtm} ${gaCollect}`,
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=15552000; includeSubDomains",
  },
];

const nextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
