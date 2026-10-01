"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { IconCalendarPlus, IconCircleCheck, IconPlayerPlay } from "@tabler/icons-react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/Toast";
import type { Appointment } from "@/lib/types";
import { regionLabel } from "@/lib/derm/regions";
import type { DermRegionRef } from "@/lib/derm/types";
import { MAX_SESSION_TEXT, getProcedure } from "@/lib/derm/procedures";
import { DOC_FIELDS, docFieldLabelKey, docGroupLabelKey, groupsFor } from "@/lib/derm/documentation";
import type { DeviceInfo, ProductInfo, SessionFieldsInput, TreatmentItem, TreatmentSession } from "@/lib/derm/treatmentTypes";
import { useCompleteTreatment, useEndSession, useSaveSession, useStartTreatment } from "@/lib/derm/treatmentHooks";
import RegionList from "../RegionList";
import { RegionChip, fmtDate, fmtDateTime } from "../dermUi";
import { scheduleNextVisitHref, treatmentErrorKey, useProcLabel, useTargetText } from "./shared";

interface Props {
  patientId: string;
  patientName: string;
  item: TreatmentItem;
  sessions: TreatmentSession[];
  currentDoctorId?: string;
  onClose: () => void;
}

const usable = (a: Appointment) => a.type !== "blocked" && a.status !== "cancelled" && a.status !== "no_show";
const dayKey = (iso: string) => new Date(iso).toDateString();

function Counter({ v, max }: { v: string; max: number }) {
  return <span className={`text-[10px] ${v.length > max * 0.9 ? "text-amber-400" : "text-mute"}`}>{v.length}/{max}</span>;
}

/**
 * Sessions of ONE treatment. A session always belongs to an EXISTING visit (scheduled or walk-in): if the patient has no
 * usable visit the clinician is sent to create/open one — a visit is never invented here. The two closing actions are
 * deliberately separate and named for what they do:
 *   END THIS SESSION  — this visit's work is finished; the treatment stays IN_PROGRESS (more sessions expected)
 *   COMPLETE TREATMENT — the whole treatment item is finished
 * Session notes are procedure-specific; the visit's own notes are a different field and are not touched here.
 */
export default function SessionPanel({ patientId, patientName, item, sessions, currentDoctorId, onClose }: Props) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const procLabel = useProcLabel();
  const targetText = useTargetText();
  const proc = getProcedure(item.procedureCode);
  const start = useStartTreatment(patientId);
  const save = useSaveSession(patientId);
  const end = useEndSession(patientId);
  const complete = useCompleteTreatment(patientId);
  const busy = start.isPending || save.isPending || end.isPending || complete.isPending;

  // Same query key the map tab and the appointments screens already use -> shared cache, no extra request.
  const apptQ = useQuery({
    queryKey: ["patient-appointments", patientId],
    queryFn: async () => (await api.get<Appointment[]>(`/appointments?patientId=${patientId}`)).data,
    enabled: !!patientId,
  });
  const mine = useMemo(() => sessions.filter((s) => s.itemId === item._id), [sessions, item._id]);
  const visits = useMemo(() => {
    const now = Date.now();
    // today's / most recent first: the visit the doctor is most likely in right now sits on top
    return (apptQ.data ?? []).filter(usable).sort((a, b) => Math.abs(new Date(a.startAt).getTime() - now) - Math.abs(new Date(b.startAt).getTime() - now));
  }, [apptQ.data]);

  const openSession = mine.find((s) => s.status === "in_progress");
  const [visitId, setVisitId] = useState<string>("");
  useEffect(() => {
    if (visitId) return;
    const pick = openSession?.appointmentId ?? visits.find((v) => dayKey(v.startAt) === new Date().toDateString())?._id ?? visits[0]?._id ?? "";
    if (pick) setVisitId(pick);
  }, [visits, openSession, visitId]);

  const session = mine.find((s) => s.appointmentId === visitId) ?? null;
  const [done, setDone] = useState<null | "ended" | "completed">(null);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- form state (initialised from the session whenever another session is shown)
  const [f, setF] = useState({ procedureNotes: "", observations: "", outcome: "", followUpInstructions: "", followUpDueAt: "" });
  const [treated, setTreated] = useState<DermRegionRef[]>([]);
  const [product, setProduct] = useState<ProductInfo>({});
  const [device, setDevice] = useState<DeviceInfo>({});
  const [pickTreated, setPickTreated] = useState(false);
  useEffect(() => {
    setF({
      procedureNotes: session?.procedureNotes ?? "", observations: session?.observations ?? "", outcome: session?.outcome ?? "",
      followUpInstructions: session?.followUpInstructions ?? "", followUpDueAt: session?.followUpDueAt ? session.followUpDueAt.slice(0, 10) : "",
    });
    setTreated(session?.treatedRegions ?? []);
    setProduct(session?.product ?? {});
    setDevice(session?.device ?? {});
    setError(null); setConfirmComplete(false);
  }, [session?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fields = (): SessionFieldsInput => ({
    procedureNotes: f.procedureNotes, observations: f.observations, outcome: f.outcome, followUpInstructions: f.followUpInstructions,
    followUpDueAt: f.followUpDueAt || null,
    treatedRegions: item.targetType === "general" && treated.length === 0 ? [] : treated,
    product: proc && groupsFor(proc.metadata).includes("product") ? product : undefined,
    device: proc && groupsFor(proc.metadata).includes("device") ? device : undefined,
  });

  const run = async (fn: () => Promise<unknown>, ok?: () => void) => {
    setError(null);
    try { await fn(); ok?.(); } catch (e) { setError(t(treatmentErrorKey(e))); }
  };

  const noVisit = !apptQ.isLoading && visits.length === 0;
  const isOpen = session?.status === "in_progress";
  const isEnded = session?.status === "ended";
  const itemClosed = item.status === "completed" || item.status === "cancelled";
  const visitLabel = (a: Appointment) => `${fmtDateTime(a.startAt, lang)} · ${a.source === "walk_in" ? t("dt.walkIn") : t(`status.${a.status}`) === `status.${a.status}` ? a.status : t(`status.${a.status}`)}`;

  const nextHref = scheduleNextVisitHref(t, { patientId, patientName, procedure: procLabel(item.procedureCode), target: targetText(item), currentDoctorId });

  if (done) {
    return (
      <div className="space-y-3 text-center" role="status">
        <IconCircleCheck size={34} className="mx-auto text-emerald-400" />
        <div className="text-sm font-medium text-ink">{t(done === "ended" ? "dt.session.endedTitle" : "dt.session.completedTitle")}</div>
        <p className="text-xs text-mute">{t(done === "ended" ? "dt.session.endedBody" : "dt.session.completedBody")}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {done === "ended" && <Link href={nextHref} className="btn-teal inline-flex items-center gap-1"><IconCalendarPlus size={14} />{t("dt.scheduleNext")}</Link>}
          <button type="button" className="btn-ghost" onClick={onClose}>{t("dt.close")}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-edge bg-soft px-3 py-2">
        <div className="text-xs font-medium text-ink">{procLabel(item.procedureCode)}</div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {item.targetType === "general" || !item.regions.length
            ? <span className="text-[11px] text-mute">{targetText(item)}</span>
            : item.regions.map((r) => <RegionChip key={r.id} id={r.id} surface={r.surface} />)}
        </div>
        <div className="mt-1 text-[11px] text-mute">{t("dt.session.count").replace("{n}", String(mine.length))}</div>
      </div>

      {/* 1. the EXISTING visit */}
      <div>
        <label className="lbl" htmlFor="dt-visit">{t("dt.session.visit")}</label>
        {apptQ.isLoading ? <p className="text-xs text-mute">{t("common.loading")}</p> : noVisit ? (
          <div className="rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-100">
            <p>{t("dt.session.noVisit")}</p>
            <Link href={`/appointments?schedule=${patientId}&name=${encodeURIComponent(patientName)}`} className="mt-2 inline-flex items-center gap-1 text-teal underline"><IconCalendarPlus size={13} />{t("dt.session.openVisits")}</Link>
          </div>
        ) : (
          <>
            <select id="dt-visit" className="inp" value={visitId} onChange={(e) => { setVisitId(e.target.value); setDone(null); }} disabled={busy}>
              {visits.map((v) => <option key={v._id} value={v._id}>{visitLabel(v)}{mine.some((s) => s.appointmentId === v._id) ? ` · ${t("dt.session.hasSession")}` : ""}</option>)}
            </select>
            <p className="mt-1 text-[10px] text-mute">{t("dt.session.visitNote")}</p>
          </>
        )}
      </div>

      {/* 2. start / continue */}
      {!session && !noVisit && !itemClosed && visitId && (
        <button type="button" className="btn-teal inline-flex w-full items-center justify-center gap-1.5" disabled={busy}
          onClick={() => void run(() => start.mutateAsync({ itemId: item._id, appointmentId: visitId }), () => toast.success(t("dt.session.started")))}>
          <IconPlayerPlay size={14} />{start.isPending ? t("dm.saving") : t(item.status === "planned" ? "dt.start" : "dt.continue")}
        </button>
      )}
      {!session && itemClosed && <p className="text-xs text-mute">{t("dt.session.itemClosed")}</p>}

      {/* 3. the session */}
      {session && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-mute">
            <span className="rounded-full bg-teal/15 px-2 py-0.5 font-medium text-teal">{t("dt.session.no").replace("{n}", String(session.sessionNumber))}</span>
            <span>{isOpen ? t("dt.session.open") : t("dt.session.ended")}{session.autoClosed ? ` · ${t("dt.session.auto")}` : ""}</span>
            {session.performedBy && <span>· {session.performedBy.name}</span>}
          </div>

          {/* treated regions */}
          <div>
            <div className="lbl">{t("dt.session.treated")}</div>
            <div className="flex flex-wrap gap-1.5">
              {treated.length === 0 && <span className="text-[11px] text-mute">{item.targetType === "general" ? t("dt.session.treatedGeneral") : "—"}</span>}
              {treated.map((r) => (
                <RegionChip key={r.id} id={r.id} surface={r.surface}
                  onRemove={isOpen && (item.targetType === "general" || treated.length > 1) ? () => setTreated((c) => c.filter((x) => x.id !== r.id)) : undefined} />
              ))}
            </div>
            {isOpen && item.targetType !== "general" && item.regions.filter((r) => !treated.some((x) => x.id === r.id)).length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {item.regions.filter((r) => !treated.some((x) => x.id === r.id)).map((r) => (
                  <button key={r.id} type="button" className="rounded-full border border-dashed border-edge px-2 py-0.5 text-[10px] text-mute hover:text-ink" onClick={() => setTreated((c) => [...c, r])}>+ <RegionChipText id={r.id} surface={r.surface} /></button>
                ))}
              </div>
            )}
            {isOpen && item.targetType === "general" && (
              <>
                <button type="button" className="mt-1 text-[11px] text-blue hover:underline" onClick={() => setPickTreated((p) => !p)}>{t("dt.session.addTreated")}</button>
                {pickTreated && <RegionList className="mt-1" selected={treated.map((r) => r.id)} onToggle={(id) => setTreated((c) => (c.some((r) => r.id === id) ? c.filter((r) => r.id !== id) : [...c, { id }].slice(0, 12)))} />}
              </>
            )}
          </div>

          <fieldset disabled={!isOpen || busy} className="space-y-3">
            <div>
              <div className="flex items-center justify-between"><label className="lbl" htmlFor="dt-pn">{t("dt.session.notes")}</label><Counter v={f.procedureNotes} max={MAX_SESSION_TEXT.procedureNotes} /></div>
              <textarea id="dt-pn" className="inp min-h-[72px]" maxLength={MAX_SESSION_TEXT.procedureNotes} value={f.procedureNotes} onChange={(e) => setF({ ...f, procedureNotes: e.target.value })} placeholder={t("dt.session.notesHint")} />
              <p className="mt-0.5 text-[10px] text-mute">{t("dt.session.notesNote")}</p>
            </div>
            <div>
              <div className="flex items-center justify-between"><label className="lbl" htmlFor="dt-ob">{t("dt.session.observations")}</label><Counter v={f.observations} max={MAX_SESSION_TEXT.observations} /></div>
              <textarea id="dt-ob" className="inp min-h-[56px]" maxLength={MAX_SESSION_TEXT.observations} value={f.observations} onChange={(e) => setF({ ...f, observations: e.target.value })} />
            </div>
            <div>
              <div className="flex items-center justify-between"><label className="lbl" htmlFor="dt-oc">{t("dt.session.outcome")}</label><Counter v={f.outcome} max={MAX_SESSION_TEXT.outcome} /></div>
              <textarea id="dt-oc" className="inp min-h-[48px]" maxLength={MAX_SESSION_TEXT.outcome} value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })} />
            </div>

            {/* Documentation groups come from the ONE central config (lib/derm/documentation.ts): this form hard-codes no procedure logic. */}
            {proc && groupsFor(proc.metadata).map((g) => {
              const val = (g === "product" ? product : device) as Record<string, string | undefined>;
              const setVal = (key: string, v: string) => (g === "product" ? setProduct({ ...product, [key]: v }) : setDevice({ ...device, [key]: v }));
              return (
                <div key={g} className="rounded-xl border border-edge p-2.5" data-doc-group={g}>
                  <div className="lbl">{t(docGroupLabelKey(g))}</div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {DOC_FIELDS[g].map((fld) => {
                      const label = t(docFieldLabelKey(g, fld.key));
                      const wide = fld.kind === "textarea" ? "sm:col-span-2" : "";
                      return fld.kind === "textarea"
                        ? <textarea key={fld.key} className={`inp min-h-[44px] ${wide}`} aria-label={label} placeholder={label} maxLength={fld.max} value={val[fld.key] ?? ""} onChange={(e) => setVal(fld.key, e.target.value)} />
                        : <input key={fld.key} className={`inp ${wide}`} type={fld.kind === "date" ? "date" : "text"} aria-label={label} title={label} placeholder={fld.kind === "date" ? undefined : label} maxLength={fld.kind === "date" ? undefined : fld.max} value={val[fld.key] ?? ""} onChange={(e) => setVal(fld.key, e.target.value)} />;
                    })}
                  </div>
                  <p className="mt-1 text-[10px] text-mute">{t("dt.trace.note")}</p>
                </div>
              );
            })}

            <div>
              <div className="flex items-center justify-between"><label className="lbl" htmlFor="dt-fi">{t("dt.session.instructions")}</label><Counter v={f.followUpInstructions} max={MAX_SESSION_TEXT.followUpInstructions} /></div>
              <textarea id="dt-fi" className="inp min-h-[44px]" maxLength={MAX_SESSION_TEXT.followUpInstructions} value={f.followUpInstructions} onChange={(e) => setF({ ...f, followUpInstructions: e.target.value })} />
            </div>
            <div>
              <label className="lbl" htmlFor="dt-fd">{t("dt.session.reviewDate")}</label>
              <input id="dt-fd" className="inp" type="date" value={f.followUpDueAt} onChange={(e) => setF({ ...f, followUpDueAt: e.target.value })} />
              <p className="mt-0.5 text-[10px] text-mute">{t("dt.session.reviewNote")}</p>
            </div>
          </fieldset>

          {isEnded && (
            <div className="rounded-lg bg-soft px-3 py-2 text-[11px] text-mute">
              {t("dt.session.endedAt").replace("{d}", session.endedAt ? fmtDateTime(session.endedAt, lang) : "—")}
              {session.followUpDueAt && <> · {t("dt.session.reviewOn").replace("{d}", fmtDate(session.followUpDueAt, lang))}</>}
            </div>
          )}

          {error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

          {/* 4. the two closing actions — never merged */}
          {confirmComplete ? (
            <div className="space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
              <p className="text-xs text-emerald-100">{t("dt.complete.confirm")}</p>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => setConfirmComplete(false)}>{t("dm.cancel")}</button>
                <button type="button" className="btn-teal" disabled={busy}
                  onClick={() => void run(() => complete.mutateAsync({ itemId: item._id, appointmentId: visitId, ...(isOpen ? fields() : {}) }), () => setDone("completed"))}>
                  {complete.isPending ? t("dm.saving") : t("dt.complete")}
                </button>
              </div>
            </div>
          ) : (item.status === "in_progress" && (isOpen || isEnded)) && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-edge pt-3">
              {isOpen && (
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => void run(() => save.mutateAsync({ sessionId: session._id, ...fields() }), () => toast.success(t("dt.session.saved")))}>
                  {save.isPending ? t("dm.saving") : t("dt.session.saveDraft")}
                </button>
              )}
              {isOpen && (
                <button type="button" className="btn-ghost !border-teal !text-teal" disabled={busy} title={t("dt.endSession.tip")}
                  onClick={() => void run(() => end.mutateAsync({ itemId: item._id, appointmentId: visitId, ...fields() }), () => setDone("ended"))}>
                  {end.isPending ? t("dm.saving") : t("dt.endSession")}
                </button>
              )}
              <button type="button" className="btn-teal" disabled={busy} title={t("dt.complete.tip")} onClick={() => setConfirmComplete(true)}>{t("dt.complete")}</button>
            </div>
          )}
          {isOpen && item.status === "in_progress" && !confirmComplete && <p className="text-[10px] text-mute">{t("dt.endVsComplete")}</p>}
        </div>
      )}
    </div>
  );
}

function RegionChipText({ id }: { id: string; surface?: DermRegionRef["surface"] }) {
  const { lang } = useI18n();
  // plain inline label (no nested interactive element inside the "+" button)
  return <span>{regionLabel(id, lang)}</span>;
}
