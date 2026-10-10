import type { SurfaceId } from "@/lib/dental/taxonomy";
import type { TargetType } from "@/lib/dental/types";

/** Where a clinical note belongs. Mirrors the server enum (ClinicalNote.sourceType). */
export type NoteSource = "patient" | "appointment" | "dental_treatment" | "derm_treatment";

export interface PersonRef { _id: string; name: string }

export interface ClinicalNote {
  _id: string;
  patientId: string;
  sourceType: NoteSource;
  sourceId?: string;
  text: string;
  author: PersonRef | null;
  doctor: PersonRef | null;
  createdAt: string;
  updatedAt: string;
  editCount: number; // also the token an edit sends back so a stale screen can't overwrite a newer edit
  edited: { at: string; by: PersonRef | null } | null;
}

export interface NoteRevision {
  text: string; // the content that was replaced
  versionAt: string; // when that content had been saved
  editedAt: string; // when it was replaced
  editedBy: PersonRef | null;
}

export type TimelineKind = "visit" | "treatment" | "note";
export type TimelineFilter = "all" | TimelineKind;

export interface TimelineContext {
  procedureCode?: string;
  customName?: string;
  targetType?: TargetType;
  toothNumbers?: string[];
  surfaces?: SurfaceId[];
  visitAt?: string;
  visitStatus?: string;
  visitType?: string;
  visitSource?: string; // "walk_in" for a visit registered at reception without a booking
  sourceType?: NoteSource;
}

/** One row of the patient's clinical timeline. Derived on the server from the records that own the information. */
export interface TimelineEvent {
  key: string; // unique & stable: React key + paging cursor
  kind: TimelineKind;
  /** visit: appointment status · treatment: planned|in_progress|completed|cancelled · note: note|session_note */
  event: string;
  at: string;
  by: PersonRef | null;
  context: TimelineContext;
  content?: string;
  appointmentId?: string;
  itemId?: string;
  noteId?: string;
  editable?: boolean;
  editCount?: number;
  edited?: { at: string; by: PersonRef | null } | null;
  reason?: string;
}

export interface TimelinePage { events: TimelineEvent[]; nextCursor: string | null }

/** What a note is "about" when it is started from a visit / treatment (so the doctor never re-selects it). */
export interface NoteContext {
  sourceType: NoteSource;
  sourceId?: string;
  /** Human wording for the dialog header, e.g. "Crown — 16" or "Visit · 8 Oct". Built by the caller. */
  label?: string;
}
