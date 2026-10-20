"use client";
import { useEffect, useState } from "react";
import { IconX, IconFocus2, IconPlus, IconHistory, IconArrowBackUp, IconAlertTriangle, IconArrowRight, IconTargetArrow, IconTargetOff } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { errMsg } from "@/lib/api";
import { useToast } from "@/components/Toast";
import Modal from "@/components/Modal";
import { getToothMeta, slotVariants, toothName, type DentitionType } from "@/lib/dental/fdi";
import { SURFACES, findItem, taxonomyFor, type EventCategory, type SurfaceId } from "@/lib/dental/taxonomy";
import type { DentalEvent, TimelineEntry, ToothVisualState, TreatmentItem, VisitRef } from "@/lib/dental/types";
import { getSurfaceOrientation, surfaceLabel } from "@/lib/dental/surfaces";
import { deriveToothMarks } from "@/lib/dental/toothMarks";
import { STATE_TOKENS, stateChipStyle } from "@/lib/dental/visualTheme";
import ToothCross from "./ToothCross";
import { procLabel } from "@/lib/dental/procedures";
import type { EditorPrefill } from "./treatment/TreatmentEditor";
import { BillingLine, ProcSwatch, StatusPill, TargetText, TimelineRow, money } from "./treatment/shared";
import { useAddDentalEvent, useResolveDentalEvent } from "@/lib/dental/hooks";
import { useFocusTarget } from "@/lib/history/focus";

interface Props {
  fdi: string;
  dentition: DentitionType;
  events: DentalEvent[]; // every event (any status) for THIS tooth
  patientId: string;
  canWrite: boolean;
  can3D: boolean;
  focusing: boolean;
  variant: "side" | "sheet" | "inline";
  onClose: () => void;
  onFocus: () => void;
  onBack: () => void;
  /** Mixed dentition: which teeth the chart shows now + a way to change the tooth in this position. */
  mixed?: boolean;
  shownTeeth?: readonly string[];
  onChooseTooth?: (fdi: string) => void;
  choosing?: boolean;
  /** Phase 3: treatment items + treatment history (derived from plan items/sessions) that target THIS tooth. */
  plan?: readonly TreatmentItem[];
  treatmentEntries?: TimelineEntry[];
  visits?: Record<string, VisitRef>;
  onAddTreatment?: (prefill: EditorPrefill) => void;
  onOpenPlan?: () => void;
  /** Phase 4: opens the ONE Add-to-Invoice confirmation for a completed treatment. */
  onBill?: (item: TreatmentItem) => void;
  /** Phase 3 deep link: the chart entry (note) to show, and the surface to emphasise. */
  focusEventId?: string;
  focusSurface?: string;
  /** PHASE 5 — the derived chart state of THIS tooth (same object the 2D and 3D charts draw) + the shared selected SURFACE. */
  visual?: ToothVisualState;
  surface?: SurfaceId | null;
  onSurface?: (s: SurfaceId | null) => void;
  /** 3D isolation of this tooth (neighbours fade away so Mesial / Distal are visible). */
  isolated?: boolean;
  onIsolate?: (on: boolean) => void;
}

const chip = (on: boolean) =>
  `rounded-lg border px-2 py-1.5 text-start text-[11px] leading-tight transition-colors ${
    on ? "border-teal bg-teal/15 text-teal" : "border-edge bg-card2 text-ink hover:border-sky"
  }`;

const SurfacePills = ({ s, focus, fdi }: { s: SurfaceId[]; focus?: string; fdi?: string }) =>
  s.length ? (
    <span className="ms-1 inline-flex gap-0.5" dir="ltr">
      {s.map((x) => (
        <span key={x} data-surface={x} data-surface-focus={focus === x ? "true" : undefined}
          className={`rounded px-1 font-mono text-[9px] ${focus === x ? "bg-teal/25 text-teal ring-1 ring-teal" : "bg-sky/15 text-sky"}`}>{surfaceLabel(fdi, x)}</span>
      ))}
    </span>
  ) : null;

export default function ToothPanel(p: Props) {
  const { t, lang } = useI18n();
  const meta = getToothMeta(p.fdi);
  const [adding, setAdding] = useState<EventCategory | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  // Deep link to a chart note: open the full tooth history (where the note lives) as soon as the linked entry belongs to this tooth.
  const linkedHere = !!p.focusEventId && p.events.some((e) => e._id === p.focusEventId);
  useEffect(() => {
    if (linkedHere) setShowHistory(true);
  }, [linkedHere, p.focusEventId]);
  if (!meta) return null;

  const active = p.events.filter((e) => e.status === "active");
  const existing = active.filter((e) => e.category === "existing_condition");
  const diagnoses = active.filter((e) => e.category === "diagnosis");
  const surfaces = SURFACES.filter((s) => active.some((e) => e.surfaces.includes(s)));
  // Recent History / Full Tooth History = clinical events + treatment events for this tooth, newest first.
  const merged = [
    ...p.events.map((e) => ({ at: e.createdAt, e, tx: undefined as TimelineEntry | undefined })),
    ...(p.treatmentEntries ?? []).map((tx) => ({ at: tx.at, e: undefined as DentalEvent | undefined, tx })),
  ].sort((a, b) => +new Date(b.at) - +new Date(a.at));
  const planItems = (p.plan ?? []).filter((i) => i.status !== "cancelled");

  const wrap =
    p.variant === "side"
      ? "dn-panel-in absolute bottom-3 right-3 top-3 z-20 w-[300px]"
      : p.variant === "sheet"
      ? "dn-sheet-in fixed inset-x-0 bottom-0 z-drawer max-h-[68vh]"
      : "w-full";

  return (
    <aside data-testid="tooth-panel" data-fdi={p.fdi} dir={lang === "ar" ? "rtl" : "ltr"} className={wrap} aria-label={`${t("dn.tooth")} ${p.fdi}`}>
      <div className={`card flex max-h-full flex-col overflow-hidden shadow-2xl ${p.variant === "sheet" ? "rounded-b-none" : ""}`}>
        {/* header */}
        <div className="flex items-start gap-2 border-b border-edge px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-medium tracking-[0.14em] text-mute">
              {t("dn.tooth").toUpperCase()} <span className="font-mono text-[15px] text-teal" dir="ltr">{p.fdi}</span>
            </div>
            <div className="mt-0.5 text-[13px] font-medium text-ink">{toothName(meta, t)}</div>
          </div>
          <button type="button" onClick={p.onClose} aria-label={t("dn.close")} className="rounded-md p-1 text-mute hover:bg-soft hover:text-ink">
            <IconX size={15} />
          </button>
        </div>

        <div className="flex-1 space-y-3.5 overflow-y-auto px-3.5 py-3">
          <Inspector fdi={p.fdi} visual={p.visual} surface={p.surface ?? null} onSurface={p.onSurface} compact={p.variant === "sheet"} />

          <Section title={t("dn.existing")}>
            {existing.length ? existing.map((e) => (
              <div key={e._id} className="text-[12px] text-ink">
                • {t(`dn.c.${e.code}`)}<SurfacePills s={e.surfaces} focus={p.focusSurface} fdi={p.fdi} />
                {e.note && <div dir="auto" className="ms-3 text-[10px] text-mute">{e.note}</div>}
              </div>
            )) : <Empty>{t("dn.none")}</Empty>}
          </Section>

          <Section title={t("dn.diagnoses")} testId="tooth-panel-diagnoses">
            {diagnoses.length ? diagnoses.map((e) => (
              <div key={e._id} className="flex items-center gap-2 text-[12px] text-ink">
                <span className="min-w-0 flex-1"><span style={{ color: STATE_TOKENS.condition.css }} aria-hidden>●</span> {t(`dn.c.${e.code}`)}<SurfacePills s={e.surfaces} focus={p.focusSurface} fdi={p.fdi} />{e.note && <span dir="auto" className="block text-[10px] text-mute">{e.note}</span>}</span>
                {p.canWrite && p.onAddTreatment && (
                  <button type="button" className="shrink-0 rounded-md border border-edge px-1.5 py-0.5 text-[10px] text-sky hover:border-sky"
                    onClick={() => p.onAddTreatment?.({ fdi: p.fdi, surfaces: e.surfaces, diagnosisId: e._id, diagnosisLabel: t(`dn.c.${e.code}`) })}>{t("dn.plan.add")}</button>
                )}
              </div>
            )) : <Empty>{t("dn.none")}</Empty>}
          </Section>

          <Section title={t("dn.forTooth")} testId="tooth-panel-plan">
            {planItems.length ? planItems.map((i) => (
              <div key={i._id} data-testid="panel-tx" data-code={i.procedureCode} data-status={i.status} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-ink">
                <span className="inline-flex min-w-0 max-w-full items-start gap-1.5"><ProcSwatch code={i.procedureCode} status={i.status} /><span className="min-w-0 break-words">{procLabel(t, i)}</span></span>
                <span className="text-[11px] text-mute"><TargetText targetType={i.targetType} toothNumbers={i.toothNumbers.filter((f) => f !== p.fdi || i.targetType === "tooth" || i.targetType === "surface")} surfaces={i.surfaces} toothSurfaces={i.toothSurfaces} /></span>
                <StatusPill status={i.status} />
                {i.estimatedPrice != null && <span className="text-[10px] text-mute" dir="ltr">{money(i.estimatedPrice)}</span>}
                {i.status === "completed" && <div className="w-full"><BillingLine billing={i.billing} canBill={!!p.onBill} onAdd={() => p.onBill?.(i)} /></div>}
              </div>
            )) : <Empty>{t("dn.tt.none")}</Empty>}
            {p.onOpenPlan && (
              <button type="button" data-testid="panel-view-plan" onClick={p.onOpenPlan}
                className={`inline-flex items-center gap-1 text-[11px] font-medium text-sky hover:underline ${p.variant === "sheet" ? "min-h-[44px]" : ""}`}>{t("dn.viewPlan")} <IconArrowRight size={12} className="rtl-flip" aria-hidden /></button>
            )}
          </Section>

          {surfaces.length > 0 && (
            <Section title={t("dn.surfaces")}>
              <div className="flex flex-wrap gap-1" dir="ltr">
                {surfaces.map((s) => (
                  <span key={s} title={t(`dn.s.${s}`)} data-surface={s} data-surface-focus={p.focusSurface === s ? "true" : undefined}
                    className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${p.focusSurface === s ? "border-teal bg-teal/20 text-teal ring-1 ring-teal" : "border-sky/40 bg-sky/10 text-sky"}`}>{surfaceLabel(p.fdi, s)}</span>
                ))}
              </div>
            </Section>
          )}

          {/* quick actions */}
          {p.canWrite ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className={`btn-ghost min-w-[6.5rem] flex-1 !px-2 !py-1.5 text-[11px] ${adding === "existing_condition" ? "!border-teal !text-teal" : ""}`} onClick={() => setAdding(adding === "existing_condition" ? null : "existing_condition")}>
                  <IconPlus size={12} /> {t("dn.addExisting")}
                </button>
                <button type="button" className={`btn-ghost min-w-[6.5rem] flex-1 !px-2 !py-1.5 text-[11px] ${adding === "diagnosis" ? "!border-teal !text-teal" : ""}`} onClick={() => setAdding(adding === "diagnosis" ? null : "diagnosis")}>
                  <IconPlus size={12} /> {t("dn.addDiagnosis")}
                </button>
                {p.onAddTreatment && (
                  <button type="button" className="btn-ghost min-w-[6.5rem] flex-1 !px-2 !py-1.5 text-[11px]" onClick={() => p.onAddTreatment?.({ fdi: p.fdi })}>
                    <IconPlus size={12} /> {t("dn.plan.addShort")}
                  </button>
                )}
              </div>
              {adding && <AddEntry key={adding} category={adding} fdi={p.fdi} patientId={p.patientId} onDone={() => setAdding(null)} onCancel={() => setAdding(null)} />}
            </div>
          ) : (
            <div className="rounded-lg border border-edge bg-card2 px-2.5 py-2 text-[10px] text-mute">{t("dn.readOnly")}</div>
          )}

          {p.can3D && <p className="text-[9px] leading-relaxed text-mute">{t("dn.note3d")}</p>}

          {/* mixed dentition: which tooth is currently charted in this position (doctor's choice, history of both is kept) */}
          {p.mixed && p.onChooseTooth && slotVariants(meta).length > 1 && (
            <Section title={t("dn.position")}>
              <div className="flex gap-1.5">
                {slotVariants(meta).map((v) => {
                  const on = !!p.shownTeeth?.includes(v.fdi);
                  return (
                    <button key={v.fdi} type="button" disabled={!p.canWrite || p.choosing || on} aria-pressed={on} onClick={() => p.onChooseTooth?.(v.fdi)}
                      className={`${chip(on)} flex-1 text-center disabled:cursor-default`}>
                      {v.dentition === "primary" ? t("dn.showPrimary") : t("dn.showPermanent")} <span className="font-mono" dir="ltr">{v.fdi}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[9px] leading-relaxed text-mute">{t("dn.positionHint")}</p>
            </Section>
          )}

          {/* recent history (compact) + full tooth history */}
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-mute"><IconHistory size={12} /> {t("dn.recentHistory")}</div>
            {merged.length ? (
              <div className="space-y-1">
                {merged.slice(0, 3).map((h) => h.e ? (
                  <div key={h.e._id} className={`flex items-baseline gap-2 text-[11px] ${h.e.status === "resolved" ? "opacity-50" : ""}`}>
                    <span className="w-16 shrink-0 text-[10px] text-mute" dir="ltr">{shortWhen(h.e.createdAt, lang, t("dn.today"))}</span>
                    <span className="min-w-0 text-ink">{t(`dn.c.${h.e.code}`)}<SurfacePills s={h.e.surfaces} fdi={p.fdi} /></span>
                  </div>
                ) : (
                  <div key={h.tx!.id} className="flex items-baseline gap-2 text-[11px]">
                    <span className="w-16 shrink-0 text-[10px] text-mute" dir="ltr">{shortWhen(h.tx!.at, lang, t("dn.today"))}</span>
                    <span className="min-w-0 text-ink">{t(`dn.h.${h.tx!.kind}`)}{h.tx!.kind === "session" && h.tx!.sessionNumber ? ` ${h.tx!.sessionNumber}` : ""} — {procLabel(t, h.tx!)}</span>
                  </div>
                ))}
              </div>
            ) : <Empty>{t("dn.noHistory")}</Empty>}
            {merged.length > 0 && (
              <button type="button" onClick={() => setShowHistory(true)} className="mt-1.5 text-[11px] font-medium text-sky hover:underline">
                {t("dn.viewFullHistory")} ({merged.length})
              </button>
            )}
          </div>
        </div>

        {p.can3D && (
          <div className="flex flex-wrap gap-1.5 border-t border-edge px-3.5 py-2.5">
            {p.focusing && !p.isolated ? (
              <button type="button" className={`btn-ghost min-w-[6rem] flex-1 !py-1.5 text-[11px] ${p.variant === "sheet" ? "min-h-[44px]" : ""}`} onClick={p.onBack}><IconArrowBackUp size={13} /> {t("dn.back")}</button>
            ) : !p.isolated ? (
              <button type="button" className={`btn-teal min-w-[6rem] flex-1 !py-1.5 text-[11px] ${p.variant === "sheet" ? "min-h-[44px]" : ""}`} onClick={p.onFocus}><IconFocus2 size={13} /> {t("dn.focus")}</button>
            ) : null}
            {p.onIsolate && (
              <button type="button" data-testid={p.isolated ? "exit-isolation" : "isolate-tooth"} aria-pressed={!!p.isolated}
                className={`${p.isolated ? "btn-teal" : "btn-ghost"} min-w-[6rem] flex-1 !py-1.5 text-[11px] ${p.variant === "sheet" ? "min-h-[44px]" : ""}`}
                onClick={() => p.onIsolate?.(!p.isolated)} title={t("dn2.isolateHint")}>
                {p.isolated ? <><IconTargetOff size={13} /> {t("dn2.exitIsolation")}</> : <><IconTargetArrow size={13} /> {t("dn2.isolate")}</>}
              </button>
            )}
          </div>
        )}
      </div>
      {showHistory && (
        <Modal title={`${t("dn.toothHistory")} — ${p.fdi}`} subtitle={toothName(meta, t)} onClose={() => setShowHistory(false)}>
          <div dir={lang === "ar" ? "rtl" : "ltr"} className="max-h-[60vh] space-y-1.5 overflow-y-auto">
            {merged.length ? merged.map((h) => h.e ? (
              <HistoryRow key={h.e._id} e={h.e} lang={lang} canWrite={p.canWrite} patientId={p.patientId} focusSurface={p.focusSurface} />
            ) : (
              <TimelineRow key={h.tx!.id} e={h.tx!} visits={p.visits} showTarget={false} />
            )) : <Empty>{t("dn.noHistory")}</Empty>}
          </div>
        </Modal>
      )}
    </aside>
  );
}

/**
 * PHASE 5 — the tooth inspector: the SAME five-surface drawing the 2D chart uses (so it reads identically in both views) plus one row per
 * surface saying exactly what is on it. Picking a surface here, in the 2D chart or in the 3D scene is ONE shared state.
 */
function Inspector({ fdi, visual, surface, onSurface, compact }: { fdi: string; visual?: ToothVisualState; surface: SurfaceId | null; onSurface?: (s: SurfaceId | null) => void; compact?: boolean }) {
  const { t } = useI18n();
  const o = getSurfaceOrientation(fdi);
  if (!o) return null;
  const marks = deriveToothMarks(fdi, visual);
  // order = how the doctor reads a tooth: Mesial, Distal, facial, lingual/palatal, occlusal/incisal
  const order: SurfaceId[] = ["M", "D", "B", "L", "O"];
  const textOf = (s: SurfaceId) => marks.surfaces[s].map((m) => (m.kind === "filling" ? `${t("dn.p.filling")} · ${t(`dn2.st.${m.state}`)}` : t(`dn.c.${m.code}`)));
  const chipMarks = (s: SurfaceId) => marks.surfaces[s];
  return (
    <Section title={t("dn2.inspector")} testId="tooth-inspector">
      <div className="flex items-start gap-3">
        <div className="shrink-0" dir="ltr">
          <ToothCross fdi={fdi} marks={marks} size={compact ? 84 : 96} letters selected selectedSurface={surface} onSurface={(s) => onSurface?.(s === surface ? null : s)} title={`${fdi}`} />
        </div>
        <div className="min-w-0 flex-1 space-y-1" role="group" aria-label={t("dn.surfaces")}>
          {order.map((s) => {
            const on = surface === s, ms = chipMarks(s);
            return (
              <button key={s} type="button" data-testid="surface-row" data-surface={s} data-has={ms.length ? "true" : "false"} aria-pressed={on}
                onClick={() => onSurface?.(on ? null : s)}
                className={`flex w-full items-center gap-1.5 rounded-md border px-1.5 text-start text-[11px] leading-tight transition-colors ${compact ? "min-h-[44px]" : "min-h-[28px]"} ${on ? "border-teal bg-teal/15 text-teal" : "border-edge bg-card2 text-ink hover:border-sky"}`}>
                <span className="w-4 shrink-0 text-center font-mono text-[10px]" dir="ltr">{o.letters[s]}</span>
                <span className="min-w-0 flex-1 truncate">{t(o.nameKeys[s])}</span>
                <span className="flex shrink-0 items-center gap-0.5" aria-hidden>
                  {ms.slice(0, 3).map((m, i) => <i key={i} className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: STATE_TOKENS[m.state].css }} />)}
                </span>
                <span className="sr-only">{textOf(s).join(", ") || t("dn2.nothingHere")}</span>
              </button>
            );
          })}
        </div>
      </div>
      {surface ? (
        <div data-testid="surface-detail" data-surface={surface} className="rounded-md border border-teal/40 bg-teal/10 px-2 py-1.5 text-[11px] text-ink">
          <div className="font-medium text-teal">{t(o.nameKeys[surface])} <span dir="ltr" className="font-mono">({o.letters[surface]})</span></div>
          {chipMarks(surface).length ? (
            <ul className="mt-0.5 space-y-0.5">
              {chipMarks(surface).map((m, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <span aria-hidden style={{ color: STATE_TOKENS[m.state].css }}>{STATE_TOKENS[m.state].glyph}</span>
                  {m.kind === "filling" ? t("dn.p.filling") : t(`dn.c.${m.code}`)}
                  <span className="rounded-full border px-1 text-[9px]" style={stateChipStyle(m.state)}>{t(`dn2.st.${m.state}`)}</span>
                </li>
              ))}
            </ul>
          ) : <div className="text-mute">{t("dn2.nothingHere")}</div>}
        </div>
      ) : <p className="text-[10px] text-mute">{t("dn2.pickSurface")}</p>}
    </Section>
  );
}

const shortWhen = (iso: string, lang: string, today: string) => {
  const d = new Date(iso), loc = lang === "ar" ? "ar-JO" : "en-GB";
  if (Number.isNaN(d.getTime())) return "";
  // PHASE 7 — "today" and the printed day are the CLINIC's (Asia/Amman), not the browser's
  const day = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Amman" }).format(x);
  return day(d) === day(new Date())
    ? `${today} ${d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Amman" })}`
    : d.toLocaleDateString(loc, { day: "numeric", month: "short", timeZone: "Asia/Amman" });
};

const Section = ({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) => (
  <div data-testid={testId}>
    <div className="mb-1 text-[10px] font-medium tracking-wide text-mute">{title}</div>
    <div className="space-y-1">{children}</div>
  </div>
);
const Empty = ({ children }: { children: React.ReactNode }) => <div className="text-[11px] text-mute">{children}</div>;

function AddEntry({ category, fdi, patientId, onDone, onCancel }: { category: EventCategory; fdi: string; patientId: string; onDone: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const add = useAddDentalEvent(patientId);
  const [code, setCode] = useState<string | null>(null);
  const [surfaces, setSurfaces] = useState<SurfaceId[]>([]);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const item = code ? findItem(category, code) : undefined;

  const pick = (c: string) => {
    setCode(c);
    setErr("");
    if (findItem(category, c)?.surfaces === "none") setSurfaces([]);
  };
  const toggle = (s: SurfaceId) => setSurfaces((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const save = async () => {
    if (!code) return;
    setErr("");
    try {
      await add.mutateAsync({ fdi, category, code, surfaces: item?.surfaces === "optional" ? surfaces : [], note });
      toast.success(t("dn.saved"), `${t("dn.tooth")} ${fdi} · ${t(`dn.c.${code}`)}`);
      onDone();
    } catch (e) {
      // Keep the selection on failure — nothing the doctor chose is lost.
      setErr(errMsg(e, t("dn.err.save")));
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-edge bg-card2 p-2.5">
      <div className="grid grid-cols-2 gap-1.5">
        {taxonomyFor(category).map((i) => (
          <button key={i.code} type="button" className={chip(code === i.code)} onClick={() => pick(i.code)}>{t(`dn.c.${i.code}`)}</button>
        ))}
      </div>
      {item && (item.surfaces === "optional" ? (
        <div>
          <div className="mb-1 text-[10px] text-mute">{t("dn.surfacesOptional")}</div>
          <div className="flex gap-1" dir="ltr">
            {SURFACES.map((s) => (
              <button key={s} type="button" title={t(`dn.s.${s}`)} aria-pressed={surfaces.includes(s)} onClick={() => toggle(s)}
                className={`flex-1 rounded-md border py-1 font-mono text-[10px] ${surfaces.includes(s) ? "border-teal bg-teal/20 text-teal" : "border-edge bg-card text-ink hover:border-sky"}`}>
                {surfaceLabel(fdi, s)}
              </button>
            ))}
          </div>
        </div>
      ) : <div className="text-[10px] text-mute">{t("dn.wholeTooth")}</div>)}
      {item && <input className="inp !py-1 text-[11px]" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("dn.note")} />}
      {err && (
        <div role="alert" className="flex items-start gap-1.5 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[10px] text-red-400">
          <IconAlertTriangle size={12} className="mt-px shrink-0" /> {err}
        </div>
      )}
      <div className="flex gap-1.5">
        <button type="button" className="btn-teal flex-1 !py-1.5 text-[11px]" disabled={!code || add.isPending} onClick={save}>{add.isPending ? t("dn.saving") : t("dn.save")}</button>
        <button type="button" className="btn-ghost !px-3 !py-1.5 text-[11px]" onClick={onCancel}>{t("dn.cancel")}</button>
      </div>
    </div>
  );
}

function HistoryRow({ e, lang, canWrite, patientId, focusSurface }: { e: DentalEvent; lang: string; canWrite: boolean; patientId: string; focusSurface?: string }) {
  const { t } = useI18n();
  const f = useFocusTarget("event", e._id);
  const toast = useToast();
  const resolve = useResolveDentalEvent(patientId);
  const when = new Date(e.createdAt).toLocaleString(lang === "ar" ? "ar-JO" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Amman" });
  const act = async (reason: "resolved" | "entered_in_error") => {
    try { await resolve.mutateAsync({ eventId: e._id, reason }); }
    catch (er) { toast.error(t("dn.err.save"), errMsg(er, "")); }
  };
  return (
    <div ref={f.ref} {...f.attrs} data-testid="tooth-history-row" className={`rounded-lg border border-edge bg-card2 px-2.5 py-1.5 ${e.status === "resolved" ? "opacity-60" : ""} ${f.className}`}>
      <div className="flex items-center justify-between gap-2 text-[9px] text-mute">
        <span dir="ltr">{when}</span>
        <span>{e.category === "diagnosis" ? t("dn.cat.diagnosis") : t("dn.cat.existing")}</span>
      </div>
      <div className="text-[12px] text-ink">{t(`dn.c.${e.code}`)}<SurfacePills s={e.surfaces} focus={focusSurface} fdi={e.fdi} /></div>
      {e.note && <div dir="auto" className="text-[10px] text-mute">{e.note}</div>}
      <div className="mt-0.5 flex flex-wrap items-center justify-between gap-1 text-[9px] text-mute">
        <span>{e.createdBy ? `${t("dn.by")} ${e.createdBy.name}` : ""}</span>
        {e.status === "resolved" ? (
          <span className="pill border border-edge bg-soft">{e.resolution?.reason === "entered_in_error" ? t("dn.errorEntry") : t("dn.resolved")}</span>
        ) : canWrite ? (
          <span className="flex gap-2">
            <button type="button" disabled={resolve.isPending} className="text-teal hover:underline" onClick={() => act("resolved")}>{t("dn.resolve")}</button>
            <button type="button" disabled={resolve.isPending} className="text-red-400 hover:underline" onClick={() => act("entered_in_error")}>{t("dn.enteredInError")}</button>
          </span>
        ) : null}
      </div>
    </div>
  );
}
