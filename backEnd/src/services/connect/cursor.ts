import { PolicyError } from "../../auth/policy";

/** Opaque message cursors: base64url("v1:<seq>"). Shared by the message pages (messages.ts), the Seen position (peerRead.ts) and realtime events. */
export const encodeCursor = (seq: number): string => Buffer.from(`v1:${seq}`, "utf8").toString("base64url");

export function decodeCursor(raw: unknown): number {
  const bad = () => new PolicyError(400, "INVALID_CURSOR", "Invalid cursor");
  if (typeof raw !== "string" || !/^[A-Za-z0-9_-]{4,40}$/.test(raw)) throw bad();
  const m = /^v1:(\d{1,12})$/.exec(Buffer.from(raw, "base64url").toString("utf8"));
  if (!m) throw bad();
  const seq = Number(m[1]);
  if (!Number.isSafeInteger(seq) || seq < 1) throw bad();
  return seq;
}
