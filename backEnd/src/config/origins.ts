/**
 * Browser origins allowed to talk to the API — the SINGLE definition, shared by Express CORS (index.ts) and the Connect realtime
 * handshake (services/connect/realtime.ts), so the two can never drift apart.
 *
 * FIX #11 (F-03) rule, unchanged: CORS fails CLOSED, never reflects every origin.
 *   Production : only FRONTEND_URL (a missing FRONTEND_URL means NO origin is allowed — localhost is never trusted automatically).
 *   Otherwise  : FRONTEND_URL (if set) and the local Next.js dev server.
 */
export function allowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] | false {
  const frontendUrl = (env.FRONTEND_URL ?? "").trim().replace(/\/+$/, "") || undefined;
  const isProduction = env.NODE_ENV === "production";
  if (isProduction) return frontendUrl ? [frontendUrl] : false;
  return frontendUrl ? [frontendUrl, "http://localhost:3000"] : ["http://localhost:3000"];
}
