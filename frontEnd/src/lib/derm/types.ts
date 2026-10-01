import type { RecordType, SurfaceId } from "./regions";

/** Mirrors backEnd/src/config/dermatology.ts MAX_TEXT (checked by scripts/check-derm-registry-sync.js). */
export const DERM_MAX_TEXT = { concern: 500, findings: 3000, diagnosis: 300, notes: 3000, voidNote: 500 } as const;
export const MARKER_SPACE = "region-aabb/v1";

export interface DermRegionRef { id: string; surface?: SurfaceId }
export interface DermMarker { regionId: string; u: number; v: number; w: number }
export interface DermVisitInfo { startAt: string; status: string; source?: string }
export interface DermPerson { _id: string; name: string }

export interface DermAssessment {
  _id: string;
  patientId: string;
  appointmentId: string | null;
  visit: DermVisitInfo | null;
  recordType: RecordType;
  regions: DermRegionRef[];
  markers: DermMarker[];
  markerSpace: string;
  concern: string;
  findings: string;
  /** Optional, entered by the clinician only — the system never suggests or infers one. */
  diagnosis: string;
  notes: string;
  status: "active" | "entered_in_error";
  rev: number;
  registryVersion: number;
  createdAt: string;
  updatedAt: string;
  createdBy: DermPerson | null;
  edited: boolean;
  lastEditedAt: string | null;
  resolution?: { at: string; by: DermPerson | null; reason: string; note?: string };
}

export interface DermRegionActivity { total: number; dermatology: number; aesthetic: number; lastAt: string }
export interface DermMapResponse {
  registryVersion: number;
  total: number;
  byType: { dermatology: number; aesthetic: number };
  lastAt: string | null;
  regions: Record<string, DermRegionActivity>;
}

export interface DermListResponse { assessments: DermAssessment[]; hasMore: boolean; nextBefore: string | null }

export interface DermListFilters {
  regionId?: string;
  recordType?: RecordType;
  appointmentId?: string;
  includeVoided?: boolean;
}

export interface CreateAssessmentInput {
  clientRequestId: string;
  recordType: RecordType;
  regions: DermRegionRef[];
  markers?: DermMarker[];
  concern?: string;
  findings?: string;
  diagnosis?: string;
  notes?: string;
  appointmentId?: string | null;
}
