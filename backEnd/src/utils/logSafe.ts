/**
 * PHASE 7 — log hygiene. Operational logs may say THAT something happened, never carry patient / user contact details
 * or the content of a message (a verification / reset email contains a one-time link).
 */
export const isProduction = (): boolean => process.env.NODE_ENV === "production";

/** "0795123456" -> "•••••••456" (last 3 digits only). */
export const maskPhone = (p: unknown): string => {
  const s = String(p ?? "").replace(/\s+/g, "");
  return s.length <= 3 ? "•••" : "•".repeat(Math.max(3, s.length - 3)) + s.slice(-3);
};

/** "jane.doe@example.com" -> "j•••@example.com". */
export const maskEmail = (e: unknown): string => {
  const s = String(e ?? "");
  const at = s.lastIndexOf("@");
  if (at < 1) return "•••";
  return `${s[0]}•••${s.slice(at)}`;
};

/**
 * Error text for the server log. A MongoDB duplicate-key / cast / validation message embeds the VALUE that was submitted
 * (a patient's phone number, an e-mail address…), so only the error kind and the offending key NAMES are logged for those.
 */
export function safeErrorText(err: any): string {
  if (!err) return "unknown error";
  if (err.code === 11000) return `E11000 duplicate key on ${Object.keys(err.keyPattern ?? err.keyValue ?? {}).join(",") || "index"}`;
  if (err.name === "CastError") return `CastError at path "${err.path ?? "?"}"`;
  if (err.name === "ValidationError") return `ValidationError at ${Object.keys(err.errors ?? {}).join(",") || "document"}`;
  return String(err.message || err);
}
