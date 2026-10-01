"use client";
import { useState } from "react";
import Modal from "@/components/Modal";
import { useI18n } from "@/lib/i18n";
import { useDermBridge } from "@/store/dermBridge";
import type { DermAssessment } from "@/lib/derm/types";
import TreatmentForm from "./TreatmentForm";
import UnifiedTimeline from "./UnifiedTimeline";

interface Props {
  patientId: string;
  canWrite: boolean;
  /** Parent-owned tab switches of the Patient Profile. */
  onOpenMap: () => void;
  onOpenPlan: () => void;
}

/**
 * "History" tab: the patient's unified Dermatology & Aesthetics timeline (assessments, treatment events, sessions,
 * follow-ups). Plain 2D. Selecting a region or "View on map" hands the regions to the SAME 3D map through the bridge;
 * "Add treatment" on an assessment opens the editor with that assessment's regions / record type / diagnosis carried over.
 */
export default function DermHistoryTab({ patientId, canWrite, onOpenMap, onOpenPlan }: Props) {
  const { t } = useI18n();
  const requestFocus = useDermBridge((s) => s.requestFocus);
  const [from, setFrom] = useState<DermAssessment | null>(null);
  const viewOnMap = (ids: string[]) => { if (!ids.length) return; requestFocus(patientId, ids); onOpenMap(); };
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-ink">{t("dt.history.title")}</h3>
      <UnifiedTimeline patientId={patientId} canWrite={canWrite} onSelectRegion={(id) => viewOnMap([id])} onViewMap={viewOnMap} onAddTreatment={(a) => setFrom(a)} />
      {from && (
        <Modal title={t("dt.form.title")} size="lg" onClose={() => setFrom(null)}>
          <div className="px-5 py-4">
            <TreatmentForm patientId={patientId} mode="create" prefill={{ regions: from.regions.map((r) => (r.surface ? { id: r.id, surface: r.surface } : { id: r.id })), assessment: from, recordType: from.recordType }}
              onSaved={() => { setFrom(null); onOpenPlan(); }} onCancel={() => setFrom(null)} />
          </div>
        </Modal>
      )}
    </div>
  );
}
