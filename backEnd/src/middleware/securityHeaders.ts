import { Request, Response, NextFunction } from "express";

/**
 * Minimal, dependency-free security-headers middleware.
 *
 * This deliberately avoids adding `helmet` as a new dependency so the change
 * is a pure drop-in with no `npm install` step and nothing new to break on
 * deploy. It sets the same core headers helmet's defaults would for a JSON API.
 *
 * NOTE: this API server only ever returns JSON (no HTML is rendered here), so a
 * full Content-Security-Policy isn't meaningful on these responses — the CSP
 * that matters for XSS protection belongs on the Next.js frontend and is set in
 * `frontEnd/next.config.mjs`. We still send a restrictive default CSP here so a
 * stray/unexpected HTML response can't load or run anything.
 */
export const securityHeaders = (
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  // Stop browsers from MIME-sniffing a response into a different content type.
  res.setHeader("X-Content-Type-Options", "nosniff");

  // This API should never be framed by anyone.
  res.setHeader("X-Frame-Options", "DENY");

  // Don't leak full URLs (which may carry ids) in the Referer header.
  res.setHeader("Referrer-Policy", "no-referrer");

  // Lock down what any (unexpected) HTML from this origin could do.
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  );

  // Turn off legacy powerful features by default.
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()"
  );

  // Tell browsers to keep talking to us over HTTPS for the next 6 months.
  // Safe because the API is served over HTTPS in production (Render). It only
  // takes effect on HTTPS responses, so local http dev is unaffected.
  res.setHeader(
    "Strict-Transport-Security",
    "max-age=15552000; includeSubDomains"
  );

  // Don't advertise the framework.
  res.removeHeader("X-Powered-By");

  next();
};
