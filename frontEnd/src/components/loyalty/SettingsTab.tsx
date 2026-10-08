"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconCheck, IconCopy, IconDiamond, IconHandStop, IconInfoCircle, IconLink, IconLock, IconSparkles, IconSettings } from "@tabler/icons-react";
import { api } from "@/lib/api";
import { apiError, fmtNum, pointsWord, prefersReducedMotion, useLoyaltyBrand, useLoyaltySettings, useLT, useSaveLoyaltySettings, type SettingsPatchBody } from "@/lib/loyalty";
import type { Clinic } from "@/lib/types";
import { useFlash } from "./parts";
import LoyaltyCard3D from "./LoyaltyCard3D";
import { LoyaltyErrorState, LoyaltyLoader, LoyaltyPanel, LoyaltySurface, LyxSwitch, SuccessBurst } from "./ui/LoyaltyUI";

/* ---------- strict client-side parsing (the server re-validates everything) ---------- */
const parseIntStr = (s: string) => (/^\d{1,6}$/.test(s.trim()) ? Number(s.trim()) : NaN);
const parseJod = (s: string) => (/^\d{1,7}(\.\d{1,3})?$/.test(s.trim()) ? Number(s.trim()) : NaN);

interface Draft {
  vEnabled: boolean;
  vPoints: string;
  sEnabled: boolean;
  sAmount: string;
  sPoints: string;
}

export default function SettingsTab() {
  const { t } = useLT();
  const q = useLoyaltySettings();
  const save = useSaveLoyaltySettings();
  const flash = useFlash();
  const [name, setName] = useState("");
  const [pending, setPending] = useState<"program" | "name" | "earning" | "checkin" | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const celebrateTimer = useRef<ReturnType<typeof setTimeout>>();

  const s = q.data?.settings;
  const serverName = s?.branding.displayName ?? "";
  const serverDraft: Draft | null = useMemo(
    () =>
      s
        ? {
            vEnabled: s.earning.visits.enabled,
            vPoints: s.earning.visits.pointsPerVisit != null ? String(s.earning.visits.pointsPerVisit) : "",
            sEnabled: s.earning.spending.enabled,
            sAmount: s.earning.spending.spendAmount != null ? String(s.earning.spending.spendAmount) : "",
            sPoints: s.earning.spending.pointsPerSpendAmount != null ? String(s.earning.spending.pointsPerSpendAmount) : "",
          }
        : null,
    // re-sync whenever the SERVER copy changes (after load and after every confirmed save)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q.data]
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => setName(serverName), [serverName, s?.updatedAt]);
  useEffect(() => setDraft(serverDraft), [serverDraft]);
  useEffect(() => () => clearTimeout(celebrateTimer.current), []);

  const clinic = useQuery({ queryKey: ["clinic"], queryFn: async () => (await api.get<Clinic>("/clinic")).data, staleTime: 30_000 });

  const brand = useLoyaltyBrand();
  if (q.isError) return <LoyaltyErrorState message={apiError(q.error, t("Couldn't load settings", "تعذّر تحميل الإعدادات")).message} onRetry={() => q.refetch()} />;
  if (q.isLoading || !q.data || !s || !draft || !serverDraft) return <LoyaltyLoader className="h-64" />;

  const { canConfigure, limits } = q.data;
  const L = {
    visit: limits?.pointsPerVisit ?? { min: 1, max: 10000 },
    pts: limits?.pointsPerSpendAmount ?? { min: 1, max: 10000 },
    amt: limits?.spendAmount ?? { min: 0.001, max: 1000000 },
  };

  /* ---------- validation of the DRAFT (only matters while a mode is on) ---------- */
  const vPts = parseIntStr(draft.vPoints);
  const sAmt = parseJod(draft.sAmount);
  const sPts = parseIntStr(draft.sPoints);
  const errs = {
    vPoints: draft.vEnabled && !(vPts >= L.visit.min && vPts <= L.visit.max) ? t(`Enter a whole number from ${L.visit.min} to ${fmtNum(L.visit.max)}`, `أدخل رقمًا صحيحًا من ${L.visit.min} إلى ${fmtNum(L.visit.max)}`) : null,
    sAmount: draft.sEnabled && !(sAmt >= L.amt.min && sAmt <= L.amt.max) ? t(`Enter an amount from ${L.amt.min} JOD (up to 3 decimals)`, `أدخل مبلغًا من ${L.amt.min} دينار (حتى 3 خانات عشرية)`) : null,
    sPoints: draft.sEnabled && !(sPts >= L.pts.min && sPts <= L.pts.max) ? t(`Enter a whole number from ${L.pts.min} to ${fmtNum(L.pts.max)}`, `أدخل رقمًا صحيحًا من ${L.pts.min} إلى ${fmtNum(L.pts.max)}`) : null,
  };
  const hasErr = !!(errs.vPoints || errs.sAmount || errs.sPoints);
  const earningDirty = JSON.stringify(draft) !== JSON.stringify(serverDraft);

  /* ---------- live explanation: built ONLY from what the doctor has typed ---------- */
  const lines: string[] = [];
  if (draft.vEnabled && !errs.vPoints) {
    lines.push(t(`Patients will receive ${pointsWord(vPts, "en")} for every completed visit.`, `سيحصل المرضى على ${pointsWord(vPts, "ar")} عن كل زيارة مكتملة.`));
  }
  if (draft.sEnabled && !errs.sAmount && !errs.sPoints) {
    lines.push(t(`Patients will receive ${pointsWord(sPts, "en")} for every ${fmtNum(sAmt)} JOD paid.`, `سيحصل المرضى على ${pointsWord(sPts, "ar")} عن كل ${fmtNum(sAmt)} دينار مدفوع.`));
  }

  const run = (kind: "program" | "name" | "earning" | "checkin", body: SettingsPatchBody) => {
    setPending(kind);
    save.mutate(body, {
      onSuccess: (d) => {
        flash.show("ok", d.message ?? t("Saved", "تم الحفظ"));
        if (kind === "earning" && d.earningChanged) {
          // Shown ONLY after the server confirmed the save.
          setCelebrate(true);
          clearTimeout(celebrateTimer.current);
          celebrateTimer.current = setTimeout(() => setCelebrate(false), prefersReducedMotion() ? 3200 : 2800);
        }
      },
      onError: (e) => flash.show("err", apiError(e, t("Couldn't save settings", "تعذّر حفظ الإعدادات")).message),
      onSettled: () => setPending(null),
    });
  };

  const saveEarning = () => {
    const body: SettingsPatchBody = { earning: {} };
    const sv = serverDraft;
    if (draft.vEnabled !== sv.vEnabled || draft.vPoints !== sv.vPoints) {
      body.earning!.visits = { enabled: draft.vEnabled, pointsPerVisit: Number.isFinite(vPts) ? vPts : null };
    }
    if (draft.sEnabled !== sv.sEnabled || draft.sAmount !== sv.sAmount || draft.sPoints !== sv.sPoints) {
      body.earning!.spending = { enabled: draft.sEnabled, spendAmount: Number.isFinite(sAmt) ? sAmt : null, pointsPerSpendAmount: Number.isFinite(sPts) ? sPts : null };
    }
    run("earning", body);
  };

  const nameDirty = name.trim() !== serverName;
  const base = typeof window !== "undefined" ? window.location.origin : "";
  const publicUrl = clinic.data?.slug ? `${base}/c/${clinic.data.slug}/loyalty` : "";

  const field = "inp tabular-nums";

  const cardName = name.trim() || brand.clinicName;
  const note = (txt: string, k?: "gold") => (
    <p className="lyx-rd-note" data-k={k} style={{ marginTop: 0 }}>
      <IconInfoCircle size={13} />
      {txt}
    </p>
  );

  return (
    <div className="relative space-y-3" data-testid="settings-root">
      {flash.node}
      {!canConfigure && (
        <div className="lyx-an-note" style={{ color: "var(--lyx-text2)", background: "rgba(255,244,214,.04)", borderColor: "var(--lyx-line)" }}>
          <IconLock size={15} style={{ flex: "none", marginTop: 1 }} />
          {t("Only the clinic owner or doctor can change Loyalty settings.", "يمكن لمالك العيادة أو الطبيب فقط تغيير إعدادات الولاء.")}
        </div>
      )}

      {/* ===== Program ===== */}
      <LoyaltyPanel title={t("Program", "البرنامج")} subtitle={t("Turn Loyalty on or off and choose how your card is named.", "فعّل الولاء أو أوقفه واختر اسم بطاقتك.")} icon={<IconSettings size={16} />} index={0}>
        <div className="lyx-st-split">
          <div className="lyx-st-sec">
            <div className="lyx-st-row">
              <div className="min-w-0">
                <h4>{t("Loyalty program is on", "برنامج الولاء مفعّل")}</h4>
                <p>{t("When off, new members can't be enrolled, earning pauses and patients can't open their card. Existing members and history are kept.", "عند الإيقاف لا يمكن تسجيل أعضاء جدد، وتتوقف النقاط، ولا يستطيع المرضى فتح بطاقتهم. يبقى الأعضاء الحاليون وسجلهم محفوظين.")}</p>
              </div>
              <LyxSwitch checked={s.program.enabled} label={t("Loyalty program on/off", "تفعيل/إيقاف برنامج الولاء")} disabled={!canConfigure || pending !== null} busy={pending === "program"} onChange={() => run("program", { program: { enabled: !s.program.enabled } })} testId="program-switch" />
            </div>
            <div>
              <label className="lbl" htmlFor="lyc-name">
                {t("Program name (shown on the card)", "اسم البرنامج (يظهر على البطاقة)")}
              </label>
              <div className="lyx-link-row">
                <input id="lyc-name" className="inp" value={name} maxLength={60} disabled={!canConfigure} onChange={(e) => setName(e.target.value)} placeholder={t("Leave empty to use the clinic name", "اتركه فارغًا لاستخدام اسم العيادة")} />
                <button type="button" className="btn-teal" style={{ minHeight: 44 }} disabled={!canConfigure || !nameDirty || pending !== null} onClick={() => run("name", { branding: { displayName: name.trim() || null } })}>
                  {pending === "name" && <span className="lyc-spinner" aria-hidden="true" />}
                  {t("Save", "حفظ")}
                </button>
              </div>
            </div>
          </div>
          <div className="lyx-st-prev" data-testid="settings-card-preview">
            <small>{t("Preview — as your patients see it", "معاينة — كما يراها مرضاك")}</small>
            <LoyaltyCard3D clinicName={brand.clinicName ?? ""} programName={cardName} memberName={null} balance={null} figure={null} caption={null} badge="CLINICOS" labels={{ points: t("POINTS", "النقاط"), preview: t("PREVIEW", "معاينة"), memberPlaceholder: t("MEMBER NAME", "اسم العضو"), since: t("SINCE", "منذ") }} />
          </div>
        </div>
      </LoyaltyPanel>

      {/* ===== Earning rules ===== */}
      <LoyaltyPanel title={t("How patients earn points", "كيف يكسب المرضى النقاط")} subtitle={t("Choose visit points, spending points, both, or neither. Nothing is awarded until you turn a mode on and save.", "اختر نقاط الزيارات أو نقاط الإنفاق أو كليهما أو لا شيء. لا تُمنح أي نقاط حتى تفعّل نمطًا وتحفظ.")} icon={<IconSparkles size={16} />} index={1} className="relative overflow-hidden">
        <div className="grid gap-3 lg:grid-cols-2">
          {/* visits */}
          <div className="lyx-mode" data-on={draft.vEnabled ? "true" : "false"}>
            <div className="lyx-st-row" style={{ marginBottom: 12 }}>
              <div className="min-w-0">
                <h4>{t("Points on visits", "نقاط الزيارات")}</h4>
                <p>{t("When an appointment is marked completed.", "عند تحويل الموعد إلى «مكتمل».")}</p>
              </div>
              <LyxSwitch checked={draft.vEnabled} label={t("Points on visits", "نقاط الزيارات")} disabled={!canConfigure} onChange={() => setDraft({ ...draft, vEnabled: !draft.vEnabled })} testId="visit-switch" />
            </div>
            <label className="lbl" htmlFor="lyc-vpts">
              {t("Points per completed visit", "نقاط كل زيارة مكتملة")}
            </label>
            <input id="lyc-vpts" className={field} inputMode="numeric" disabled={!canConfigure || !draft.vEnabled} value={draft.vPoints} onChange={(e) => setDraft({ ...draft, vPoints: e.target.value })} placeholder="—" aria-invalid={!!errs.vPoints} dir="ltr" />
            {errs.vPoints && (
              <p className="mt-1 text-[11px]" style={{ color: "var(--lyx-danger)" }} role="alert">
                {errs.vPoints}
              </p>
            )}
          </div>

          {/* spending */}
          <div className="lyx-mode" data-on={draft.sEnabled ? "true" : "false"}>
            <div className="lyx-st-row" style={{ marginBottom: 12 }}>
              <div className="min-w-0">
                <h4>{t("Points on spending", "نقاط الإنفاق")}</h4>
                <p>{t("Based on what the patient actually pays.", "بناءً على ما يدفعه المريض فعليًا.")}</p>
              </div>
              <LyxSwitch checked={draft.sEnabled} label={t("Points on spending", "نقاط الإنفاق")} disabled={!canConfigure} onChange={() => setDraft({ ...draft, sEnabled: !draft.sEnabled })} testId="spend-switch" />
            </div>
            <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
              <div className="min-w-0 flex-1 basis-24">
                <label className="lbl" htmlFor="lyc-samt">
                  {t("For every (JOD)", "عن كل (دينار)")}
                </label>
                <input id="lyc-samt" className={field} inputMode="decimal" disabled={!canConfigure || !draft.sEnabled} value={draft.sAmount} onChange={(e) => setDraft({ ...draft, sAmount: e.target.value })} placeholder="—" aria-invalid={!!errs.sAmount} dir="ltr" />
              </div>
              <div className="min-w-0 flex-1 basis-24">
                <label className="lbl" htmlFor="lyc-spts">
                  {t("Give (points)", "امنح (نقاط)")}
                </label>
                <input id="lyc-spts" className={field} inputMode="numeric" disabled={!canConfigure || !draft.sEnabled} value={draft.sPoints} onChange={(e) => setDraft({ ...draft, sPoints: e.target.value })} placeholder="—" aria-invalid={!!errs.sPoints} dir="ltr" />
              </div>
            </div>
            {(errs.sAmount || errs.sPoints) && (
              <p className="mt-1 text-[11px]" style={{ color: "var(--lyx-danger)" }} role="alert">
                {errs.sAmount ?? errs.sPoints}
              </p>
            )}
          </div>
        </div>

        {/* live explanation */}
        <div aria-live="polite" className="lyx-rule" style={{ marginTop: 14 }} data-testid="settings-rule-preview">
          <div className="lyx-rule-k">
            <IconDiamond size={12} /> {t("What patients will get", "ماذا سيحصل المرضى")}
          </div>
          {lines.length ? (
            <ul style={{ margin: 0, padding: 0 }}>
              {lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs leading-relaxed" style={{ color: "var(--lyx-text2)" }}>{draft.vEnabled || draft.sEnabled ? t("Complete the values above to see the rule.", "أكمل القيم أعلاه لرؤية القاعدة.") : t("No points are awarded automatically. Turn a mode on and enter your own values.", "لا تُمنح أي نقاط تلقائيًا. فعّل نمطًا وأدخل قيمك الخاصة.")}</p>
          )}
          <div style={{ marginTop: 12 }}>
            {note(t("New rules apply to future completed visits and future payments only — past visits and payments are never recalculated. Only patients already enrolled in Loyalty earn points.", "تُطبَّق القواعد الجديدة على الزيارات المكتملة والمدفوعات المستقبلية فقط — لا يُعاد احتساب الماضي أبدًا. يكسب النقاط فقط المرضى المسجَّلون في الولاء."))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          {earningDirty && <span className="text-[11px]" style={{ color: "var(--lyx-gold)" }}>{t("Unsaved changes", "تغييرات غير محفوظة")}</span>}
          {earningDirty && canConfigure && (
            <button type="button" className="btn-ghost text-xs" disabled={pending !== null} onClick={() => setDraft(serverDraft)}>
              {t("Discard", "تراجع")}
            </button>
          )}
          <button type="button" className="btn-teal" style={{ minHeight: 44 }} disabled={!canConfigure || !earningDirty || hasErr || pending !== null} onClick={saveEarning} data-testid="earning-save">
            {pending === "earning" && <span className="lyc-spinner" aria-hidden="true" />}
            {pending === "earning" ? t("Saving…", "جارٍ الحفظ…") : t("Save earning rules", "حفظ قواعد النقاط")}
          </button>
        </div>

        {/* premium confirmation — rendered only after the backend confirmed */}
        {celebrate && (
          <div role="status" className="lyx-st-celebrate" onClick={() => setCelebrate(false)} data-testid="settings-saved-moment">
            <SuccessBurst tone="gold" />
            <b>{t("LOYALTY EARNING RULES UPDATED", "تم تحديث قواعد نقاط الولاء")}</b>
            <p>{t("Your new rules apply from now on.", "تُطبَّق القواعد الجديدة من الآن فصاعدًا.")}</p>
          </div>
        )}
      </LoyaltyPanel>

      {/* ===== Patient check-in (Phase 5) ===== */}
      <LoyaltyPanel title={t("Patient check-in", "تسجيل وصول المرضى")} icon={<IconHandStop size={16} />} index={2}>
        <div className="lyx-st-split">
          <div className="lyx-st-sec">
            <div className="lyx-st-row">
              <div className="min-w-0">
                <h4>{t("Let patients tell reception they've arrived", "اسمح للمرضى بإبلاغ الاستقبال بوصولهم")}</h4>
                <p>
                  {t(
                    "When on, patients see an “I'm here” button on their Loyalty page. Each tap creates a request that your reception team confirms in the Check-ins section. A check-in never awards points. Turn it on only when someone at the desk will watch the Check-ins section.",
                    "عند التفعيل يرى المرضى زر «وصلت» في صفحة الولاء. كل ضغطة تُنشئ طلبًا يؤكده فريق الاستقبال من قسم تسجيل الوصول. تسجيل الوصول لا يمنح أي نقاط. فعّله فقط عندما يتابع أحدٌ في الاستقبال قسم تسجيل الوصول."
                  )}
                </p>
              </div>
              <LyxSwitch checked={s.checkin.enabled} label={t("Patient check-in on/off", "تفعيل/إيقاف تسجيل وصول المرضى")} disabled={!canConfigure || pending !== null} busy={pending === "checkin"} onChange={() => run("checkin", { checkin: { enabled: !s.checkin.enabled } })} testId="ck-switch" />
            </div>
            {!s.program.enabled && s.checkin.enabled && note(t("The Loyalty program is off, so patients can't open their page or check in until you turn it on.", "برنامج الولاء متوقف، لذلك لا يستطيع المرضى فتح صفحتهم أو تسجيل الوصول حتى تفعّله."), "gold")}
          </div>
          <div className="lyx-ck-prev" data-off={s.checkin.enabled ? "false" : "true"} aria-hidden="true" data-testid="settings-checkin-preview">
            <small style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--lyx-text3)" }}>{s.checkin.enabled ? t("Patients will see", "سيرى المرضى") : t("Hidden from patients", "مخفي عن المرضى")}</small>
            <span className="btn">
              <IconHandStop size={18} /> {t("I'm here", "وصلت")}
            </span>
          </div>
        </div>
      </LoyaltyPanel>

      {/* ===== Public link ===== */}
      <PublicLink url={publicUrl} checkIn={s.checkin.enabled} />

      <p className="lyx-rd-note" style={{ paddingInline: 4 }}>
        <IconInfoCircle size={14} />
        {t("Point expiration and anti-abuse limits will be available in a later version. Rewards are managed in the Rewards section and tiers in the Tiers section.", "سيتوفر انتهاء صلاحية النقاط وحدود منع الإساءة في إصدار لاحق. تُدار الجوائز من قسم الجوائز والمستويات من قسم المستويات.")}
      </p>
    </div>
  );
}

function PublicLink({ url, checkIn }: { url: string; checkIn: boolean }) {
  const { t } = useLT();
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.getElementById(`lyc-url-${id}`) as HTMLInputElement | null;
      el?.select();
      document.execCommand("copy");
    }
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };
  // Same page for every channel. `?src=` only tells the clinic HOW the patient arrived (shown in the check-in list).
  const links = [
    { id: "link", label: t("Patient Loyalty link", "رابط الولاء للمرضى"), url },
    ...(checkIn && url
      ? [
          { id: "qr", label: t("For your QR code", "لرمز QR الخاص بك"), url: `${url}?src=qr` },
          { id: "nfc", label: t("For your NFC tag", "لوسم NFC الخاص بك"), url: `${url}?src=nfc` },
        ]
      : []),
  ];
  return (
    <LoyaltyPanel title={t("Patient Loyalty link", "رابط الولاء للمرضى")} icon={<IconLink size={16} />} index={3}>
      <p className="mb-3 text-[11.5px] leading-relaxed" style={{ color: "var(--lyx-text2)" }}>
        {checkIn
          ? t("Patients open this page to see their card and points — no app or account needed. Opening it never awards points and never checks anyone in; patients tap “I'm here” themselves. Use the QR / NFC variants below so the check-in list shows how each patient arrived.", "يفتح المرضى هذه الصفحة لرؤية بطاقتهم ونقاطهم — دون تطبيق أو حساب. فتح الرابط لا يمنح نقاطًا ولا يسجّل وصول أحد؛ المريض يضغط «وصلت» بنفسه. استخدم نسختي QR وNFC أدناه ليعرض سجل الوصول كيف وصل كل مريض.")
          : t("Patients open this page to see their card and points — no app or account needed. Use the same link for your QR code and NFC tag. Opening it never awards points.", "يفتح المرضى هذه الصفحة لرؤية بطاقتهم ونقاطهم — دون تطبيق أو حساب. استخدم الرابط نفسه لرمز QR ووسم NFC. فتح الرابط لا يمنح أي نقاط.")}
      </p>
      <div className="space-y-3">
        {links.map((l) => (
          <div key={l.id}>
            {links.length > 1 && <div className="mb-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--lyx-text3)" }}>{l.label}</div>}
            <div className="lyx-link-row">
              <input id={`lyc-url-${l.id}`} readOnly className="inp" value={l.url} dir="ltr" onFocus={(e) => e.currentTarget.select()} aria-label={l.label} />
              <button type="button" className="btn-ghost inline-flex items-center gap-1.5" style={{ minHeight: 44 }} onClick={() => copy(l.url, l.id)} disabled={!l.url}>
                {copied === l.id ? <IconCheck size={15} style={{ color: "var(--lyx-mint)" }} /> : <IconCopy size={15} />}
                {copied === l.id ? t("Copied", "تم النسخ") : t("Copy link", "نسخ الرابط")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </LoyaltyPanel>
  );
}
