import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";

/**
 * NEW SERVICE — thin wrapper around otplib + qrcode so the rest of the app
 * only ever imports from here. Keeps the TOTP library swappable and all the
 * defaults (30s period, 6 digits, SHA1 — the same combination every
 * authenticator app assumes) in one place.
 *
 * Nothing in this file talks to the database or persists a secret anywhere —
 * by design. The admin's TOTP secret lives only in the ADMIN_TOTP_SECRET
 * environment variable (same philosophy as ADMIN_PASSWORD_HASH), never in
 * Mongo. See adminController.ts (setupTotp / verifyTotpSetup) for how the
 * one-time setup flow uses these functions.
 */

const ISSUER = "ClinicOS Admin";

// Allow ±30s of clock drift between the admin's phone and the server, so a
// slightly-off phone clock doesn't lock the admin out on an otherwise
// correct code.
const EPOCH_TOLERANCE = 30;

/** Generates a brand-new random base32 TOTP secret. */
export function generateTotpSecret(): string {
  return generateSecret();
}

/**
 * Builds the otpauth:// URI that a QR code encodes. Google Authenticator,
 * Authy, Microsoft Authenticator, etc. all understand this same standard
 * format — scanning it adds the "ClinicOS Admin" entry to the app.
 */
export function buildTotpUri(secret: string, accountEmail: string): string {
  return generateURI({ issuer: ISSUER, label: accountEmail, secret });
}

/** Renders the otpauth:// URI as a scannable QR code (PNG data URL). */
export async function generateQrCodeDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri);
}

/** Checks a 6-digit code the admin typed against a given secret. */
export async function verifyTotpToken(secret: string, token: string): Promise<boolean> {
  try {
    const result = await verify({ secret, token, epochTolerance: EPOCH_TOLERANCE });
    return result.valid;
  } catch {
    return false;
  }
}
