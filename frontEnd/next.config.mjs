/** @type {import('next').NextConfig} */

// In dev, Next.js's fast-refresh/HMR uses eval(), so 'unsafe-eval' is required
// or the whole app fails to boot. In production it's not needed, so we drop it
// there for a tighter policy.
const isDev = process.env.NODE_ENV !== "production";

// The backend API origin the frontend talks to (Render). Read from the same env
// var the axios client uses so connect-src always matches wherever the API lives.
const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

// C5 — production safety net. Every API call AND the Connect realtime socket are built from NEXT_PUBLIC_API_URL at BUILD time; if it is missing
// the client silently falls back to http://localhost:5000, i.e. a "successful" production build that can never reach the real backend.
// On a hosted build (Vercel sets VERCEL; REQUIRE_PUBLIC_API_URL=1 turns it on anywhere else) that is a hard error. A plain local
// `next build` only warns, so local end-to-end builds against a local backend keep working.
const isLocalHost = (u) => {
  try {
    const h = new URL(u).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1" || h === "0.0.0.0";
  } catch {
    return true; // malformed counts as unusable
  }
};
if (!isDev) {
  const raw = process.env.NEXT_PUBLIC_API_URL;
  const unusable = !raw || isLocalHost(raw) || !/^https:/i.test(raw);
  if (unusable && (process.env.VERCEL || process.env.REQUIRE_PUBLIC_API_URL === "1")) {
    throw new Error("NEXT_PUBLIC_API_URL must be set to the public https:// URL of the API (e.g. https://your-api.onrender.com/api) for a production build; it is missing, malformed, not https, or points to localhost.");
  }
  if (!raw || isLocalHost(raw)) {
    console.warn("[clinicos] WARNING: this production build talks to " + apiUrl + " (NEXT_PUBLIC_API_URL is missing or local). Do not deploy this build.");
  }
}
let apiOrigin = "http://localhost:5000";
try {
  apiOrigin = new URL(apiUrl).origin;
} catch {
  // keep the localhost fallback if the env var is malformed
}
// ClinicOS Connect (C3) realtime: the same API host over WebSocket. "https:" in connect-src does NOT cover "wss:", so it is listed explicitly.
const apiWsOrigin = apiOrigin.replace(/^http/, "ws");

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
  `connect-src 'self' ${apiOrigin} ${apiWsOrigin} ${gtm} ${gaCollect}`,
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
  // Phase 10: don't advertise the framework/version in every response.
  poweredByHeader: false,
  // Phase 10: the app uses no next/image, so the built-in image-optimizer endpoint (/_next/image) is switched off — it is
  // attack surface (several Next advisories target it) with no benefit here.
  images: { unoptimized: true },
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
