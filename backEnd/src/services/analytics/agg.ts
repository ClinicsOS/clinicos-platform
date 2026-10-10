import { DEFAULT_CLINIC_TIMEZONE } from "../../utils/timezone";

/**
 * Small, shared pieces of aggregation pipelines. Calendar bucketing is done BY MONGODB in the clinic timezone (an IANA name, never a
 * numeric offset), so a payment at 23:30 clinic time lands on the clinic's day, not on the UTC day.
 */
const tz = DEFAULT_CLINIC_TIMEZONE;
export const dayOf = (field: string) => ({ $dateToString: { format: "%Y-%m-%d", date: field, timezone: tz } });
export const hourOf = (field: string) => ({ $hour: { date: field, timezone: tz } });
/** 1 = Sunday … 7 = Saturday (MongoDB $dayOfWeek) */
export const dowOf = (field: string) => ({ $dayOfWeek: { date: field, timezone: tz } });

export const round3 = (n: number) => Math.round(n * 1000) / 1000;
export const sumMap = (m: Map<string, number>) => { let t = 0; m.forEach((v) => (t += v)); return t; };
