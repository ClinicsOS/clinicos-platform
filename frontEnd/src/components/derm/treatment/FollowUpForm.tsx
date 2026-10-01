"use client";
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/Toast";
import type { Appointment } from "@/lib/types";
import type { DermAssessment } from "@/lib/derm/types";
import { FOLLOWUP_OUTCOMES, MAX_FOLLOWUP_TEXT, type FollowUpOutcome } from "@/lib/derm/procedures";
import type { FollowUp, TreatmentItem, TreatmentSession } from "@/lib/derm/treatmentTypes";
import { newRequestId } from "@/lib/derm/hooks";
import { useCreateFollowUp } from "@/lib/derm/treatmentHooks";
import { RegionChip, fmtDateTime } from "../dermUi";
import { treatmentErrorKey, useProcLabel, useTargetText } from "./shared";

interface Props {
  patientId: string;
  /** What the follow-up is about (at least one). A session implies its treatment. */
  item?: TreatmentItem | null;
  sessions?: TreatmentSession[];
  assessment?: DermAssessment | null;
  onSaved: (f: FollowUp) => void;
  onCancel: () => void;
}

const TEXTS = [
  ["clinicianAssessment", "dt.fu.assessment", MAX_FOLLOWUP_TEXT.assessment, 72],
  ["progress", "dt.fu.progress", MAX_FOLLOWUP_TEXT.progress, 56],
  ["complications", "dt.fu.complications", MAX_FOLLOWUP_TEXT.complications, 56],
  ["notes", "dt.fu.notes", MAX_FOLLOWUP_TEXT.notes, 48],
  ["nextStep", "dt.fu.nextStep", MAX_FOLLOWUP_TEXT.nextStep, 48],
] as const;

/**
 * A clinical review after an assessment / treatment / session. Everything here is typed or chosen by the clinician: the
 * outcome is an explicit choice (or left empty), nothing is scored or interpreted, and no next date is suggested.
 * The session shown is only the treatment's most recent one (a default the clinician can change); the visit is optional
 * and must be an EXISTING visit.
 */
export default function FollowUpForm({ patientId, item, sessions = [], assessment, onSaved, onCancel }: Props) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const procLabel = useProcLabel();
  const targetText = useTargetText();
  const create = useCreateFollowUp(patientId);
  const mine = useMemo(() => (item ? sessions.filter((s) => s.itemId === item._id).sort((a, b) => b.sessionNumber - a.sessionNumber) : []), [sessions, item]);
  const [sessionId, setSessionId] = useState<string>(mine[0]?._id ?? "");
  const [visitId, setVisitId] = useState("");
  const [outcome, setOutcome] = useState<FollowUpOutcome | "">("");
  const [v, setV] = useState({ clinicianAssessment: "", progress: "", complications: "", notes: "", nextStep: "" });
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(newRequestId());
  const lastSig = useRef("");

  const apptQ = useQuery({
    queryKey: ["patient-appointments", patientId],
    queryFn: async () => (await api.get<Appointment[]>(`/appointments?patientId=${patientId}`)).data,
    enabled: !!patientId,
  });
  const visits = (apptQ.data ?? []).filter((a) => a.type !== "blocked" && a.status !== "cancelled" && a.status !== "no_show");
  const empty = !outcome && !Object.values(v).some((x) => x.trim());

  const regions = item ? (mine.find((s) => s._id === sessionId)?.treatedRegions?.length ? mine.find((s) => s._id === sessionId)!.treatedRegions : item.regions) : assessment?.regions ?? [];
  const general = !!item && item.targetType === "general" && regions.length === 0;

  const submit = async () => {
    setTouched(true); setError(null);
    if (empty) return;
    const body = {
      itemId: item?._id ?? null, sessionId: sessionId || null, assessmentId: !item ? assessment?._id ?? null : null,
      appointmentId: visitId || null, outcome: outcome || null, ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim()])),
    };
    const sig = JSON.stringify(body);
    if (sig !== lastSig.current) { reqId.current = newRequestId(); lastSig.current = sig; }
    try {
      const r = await create.mutateAsync({ clientRequestId: reqId.current, ...body });
      toast.success(t("dt.fu.saved"));
      onSaved(r.followUp);
    } catch (e) { setError(t(treatmentErrorKey(e))); }
  };

  return (
    <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }} aria-label={t("dt.fu.title")}>
      <div className="rounded-xl border border-edge bg-soft px-3 py-2 text-[11px]">
        <div className="font-medium text-ink">{item ? procLabel(item.procedureCode) : t("dt.fu.onAssessment")}</div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {general ? <span className="text-mute">{item ? targetText(item) : ""}</span> : regions.map((r) => <RegionChip key={r.id} id={r.id} surface={r.surface} />)}
        </div>
      </div>

      {item && mine.length > 0 && (
        <div>
          <label className="lbl" htmlFor="fu-session">{t("dt.fu.session")}</label>
          <select id="fu-session" className="inp" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
            <option value="">{t("dt.fu.wholeTreatment")}</option>
            {mine.map((s) => <option key={s._id} value={s._id}>{t("dt.session.no").replace("{n}", String(s.sessionNumber))} · {fmtDateTime(s.startedAt, lang)}</option>)}
          </select>
        </div>
      )}

      <div>
        <div className="lbl">{t("dt.fu.outcome")}</div>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("dt.fu.outcome")}>
          {["", ...FOLLOWUP_OUTCOMES].map((o) => (
            <button key={o || "none"} type="button" role="radio" aria-checked={outcome === o} onClick={() => setOutcome(o as FollowUpOutcome | "")}
              className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${outcome === o ? "border-teal bg-teal/15 text-ink" : "border-edge bg-soft text-mute hover:text-ink"}`}>
              {o ? t(`dt.fu.o.${o}`) : t("dt.fu.o.none")}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-mute">{t("dt.fu.outcomeNote")}</p>
      </div>

      {TEXTS.map(([k, lk, max, h]) => (
        <div key={k}>
          <div className="flex items-center justify-between"><label className="lbl" htmlFor={`fu-${k}`}>{t(lk)}</label><span className="text-[10px] text-mute">{v[k].length}/{max}</span></div>
          <textarea id={`fu-${k}`} className="inp" style={{ minHeight: h }} maxLength={max} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
        </div>
      ))}

      <div>
        <label className="lbl" htmlFor="fu-visit">{t("dt.fu.visit")}</label>
        <select id="fu-visit" className="inp" value={visitId} onChange={(e) => setVisitId(e.target.value)}>
          <option value="">{t("dm.form.noVisit")}</option>
          {visits.map((a) => <option key={a._id} value={a._id}>{fmtDateTime(a.startAt, lang)}{a.source === "walk_in" ? ` · ${t("dt.walkIn")}` : ""}</option>)}
        </select>
        <p className="mt-1 text-[10px] text-mute">{t("dm.form.visitNote")}</p>
      </div>

      {touched && empty && <p className="text-[11px] text-red-400" role="alert">{t("dt.err.emptyFollowUp")}</p>}
      {error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={create.isPending}>{t("dm.cancel")}</button>
        <button type="submit" className="btn-teal" disabled={create.isPending}>{create.isPending ? t("dm.saving") : t("dm.save")}</button>
      </div>
    </form>
  );
}
