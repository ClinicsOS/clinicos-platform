import type { ReactNode } from "react";
import type { DermRegionRef } from "@/lib/derm/types";
import type { DermReportData, FollowUp, TreatmentItem, TreatmentSession } from "@/lib/derm/treatmentTypes";
import { docFieldLabelKey } from "@/lib/derm/documentation";
import {
  activeFollowUps, ageYears, buildHistory, diagnosesOf, fmtDate, fmtDateTime, fmtYmd, hasAnyClinicalData, itemsByPhase, nonEmpty, overviewStats,
  planEstimate, sessionGroups, sessionProcedureName, sessionsOfItem, sessionsSorted, visibleAssessments, type ReportOptions, type ReportType,
} from "@/lib/derm/reportModel";
import { procedureLabel } from "@/lib/derm/procedures";

/**
 * The printable Dermatology & Aesthetic documents. PURE presentation of the server-authorized payload: no hooks, no data
 * fetching, no routing — so it renders identically in the browser (print / Save as PDF) and in headless tests.
 * Nothing here recommends, diagnoses, scores or interprets anything: it prints what the clinician documented.
 */
export type TFn = (key: string) => string;
export type RegionTextFn = (id: string, surface?: string | null) => string;

export const reportCss = `
  @page { size: A4; margin: 12mm 14mm; }
  * { box-sizing: border-box; }
  .doc { font-family: ui-sans-serif, system-ui, "Segoe UI", Tahoma, Arial, sans-serif; color: #1c2b3a; background: #fff; max-width: 190mm; margin: 0 auto; padding: 4mm 2mm 6mm; font-size: 12.5px; line-height: 1.55; }
  .doc h1, .doc h2, .doc h3 { color: #0c2e4e; margin: 0; }
  .toolbar { position: sticky; top: 0; z-index: 10; display: flex; gap: 8px; justify-content: flex-end; padding: 10px 14px; background: #f3f6f9; border-bottom: 1px solid #dde5ec; }
  .toolbar button { font-size: 12px; padding: 7px 14px; border-radius: 8px; border: 1px solid #c7d4de; background: #fff; cursor: pointer; }
  .toolbar button.primary { background: #0c2e4e; color: #fff; border-color: #0c2e4e; }
  .hd { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; border-bottom: 2px solid #0c2e4e; padding-bottom: 10px; margin-bottom: 14px; break-inside: avoid; }
  .hd img { max-height: 44px; max-width: 140px; object-fit: contain; }
  .hd .clinic-name { font-size: 15px; font-weight: 600; }
  .hd .clinic-meta { font-size: 10.5px; color: #5e6b7a; margin-top: 2px; }
  .hd .doc-title { font-size: 17px; font-weight: 700; text-align: end; }
  .hd .doc-date { font-size: 10.5px; color: #5e6b7a; margin-top: 2px; text-align: end; }
  .section { margin: 14px 0; }
  .sec-financial { break-inside: avoid; } /* the totals and their explanatory note always stay on the same page */
  .section > h2 { font-size: 12.5px; letter-spacing: 0.04em; text-transform: uppercase; color: #5e6b7a; border-bottom: 1px solid #dde5ec; padding-bottom: 5px; margin-bottom: 8px; break-after: avoid; }
  .pinfo { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 18px; font-size: 12px; }
  .lbl { color: #5e6b7a; font-size: 10px; display: block; }
  .overview { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .stat { border: 1px solid #dde5ec; border-radius: 8px; padding: 7px 6px; text-align: center; break-inside: avoid; }
  .stat b { display: block; font-size: 15px; }
  .stat span { font-size: 9px; color: #5e6b7a; }
  .card { border: 1px solid #dde5ec; border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; break-inside: avoid; }
  .card.long { break-inside: auto; } /* a card with long clinical text may continue on the next page instead of leaving a blank gap */
  .card .top { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; margin-bottom: 4px; }
  .card .top b { color: #0c2e4e; }
  .card .when { color: #5e6b7a; font-size: 10.5px; white-space: nowrap; }
  .kv { margin: 3px 0; }
  .kv .k { color: #5e6b7a; font-size: 10px; display: block; }
  .kv .v { white-space: pre-wrap; overflow-wrap: anywhere; }
  .grp { margin-top: 6px; padding: 5px 8px; background: #f6f9fb; border-radius: 6px; break-inside: avoid; }
  .grp h4 { margin: 0 0 3px; font-size: 10.5px; color: #0c2e4e; text-transform: uppercase; letter-spacing: .03em; }
  .grp .row { display: grid; grid-template-columns: 36% 1fr; gap: 6px; font-size: 11.5px; padding: 1px 0; }
  .grp .row .k { color: #5e6b7a; }
  .grp .row .v { overflow-wrap: anywhere; white-space: pre-wrap; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 2px 0 4px; }
  .chip { border: 1px solid #c7d4de; border-radius: 999px; padding: 1px 8px; font-size: 10.5px; background: #fff; }
  table.tbl { width: 100%; border-collapse: collapse; font-size: 11px; }
  table.tbl th { text-align: start; font-size: 9.5px; color: #5e6b7a; text-transform: uppercase; letter-spacing: 0.03em; border-bottom: 1px solid #0c2e4e; padding: 4px 6px; }
  table.tbl td { border-bottom: 1px solid #eef2f5; padding: 5px 6px; vertical-align: top; overflow-wrap: anywhere; }
  table.tbl tr { break-inside: avoid; }
  table.tbl .num { text-align: end; white-space: nowrap; }
  .total-row td { border-top: 2px solid #0c2e4e; border-bottom: none; font-weight: 700; padding-top: 7px; }
  .note { font-size: 10px; color: #5e6b7a; border: 1px dashed #c7d4de; border-radius: 8px; padding: 6px 9px; margin-top: 6px; }
  .phase { font-size: 11px; font-weight: 600; color: #0c2e4e; margin: 8px 0 3px; break-after: avoid; }
  .hist-item { break-inside: avoid; display: flex; gap: 10px; font-size: 11.5px; padding: 4px 0; border-bottom: 1px dotted #eef2f5; }
  .hist-date { width: 74px; flex-shrink: 0; color: #5e6b7a; font-size: 10px; }
  .hist-item .what b { color: #0c2e4e; }
  .muted { color: #5e6b7a; }
  .sign { display: flex; justify-content: space-between; gap: 30px; margin-top: 22px; break-inside: avoid; }
  .sign div { width: 45%; border-top: 1px solid #9db3c4; padding-top: 4px; font-size: 10px; color: #5e6b7a; text-align: center; }
  .footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #eef2f5; font-size: 9px; color: #9aa8b3; text-align: center; }
  .empty { padding: 30px 10px; text-align: center; color: #5e6b7a; border: 1px dashed #c7d4de; border-radius: 8px; }
  @media print { .toolbar { display: none; } body { background: #fff; } .doc { box-shadow: none !important; } }
  @media screen { .doc { margin: 16px auto; box-shadow: 0 0 0 1px #dde5ec, 0 8px 28px rgba(20,40,60,.08); border-radius: 4px; } }
  @media screen and (max-width: 640px) { .pinfo { grid-template-columns: 1fr 1fr; } .overview { grid-template-columns: 1fr 1fr; } .doc { padding: 4mm 3mm 10mm; } .grp .row { grid-template-columns: 1fr; } }
`;

const jd = (n: number) => `${Number(n.toFixed(3)).toString()} JD`;
const invLabel = (n: number) => `INV-${String(n).padStart(4, "0")}`;
/** A card holding a lot of text is allowed to flow across pages (short ones stay together). */
const isLong = (...parts: (string | undefined | null)[]) => parts.reduce((n, p) => n + (p ? p.length : 0), 0) > 700;
const fill = (s: string, vars: Record<string, string | number>) => Object.entries(vars).reduce((r, [k, v]) => r.split(`{${k}}`).join(String(v)), s);

interface Ctx { data: DermReportData; lang: string; t: TFn; rt: RegionTextFn }

function regionsText(c: Ctx, x: { targetType?: string; regions: DermRegionRef[]; generalArea?: string }): string {
  if (x.targetType === "general" || x.regions.length === 0) return x.generalArea ? `${c.t("dt.target.general")} · ${c.t(`dm.group.${x.generalArea}`)}` : c.t("dt.target.general");
  return x.regions.map((r) => c.rt(r.id, r.surface)).join(c.lang === "ar" ? "، " : ", ");
}
function Chips({ c, x }: { c: Ctx; x: { targetType?: string; regions: DermRegionRef[]; generalArea?: string } }) {
  if (x.targetType === "general" || x.regions.length === 0) return <div className="chips"><span className="chip">{regionsText(c, x)}</span></div>;
  return <div className="chips">{x.regions.map((r) => <span key={`${r.id}:${r.surface ?? ""}`} className="chip">{c.rt(r.id, r.surface)}</span>)}</div>;
}
function visitText(c: Ctx, appointmentId: string | null | undefined): string {
  if (!appointmentId) return "";
  const v = c.data.visits[appointmentId];
  if (!v) return "";
  return `${fmtDate(v.startAt, c.lang)}${v.source === "walk_in" ? ` · ${c.t("dt.walkIn")}` : ""}`;
}
function KV({ k, v }: { k: string; v?: string | null }) {
  if (!nonEmpty(v)) return null; // empty fields are never printed
  return <div className="kv"><span className="k">{k}</span><span className="v" dir="auto">{v.trim()}</span></div>;
}
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section className={`section sec-${id}`}><h2>{title}</h2>{children}</section>;
}

// ---------------------------------------------------------------- header + patient
function Header({ c, title }: { c: Ctx; title: string }) {
  const { clinic } = c.data;
  return (
    <div className="hd">
      <div>
        {clinic?.logoUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={clinic.logoUrl} alt="" /> : null}
        <div className="clinic-name"><bdi>{clinic?.name ?? ""}</bdi></div>
        <div className="clinic-meta" dir="auto">{[clinic?.phone, clinic?.address].filter(nonEmpty).join(" · ")}</div>
      </div>
      <div>
        <div className="doc-title">{title}</div>
        <div className="doc-date">{c.t("dr.generated")}: {fmtDateTime(c.data.generatedAt, c.lang)}</div>
      </div>
    </div>
  );
}
function PatientBlock({ c }: { c: Ctx }) {
  const p = c.data.patient;
  if (!p) return null;
  const age = ageYears(p.birthDate);
  return (
    <Section id="patient" title={c.t("dr.sec.patient")}>
      <div className="pinfo">
        <div><span className="lbl">{c.t("dr.f.name")}</span><bdi>{p.fullName}</bdi></div>
        <div><span className="lbl">{c.t("dr.f.file")}</span><bdi>{p.fileNumber}</bdi></div>
        {nonEmpty(p.phone) && <div><span className="lbl">{c.t("dr.f.phone")}</span><bdi dir="ltr">{p.phone}</bdi></div>}
        {p.birthDate && <div><span className="lbl">{c.t("dr.f.dob")}</span>{fmtDate(p.birthDate, c.lang)}{age !== null ? ` (${age})` : ""}</div>}
        {p.gender && <div><span className="lbl">{c.t("dr.f.gender")}</span>{c.t(`dr.gender.${p.gender}`)}</div>}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- sections
function Overview({ c }: { c: Ctx }) {
  const s = overviewStats(c.data);
  const stat = (n: number | string, label: string) => <div className="stat"><b>{n}</b><span>{label}</span></div>;
  return (
    <Section id="overview" title={c.t("dr.sec.overview")}>
      <div className="overview">
        {stat(s.assessments, c.t("dr.ov.assessments"))}{stat(s.diagnoses, c.t("dr.ov.diagnoses"))}{stat(s.activeTreatments, c.t("dr.ov.activeTx"))}{stat(s.completedTreatments, c.t("dr.ov.completedTx"))}
        {stat(s.sessions, c.t("dr.ov.sessions"))}{stat(s.followUps, c.t("dr.ov.followUps"))}{stat(s.lastActivity ? fmtDate(s.lastActivity, c.lang) : "—", c.t("dr.ov.lastActivity"))}
      </div>
    </Section>
  );
}

function Assessments({ c }: { c: Ctx }) {
  const { active, voidedCount } = visibleAssessments(c.data);
  if (!active.length && !voidedCount) return null;
  return (
    <Section id="assessments" title={c.t("dr.sec.assessments")}>
      {active.map((a) => (
        <div className={`card${isLong(a.concern, a.findings, a.diagnosis, a.notes) ? " long" : ""}`} key={a._id}>
          <div className="top"><b>{c.t(`dm.type.${a.recordType}`)}</b><span className="when">{fmtDateTime(a.createdAt, c.lang)}</span></div>
          <Chips c={c} x={{ regions: a.regions, targetType: "single_region" }} />
          <KV k={c.t("dr.a.concern")} v={a.concern} />
          <KV k={c.t("dr.a.findings")} v={a.findings} />
          <KV k={c.t("dr.a.diagnosis")} v={a.diagnosis} />
          <KV k={c.t("dr.a.notes")} v={a.notes} />
          <div className="muted" style={{ fontSize: 10.5 }}>
            {[a.createdBy?.name ? `${c.t("dr.clinician")}: ${a.createdBy.name}` : "", visitText(c, a.appointmentId) ? `${c.t("dr.visit")}: ${visitText(c, a.appointmentId)}` : "", a.edited ? c.t("dr.edited") : ""].filter(Boolean).join(" · ")}
          </div>
        </div>
      ))}
      {voidedCount > 0 && <p className="note">{fill(c.t("dr.voidedHidden"), { n: voidedCount })}</p>}
    </Section>
  );
}

function Diagnoses({ c }: { c: Ctx }) {
  const rows = diagnosesOf(visibleAssessments(c.data).active);
  if (!rows.length) return null;
  return (
    <Section id="diagnoses" title={c.t("dr.sec.diagnoses")}>
      <table className="tbl"><thead><tr><th>{c.t("dr.col.date")}</th><th>{c.t("dr.col.diagnosis")}</th><th>{c.t("dr.col.regions")}</th><th>{c.t("dr.col.type")}</th></tr></thead>
        <tbody>{rows.map((a) => <tr key={a._id}><td>{fmtDate(a.createdAt, c.lang)}</td><td dir="auto">{a.diagnosis}</td><td>{regionsText(c, { regions: a.regions, targetType: "single_region" })}</td><td>{c.t(`dm.type.${a.recordType}`)}</td></tr>)}</tbody></table>
      <p className="note">{c.t("dr.dxNote")}</p>
    </Section>
  );
}

function PlanTable({ c, items }: { c: Ctx; items: TreatmentItem[] }) {
  return (
    <table className="tbl"><thead><tr><th>{c.t("dr.col.procedure")}</th><th>{c.t("dr.col.regions")}</th><th>{c.t("dr.col.priority")}</th><th>{c.t("dr.col.status")}</th><th>{c.t("dr.col.dates")}</th><th className="num">{c.t("dr.col.estimate")}</th></tr></thead>
      <tbody>{items.map((i) => {
        const started = i.statusHistory.find((h) => h.status === "in_progress")?.at;
        const done = i.statusHistory.find((h) => h.status === "completed")?.at;
        const cancelled = i.statusHistory.find((h) => h.status === "cancelled")?.at;
        const dates = [`${c.t("dr.d.planned")} ${fmtDate(i.createdAt, c.lang)}`, started ? `${c.t("dr.d.started")} ${fmtDate(started, c.lang)}` : "", done ? `${c.t("dr.d.completed")} ${fmtDate(done, c.lang)}` : "", cancelled ? `${c.t("dr.d.cancelled")} ${fmtDate(cancelled, c.lang)}` : ""].filter(Boolean);
        return (
          <tr key={i._id}>
            <td><b>{procedureLabel(i.procedureCode, c.lang === "ar" ? "ar" : "en")}</b><div className="muted">{c.t(`dm.type.${i.recordType}`)}</div>{nonEmpty(i.notes) && <div dir="auto" className="muted">{i.notes}</div>}{i.status === "cancelled" && nonEmpty(i.cancelReason) && <div dir="auto" className="muted">{c.t("dr.cancelReason")}: {i.cancelReason}</div>}</td>
            <td>{regionsText(c, i)}</td><td>{c.t(`dt.priority.${i.priority}`)}</td><td>{c.t(`dt.status.${i.status}`)}</td>
            <td>{dates.map((d, k) => <div key={k}>{d}</div>)}</td>
            <td className="num">{typeof i.estimatedPrice === "number" ? jd(i.estimatedPrice) : "—"}</td>
          </tr>
        );
      })}</tbody></table>
  );
}
function Plan({ c }: { c: Ctx }) {
  const phases = itemsByPhase(c.data);
  if (!phases.length) return null;
  const est = planEstimate(c.data);
  const multi = phases.length > 1;
  return (
    <Section id="plan" title={c.t("dr.sec.plan")}>
      {phases.map((p) => (
        <div key={p.phase}>
          {multi && <div className="phase">{c.t("dr.phase")} {p.phase}{nonEmpty(p.name) ? ` — ${p.name}` : ""}</div>}
          <PlanTable c={c} items={p.items} />
        </div>
      ))}
      {est.hasAny && <table className="tbl"><tbody><tr className="total-row"><td>{c.t("dr.estTotal")}</td><td className="num">{jd(est.total)}</td></tr></tbody></table>}
      <p className="note">{c.t("dr.estNote")}</p>
    </Section>
  );
}

function SessionCard({ c, s, followUps }: { c: Ctx; s: TreatmentSession; followUps?: FollowUp[] }) {
  const groups = sessionGroups(s);
  const regions = s.treatedRegions.length ? s.treatedRegions : s.regions;
  return (
    <div className={`card sess${isLong(s.procedureNotes, s.observations, s.outcome, s.followUpInstructions, s.device?.settingsSummary, s.device?.notes, s.product?.notes) ? " long" : ""}`} key={s._id}>
      <div className="top"><b>{sessionProcedureName(s, c.lang)} · {c.t("dr.s.n")} {s.sessionNumber}</b><span className="when">{fmtDateTime(s.startedAt, c.lang)}</span></div>
      <Chips c={c} x={{ regions, targetType: s.targetType, generalArea: s.generalArea }} />
      <div className="muted" style={{ fontSize: 10.5 }}>
        {[s.performedBy?.name ? `${c.t("dr.clinician")}: ${s.performedBy.name}` : "", visitText(c, s.appointmentId) ? `${c.t("dr.visit")}: ${visitText(c, s.appointmentId)}` : "", c.t(`dm.type.${s.recordType}`)].filter(Boolean).join(" · ")}
      </div>
      {groups.map((g) => (
        <div className="grp" key={g.group}>
          <h4>{c.t(`dr.grp.${g.group}`)}</h4>
          {g.rows.map((r) => <div className="row" key={r.key}><span className="k">{c.t(docFieldLabelKey(g.group, r.key))}</span><span className="v" dir="auto">{r.kind === "date" ? fmtYmd(r.value, c.lang) : r.value}</span></div>)}
        </div>
      ))}
      <KV k={c.t("dr.s.notes")} v={s.procedureNotes} />
      <KV k={c.t("dr.s.observations")} v={s.observations} />
      <KV k={c.t("dr.s.outcome")} v={s.outcome} />
      <KV k={c.t("dr.s.instructions")} v={s.followUpInstructions} />
      {s.followUpDueAt && <KV k={c.t("dr.s.dueAt")} v={fmtDate(s.followUpDueAt, c.lang)} />}
      {followUps && followUps.length > 0 && <div className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>{c.t("dr.s.followUps")}: {followUps.map((f) => fmtDate(f.createdAt, c.lang)).join(", ")}</div>}
    </div>
  );
}
function Sessions({ c }: { c: Ctx }) {
  const list = sessionsSorted(c.data);
  if (!list.length) return null;
  const fus = activeFollowUps(c.data);
  return <Section id="sessions" title={c.t("dr.sec.sessions")}>{list.map((s) => <SessionCard key={s._id} c={c} s={s} followUps={fus.filter((f) => f.sessionId === s._id)} />)}</Section>;
}

function FollowUpCard({ c, f }: { c: Ctx; f: FollowUp }) {
  const item = f.itemId ? c.data.items.find((i) => i._id === f.itemId) : undefined;
  const sess = f.sessionId ? c.data.sessions.find((s) => s._id === f.sessionId) : undefined;
  const linked = [item ? procedureLabel(item.procedureCode, c.lang === "ar" ? "ar" : "en") : "", sess ? `${c.t("dr.s.n")} ${sess.sessionNumber}` : ""].filter(Boolean).join(" · ");
  return (
    <div className={`card${isLong(f.clinicianAssessment, f.progress, f.complications, f.notes, f.nextStep) ? " long" : ""}`}>
      <div className="top"><b>{linked || c.t(`dm.type.${f.recordType}`)}</b><span className="when">{fmtDateTime(f.createdAt, c.lang)}</span></div>
      {f.regions.length > 0 && <Chips c={c} x={{ regions: f.regions, targetType: "single_region" }} />}
      {f.outcome && <KV k={c.t("dr.fu.outcome")} v={c.t(`dt.fu.o.${f.outcome}`)} />}
      <KV k={c.t("dr.fu.assessment")} v={f.clinicianAssessment} />
      <KV k={c.t("dr.fu.progress")} v={f.progress} />
      <KV k={c.t("dr.fu.complications")} v={f.complications} />
      <KV k={c.t("dr.fu.notes")} v={f.notes} />
      <KV k={c.t("dr.fu.next")} v={f.nextStep} />
      <div className="muted" style={{ fontSize: 10.5 }}>{[f.createdBy?.name ? `${c.t("dr.clinician")}: ${f.createdBy.name}` : "", visitText(c, f.appointmentId) ? `${c.t("dr.visit")}: ${visitText(c, f.appointmentId)}` : "", f.edited ? c.t("dr.edited") : ""].filter(Boolean).join(" · ")}</div>
    </div>
  );
}
function FollowUps({ c }: { c: Ctx }) {
  const list = activeFollowUps(c.data);
  if (!list.length) return null;
  return <Section id="followups" title={c.t("dr.sec.followups")}>{list.map((f) => <FollowUpCard key={f._id} c={c} f={f} />)}</Section>;
}

function History({ c, financial }: { c: Ctx; financial: boolean }) {
  const ev = buildHistory(c.data, c.lang, { financial });
  if (!ev.length) return null;
  const label = (k: string) => c.t(`dr.h.${k}`);
  return (
    <Section id="history" title={c.t("dr.sec.history")}>
      {ev.map((e) => (
        <div className="hist-item" key={e.key}>
          <div className="hist-date">{fmtDate(e.at, c.lang)}</div>
          <div className="what">
            <b>{label(e.kind)}</b>
            {e.sessionNumber ? ` ${e.sessionNumber}` : ""}
            {e.procedureName ? ` — ${e.procedureName}` : e.recordType ? ` — ${c.t(`dm.type.${e.recordType}`)}` : ""}
            {e.regions.length > 0 || e.targetType === "general" ? <span className="muted"> · {regionsText(c, { regions: e.regions, targetType: e.targetType, generalArea: e.generalArea })}</span> : null}
            {e.diagnosis && <div dir="auto">{c.t("dr.a.diagnosis")}: {e.diagnosis}</div>}
            {e.detail && <div dir="auto" className="muted">{e.detail}</div>}
            {e.outcome && <div className="muted">{c.t("dr.fu.outcome")}: {c.t(`dt.fu.o.${e.outcome}`)}</div>}
            {typeof e.invoiceNumber === "number" && <span className="muted"> · {invLabel(e.invoiceNumber)}</span>}
          </div>
        </div>
      ))}
    </Section>
  );
}

function Financial({ c }: { c: Ctx }) {
  const f = c.data.financial;
  if (!f) return null;
  return (
    <Section id="financial" title={c.t("dr.sec.financial")}>
      {f.invoices.length === 0 ? <p className="muted">{c.t("dr.fin.none")}</p> : (
        <table className="tbl"><thead><tr><th>{c.t("dr.fin.inv")}</th><th>{c.t("dr.col.date")}</th><th>{c.t("dr.col.status")}</th><th className="num">{c.t("dr.fin.total")}</th><th className="num">{c.t("dr.fin.paid")}</th></tr></thead>
          <tbody>
            {f.invoices.map((i) => <tr key={i.invoiceNumber}><td>{invLabel(i.invoiceNumber)}</td><td>{fmtDate(i.createdAt, c.lang)}</td><td>{c.t(`dr.fin.s.${i.status}`)}</td><td className="num">{jd(i.total)}</td><td className="num">{jd(i.paid)}</td></tr>)}
            <tr className="total-row"><td colSpan={3}>{c.t("dr.fin.totalInvoiced")}</td><td className="num">{jd(f.totalInvoiced)}</td><td className="num">{jd(f.totalPaid)}</td></tr>
            <tr><td colSpan={3}><b>{c.t("dr.fin.balance")}</b></td><td className="num" colSpan={2}><b>{jd(f.outstandingBalance)}</b></td></tr>
          </tbody></table>
      )}
      <p className="note">{c.t("dr.fin.note")}</p>
    </Section>
  );
}

function Footer({ c }: { c: Ctx }) {
  return (
    <>
      <div className="sign"><div>{c.t("dr.sign.clinician")}</div><div>{c.t("dr.sign.date")}</div></div>
      <div className="footer">{c.t("dr.disclaimer")} · <bdi>{c.data.clinic?.name ?? ""}</bdi> · {c.t("dr.generated")} {fmtDateTime(c.data.generatedAt, c.lang)}</div>
    </>
  );
}

// ---------------------------------------------------------------- the document
export interface DocumentProps {
  data: DermReportData; type: ReportType; lang: string; t: TFn; rt: RegionTextFn; options: ReportOptions;
  /** Required for type "session": the session to print (it must be one of this patient's sessions in `data`). */
  sessionId?: string;
}
export function reportTitleKey(type: ReportType): string { return `dr.title.${type}`; }

export function DermReportDocument({ data, type, lang, t, rt, options, sessionId }: DocumentProps) {
  const c: Ctx = { data, lang, t, rt };
  const title = t(reportTitleKey(type));
  let body: ReactNode;

  if (type === "session") {
    const s = data.sessions.find((x) => x._id === sessionId);
    if (!s) {
      body = <div className="empty">{t("dr.err.sessionMissing")}</div>; // wrong / foreign id: never leaks anything
    } else {
      const item = data.items.find((i) => i._id === s.itemId);
      const fus = activeFollowUps(data).filter((f) => f.sessionId === s._id);
      body = (
        <>
          <Section id="session" title={t("dr.sec.session")}>
            <SessionCard c={c} s={s} followUps={fus} />
            {item && <p className="muted" style={{ fontSize: 11 }}>{t("dr.s.treatment")}: {procedureLabel(item.procedureCode, lang === "ar" ? "ar" : "en")} — {t(`dt.status.${item.status}`)}</p>}
          </Section>
          {fus.length > 0 && <Section id="followups" title={t("dr.sec.followups")}>{fus.map((f) => <FollowUpCard key={f._id} c={c} f={f} />)}</Section>}
        </>
      );
    }
  } else if (type === "plan") {
    body = data.items.length ? <Plan c={c} /> : <div className="empty">{t("dr.empty.plan")}</div>;
  } else if (type === "history") {
    body = hasAnyClinicalData(data) ? <History c={c} financial={options.financial} /> : <div className="empty">{t("dr.empty.history")}</div>;
  } else {
    body = hasAnyClinicalData(data) ? (
      <>
        <Overview c={c} />
        {options.assessments && <Assessments c={c} />}
        {options.diagnoses && <Diagnoses c={c} />}
        {options.plan && <Plan c={c} />}
        {options.sessions && <Sessions c={c} />}
        {options.followUps && <FollowUps c={c} />}
        {options.history && <History c={c} financial={options.financial} />}
        {options.financial && <Financial c={c} />}
      </>
    ) : <div className="empty">{t("dr.empty.full")}</div>;
  }

  return (
    <div className="doc" dir={lang === "ar" ? "rtl" : "ltr"} lang={lang === "ar" ? "ar" : "en"}>
      <Header c={c} title={title} />
      <PatientBlock c={c} />
      {body}
      <Footer c={c} />
    </div>
  );
}
