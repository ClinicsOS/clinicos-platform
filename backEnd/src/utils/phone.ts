/**
 * Normalizes a phone number stored in our DB (which may be entered as
 * "07XXXXXXXX", "+9627XXXXXXXX", "9627XXXXXXXX", with spaces/dashes, etc.)
 * into the digits-only international format WhatsApp's Cloud API expects
 * (e.g. "9627XXXXXXXX", no leading "+").
 *
 * Returns null if the number doesn't look like a usable Jordanian mobile
 * number, so the caller can skip sending instead of hitting the API with
 * garbage.
 *
 * NEW FILE — does not touch any existing code. Existing phone fields on
 * Patient/User keep working exactly as before; this only runs at the
 * moment we build a WhatsApp request.
 */
export function normalizeJordanPhone(raw: string): string | null {
  if (!raw) return null;

  const digits = raw.replace(/[^\d]/g, ""); // strip spaces, dashes, "+"

  // Already has the country code: "9627XXXXXXXX" (12 digits)
  if (/^9627\d{8}$/.test(digits)) return digits;

  // Local format: "07XXXXXXXX" (10 digits, starts with 0)
  if (/^07\d{8}$/.test(digits)) return `962${digits.slice(1)}`;

  // Local format without leading 0: "7XXXXXXXX" (9 digits)
  if (/^7\d{8}$/.test(digits)) return `962${digits}`;

  // Doesn't match a known Jordanian mobile shape — don't guess.
  return null;
}
