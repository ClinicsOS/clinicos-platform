"use client";
import { useEffect, useMemo, useState } from "react";
import { IconAlertTriangle, IconCheck, IconEye, IconInfoCircle, IconPlayerPlay, IconPlus, IconRefresh, IconStairsUp, IconTrash, IconTrophy } from "@tabler/icons-react";
import {
  TIER_KEYS,
  apiError,
  fmtMetricValue,
  fmtNum,
  useLT,
  usePreviewTiers,
  useRecalculateTiers,
  useSaveTiersConfig,
  useTierAnalytics,
  useTierHistory,
  useTierText,
  useTiersConfig,
  type RecalcResult,
  type TierConfigBody,
  type TierConfigDto,
  type TierKey,
  type TierLimits,
  type TierMetric,
  type TierPreviewImpact,
  type TierUnit,
} from "@/lib/loyalty";
import Dialog from "./Dialog";
import TierCard3D, { TierBadge } from "./TierCard3D";
import TierWorld from "./TierWorld";
import TierPromotionMoment, { useUnseenPromotion } from "./ui/TierPromotion";
import { LoyaltyEmptyState, LoyaltyErrorState, LoyaltyLoader, LoyaltyMetric, LoyaltyPanel, LoyaltySurface, ProgressRail, SegTabs } from "./ui/LoyaltyUI";
import { TIER_ACCENT } from "./shell/loyaltyDesign";
import { useLoyaltyUi } from "@/lib/loyaltyNav";
import { BenefitList, MiniProgress, TierHistoryList } from "./TierParts";
import { CountUp, EmptyState, ErrorBox, Pager, Panel, Skeleton, useFlash } from "./parts";

/**
 * ClinicOS Loyalty — TIERS (Phase 7).
 * Three views: Overview (the four tiers + real analytics), Configure (owner / doctor), History (real tier changes).
 * The server owns every calculation. The only client-side maths is the "try a value" helper, which applies the published
 * progress formula to a number the user types — it never reads or invents member data.
 */

type View = "overview" | "configure" | "history";

/* ============================================================
 * Draft model + client-side validation (the server re-validates everything)
 * ============================================================ */

interface DraftBenefit {
  title: string;
  description: string;
}
interface DraftSlot {
  name: string;
  threshold: string;
  description: string;
  benefits: DraftBenefit[];
}
interface Draft {
  enabled: boolean;
  metric: TierMetric | null;
  tiers: Record<TierKey, DraftSlot>;
}

const thToStr = (n: number | null) => (n === null ? "" : String(n));
const draftFrom = (c: TierConfigDto): Draft => {
  const tiers = {} as Record<TierKey, DraftSlot>;
  for (const s of c.tiers) {
    tiers[s.key] = { name: s.name, threshold: s.key === "tier1" ? "0" : thToStr(s.threshold), description: s.description ?? "", benefits: s.benefits.map((b) => ({ title: b.title, description: b.description ?? "" })) };
  }
  return { enabled: c.enabled, metric: c.progressionMetric, tiers };
};

const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/;
// built from a string: the project's TS target is below ES6, but every supported browser handles the `u` flag
const NAME_RX = new RegExp("^[\\p{L}\\p{N}\\p{M}][\\p{L}\\p{N}\\p{M} .'’&+\\-]*$", "u");
const squeeze = (s: string) => s.replace(/\s+/g, " ").trim();

const parseThreshold = (metric: TierMetric, raw: string): number => {
  const s = raw.trim();
  const ok = metric === "lifetime_spending" ? /^\d{1,8}(\.\d{1,3})?$/.test(s) : /^\d{1,9}$/.test(s);
  return ok ? Number(s) : NaN;
};

interface SlotErrors {
  name?: string;
  threshold?: string;
  description?: string;
  benefits: (string | null)[];
}
interface Errors {
  metric?: string;
  slots: Record<TierKey, SlotErrors>;
  any: boolean;
}

function validateDraft(d: Draft, L: TierLimits, t: (en: string, ar: string) => string): Errors {
  const slots = {} as Record<TierKey, SlotErrors>;
  let any = false;
  const mark = <T,>(v: T | undefined | null): T | undefined => {
    if (v) any = true;
    return v ?? undefined;
  };
  const seen = new Map<string, TierKey>();
  const metricErr = d.enabled && !d.metric ? t("Choose what progression is based on", "اختر أساس التقدّم بين المستويات") : undefined;
  if (metricErr) any = true;

  for (const k of TIER_KEYS) {
    const s = d.tiers[k];
    const e: SlotErrors = { benefits: [] };
    const raw = s.name;
    const nm = squeeze(raw);
    if (CONTROL.test(raw)) e.name = t("Plain visible characters only", "أحرف ظاهرة عادية فقط");
    else if (nm.length < L.nameMin || nm.length > L.nameMax) e.name = t(`${L.nameMin}–${L.nameMax} characters`, `من ${L.nameMin} إلى ${L.nameMax} حرفًا`);
    else if (!NAME_RX.test(nm)) e.name = t("Letters, numbers, spaces and - ' & + . only", "أحرف وأرقام ومسافات و - ' & + . فقط");
    else if (seen.has(nm.toLocaleLowerCase())) e.name = t("Each tier needs a different name", "لكل مستوى اسم مختلف");
    else seen.set(nm.toLocaleLowerCase(), k);

    const desc = s.description;
    if (CONTROL.test(desc) || /[<>]/.test(desc)) e.description = t("No < > or line breaks", "بدون < > أو أسطر جديدة");
    else if (squeeze(desc).length > L.descriptionMax) e.description = t(`Up to ${L.descriptionMax} characters`, `حتى ${L.descriptionMax} حرفًا`);

    s.benefits.forEach((b, i) => {
      const bt = squeeze(b.title);
      let msg: string | null = null;
      if (CONTROL.test(b.title) || /[<>]/.test(b.title) || CONTROL.test(b.description) || /[<>]/.test(b.description)) msg = t("No < > or line breaks", "بدون < > أو أسطر جديدة");
      else if (bt.length < L.benefitTitleMin || bt.length > L.benefitTitleMax) msg = t(`Title: ${L.benefitTitleMin}–${L.benefitTitleMax} characters`, `العنوان: من ${L.benefitTitleMin} إلى ${L.benefitTitleMax} حرفًا`);
      else if (squeeze(b.description).length > L.benefitDescriptionMax) msg = t(`Description: up to ${L.benefitDescriptionMax} characters`, `الوصف: حتى ${L.benefitDescriptionMax} حرفًا`);
      e.benefits[i] = msg;
      if (msg) any = true;
    });
    if (s.benefits.length > L.benefitsMax) {
      e.description = e.description ?? t(`At most ${L.benefitsMax} benefits`, `حتى ${L.benefitsMax} مزايا كحد أقصى`);
      any = true;
    }
    slots[k] = { ...e, name: mark(e.name), description: mark(e.description), benefits: e.benefits };
  }

  // thresholds — enabled needs all of them; otherwise they're optional, but once any is typed every one is required (server rule)
  const anyTyped = TIER_KEYS.slice(1).some((k) => d.tiers[k].threshold.trim() !== "");
  if ((d.enabled || anyTyped) && d.metric) {
    const max = L.maxThreshold[d.metric];
    let prev = 0;
    let prevOk = true;
    for (const k of TIER_KEYS.slice(1)) {
      const raw = d.tiers[k].threshold;
      const v = raw.trim() === "" ? NaN : parseThreshold(d.metric, raw);
      let msg: string | undefined;
      if (raw.trim() === "") msg = t("Required", "مطلوب");
      else if (!Number.isFinite(v)) msg = d.metric === "lifetime_spending" ? t("A number in JOD, up to 3 decimals", "رقم بالدينار حتى 3 خانات عشرية") : t("A whole number", "رقم صحيح");
      else if (v > max) msg = t(`At most ${fmtNum(max)}`, `الحد الأقصى ${fmtNum(max)}`);
      else if (prevOk && v <= prev) msg = t("Must be higher than the tier before it", "يجب أن يكون أعلى من المستوى السابق");
      if (msg) {
        slots[k].threshold = msg;
        any = true;
      }
      // ordering can only be checked against a valid, accepted previous value
      prevOk = !msg;
      if (!msg) prev = v;
    }
  }
  return { metric: metricErr, slots, any };
}

function bodyFrom(d: Draft): TierConfigBody {
  const tiers = {} as TierConfigBody["tiers"];
  for (const k of TIER_KEYS) {
    const s = d.tiers[k];
    const raw = s.threshold.trim();
    tiers[k] = {
      name: squeeze(s.name),
      threshold: k === "tier1" ? 0 : raw === "" || !d.metric ? null : parseThreshold(d.metric, raw),
      description: squeeze(s.description) || null,
      benefits: s.benefits.map((b) => ({ title: squeeze(b.title), description: squeeze(b.description) || null })),
    };
  }
  return { enabled: d.enabled, progressionMetric: d.metric, tiers };
}

const rulesSig = (d: Draft) => JSON.stringify([d.enabled, d.metric, TIER_KEYS.slice(1).map((k) => d.tiers[k].threshold.trim())]);
const unitOfMetric = (m: TierMetric | null): TierUnit | null => (m === "lifetime_points" ? "points" : m === "completed_visits" ? "visits" : m === "lifetime_spending" ? "jod" : null);

/** Same published formula as the server: floor(( value − current ) / ( next − current ) × 100), 0…99 until the next tier is reached. */
function tryValue(thresholds: number[], v: number) {
  let idx = 0;
  thresholds.forEach((th, i) => {
    if (v >= th) idx = i;
  });
  const top = idx === thresholds.length - 1;
  if (top) return { idx, percent: 100, remaining: 0, top };
  const span = thresholds[idx + 1] - thresholds[idx];
  const ratio = span > 0 ? (v - thresholds[idx]) / span : 0;
  return { idx, percent: Math.max(0, Math.min(99, Math.floor(ratio * 100))), remaining: Math.max(0, thresholds[idx + 1] - v), top };
}

const mergeRun = (a: RecalcResult | null, b: RecalcResult): RecalcResult =>
  a
    ? {
        ...b,
        processed: a.processed + b.processed,
        promoted: a.promoted + b.promoted,
        demoted: a.demoted + b.demoted,
        initial: a.initial + b.initial,
        unchanged: a.unchanged + b.unchanged,
        countersCorrected: a.countersCorrected + b.countersCorrected,
        errors: a.errors + b.errors,
      }
    : b;

/* ============================================================
 * The tab
 * ============================================================ */

export default function TiersTab({ brand, initialView }: { brand: string; initialView?: View }) {
  const { t } = useLT();
  const cfgQ = useTiersConfig();
  const stored = useLoyaltyUi((s) => s.tiersView);
  const setStored = useLoyaltyUi((s) => s.setTiersView);
  const view: View | null = initialView ?? stored;

  const canConfigure = !!cfgQ.data?.canConfigure;
  useEffect(() => {
    if (view !== null || !cfgQ.data) return;
    setStored(cfgQ.data.config.usable || !cfgQ.data.canConfigure ? "overview" : "configure");
  }, [view, cfgQ.data, setStored]);

  if (cfgQ.isError) return <LoyaltyErrorState message={apiError(cfgQ.error, t("Couldn't load tiers", "تعذّر تحميل المستويات")).message} onRetry={() => cfgQ.refetch()} />;
  if (cfgQ.isLoading || !cfgQ.data || view === null) return <LoyaltyLoader className="h-72" />;
  const { config, limits } = cfgQ.data;
  const current: View = view === "configure" && !canConfigure ? "overview" : view;

  return (
    <div className="space-y-3" data-testid="tiers-tab">
      <div className="flex flex-wrap items-center gap-2">
        <SegTabs
          label={t("Tiers view", "عرض المستويات")}
          value={current}
          onChange={setStored}
          items={[
            { id: "overview", label: t("Tiers", "المستويات"), testId: "tiers-view-overview" },
            ...(canConfigure ? [{ id: "configure" as View, label: t("Configure", "الإعداد"), testId: "tiers-view-configure" }] : []),
            { id: "history", label: t("History", "السجل"), testId: "tiers-view-history" },
          ]}
        />
        {!canConfigure && (
          <span className="lyx-chipx" data-testid="tiers-viewonly">
            <IconEye size={13} /> {t("View only", "للعرض فقط")}
          </span>
        )}
      </div>

      {current === "overview" && <TiersOverview config={config} brand={brand} canConfigure={canConfigure} onConfigure={() => setStored("configure")} />}
      {current === "configure" && <TiersConfigure config={config} limits={limits} brand={brand} />}
      {current === "history" && <TiersHistory enabled={config.enabled} />}
    </div>
  );
}

/* ============================================================
 * Overview — the tier world + analytics (real data only)
 * ============================================================ */

function TiersOverview({ config, brand, canConfigure, onConfigure }: { config: TierConfigDto; brand: string; canConfigure: boolean; onConfigure: () => void }) {
  const { t } = useLT();
  const an = useTierAnalytics(config.usable);
  const promo = useUnseenPromotion(config.usable ? an.data?.recentPromotions : null);

  if (!config.usable) {
    return (
      <LoyaltySurface data-pad="true">
        <LoyaltyEmptyState
          kind="tiers"
          icon={<IconStairsUp size={30} stroke={1.5} />}
          title={config.enabled ? t("Tier setup isn't complete.", "إعداد المستويات غير مكتمل.") : t("Tiers are not set up yet.", "المستويات غير مفعّلة بعد.")}
          text={
            canConfigure
              ? t("Choose what progression is based on and set the thresholds for your four tiers. Members keep earning and redeeming points exactly as before.", "اختر أساس التقدّم وحدّد عتبات المستويات الأربعة. يواصل الأعضاء كسب النقاط واستبدالها كما هو.")
              : t("The clinic owner or doctor needs to set up Loyalty tiers.", "على مالك العيادة أو الطبيب إعداد مستويات الولاء.")
          }
          action={
            canConfigure ? (
              <button type="button" className="btn-teal text-xs" onClick={onConfigure} data-testid="tiers-setup-cta">
                <IconStairsUp size={15} /> {t("Set up tiers", "إعداد المستويات")}
              </button>
            ) : undefined
          }
        />
      </LoyaltySurface>
    );
  }

  return (
    <div className="space-y-3">
      <TierWorld config={config} analytics={an.data} brand={brand} canConfigure={canConfigure} onConfigure={onConfigure} />

      {an.isError ? (
        <LoyaltyErrorState message={apiError(an.error, t("Couldn't load tier analytics", "تعذّر تحميل تحليلات المستويات")).message} onRetry={() => an.refetch()} />
      ) : !an.data ? (
        <LoyaltyLoader className="h-40" />
      ) : (
        <Analytics a={an.data} />
      )}
      <TierPromotionMoment row={promo.row} brand={brand} onDone={promo.dismiss} />
    </div>
  );
}

function Analytics({ a }: { a: NonNullable<ReturnType<typeof useTierAnalytics>["data"]> }) {
  const { t } = useLT();
  if (a.totalMembers === 0) {
    return (
      <LoyaltySurface data-pad="true">
        <LoyaltyEmptyState kind="tiers" compact icon={<IconTrophy size={28} stroke={1.5} />} title={t("No members to show yet.", "لا يوجد أعضاء لعرضهم بعد.")} text={t("Tier numbers appear here as soon as patients are enrolled in Loyalty.", "تظهر أرقام المستويات هنا فور تسجيل المرضى في الولاء.")} />
      </LoyaltySurface>
    );
  }
  const tiles = [
    { l: t("Members", "الأعضاء"), v: a.totalMembers, id: "total" },
    { l: `${t("In", "في")} ${a.topTier.name}`, v: a.topTier.count, id: "top" },
    { l: t(`Promotions · last ${a.promotions.windowDays} days`, `الترقيات · آخر ${a.promotions.windowDays} يومًا`), v: a.promotions.count, id: "promos" },
    ...(a.nearNext ? [{ l: t(`Close to next tier (≥ ${a.nearNext.percent}%)`, `قريبون من المستوى التالي (${a.nearNext.percent}% فأكثر)`), v: a.nearNext.total, id: "near" }] : []),
  ];
  return (
    <div className="space-y-3" data-testid="tiers-analytics">
      <div className="lyx-grid-metrics">
        {tiles.map((x, i) => (
          <LoyaltyMetric key={x.id} index={i} tone={x.id === "promos" ? "mint" : undefined} label={x.l} value={x.v} testId={`tiers-stat-${x.id}`} />
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <LoyaltyPanel title={t("Members by tier", "الأعضاء حسب المستوى")} icon={<IconStairsUp size={16} />} index={2}>
          <ul className="lyx-tw-dist" data-testid="tiers-distribution">
            {a.tiers.map((x) => (
              <li key={x.key}>
                <div>
                  <TierBadge tierKey={x.key} name={x.name} size="sm" />
                  <span>
                    <b data-testid={`tiers-count-${x.key}`}>{fmtNum(x.count)}</b> · {x.percent}%
                  </span>
                </div>
                <ProgressRail value={x.percent} max={100} tierColor={TIER_ACCENT[x.key]} height={8} label={`${x.name}: ${x.percent}%`} />
              </li>
            ))}
          </ul>
          {a.unassigned > 0 && <p className="mt-3 text-[11px]" style={{ color: "var(--lyx-text2)" }}>{t(`${fmtNum(a.unassigned)} member(s) are waiting for their first tier calculation.`, `يوجد ${fmtNum(a.unassigned)} عضو بانتظار أول حساب لمستواهم.`)}</p>}
        </LoyaltyPanel>

        <LoyaltyPanel title={t("Recent promotions", "آخر الترقيات")} icon={<IconTrophy size={16} />} index={3}>
          {a.recentPromotions.length === 0 ? (
            <LoyaltyEmptyState kind="tiers" compact icon={<IconTrophy size={28} stroke={1.5} />} title={t("No promotions yet.", "لا توجد ترقيات بعد.")} text={t("A promotion appears here when a member really moves up a tier.", "تظهر الترقية هنا عندما ينتقل عضو فعليًا إلى مستوى أعلى.")} />
          ) : (
            <TierHistoryList rows={a.recentPromotions} showPatient />
          )}
        </LoyaltyPanel>
      </div>
    </div>
  );
}

/* ============================================================
 * History — every real tier change
 * ============================================================ */

function TiersHistory({ enabled }: { enabled: boolean }) {
  const { t } = useLT();
  const [page, setPage] = useState(1);
  const q = useTierHistory(page);
  return (
    <LoyaltyPanel title={t("Tier changes", "تغييرات المستويات")} subtitle={t("Only real changes — a row is written when a member's tier actually moves.", "تغييرات حقيقية فقط — يُكتب سجل عند انتقال مستوى عضو فعليًا.")} icon={<IconTrophy size={16} />} index={0}>
      {q.isError ? (
        <LoyaltyErrorState message={apiError(q.error, t("Couldn't load history", "تعذّر تحميل السجل")).message} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <LoyaltyLoader className="h-32" />
      ) : q.data.history.length === 0 ? (
        <LoyaltyEmptyState
          kind="tiers"
          compact
          icon={<IconTrophy size={28} stroke={1.5} />}
          title={t("No tier changes yet.", "لا توجد تغييرات في المستويات بعد.")}
          text={enabled ? t("A row is added only when a member's tier really changes.", "تُضاف سجلات فقط عند تغيّر مستوى عضو فعليًا.") : t("Tier changes will be recorded once tiers are switched on.", "ستُسجَّل التغييرات عند تفعيل المستويات.")}
        />
      ) : (
        <>
          <TierHistoryList rows={q.data.history} showPatient />
          <Pager page={page} pages={q.data.pages} onPage={setPage} />
        </>
      )}
    </LoyaltyPanel>
  );
}

const unitLabel = (u: TierUnit | null, t: (en: string, ar: string) => string) => (u === "points" ? t("POINTS", "نقطة") : u === "visits" ? t("VISITS", "زيارة") : u === "jod" ? t("JOD", "دينار") : "");

/* ============================================================
 * Configure (owner / doctor)
 * ============================================================ */

function TiersConfigure({ config, limits, brand }: { config: TierConfigDto; limits: TierLimits; brand: string }) {
  const { t } = useLT();
  const save = useSaveTiersConfig();
  const preview = usePreviewTiers();
  const flash = useFlash();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(config));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [impact, setImpact] = useState<TierPreviewImpact | null>(null);
  const [run, setRun] = useState<{ result: RecalcResult; label: string } | null>(null);

  const server = useMemo(() => draftFrom(config), [config]);
  useEffect(() => {
    setDraft(draftFrom(config));
    setImpact(null);
  }, [config]);

  const errs = useMemo(() => validateDraft(draft, limits, t), [draft, limits, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(draft) !== JSON.stringify(server);
  const rulesDirty = draft.enabled && rulesSig(draft) !== rulesSig(server);
  const unit = unitOfMetric(draft.metric);
  const complete = !!draft.metric && TIER_KEYS.slice(1).every((k) => draft.tiers[k].threshold.trim() !== "");
  const canSave = dirty && !errs.any && !save.isPending && (!draft.enabled || complete);

  const patchSlot = (k: TierKey, p: Partial<DraftSlot>) => {
    setImpact(null);
    setDraft((d) => ({ ...d, tiers: { ...d.tiers, [k]: { ...d.tiers[k], ...p } } }));
  };
  const setMetric = (m: TierMetric) => {
    if (m === draft.metric) return;
    setImpact(null);
    // thresholds are in the metric's unit — carrying "1000" from points over to JOD would silently change its meaning
    setDraft((d) => ({ ...d, metric: m, tiers: Object.fromEntries(TIER_KEYS.map((k) => [k, { ...d.tiers[k], threshold: k === "tier1" ? "0" : "" }])) as Record<TierKey, DraftSlot> }));
  };

  const doSave = async () => {
    setConfirmOpen(false);
    try {
      const r = await save.mutateAsync(bodyFrom(draft));
      flash.show("ok", r.message ?? t("Saved", "تم الحفظ"));
      setImpact(null);
      setRun(r.recalculation ? { result: r.recalculation, label: t("Recalculation after saving", "إعادة الحساب بعد الحفظ") } : null);
    } catch (e) {
      flash.show("err", apiError(e, t("Couldn't save tier settings", "تعذّر حفظ إعدادات المستويات")).message);
    }
  };
  const onSave = () => (rulesDirty ? setConfirmOpen(true) : doSave());

  const checkImpact = async () => {
    try {
      setImpact((await preview.mutateAsync(bodyFrom(draft))).impact);
    } catch (e) {
      setImpact(null);
      flash.show("err", apiError(e, t("Couldn't calculate the impact", "تعذّر حساب الأثر")).message);
    }
  };

  const metrics: { key: TierMetric; title: string; text: string }[] = [
    { key: "lifetime_points", title: t("Lifetime points", "إجمالي النقاط المكتسبة"), text: t("All visit and spending points the member has ever earned. Redeeming or expiring points never lowers it. Manual credits aren't counted.", "كل نقاط الزيارات والإنفاق التي كسبها العضو. الاستبدال أو انتهاء الصلاحية لا يخفضها. الإضافات اليدوية لا تُحتسب.") },
    { key: "completed_visits", title: t("Completed visits", "الزيارات المكتملة"), text: t("Appointments marked completed. It doesn't depend on points at all.", "المواعيد المحوّلة إلى «مكتمل». لا يعتمد على النقاط إطلاقًا.") },
    { key: "lifetime_spending", title: t("Lifetime spending", "إجمالي الإنفاق"), text: t("Total payments received from the patient, in JOD. It doesn't depend on points at all.", "إجمالي الدفعات المستلمة من المريض بالدينار. لا يعتمد على النقاط إطلاقًا.") },
  ];

  // "try a value" — only when the draft thresholds are all valid
  const thresholdsValid = !!draft.metric && complete && !TIER_KEYS.slice(1).some((k) => errs.slots[k].threshold);
  const thresholds = thresholdsValid ? TIER_KEYS.map((k) => (k === "tier1" ? 0 : parseThreshold(draft.metric as TierMetric, draft.tiers[k].threshold))) : null;

  return (
    <div className="space-y-3" data-testid="tiers-configure">
      {flash.node}

      {/* ===== switch + metric ===== */}
      <Panel className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs font-medium text-ink">{t("Loyalty tiers", "مستويات الولاء")}</div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-mute">
              {t("Four tiers members move through as they progress. Turning tiers off hides them everywhere but keeps all tier data.", "أربعة مستويات ينتقل بينها الأعضاء مع تقدّمهم. إيقاف المستويات يخفيها من كل مكان مع الاحتفاظ بكل بيانات المستويات.")}
            </p>
          </div>
          <button
            role="switch"
            aria-checked={draft.enabled}
            aria-label={t("Tiers on/off", "تفعيل/إيقاف المستويات")}
            data-testid="tiers-switch"
            onClick={() => (setImpact(null), setDraft((d) => ({ ...d, enabled: !d.enabled })))}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${draft.enabled ? "bg-teal" : "bg-edge"}`}
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${draft.enabled ? "start-6" : "start-1"}`} />
          </button>
        </div>

        <div className="mt-4 border-t border-edge pt-4">
          <div className="mb-2 text-xs font-medium text-ink" id="tiers-metric-label">
            {t("Progression is based on", "التقدّم مبني على")}
          </div>
          <div className="grid gap-2 md:grid-cols-3" role="radiogroup" aria-labelledby="tiers-metric-label">
            {metrics.map((m) => (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={draft.metric === m.key}
                data-testid={`tiers-metric-${m.key}`}
                onClick={() => setMetric(m.key)}
                className={`min-w-0 rounded-2xl border p-3 text-start transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky ${draft.metric === m.key ? "border-amber-300/60 bg-amber-300/10" : "border-edge bg-soft hover:border-sky"}`}
              >
                <div className="mb-1 flex items-center gap-2 text-xs font-medium text-ink">
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${draft.metric === m.key ? "border-amber-300 bg-amber-300 text-[#3a280a]" : "border-mute"}`}>{draft.metric === m.key && <IconCheck size={11} stroke={3} />}</span>
                  {m.title}
                </div>
                <p className="text-[11px] leading-relaxed text-mute">{m.text}</p>
              </button>
            ))}
          </div>
          {errs.metric && (
            <p className="mt-2 text-[11px] text-red-400" role="alert">
              {errs.metric}
            </p>
          )}
          <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-mute">
            <IconInfoCircle size={13} className="mt-0.5 shrink-0" />
            {t("Progression never uses the available points balance, so redeeming a reward can't lower a member's tier. Only ONE metric is used at a time.", "لا يستخدم التقدّم رصيد النقاط المتاح أبدًا، لذلك استبدال مكافأة لا يخفض مستوى العضو. يُستخدم مقياس واحد فقط في كل مرة.")}
          </p>
        </div>
      </Panel>

      {/* ===== four tiers ===== */}
      <div className="grid gap-3 lg:grid-cols-2">
        {TIER_KEYS.map((k, i) => {
          const s = draft.tiers[k];
          const e = errs.slots[k];
          const def = config.tiers.find((x) => x.key === k)?.defaultName ?? "";
          const thNum = k === "tier1" ? 0 : draft.metric && s.threshold.trim() !== "" && !e.threshold ? parseThreshold(draft.metric, s.threshold) : NaN;
          return (
            <Panel key={k} className="p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-xs font-medium text-ink">
                  {t("Tier", "المستوى")} {i + 1}
                </h3>
                <TierBadge tierKey={k} name={squeeze(s.name) || def} size="sm" />
              </div>
              <TierCard3D
                tierKey={k}
                tierName={squeeze(s.name) || def}
                brand={brand}
                tierWord={t("TIER", "المستوى")}
                centerLabel={`${k === "tier1" ? t("BASE TIER", "المستوى الأساسي") : t("STARTS AT", "يبدأ من")}${unit ? ` · ${unitLabel(unit, t)}` : ""}`}
                centerValue={Number.isFinite(thNum) ? fmtMetricValue(thNum, unit) : null}
                holder={squeeze(s.description) || null}
                testId={`tier-edit-card-${k}`}
                tilt={false}
              />

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <label className="lbl" htmlFor={`tier-name-${k}`}>
                    {t("Display name", "الاسم المعروض")} <span className="text-mute/70">({squeeze(s.name).length}/{limits.nameMax})</span>
                  </label>
                  <input id={`tier-name-${k}`} data-testid={`tier-name-${k}`} className="inp" maxLength={limits.nameMax + 8} value={s.name} onChange={(ev) => patchSlot(k, { name: ev.target.value })} aria-invalid={!!e.name} dir="auto" />
                  {e.name && (
                    <p className="mt-1 text-[11px] text-red-400" role="alert">
                      {e.name}
                    </p>
                  )}
                </div>
                <div className="min-w-0">
                  <label className="lbl" htmlFor={`tier-th-${k}`}>
                    {k === "tier1" ? t("Starts at", "يبدأ من") : t("Reached at", "يُبلَغ عند")} {unit ? `(${unitLabel(unit, t).toLowerCase()})` : ""}
                  </label>
                  {k === "tier1" ? (
                    <input id={`tier-th-${k}`} data-testid={`tier-th-${k}`} className="inp text-center tabular-nums" value="0" readOnly disabled dir="ltr" aria-label={t("Base tier starts at 0", "المستوى الأساسي يبدأ من 0")} />
                  ) : (
                    <input
                      id={`tier-th-${k}`}
                      data-testid={`tier-th-${k}`}
                      className="inp text-center tabular-nums"
                      inputMode="decimal"
                      value={s.threshold}
                      disabled={!draft.metric}
                      onChange={(ev) => patchSlot(k, { threshold: ev.target.value })}
                      placeholder={draft.metric ? "—" : t("Choose a metric first", "اختر المقياس أولًا")}
                      aria-invalid={!!e.threshold}
                      dir="ltr"
                    />
                  )}
                  {e.threshold && (
                    <p className="mt-1 text-[11px] text-red-400" role="alert">
                      {e.threshold}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-3">
                <label className="lbl" htmlFor={`tier-desc-${k}`}>
                  {t("Short description (optional)", "وصف قصير (اختياري)")} <span className="text-mute/70">({squeeze(s.description).length}/{limits.descriptionMax})</span>
                </label>
                <input id={`tier-desc-${k}`} data-testid={`tier-desc-${k}`} className="inp" maxLength={limits.descriptionMax + 20} value={s.description} onChange={(ev) => patchSlot(k, { description: ev.target.value })} aria-invalid={!!e.description} dir="auto" />
                {e.description && (
                  <p className="mt-1 text-[11px] text-red-400" role="alert">
                    {e.description}
                  </p>
                )}
              </div>

              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-mute">
                    {t("Benefits (information only)", "المزايا (معلومات فقط)")} <span className="text-mute/70">({s.benefits.length}/{limits.benefitsMax})</span>
                  </span>
                  <button type="button" className="inline-flex items-center gap-1 text-[11px] text-sky hover:underline disabled:opacity-40" disabled={s.benefits.length >= limits.benefitsMax} data-testid={`tier-add-benefit-${k}`} onClick={() => patchSlot(k, { benefits: [...s.benefits, { title: "", description: "" }] })}>
                    <IconPlus size={12} /> {t("Add benefit", "إضافة ميزة")}
                  </button>
                </div>
                {s.benefits.length === 0 && <p className="text-[11px] text-mute">{t("No benefits listed.", "لا توجد مزايا معروضة.")}</p>}
                <ul className="space-y-2">
                  {s.benefits.map((b, bi) => (
                    <li key={bi} className="rounded-xl border border-edge bg-soft p-2.5">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <input aria-label={t("Benefit title", "عنوان الميزة")} data-testid={`tier-benefit-title-${k}-${bi}`} className="inp !py-1.5 text-xs" maxLength={limits.benefitTitleMax + 10} value={b.title} onChange={(ev) => patchSlot(k, { benefits: s.benefits.map((x, xi) => (xi === bi ? { ...x, title: ev.target.value } : x)) })} placeholder={t("Title", "العنوان")} dir="auto" />
                          <input aria-label={t("Benefit description", "وصف الميزة")} className="inp !py-1.5 text-xs" maxLength={limits.benefitDescriptionMax + 10} value={b.description} onChange={(ev) => patchSlot(k, { benefits: s.benefits.map((x, xi) => (xi === bi ? { ...x, description: ev.target.value } : x)) })} placeholder={t("Short description (optional)", "وصف قصير (اختياري)")} dir="auto" />
                        </div>
                        <button type="button" aria-label={t("Remove benefit", "حذف الميزة")} onClick={() => patchSlot(k, { benefits: s.benefits.filter((_, xi) => xi !== bi) })} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-mute hover:bg-card hover:text-red-400">
                          <IconTrash size={14} />
                        </button>
                      </div>
                      {e.benefits[bi] && (
                        <p className="mt-1 text-[11px] text-red-400" role="alert">
                          {e.benefits[bi]}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>
          );
        })}
      </div>

      {/* ===== live preview ===== */}
      <TryValue thresholds={thresholds} draft={draft} unit={unit} />

      {/* ===== warning + impact + save ===== */}
      <Panel className="p-4">
        {rulesDirty && (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-[11px] leading-relaxed text-amber-300" role="alert" data-testid="tiers-rules-warning">
            <IconAlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>{t("Changing progression rules may recalculate member tiers.", "تغيير قواعد التقدّم قد يعيد حساب مستويات الأعضاء.")}</span>
          </div>
        )}
        {rulesDirty && config.usable && !errs.any && complete && (
          <div className="mb-3">
            <button type="button" className="btn-ghost text-xs" disabled={preview.isPending} onClick={checkImpact} data-testid="tiers-check-impact">
              {preview.isPending ? <span className="lyc-spinner" aria-hidden="true" /> : <IconEye size={14} />} {t("Check exact impact", "فحص الأثر الدقيق")}
            </button>
            {impact && <ImpactBox impact={impact} />}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {dirty && <span className="text-[11px] text-amber-300">{t("Unsaved changes", "تغييرات غير محفوظة")}</span>}
          {dirty && (
            <button className="btn-ghost text-xs" disabled={save.isPending} onClick={() => (setDraft(server), setImpact(null))}>
              {t("Discard", "تراجع")}
            </button>
          )}
          <button className="btn-teal" disabled={!canSave} onClick={onSave} data-testid="tiers-save">
            {save.isPending && <span className="lyc-spinner" aria-hidden="true" />}
            {save.isPending ? t("Saving…", "جارٍ الحفظ…") : t("Save tier settings", "حفظ إعدادات المستويات")}
          </button>
        </div>
      </Panel>

      {run && <RunSummary run={run} onChange={setRun} />}

      {config.usable && <Maintenance onRun={setRun} />}

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} title={t("Save and recalculate?", "حفظ وإعادة الحساب؟")} testId="tiers-confirm">
        <p className="text-xs leading-relaxed text-mute">{t("Changing progression rules may recalculate member tiers. Members whose numbers no longer match their tier will be moved, and each change is recorded in the tier history.", "تغيير قواعد التقدّم قد يعيد حساب مستويات الأعضاء. سيُنقل الأعضاء الذين لم تعد أرقامهم تطابق مستواهم، ويُسجَّل كل تغيير في سجل المستويات.")}</p>
        <p className="mt-2 text-xs leading-relaxed text-mute">{t("Points balances and the points history are never touched.", "أرصدة النقاط وسجل النقاط لا يُمسّان أبدًا.")}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost text-xs" onClick={() => setConfirmOpen(false)}>
            {t("Cancel", "إلغاء")}
          </button>
          <button className="btn-teal text-xs" onClick={doSave} data-testid="tiers-confirm-save">
            {t("Save and recalculate", "حفظ وإعادة الحساب")}
          </button>
        </div>
      </Dialog>
    </div>
  );
}

/* ---------- "try a value": the published formula applied to a typed number (not member data) ---------- */

function TryValue({ thresholds, draft, unit }: { thresholds: number[] | null; draft: Draft; unit: TierUnit | null }) {
  const { t } = useLT();
  const tx = useTierText();
  const [raw, setRaw] = useState("");
  const v = draft.metric && raw.trim() !== "" ? parseThreshold(draft.metric, raw) : NaN;
  const res = thresholds && Number.isFinite(v) ? tryValue(thresholds, v) : null;
  const key = res ? TIER_KEYS[res.idx] : null;
  return (
    <Panel className="p-4">
      <h3 className="mb-1 text-xs font-medium text-ink">{t("Try a value", "جرّب قيمة")}</h3>
      <p className="mb-3 text-[11px] leading-relaxed text-mute">{t("Preview only: type any number to see which tier it would reach under the settings above. It isn't a real member.", "معاينة فقط: اكتب أي رقم لترى أي مستوى سيبلغ وفق الإعدادات أعلاه. ليس عضوًا حقيقيًا.")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-40 max-w-full">
          <label className="lbl" htmlFor="tiers-try">
            {draft.metric ? tx.metricName(draft.metric) : t("Value", "القيمة")}
          </label>
          <input id="tiers-try" data-testid="tiers-try" className="inp text-center tabular-nums" inputMode="decimal" value={raw} disabled={!thresholds} onChange={(e) => setRaw(e.target.value)} placeholder={thresholds ? "—" : t("Complete the thresholds", "أكمل العتبات")} dir="ltr" />
        </div>
        <div className="min-w-0 flex-1 basis-56" aria-live="polite" data-testid="tiers-try-result">
          {res && key ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <TierBadge tierKey={key} name={squeeze(draft.tiers[key].name)} />
                <span className="text-xs tabular-nums text-ink">{res.top ? t("Highest tier", "أعلى مستوى") : `${res.percent}%`}</span>
              </div>
              <div className="mt-2 max-w-xs">
                <MiniProgress percent={res.percent} top={res.top} />
              </div>
              {!res.top && (
                <p className="mt-1.5 text-[11px] text-mute">
                  {tx.value(res.remaining, unit)} {t("to", "للوصول إلى")} <span dir="auto">{squeeze(draft.tiers[TIER_KEYS[res.idx + 1]].name)}</span>
                </p>
              )}
            </>
          ) : (
            <p className="text-[11px] text-mute">{raw.trim() !== "" && thresholds ? t("Enter a valid number.", "أدخل رقمًا صحيحًا.") : ""}</p>
          )}
        </div>
      </div>
    </Panel>
  );
}

function ImpactBox({ impact }: { impact: TierPreviewImpact }) {
  const { t } = useLT();
  return (
    <div className="lyc-pop mt-3 rounded-xl border border-edge bg-soft p-3 text-xs" data-testid="tiers-impact">
      <div className="mb-2 font-medium text-ink">{impact.exact ? t("Exact impact on current members", "الأثر الدقيق على الأعضاء الحاليين") : t("Impact on members whose numbers are up to date", "الأثر على الأعضاء المحدّثة أرقامهم")}</div>
      <dl className="grid grid-cols-3 gap-2 text-center">
        {[
          { l: t("Move up", "يصعدون"), v: impact.promoted, c: "text-emerald-300", id: "up" },
          { l: t("Move down", "ينزلون"), v: impact.demoted, c: "text-rose-300", id: "down" },
          { l: t("Stay", "يبقون"), v: impact.same, c: "text-ink", id: "same" },
        ].map((x) => (
          <div key={x.id} className="rounded-lg bg-card px-2 py-2">
            <dd className={`text-base font-medium tabular-nums ${x.c}`} data-testid={`tiers-impact-${x.id}`}>
              {fmtNum(x.v)}
            </dd>
            <dt className="text-[10px] text-mute">{x.l}</dt>
          </div>
        ))}
      </dl>
      {impact.unreconciled > 0 && (
        <p className="mt-2 text-[11px] leading-relaxed text-amber-300" data-testid="tiers-impact-unreconciled">
          {t(`${fmtNum(impact.unreconciled)} member(s) haven't had their history counted yet, so they are not included above. They are calculated when the rules are saved.`, `يوجد ${fmtNum(impact.unreconciled)} عضو لم يُحتسب سجلهم السابق بعد، لذلك لا يظهرون أعلاه. يُحسبون عند حفظ القواعد.`)}
        </p>
      )}
      {impact.truncated && <p className="mt-2 text-[11px] text-mute">{t("Very large clinic: only the first members were evaluated.", "عيادة كبيرة جدًا: قُيّم الأعضاء الأوائل فقط.")}</p>}
    </div>
  );
}

/* ---------- result of a recalculation (save or maintenance) ---------- */

function RunSummary({ run, onChange }: { run: { result: RecalcResult; label: string }; onChange: (r: { result: RecalcResult; label: string } | null) => void }) {
  const { t } = useLT();
  const rec = useRecalculateTiers();
  const r = run.result;
  const next = async () => {
    try {
      const d = await rec.mutateAsync({ mode: "tiers", dryRun: r.dryRun, cursor: r.nextCursor });
      onChange({ ...run, result: mergeRun(r, d.result) });
    } catch {
      /* the error line below shows it; nothing was half-applied (each member is its own safe unit) */
    }
  };
  return (
    <Panel className="lyc-pop p-4" >
      <div data-testid="tiers-run-summary">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-ink">{run.label}</h3>
          {r.dryRun && <span className="rounded-full bg-sky/15 px-2.5 py-0.5 text-[10px] font-medium text-sky">{t("Dry run — nothing was changed", "تجربة — لم يُغيَّر شيء")}</span>}
        </div>
        <dl className="grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
          {[
            { l: t("Checked", "تم فحصهم"), v: r.processed, id: "processed" },
            { l: t("Moved up", "صعدوا"), v: r.promoted, id: "promoted" },
            { l: t("Moved down", "نزلوا"), v: r.demoted, id: "demoted" },
            { l: t("First tier", "أول مستوى"), v: r.initial, id: "initial" },
            { l: t("Unchanged", "دون تغيير"), v: r.unchanged, id: "unchanged" },
          ].map((x) => (
            <div key={x.id} className="rounded-lg bg-soft px-2 py-2">
              <dd className="text-base font-medium tabular-nums text-ink" data-testid={`tiers-run-${x.id}`}>
                {fmtNum(x.v)}
              </dd>
              <dt className="text-[10px] text-mute">{x.l}</dt>
            </div>
          ))}
        </dl>
        {r.countersCorrected > 0 && <p className="mt-2 text-[11px] text-mute">{t(`${fmtNum(r.countersCorrected)} member counter(s) were rebuilt from the real history.`, `أُعيد بناء عدادات ${fmtNum(r.countersCorrected)} عضو من السجل الفعلي.`)}</p>}
        {r.errors > 0 && (
          <p className="mt-2 text-[11px] text-red-400" role="alert">
            {t(`${fmtNum(r.errors)} member(s) couldn't be processed. Run it again.`, `تعذّرت معالجة ${fmtNum(r.errors)} عضو. شغّلها مرة أخرى.`)}
          </p>
        )}
        {!r.done ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="btn-teal text-xs" disabled={rec.isPending} onClick={next} data-testid="tiers-run-continue">
              {rec.isPending ? <span className="lyc-spinner" aria-hidden="true" /> : <IconPlayerPlay size={14} />} {t("Continue", "متابعة")}
            </button>
            <span className="text-[11px] text-mute">{t(`${fmtNum(r.remaining)} member(s) left.`, `متبقٍ ${fmtNum(r.remaining)} عضو.`)}</span>
          </div>
        ) : (
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-emerald-300">
            <IconCheck size={13} /> {t("Finished.", "اكتملت العملية.")}
          </p>
        )}
        {rec.isError && (
          <p className="mt-2 text-[11px] text-red-400" role="alert">
            {apiError(rec.error, t("Couldn't continue", "تعذّرت المتابعة")).message}
          </p>
        )}
      </div>
    </Panel>
  );
}

/* ---------- maintenance: recalculate / reconcile (owner / doctor) ---------- */

function Maintenance({ onRun }: { onRun: (r: { result: RecalcResult; label: string } | null) => void }) {
  const { t } = useLT();
  const an = useTierAnalytics(true);
  const rec = useRecalculateTiers();
  const [mode, setMode] = useState<"tiers" | "full">("tiers");
  const [dry, setDry] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const na = an.data?.needsAttention;

  const go = async () => {
    setError(null);
    try {
      const d = await rec.mutateAsync({ mode, dryRun: dry });
      onRun({ result: d.result, label: mode === "full" ? t("Rebuild counters", "إعادة بناء العدادات") : t("Recalculate tiers", "إعادة حساب المستويات") });
    } catch (e) {
      setError(apiError(e, t("Couldn't run it", "تعذّر التشغيل")).message);
    }
  };

  return (
    <Panel className="p-4">
      <div data-testid="tiers-maintenance">
        <div className="mb-1 flex items-center gap-2">
          <IconRefresh size={15} className="text-sky" />
          <h3 className="text-xs font-medium text-ink">{t("Maintenance", "الصيانة")}</h3>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-mute">
          {t("Use this after importing old data or if numbers look wrong. It works in safe batches and never changes points balances. Start with a dry run to see what would change.", "استخدمها بعد استيراد بيانات قديمة أو إذا بدت الأرقام خاطئة. تعمل على دفعات آمنة ولا تغيّر أرصدة النقاط أبدًا. ابدأ بتجربة لترى ما الذي سيتغيّر.")}
        </p>
        {na && (na.unreconciled > 0 || na.awaitingRecalculation > 0) && (
          <p className="mb-3 text-[11px] text-amber-300" data-testid="tiers-maint-counts">
            {t(`${fmtNum(na.unreconciled)} member(s) not counted from history yet · ${fmtNum(na.awaitingRecalculation)} awaiting recalculation.`, `${fmtNum(na.unreconciled)} عضو لم يُحتسب سجلهم بعد · ${fmtNum(na.awaitingRecalculation)} بانتظار إعادة الحساب.`)}
          </p>
        )}
        <div className="grid gap-2 md:grid-cols-2" role="radiogroup" aria-label={t("What to run", "ما الذي سيُشغَّل")}>
          {[
            { id: "tiers" as const, title: t("Re-evaluate tiers", "إعادة تقييم المستويات"), text: t("Only members whose tier is missing or older than the current rules.", "فقط الأعضاء الذين مستواهم غير محسوب أو أقدم من القواعد الحالية.") },
            { id: "full" as const, title: t("Rebuild counters from history", "إعادة بناء العدادات من السجل"), text: t("Recounts every member's earned points, completed visits and payments from the real records, then re-evaluates.", "يعيد عدّ نقاط كل عضو المكتسبة وزياراته المكتملة ودفعاته من السجلات الفعلية، ثم يعيد التقييم.") },
          ].map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} data-testid={`tiers-maint-${m.id}`} onClick={() => setMode(m.id)} className={`min-w-0 rounded-2xl border p-3 text-start transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky ${mode === m.id ? "border-amber-300/60 bg-amber-300/10" : "border-edge bg-soft hover:border-sky"}`}>
              <div className="mb-0.5 text-xs font-medium text-ink">{m.title}</div>
              <p className="text-[11px] leading-relaxed text-mute">{m.text}</p>
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-ink">
            <input type="checkbox" checked={dry} onChange={(e) => setDry(e.target.checked)} data-testid="tiers-maint-dry" className="h-4 w-4 accent-amber-300" />
            {t("Dry run (change nothing)", "تجربة (دون تغيير)")}
          </label>
          <button className="btn-teal text-xs" disabled={rec.isPending} onClick={go} data-testid="tiers-maint-run">
            {rec.isPending ? <span className="lyc-spinner" aria-hidden="true" /> : <IconPlayerPlay size={14} />} {dry ? t("Run dry run", "تشغيل التجربة") : t("Run now", "شغّل الآن")}
          </button>
        </div>
        {error && (
          <p className="mt-2 text-[11px] text-red-400" role="alert">
            {error}
          </p>
        )}
      </div>
    </Panel>
  );
}

