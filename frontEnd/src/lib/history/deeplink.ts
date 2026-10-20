/**
 * PHASE 3 — deep links from the clinical History into the exact clinical context.
 *
 * The link is plain URL state with STABLE database ids — never note text, never an array position:
 *
 *   /patients/profile?patient=<patientId>&tab=dental-chart&tooth=26&surface=D&event=<eventId>&note=<noteId>&source=<sourceId>
 *   /patients/profile?patient=<patientId>&tab=treatment-plan&item=<itemId>&session=<sessionId>&note=<noteId>&source=<sourceId>
 *   /appointments?appt=<appointmentId>&date=<YYYY-MM-DD>&patient=<patientId>&note=<noteId>
 *
 * Because it is URL state it survives a refresh, the Back button returns to the History, and it can be shared inside the clinic.
 * It carries NO data and NO permission: the page that receives it asks the server for the patient and the records, and the server applies the
 * same patient authorization as for any other request (a link to a patient the viewer may not open simply shows "no access").
 *
 * Pure functions only (no React, no DOM) so the rules are unit-testable. Every value read back from a URL is validated; anything malformed is
 * dropped, so a hand-edited URL can never inject markup, a selector or a query into the page.
 */
import type { HistoryDeepLink } from "./types";

export const PROFILE_TABS = ["overview", "dental-chart", "treatment-plan", "clinical-map", "derm-plan", "derm-history", "record"] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];

const OID = /^[a-f0-9]{24}$/i;
const FDI = /^\d{2}$/;
const NOTE_ID = /^[A-Za-z0-9:_-]{1,60}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const SURFACE_IDS = ["M", "D", "B", "L", "O"] as const;

/** What the Patient Profile (or a tab inside it) should focus on. Every field is already validated. */
export interface ProfileFocus {
  patient: string | null;
  tab: ProfileTab | null;
  tooth: string | null;
  /** PHASE 5 — a MULTI-TOOTH treatment link: every tooth of the group (validated FDI codes, at most 32). The chart highlights all of them. */
  teeth: string[] | null;
  surface: string | null;
  event: string | null;
  item: string | null;
  session: string | null;
  assessment: string | null;
  followUp: string | null;
  note: string | null;
  source: string | null;
}

/** True when the link names a record to focus (as opposed to a plain "open this tab"). */
export const hasFocusTarget = (f: ProfileFocus) => !!(f.tooth || f.teeth?.length || f.event || f.item || f.session || f.assessment || f.followUp || (f.note && f.tab === "record"));

export function buildHistoryHref(patientId: string, d: HistoryDeepLink | null | undefined): string | null {
  if (!d || !OID.test(patientId)) return null;
  const q = new URLSearchParams();
  const put = (k: string, v: string | undefined | null, re: RegExp) => { if (v && re.test(v)) q.set(k, v); };
  if (d.tab === "appointment") {
    if (!d.appointmentId || !OID.test(d.appointmentId)) return null; // the visit is gone: nothing to open
    q.set("appt", d.appointmentId);
    put("date", d.appointmentDate, YMD);
    q.set("patient", patientId);
    put("note", d.noteId, NOTE_ID);
    return `/appointments?${q.toString()}`;
  }
  if (!(PROFILE_TABS as readonly string[]).includes(d.tab)) return null;
  q.set("patient", patientId);
  q.set("tab", d.tab);
  put("tooth", d.toothNumber, FDI);
  const group = sanitizeTeeth(d.toothNumbers);
  if (group.length > 1) q.set("teeth", group.join(","));
  put("surface", d.surface, /^[MDBLO]$/);
  put("event", d.eventId, OID);
  put("item", d.itemId, OID);
  put("session", d.sessionId, OID);
  put("assessment", d.assessmentId, OID);
  put("followUp", d.followUpId, OID);
  put("note", d.noteId, NOTE_ID);
  put("source", d.sourceId, OID);
  return `/patients/profile?${q.toString()}`;
}

/** PHASE 5 — keep only real two-digit FDI codes, unique, in the given order, at most 32 (hostile / hand-edited input can never grow the page). */
export function sanitizeTeeth(list: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const f of list ?? []) if (typeof f === "string" && FDI.test(f) && !out.includes(f)) { out.push(f); if (out.length >= 32) break; }
  return out;
}

type ParamsLike = { get(name: string): string | null };
const pick = (sp: ParamsLike, name: string, re: RegExp): string | null => {
  const v = sp.get(name);
  return v && re.test(v) ? v : null;
};

/** Read + validate the focus parameters of the Patient Profile URL. Unknown / malformed values become null. */
export function parseProfileFocus(sp: ParamsLike): ProfileFocus {
  const tab = sp.get("tab");
  const teeth = sanitizeTeeth((sp.get("teeth") ?? "").split(",").slice(0, 64));
  return {
    patient: pick(sp, "patient", OID),
    tab: tab && (PROFILE_TABS as readonly string[]).includes(tab) ? (tab as ProfileTab) : null,
    tooth: pick(sp, "tooth", FDI),
    teeth: teeth.length ? teeth : null, // null when absent / invalid, like every other field
    surface: pick(sp, "surface", /^[MDBLO]$/),
    event: pick(sp, "event", OID),
    item: pick(sp, "item", OID),
    session: pick(sp, "session", OID),
    assessment: pick(sp, "assessment", OID),
    followUp: pick(sp, "followUp", OID),
    note: pick(sp, "note", NOTE_ID),
    source: pick(sp, "source", OID),
  };
}

/** The treatment to focus: matched by its STABLE id only (never by text, never by position). null = it no longer exists. */
export function findFocusedItem<T extends { _id: string }>(items: readonly T[] | undefined, focus: Pick<ProfileFocus, "item">): T | null {
  if (!focus.item || !items) return null;
  return items.find((i) => i._id === focus.item) ?? null;
}

/** The Dental Chart entry to focus (by id). */
export function findFocusedEvent<T extends { _id: string }>(events: readonly T[] | undefined, focus: Pick<ProfileFocus, "event">): T | null {
  if (!focus.event || !events) return null;
  return events.find((e) => e._id === focus.event) ?? null;
}

/** The tooth to select: the link's tooth, only if the current chart actually has such a tooth (`valid` = the FDI codes of the dentition). */
export function focusedTooth(focus: Pick<ProfileFocus, "tooth">, valid?: readonly string[]): string | null {
  if (!focus.tooth) return null;
  return !valid || valid.includes(focus.tooth) ? focus.tooth : null;
}

/** The surface to emphasise inside the tooth panel (only the 5 real surfaces). */
export function focusedSurface(focus: Pick<ProfileFocus, "surface">): string | null {
  return focus.surface && (SURFACE_IDS as readonly string[]).includes(focus.surface) ? focus.surface : null;
}

/** DOM attribute used to find a focus target; one convention for every screen. */
export const focusAttr = (kind: string, id: string) => `${kind}:${id}`;
