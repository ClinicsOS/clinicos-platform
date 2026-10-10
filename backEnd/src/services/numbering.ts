/**
 * PHASE 7 — clinic-scoped sequential numbers (patient file number, invoice number).
 *
 * The number is unique per clinic (a unique index), so two requests that compute the same "next" number cannot both be stored: the loser
 * gets E11000 and must try again. `nextNumber` reads the CURRENT highest number (not a count — a count is wrong as soon as a number was
 * ever skipped); `retryPause` spreads a parallel burst so the retries do not collide again.
 */
import type { Model } from "mongoose";

export const NUMBER_ATTEMPTS = 12;

export async function nextNumber(model: Model<any>, clinicId: unknown, field: string): Promise<number> {
  const last = await model.findOne({ clinicId }).sort({ [field]: -1 }).select(field).lean<Record<string, number> | null>();
  return (last?.[field] ?? 0) + 1;
}

export const retryPause = (attempt: number) =>
  attempt === 0 ? Promise.resolve() : new Promise<void>((r) => setTimeout(r, Math.floor(Math.random() * 25 * attempt)));
