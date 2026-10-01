"use client";
import { useState } from "react";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { SkeletonList } from "@/components/Skeleton";
import type { RecordType, SurfaceId } from "@/lib/derm/regions";
import type { DermAssessment } from "@/lib/derm/types";
import type { TimelineEvent, TimelineKind } from "@/lib/derm/treatmentTypes";
import { useDermTimeline } from "@/lib/derm/treatmentHooks";
import { AssessmentCard } from "../AssessmentHistory";
import { RecordTypeBadge, RegionChip, fmtDateTime } from "../dermUi";
import FollowUpCard from "./FollowUpCard";
import { TargetChips, visitText, useProcLabel } from "./shared";

const GLYPH: Record<string, string> = { planned: "○", started: "◆", session: "▸", completed: "✓", cancelled: "✕" };

interface Props {
  patientId: string;
  canWrite: boolean;
  /** Area History: only events of this anatomical region. Omit for the patient timeline. */
  regionId?: string;
  onSelectRegion?: (id: string, surface?: SurfaceId) => void;
  onAddTreatment?: (a: DermAssessment) => void;
  onViewMap?: (ids: string[]) => void;
}

/**
 * ONE normalised, read-only timeline for the patient (or one region = Area History): assessments, treatment plan events,
 * sessions and follow-ups, newest first, keyset-paginated. It only presents what the other records already hold — nothing is
 * rewritten, and the diagnosis stays inside the assessment where the clinician entered it.
 * Filters: All / Assessment / Treatment / Follow-Up  ×  All types / Dermatology / Aesthetic.
 */
export default function UnifiedTimeline({ patientId, canWrite, regionId, onSelectRegion, onAddTreatment, onViewMap }: Props) {
  const { t, lang } = useI18n();
  const procLabel = useProcLabel();
  const [kind, setKind] = useState<TimelineKind>("all");
  const [type, setType] = useState<RecordType | "all">("all");
  const [voided, setVoided] = useState(false);
  const q = useDermTimeline(patientId, { kind, recordType: type === "all" ? undefined : type, regionId, includeVoided: voided });
  const events: TimelineEvent[] = (q.data?.pages ?? []).flatMap((p) => p.events);
  const visits = Object.assign({}, ...(q.data?.pages ?? []).map((p) => p.visits));
  const chip = (on: boolean) => `rounded-lg border px-2.5 py-1 text-[11px] font-medium ${on ? "border-teal bg-teal/15 text-teal" : "border-edge bg-soft text-mute hover:text-ink"}`;

  return (
    <section aria-label={regionId ? t("dm.area.title") : t("dm.timeline.title")} className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("dt.tl.kind")}>
        {(["all", "assessment", "treatment", "follow_up"] as const).map((k) => <button key={k} type="button" aria-pressed={kind === k} className={chip(kind === k)} onClick={() => setKind(k)}>{t(`dt.tl.k.${k}`)}</button>)}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("dm.form.type")}>
        {(["all", "dermatology", "aesthetic"] as const).map((k) => <button key={k} type="button" aria-pressed={type === k} className={chip(type === k)} onClick={() => setType(k)}>{k === "all" ? t("dt.tl.allTypes") : t(`dm.type.${k}`)}</button>)}
        <label className="ms-auto flex items-center gap-1.5 text-[11px] text-mute"><input type="checkbox" className="accent-teal" checked={voided} onChange={(e) => setVoided(e.target.checked)} />{t("dm.showVoided")}</label>
      </div>

      {q.isLoading && <SkeletonList rows={3} />}
      {q.isError && (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          <IconAlertTriangle size={13} className="me-1 inline" />{t("dm.err.load")}
          <button type="button" className="ms-2 inline-flex items-center gap-1 underline" onClick={() => void q.refetch()}><IconRefresh size={12} />{t("dm.retry")}</button>
        </div>
      )}
      {!q.isLoading && !q.isError && events.length === 0 && <p className="rounded-xl border border-dashed border-edge p-4 text-center text-xs text-mute">{regionId ? t("dm.area.empty") : t("dm.timeline.empty")}</p>}

      <div className="space-y-2">
        {events.map((e) => {
          if (e.kind === "assessment" && e.assessment) {
            return <AssessmentCard key={e.key} a={e.assessment} patientId={patientId} canWrite={canWrite} onSelectRegion={onSelectRegion} highlightRegionId={regionId} onAddTreatment={onAddTreatment} />;
          }
          if (e.kind === "follow_up" && e.followUp) {
            return <FollowUpCard key={e.key} f={e.followUp} patientId={patientId} canWrite={canWrite} onViewMap={onViewMap} />;
          }
          const tr = e.treatment ?? (e.session ? { itemId: e.session.itemId, recordType: e.session.recordType, procedureCode: e.session.procedureCode, targetType: e.session.targetType, regions: e.session.regions, generalArea: e.session.generalArea, priority: "normal" as const, phase: 1 } : null);
          if (!tr) return null;
          const s = e.session;
          return (
            <div key={e.key} className="flex items-start gap-2 rounded-xl border border-edge bg-card2 px-3 py-2">
              <span aria-hidden className="mt-0.5 w-3 shrink-0 text-center text-[12px] text-teal">{GLYPH[e.event] ?? "•"}</span>
              <div className="min-w-0 flex-1 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <RecordTypeBadge type={tr.recordType} />
                  <span className="font-medium text-ink">{t(`dt.ev.${e.event}`)}{s ? ` ${s.sessionNumber}` : ""} — {procLabel(tr.procedureCode)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {tr.regions.length ? tr.regions.map((r) => <RegionChip key={r.id} id={r.id} surface={r.surface} onClick={onSelectRegion ? () => onSelectRegion(r.id, r.surface) : undefined} />) : <TargetChips targetType="general" regions={[]} generalArea={tr.generalArea} />}
                </div>
                {s?.procedureNotes && <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-mute">{s.procedureNotes}</p>}
                {s?.outcome && <p className="mt-0.5 text-mute">{t("dt.session.outcome")}: {s.outcome}</p>}
                {e.note && <p className="mt-0.5 italic text-mute">{e.note}</p>}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[10px] text-mute">
                  <span>{fmtDateTime(e.at, lang)}</span>
                  {(s?.performedBy ?? e.by) && <span>{(s?.performedBy ?? e.by)!.name}</span>}
                  {e.appointmentId && visits[e.appointmentId] && <span>{visitText(visits[e.appointmentId], lang, t("dt.walkIn"))}</span>}
                  {onViewMap && tr.regions.length > 0 && <button type="button" className="text-teal underline" onClick={() => onViewMap(tr.regions.map((r) => r.id))}>{t("dt.viewMap")}</button>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {q.hasNextPage && <button type="button" className="btn-ghost w-full" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>{q.isFetchingNextPage ? t("common.loading") : t("dm.loadMore")}</button>}
    </section>
  );
}
