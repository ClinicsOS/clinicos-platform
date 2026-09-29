"use client";
import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import axios from "axios";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/store/auth";
import { useDentalReport } from "@/lib/dental/hooks";
import { jawRowFdis, resolveCurrentTeeth, type DentitionType } from "@/lib/dental/fdi";
import { SURFACE_LABELS } from "@/lib/dental/taxonomy";
import { deriveToothStates } from "@/lib/dental/toothStates";
import { invLabel, money, shortDate } from "@/components/dental/treatment/shared";
import type { DentalEvent, PlanStatus, TargetType } from "@/lib/dental/types";
import type { SurfaceId } from "@/lib/dental/taxonomy";

/**
 * Print-only Dental report ("Dental Patient File" / "Treatment Plan" / "Dental History").
 * Deliberately OUTSIDE the (dashboard) route group: no sidebar/nav chrome to hide, so the browser's native
 * print / Save-as-PDF prints exactly this document. All content comes from ONE server-authorized endpoint
 * (useDentalReport) — nothing here is assembled from data the frontend already had lying around.
 */
export default function DentalReportPage() {
  return (
    <Suspense fallback={null}>
      <ReportBody />
    </Suspense>
  );
}

type ReportType = "full" | "plan" | "history";

function ReportBody() {
  const params = useSearchParams();
  const patientId = params.get("patient") ?? "";
  const type = (params.get("type") as ReportType) || "full";
  const wantFinancial = params.get("financial") === "1";
  const { t, lang } = useI18n();
  const role = useAuth((s) => s.user?.role);

  const q = useDentalReport(patientId, wantFinancial, !!patientId);

  if (!patientId) return <Center>{t("dn.rep.noPatient")}</Center>;
  if (q.isLoading) return <Center busy>{t("dn.loading")}</Center>;
  if (q.isError || !q.data) {
    const status = axios.isAxiosError(q.error) ? q.error.response?.status : undefined;
    return <Center>{status === 403 ? t("dn.err.forbidden") : status === 404 ? t("pp.missing") : t("dn.rep.loadError")}</Center>;
  }
  return <Report data={q.data} type={type} lang={lang} t={t} role={role} />;
}

function Center({ children, busy }: { children: React.ReactNode; busy?: boolean }) {
  return <div className={`flex min-h-screen items-center justify-center p-8 text-center text-sm text-[#5e6b7a] ${busy ? "animate-pulse" : ""}`}>{children}</div>;
}

// ---------- print-only design tokens (deliberately NOT the app's dark dashboard theme — this is paper) ----------
const printCss = `
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  .doc { font-family: ui-sans-serif, system-ui, "Segoe UI", Tahoma, Arial, sans-serif; color: #1c2b3a; background: #fff; max-width: 190mm; margin: 0 auto; padding: 6mm 2mm 14mm; font-size: 12.5px; line-height: 1.5; }
  .doc h1, .doc h2, .doc h3 { color: #0c2e4e; }
  .toolbar { position: sticky; top: 0; z-index: 10; display: flex; gap: 8px; justify-content: flex-end; padding: 10px 14px; background: #f3f6f9; border-bottom: 1px solid #dde5ec; }
  .toolbar button { font-size: 12px; padding: 7px 14px; border-radius: 8px; border: 1px solid #c7d4de; background: #fff; cursor: pointer; }
  .toolbar button.primary { background: #0c2e4e; color: #fff; border-color: #0c2e4e; }
  .hd { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; border-bottom: 2px solid #0c2e4e; padding-bottom: 10px; margin-bottom: 14px; break-inside: avoid; }
  .hd img { max-height: 44px; max-width: 140px; object-fit: contain; }
  .hd .clinic-name { font-size: 15px; font-weight: 600; }
  .hd .clinic-meta { font-size: 10.5px; color: #5e6b7a; margin-top: 2px; }
  .hd .doc-title { font-size: 17px; font-weight: 700; }
  .hd .doc-date { font-size: 10.5px; color: #5e6b7a; margin-top: 2px; }
  .section { margin: 16px 0; break-inside: avoid-page; }
  .section h2 { font-size: 12.5px; letter-spacing: 0.04em; text-transform: uppercase; color: #5e6b7a; border-bottom: 1px solid #dde5ec; padding-bottom: 5px; margin-bottom: 8px; }
  .pinfo { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 18px; font-size: 12px; }
  .pinfo .lbl { color: #5e6b7a; font-size: 10px; }
  .overview { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
  .stat { border: 1px solid #dde5ec; border-radius: 8px; padding: 7px 6px; text-align: center; break-inside: avoid; }
  .stat b { display: block; font-size: 15px; }
  .stat span { font-size: 8.5px; color: #5e6b7a; }
  .chart-row { display: flex; gap: 2px; justify-content: center; margin: 4px 0; direction: ltr; }
  .chart-mid { width: 8px; }
  .tooth-cell { width: 22px; text-align: center; font-size: 9.5px; border: 1px solid #dde5ec; border-radius: 4px; padding: 2px 0; }
  .tooth-cell.hasmark { border-color: #9db3c4; background: #f6f9fb; }
  .tooth-fdi { font-weight: 600; }
  .tooth-marks { font-size: 8px; letter-spacing: -0.5px; }
  .legend { display: flex; flex-wrap: wrap; gap: 10px; font-size: 9.5px; color: #5e6b7a; margin-top: 6px; }
  .finding { break-inside: avoid; border-bottom: 1px dotted #dde5ec; padding: 4px 0; font-size: 11.5px; }
  .finding b { color: #0c2e4e; }
  table.plan { width: 100%; border-collapse: collapse; font-size: 11px; }
  table.plan th { text-align: start; font-size: 9.5px; color: #5e6b7a; text-transform: uppercase; letter-spacing: 0.03em; border-bottom: 1px solid #0c2e4e; padding: 4px 6px; }
  table.plan td { border-bottom: 1px solid #eef2f5; padding: 5px 6px; vertical-align: top; }
  table.plan tr { break-inside: avoid; }
  .total-row td { border-top: 2px solid #0c2e4e; border-bottom: none; font-weight: 700; padding-top: 7px; }
  .disclaimer { font-size: 9.5px; color: #5e6b7a; border: 1px dashed #c7d4de; border-radius: 8px; padding: 8px 10px; margin-top: 8px; }
  .hist-item { break-inside: avoid; display: flex; gap: 10px; font-size: 11.5px; padding: 4px 0; border-bottom: 1px dotted #eef2f5; }
  .hist-date { width: 62px; flex-shrink: 0; color: #5e6b7a; font-size: 10px; }
  .sign { display: flex; justify-content: space-between; margin-top: 30px; }
  .sign div { width: 45%; border-top: 1px solid #9db3c4; padding-top: 4px; font-size: 10px; color: #5e6b7a; text-align: center; }
  .footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #eef2f5; font-size: 9px; color: #9aa8b3; text-align: center; }
  @media print { .toolbar { display: none; } body { background: #fff; } }
  @media screen { .doc { margin: 16px auto; box-shadow: 0 0 0 1px #dde5ec, 0 8px 28px rgba(20,40,60,.08); border-radius: 4px; } }
`;

function Report({ data, type, lang, t, role }: { data: NonNullable<ReturnType<typeof useDentalReport>["data"]>; type: ReportType; lang: string; t: (k: string) => string; role?: string }) {
  const dentition = data.record.dentitionType;
  const states = useMemo(() => deriveToothStates(data.events), [data.events]);
  const activeItems = useMemo(() => data.planItems.filter((i) => i.status !== "cancelled"), [data.planItems]);
  const activeDiagnosesCount = data.events.filter((e) => e.category === "diagnosis" && e.status === "active").length;
  const lastActivity = useMemo(() => {
    const dates = [...data.events.map((e) => e.createdAt), ...data.timeline.map((e) => e.at)];
    return dates.length ? dates.reduce((a, b) => (new Date(a) > new Date(b) ? a : b)) : null;
  }, [data]);
  const genDate = shortDate(data.generatedAt, lang) + " " + new Date(data.generatedAt).toLocaleTimeString(lang === "ar" ? "ar" : undefined, { hour: "2-digit", minute: "2-digit" });
  const age = data.patient?.birthDate ? Math.floor((Date.now() - new Date(data.patient.birthDate).getTime()) / 3.15576e10) : null;

  const titleKey = type === "full" ? "dn.rep.full" : type === "plan" ? "dn.rep.planOnly" : "dn.rep.historyOnly";

  return (
    <div dir={lang === "ar" ? "rtl" : "ltr"}>
      <style>{printCss}</style>
      <div className="toolbar">
        <button onClick={() => window.close()}>{t("dn.close")}</button>
        <button className="primary" onClick={() => window.print()}>{t("dn.rep.print")}</button>
      </div>
      <div className="doc">
        {/* ---- Clinic header ---- */}
        <div className="hd">
          <div>
            <div className="clinic-name">{data.clinic?.name ?? "—"}</div>
            {(data.clinic?.phone || data.clinic?.address) && (
              <div className="clinic-meta">{[data.clinic?.phone, data.clinic?.address].filter(Boolean).join(" · ")}</div>
            )}
          </div>
          <div style={{ textAlign: lang === "ar" ? "left" : "right" }}>
            {data.clinic?.logoUrl && <img src={data.clinic.logoUrl} alt="" />}
            <div className="doc-title">{t(titleKey)}</div>
            <div className="doc-date">{t("dn.rep.generated")}: <span dir="ltr">{genDate}</span></div>
          </div>
        </div>

        {/* ---- Patient information ---- */}
        <div className="section">
          <h2>{t("dn.rep.patientInfo")}</h2>
          <div className="pinfo">
            <div><div className="lbl">{t("pt.name")}</div>{data.patient?.fullName ?? "—"}</div>
            <div><div className="lbl">{t("pt.file")}</div>#{String(data.patient?.fileNumber ?? 0).padStart(4, "0")}</div>
            <div><div className="lbl">{t("pt.phone")}</div><span dir="ltr">{data.patient?.phone ?? "—"}</span></div>
            {data.patient?.birthDate && <div><div className="lbl">{t("pp.dob")}</div>{new Date(data.patient.birthDate).toLocaleDateString(lang === "ar" ? "ar" : undefined)}{age !== null ? ` · ${age} ${t("pp.years")}` : ""}</div>}
            {data.patient?.gender && <div><div className="lbl">{t("pt.gender")}</div>{t(`pt.${data.patient.gender}`)}</div>}
            <div><div className="lbl">{t("dn.dentition")}</div>{t(`dn.dent.${dentition}`)}</div>
          </div>
        </div>

        {type !== "history" && (
          <div className="section">
            <h2>{t("dn.rep.overview")}</h2>
            <div className="overview">
              <Stat v={activeDiagnosesCount} l={t("dn.ov.diagnoses")} />
              <Stat v={data.summary.planned} l={t("dn.ps.planned")} />
              <Stat v={data.summary.inProgress} l={t("dn.ps.in_progress")} />
              <Stat v={data.summary.completed} l={t("dn.ps.completed")} />
              <Stat v={activeItems.length - data.summary.planned - data.summary.inProgress - data.summary.completed >= 0 ? undefined : undefined} l="" hide />
              <Stat vs={lastActivity ? shortDate(lastActivity, lang) : t("dn.ov.noActivity")} l={t("dn.ov.lastActivity")} />
            </div>
          </div>
        )}

        {type === "full" && (
          <>
            <div className="section">
              <h2>{t("dn.rep.chart")}</h2>
              <PrintChart dentition={dentition} currentTeeth={data.record.currentTeeth} states={states} t={t} />
            </div>
            <div className="section">
              <h2>{t("dn.rep.findings")}</h2>
              <Findings events={data.events} t={t} lang={lang} />
            </div>
          </>
        )}

        {type !== "history" && (
          <div className="section">
            <h2>{t("dn.rep.plan")}</h2>
            <PlanTable items={activeItems} t={t} lang={lang} />
            <p className="disclaimer">{t("dn.rep.estimateDisclaimer")}</p>
          </div>
        )}

        {type !== "plan" && (
          <div className="section">
            <h2>{t("dn.rep.history")}</h2>
            <HistoryList timeline={data.timeline} t={t} lang={lang} />
          </div>
        )}

        {data.financial && (
          <div className="section">
            <h2>{t("dn.rep.financial")}</h2>
            <div className="overview" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
              <Stat vs={money(data.financial.totalInvoiced)} l={t("dn.rep.totalInvoiced")} />
              <Stat vs={money(data.financial.totalPaid)} l={t("dn.rep.totalPaid")} />
              <Stat vs={money(data.financial.outstandingBalance)} l={t("dn.rep.outstanding")} />
            </div>
          </div>
        )}

        {type === "plan" && (
          <div className="sign">
            <div>{t("dn.rep.doctorSign")}</div>
            <div>{t("dn.rep.dateSign")}</div>
          </div>
        )}

        <div className="footer">ClinicOS · {t("dn.rep.generated")} <span dir="ltr">{genDate}</span></div>
      </div>
    </div>
  );
}

function Stat({ v, vs, l, hide }: { v?: number; vs?: string; l: string; hide?: boolean }) {
  if (hide) return null;
  return <div className="stat"><b>{vs ?? v ?? 0}</b><span>{l}</span></div>;
}

// ---------- Print-friendly chart: reuses the SAME arch/FDI logic as the interactive chart (jawRowFdis / resolveCurrentTeeth) ----------
function PrintChart({ dentition, currentTeeth, states, t }: { dentition: DentitionType; currentTeeth: string[] | null; states: ReturnType<typeof deriveToothStates>; t: (k: string) => string }) {
  const rows: { label: string; upper: string[]; lower: string[] }[] = [];
  if (dentition === "permanent") rows.push({ label: "", upper: jawRowFdis("upper", "permanent"), lower: jawRowFdis("lower", "permanent") });
  else if (dentition === "primary") rows.push({ label: "", upper: jawRowFdis("upper", "primary"), lower: jawRowFdis("lower", "primary") });
  else {
    // Mixed: the patient's ACTUAL current configuration (same resolver the 3D chart uses) — never a fabricated universal mixed state.
    const meta = resolveCurrentTeeth("mixed", currentTeeth);
    const isUpper = (fdi: string) => ["1", "2", "5", "6"].includes(fdi[0]);
    const upperFdi = meta.filter((m) => isUpper(m.fdi)).map((m) => m.fdi).sort();
    const lowerFdi = meta.filter((m) => !isUpper(m.fdi)).map((m) => m.fdi).sort();
    // split by midline (quadrant 1/5 vs 2/6, and 4/8 vs 3/7) for a left/right visual, distal→mesial on the left
    const leftOf = (fdi: string) => ["1", "4", "5", "8"].includes(fdi[0]);
    const orderSide = (list: string[], left: boolean) => list.filter((f) => leftOf(f) === left).sort((a, b) => (left ? b.localeCompare(a) : a.localeCompare(b)));
    rows.push({
      label: "",
      upper: [...orderSide(upperFdi, true), ...orderSide(upperFdi, false)],
      lower: [...orderSide(lowerFdi, true), ...orderSide(lowerFdi, false)],
    });
  }
  const marksFor = (fdi: string) => {
    const s = states[fdi];
    if (!s) return null;
    const bits: string[] = [];
    if (s.missing) bits.push("×");
    if (s.diagnoses.length) bits.push("●");
    if (s.existing.filter((e) => e.code !== "missing_tooth").length) bits.push("◐");
    return bits.length ? bits.join(" ") : null;
  };
  const Row = ({ list }: { list: string[] }) => (
    <div className="chart-row">
      {list.map((fdi, i) => {
        const mid = dentition !== "mixed" && i === list.length / 2;
        const marks = marksFor(fdi);
        return (
          <span key={fdi} style={{ display: "flex" }}>
            {mid && <span className="chart-mid" />}
            <span className={`tooth-cell ${marks ? "hasmark" : ""}`}>
              <span className="tooth-fdi">{fdi}</span>
              {marks && <span className="tooth-marks">{marks}</span>}
            </span>
          </span>
        );
      })}
    </div>
  );
  return (
    <div>
      {rows.map((r, i) => (
        <div key={i}>
          <Row list={r.upper} />
          <Row list={r.lower} />
        </div>
      ))}
      <div className="legend">
        <span>● {t("dn.rep.legendDx")}</span>
        <span>◐ {t("dn.rep.legendCond")}</span>
        <span>× {t("dn.rep.legendMissing")}</span>
      </div>
    </div>
  );
}

function Findings({ events, t, lang }: { events: DentalEvent[]; t: (k: string) => string; lang: string }) {
  const active = events.filter((e) => e.status === "active");
  const byTooth = new Map<string, DentalEvent[]>();
  for (const e of active) { const list = byTooth.get(e.fdi) ?? []; list.push(e); byTooth.set(e.fdi, list); }
  const teeth = Array.from(byTooth.keys()).sort();
  if (!teeth.length) return <p style={{ fontSize: 11, color: "#5e6b7a" }}>{t("dn.none")}</p>;
  return (
    <div>
      {teeth.map((fdi) => (
        <div key={fdi} className="finding">
          <b dir="ltr">{fdi}</b>{" — "}
          {byTooth.get(fdi)!.map((e, i) => (
            <span key={e._id}>
              {i > 0 && " · "}
              {e.category === "diagnosis" ? t("dn.rep.dx") : t("dn.rep.cond")}: {t(`dn.c.${e.code}`)}
              {e.surfaces.length > 0 && <span dir="ltr"> ({e.surfaces.map((s: SurfaceId) => SURFACE_LABELS[s]).join(",")})</span>}
              {" — "}<span dir="ltr">{shortDate(e.createdAt, lang)}</span>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function PlanTable({ items, t, lang }: { items: NonNullable<ReturnType<typeof useDentalReport>["data"]>["planItems"]; t: (k: string) => string; lang: string }) {
  const total = items.filter((i) => i.status !== "cancelled").reduce((s, i) => s + (i.estimatedPrice ?? 0), 0);
  return (
    <table className="plan">
      <thead>
        <tr>
          <th>{t("dn.target")}</th><th>{t("dn.procedure")}</th><th>{t("dn.phase")}</th><th>{t("dn.pr.label")}</th><th>{t("dn.target").length ? t("dn.ps.planned").slice(0, 0) : ""}{t("dn.rep.statusCol")}</th><th style={{ textAlign: "end" }}>{t("dn.inv.estimated")}</th>
        </tr>
      </thead>
      <tbody>
        {items.filter((i) => i.status !== "cancelled").map((i) => (
          <tr key={i._id}>
            <td dir="ltr">{i.targetType === "general" ? t("dn.tg.general") : i.toothNumbers.join(",")}{i.surfaces.length > 0 && <span> ({i.surfaces.map((s) => SURFACE_LABELS[s]).join(",")})</span>}</td>
            <td>{t(`dn.p.${i.procedureCode}`)}</td>
            <td>{t("dn.phase")} {i.phase}</td>
            <td>{t(`dn.pr.${i.priority}`)}</td>
            <td>{t(`dn.ps.${i.status}`)}</td>
            <td style={{ textAlign: "end" }} dir="ltr">{i.estimatedPrice != null ? money(i.estimatedPrice) : "—"}</td>
          </tr>
        ))}
        <tr className="total-row"><td colSpan={5}>{t("dn.plan.total")}</td><td style={{ textAlign: "end" }} dir="ltr">{money(total)}</td></tr>
      </tbody>
    </table>
  );
}

function HistoryList({ timeline, t, lang }: { timeline: NonNullable<ReturnType<typeof useDentalReport>["data"]>["timeline"]; t: (k: string) => string; lang: string }) {
  if (!timeline.length) return <p style={{ fontSize: 11, color: "#5e6b7a" }}>{t("dn.noHistory")}</p>;
  const sorted = [...timeline].sort((a, b) => +new Date(a.at) - +new Date(b.at));
  return (
    <div>
      {sorted.map((e) => (
        <div key={e.id} className="hist-item">
          <div className="hist-date" dir="ltr">{shortDate(e.at, lang)}</div>
          <div>
            <b dir="ltr">{e.toothNumbers.length ? e.toothNumbers.join(",") : t("dn.tg.general")}</b>{" — "}
            {t(`dn.h.${e.kind}`)}{e.kind === "session" && e.sessionNumber ? ` ${e.sessionNumber}` : ""} — {t(`dn.p.${e.procedureCode}`)}
            {e.kind === "invoiced" && e.invoiceNumber != null && <span> · <span dir="ltr">{invLabel(e.invoiceNumber)}</span></span>}
          </div>
        </div>
      ))}
    </div>
  );
}
