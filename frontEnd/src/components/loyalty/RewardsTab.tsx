"use client";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { IconCalendarEvent, IconCheck, IconClockHour4, IconEdit, IconGift, IconInfoCircle, IconPlayerPause, IconPlayerPlay, IconPlus, IconSparkles, IconTicket, IconTrash, IconCoins } from "@tabler/icons-react";
import {
  ammanDay,
  apiError,
  fmtNum,
  pointsWord,
  useDeleteReward,
  useLT,
  useRewardStatus,
  useRewards,
  useRewardsSummary,
  useSaveReward,
  type Reward,
} from "@/lib/loyalty";
import { useLoyaltyUi } from "@/lib/loyaltyNav";
import { ErrorBox, Skeleton, useFlash } from "./parts";
import Dialog from "./Dialog";
import RewardObject from "./RewardObject";
import { LoyaltyEmptyState, LoyaltyLoader, LoyaltyMetric, LoyaltySurface, SegTabs } from "./ui/LoyaltyUI";

/**
 * Rewards (Phase 8 — catalog only; redemptions have their own screen).
 *
 * Everything shown is real server data — no sample rewards, no invented numbers. owner / doctor manage the catalog; reception sees it.
 * Each reward is a premium RewardObject; creating / editing shows a live preview of exactly what the clinic is about to publish.
 */

export type RewardsView = "catalog" | "pending" | "history";

const POINTS_MAX = 1_000_000;

export default function RewardsTab({ canManage }: { canManage: boolean; initialView?: RewardsView }) {
  const { t } = useLT();
  const summary = useRewardsSummary();
  const s = summary.data;
  return (
    <div className="space-y-3">
      <div className="lyx-grid-metrics" data-testid="rw-stats">
        <LoyaltyMetric index={0} label={t("Active rewards", "جوائز فعّالة")} value={s ? s.activeRewards : "—"} icon={<IconGift size={17} />} />
        <LoyaltyMetric index={1} tone="mint" label={t("Pending", "قيد الانتظار")} value={s ? s.pending : "—"} icon={<IconClockHour4 size={17} />} hint={s && s.pending > 0 ? t("Waiting in Redemptions", "بانتظار الرد في الاستبدالات") : undefined} />
        <LoyaltyMetric index={2} label={t("Redeemed", "تم صرفها")} value={s ? s.confirmed : "—"} icon={<IconTicket size={17} />} />
        <LoyaltyMetric index={3} tone="rose" label={t("Points redeemed", "النقاط المصروفة")} value={s ? s.pointsRedeemed : "—"} icon={<IconCoins size={17} />} />
      </div>
      <Catalog canManage={canManage} />
    </div>
  );
}

/* ============================================================
 * Catalog
 * ============================================================ */

function Catalog({ canManage }: { canManage: boolean }) {
  const { t } = useLT();
  const flash = useFlash();
  const q = useRewards();
  const setStatus = useRewardStatus();
  const del = useDeleteReward();
  const filter = useLoyaltyUi((s) => s.rewardsFilter);
  const setFilter = useLoyaltyUi((s) => s.setRewardsFilter);
  const [editing, setEditing] = useState<Reward | "new" | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const list = useMemo(() => (q.data?.rewards ?? []).filter((r) => filter === "all" || r.status === filter), [q.data, filter]);

  const toggle = (r: Reward) => {
    setBusyId(r.id);
    setStatus.mutate(
      { id: r.id, status: r.status === "active" ? "inactive" : "active" },
      {
        onSuccess: (d) => flash.show("ok", d.reward.status === "active" ? t("Reward activated", "تم تفعيل الجائزة") : t("Reward deactivated — pending requests can still be answered.", "تم إيقاف الجائزة — لا تزال الطلبات المعلّقة قابلة للرد.")),
        onError: (e) => flash.show("err", apiError(e, t("Couldn't update the reward", "تعذّر تحديث الجائزة")).message),
        onSettled: () => setBusyId(null),
      }
    );
  };
  const remove = (r: Reward) => {
    setBusyId(r.id);
    del.mutate(r.id, {
      onSuccess: () => (setConfirmDel(null), flash.show("ok", t("Reward deleted", "تم حذف الجائزة"))),
      onError: (e) => (setConfirmDel(null), flash.show("err", apiError(e, t("Couldn't delete the reward", "تعذّر حذف الجائزة")).message)),
      onSettled: () => setBusyId(null),
    });
  };

  if (q.isError) return <ErrorBox message={apiError(q.error, t("Couldn't load rewards", "تعذّر تحميل الجوائز")).message} onRetry={() => q.refetch()} />;
  if (q.isLoading || !q.data) {
    return (
      <div className="lyx-rw-grid" aria-busy="true">
        <LoyaltyLoader className="h-56" />
        <LoyaltyLoader className="h-56" />
      </div>
    );
  }
  const all = q.data.rewards;

  return (
    <div className="space-y-3">
      {flash.node}
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t("Filter rewards", "تصفية الجوائز")} className="lyx-seg-tabs">
          {(["all", "active", "inactive"] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f} data-testid={`rw-filter-${f}`}>
              {f === "all" ? t("All", "الكل") : f === "active" ? t("Active", "فعّالة") : t("Inactive", "متوقفة")}
            </button>
          ))}
        </div>
        {canManage && (
          <button className="btn-teal ms-auto inline-flex min-h-[40px] items-center gap-1.5" onClick={() => setEditing("new")} data-testid="rw-new">
            <IconPlus size={15} /> {t("New reward", "جائزة جديدة")}
          </button>
        )}
      </div>

      {all.length === 0 ? (
        <LoyaltySurface pad>
          <LoyaltyEmptyState
            kind="rewards"
            icon={<IconGift size={30} stroke={1.5} />}
            title={t("No rewards yet.", "لا توجد جوائز بعد.")}
            text={
              canManage
                ? t("Create the first reward you want to offer — you decide its name and how many points it costs.", "أنشئ أول جائزة تريد تقديمها — أنت تحدد اسمها وعدد النقاط المطلوبة.")
                : t("The clinic hasn't added any rewards yet. The owner or a doctor can create them.", "لم تضف العيادة جوائز بعد. يمكن للمالك أو الطبيب إضافتها.")
            }
            action={
              canManage ? (
                <button className="btn-teal inline-flex items-center gap-1.5 px-4 py-2" onClick={() => setEditing("new")}>
                  <IconPlus size={15} /> {t("Create a reward", "إنشاء جائزة")}
                </button>
              ) : undefined
            }
          />
        </LoyaltySurface>
      ) : list.length === 0 ? (
        <p className="py-8 text-center text-xs text-mute">{t("No rewards match this filter.", "لا توجد جوائز مطابقة.")}</p>
      ) : (
        <ul className="lyx-rw-grid" data-testid="rw-grid">
          {list.map((r, i) => (
            <RewardCard
              key={r.id}
              r={r}
              index={i}
              canManage={canManage}
              busy={busyId === r.id}
              disabled={busyId !== null}
              askDelete={confirmDel === r.id}
              onEdit={() => setEditing(r)}
              onToggle={() => toggle(r)}
              onAskDelete={(v) => setConfirmDel(v ? r.id : null)}
              onDelete={() => remove(r)}
            />
          ))}
        </ul>
      )}

      {editing && <RewardForm reward={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={(msg) => (setEditing(null), flash.show("ok", msg))} />}
    </div>
  );
}

function RewardCard({
  r,
  index,
  canManage,
  busy,
  disabled,
  askDelete,
  onEdit,
  onToggle,
  onAskDelete,
  onDelete,
}: {
  r: Reward;
  index: number;
  canManage: boolean;
  busy: boolean;
  disabled: boolean;
  askDelete: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onAskDelete: (v: boolean) => void;
  onDelete: () => void;
}) {
  const { t, date } = useLT();
  const active = r.status === "active";
  const c = r.counts;
  const chips = (
    <>
      {(r.validFrom || r.validUntil) && (
        <span className="lyx-chipx">
          <IconCalendarEvent size={11} />
          {r.validFrom ? date(r.validFrom) : "…"} → {r.validUntil ? date(r.validUntil) : "…"}
        </span>
      )}
      {r.window === "scheduled" && <span className="lyx-chipx">{t("Starts", "يبدأ")} {date(r.validFrom)}</span>}
      {r.window === "expired" && <span className="lyx-chipx">{t("Expired", "منتهية")} {date(r.validUntil)}</span>}
      {c && c.pending > 0 && (
        <span className="lyx-chipx" style={{ color: "var(--lyx-gold)" }}>
          <IconClockHour4 size={11} /> {t(`${c.pending} pending`, `${c.pending} قيد الانتظار`)}
        </span>
      )}
      {c && (
        <span className="lyx-chipx" data-testid="rw-redeemed">
          <IconCheck size={11} /> {t(`${c.confirmed} redeemed`, `${c.confirmed} تم صرفها`)}
        </span>
      )}
    </>
  );
  return (
    <li data-testid="rw-card" data-status={r.status}>
      <RewardObject name={r.name} description={r.description} points={r.pointsRequired} status={r.status} chips={chips} index={index}>
        {canManage &&
          (askDelete ? (
            <div className="lyc-pop flex flex-wrap items-center justify-end gap-2" role="group" aria-label={t("Confirm delete", "تأكيد الحذف")}>
              <span className="text-[11px] text-red-300">{t("Delete this reward?", "حذف هذه الجائزة؟")}</span>
              <button className="btn-ghost px-3 text-xs" onClick={() => onAskDelete(false)} disabled={disabled}>
                {t("Keep", "إبقاء")}
              </button>
              <button className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-red-400/50 bg-red-500/15 px-3 text-xs font-medium text-red-300 hover:bg-red-500/25 disabled:opacity-50" onClick={onDelete} disabled={disabled} data-testid="rw-delete-yes">
                {busy && <span className="lyc-spinner" aria-hidden="true" />} {t("Yes, delete", "نعم، احذف")}
              </button>
            </div>
          ) : (
            <>
              {c && c.total === 0 && (
                <button className="btn-ghost inline-flex min-h-[40px] items-center gap-1.5 px-3 text-xs" onClick={() => onAskDelete(true)} disabled={disabled} aria-label={t("Delete reward", "حذف الجائزة")} data-testid="rw-delete">
                  <IconTrash size={14} />
                </button>
              )}
              <button className="btn-ghost inline-flex min-h-[40px] items-center gap-1.5 px-3 text-xs" onClick={onToggle} disabled={disabled} data-testid="rw-toggle">
                {busy ? <span className="lyc-spinner" aria-hidden="true" /> : active ? <IconPlayerPause size={14} /> : <IconPlayerPlay size={14} />}
                {active ? t("Deactivate", "إيقاف") : t("Activate", "تفعيل")}
              </button>
              <button className="btn-teal inline-flex min-h-[40px] items-center gap-1.5 px-3 text-xs" onClick={onEdit} disabled={disabled} data-testid="rw-edit">
                <IconEdit size={14} /> {t("Edit", "تعديل")}
              </button>
            </>
          ))}
      </RewardObject>
    </li>
  );
}

/* ============================================================
 * Create / edit
 * ============================================================ */

function RewardForm({ reward, onClose, onSaved }: { reward: Reward | null; onClose: () => void; onSaved: (message: string) => void }) {
  const { t } = useLT();
  const save = useSaveReward();
  const [name, setName] = useState(reward?.name ?? "");
  const [description, setDescription] = useState(reward?.description ?? "");
  const [points, setPoints] = useState(reward ? String(reward.pointsRequired) : "");
  const [from, setFrom] = useState(ammanDay(reward?.validFrom));
  const [until, setUntil] = useState(ammanDay(reward?.validUntil));
  const [err, setErr] = useState<string | null>(null);

  const n = /^\d+$/.test(points.trim()) ? Number(points.trim()) : NaN;
  const pointsOk = Number.isSafeInteger(n) && n >= 1 && n <= POINTS_MAX;
  const nameOk = name.trim().length >= 2;
  const datesOk = !(from && until && until < from);
  const valid = nameOk && pointsOk && datesOk;

  useEffect(() => setErr(null), [name, description, points, from, until]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || save.isPending) return;
    save.mutate(
      { id: reward?.id, body: { name: name.trim(), description: description.trim(), pointsRequired: n, validFrom: from || null, validUntil: until || null } },
      {
        onSuccess: (d) => onSaved(reward ? t("Reward updated", "تم تحديث الجائزة") : t(`“${d.reward.name}” created`, `تم إنشاء «${d.reward.name}»`)),
        onError: (er) => setErr(apiError(er, t("Couldn't save the reward", "تعذّر حفظ الجائزة")).message),
      }
    );
  };

  const field = "inp w-full px-3 py-2.5 text-sm";
  const label = "mb-1 block text-[11px] font-medium text-mute";

  return (
    <Dialog open onClose={onClose} busy={save.isPending} wide title={reward ? t("Edit reward", "تعديل الجائزة") : t("New reward", "جائزة جديدة")} testId="rw-form" initialFocus="#rw-name">
      <div className="mb-4" data-testid="rw-live-preview">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--lyx-gold)]">{t("Live preview", "معاينة مباشرة")}</div>
        <RewardObject preview name={name.trim()} description={description.trim()} points={pointsOk ? n : null} status={reward?.status ?? "active"} />
      </div>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div>
          <label htmlFor="rw-name" className={label}>
            {t("Reward name", "اسم الجائزة")}
          </label>
          <input id="rw-name" className={field} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. Free teeth cleaning", "مثال: تنظيف أسنان مجاني")} data-testid="rw-f-name" aria-invalid={name.length > 0 && !nameOk} />
        </div>
        <div>
          <label htmlFor="rw-desc" className={label}>
            {t("Description (optional)", "الوصف (اختياري)")}
          </label>
          <textarea id="rw-desc" className={`${field} min-h-[72px] resize-y`} value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} data-testid="rw-f-desc" />
          <div className="mt-0.5 text-end text-[10px] tabular-nums text-mute">{description.length}/300</div>
        </div>
        <div>
          <label htmlFor="rw-points" className={label}>
            {t("Points required", "النقاط المطلوبة")}
          </label>
          <input id="rw-points" className={field} inputMode="numeric" dir="ltr" value={points} onChange={(e) => setPoints(e.target.value.replace(/[^\d]/g, "").slice(0, 7))} placeholder="500" data-testid="rw-f-points" aria-invalid={points.length > 0 && !pointsOk} aria-describedby="rw-preview" />
          <div id="rw-preview" className="mt-1.5 min-h-[28px]" aria-live="polite">
            {pointsOk ? (
              <span className="lyc-pop inline-flex items-center gap-1.5 rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-xs font-medium text-amber-200" data-testid="rw-preview">
                <IconSparkles size={13} /> {t(`Requires ${pointsWord(n, "en")}`, `تتطلب ${pointsWord(n, "ar")}`)}
              </span>
            ) : points.length > 0 ? (
              <span className="text-[11px] text-red-300">{t(`Enter a whole number from 1 to ${fmtNum(POINTS_MAX)}.`, `أدخل عددًا صحيحًا من 1 إلى ${fmtNum(POINTS_MAX)}.`)}</span>
            ) : null}
          </div>
        </div>
        <fieldset className="lyx-surface !rounded-2xl !p-3" data-solid="true">
          <legend className="px-1 text-[11px] font-medium text-mute">{t("Validity (optional)", "فترة الصلاحية (اختياري)")}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="rw-from" className={label}>
                {t("From", "من")}
              </label>
              <input id="rw-from" type="date" dir="ltr" className={field} value={from} onChange={(e) => setFrom(e.target.value)} data-testid="rw-f-from" />
            </div>
            <div>
              <label htmlFor="rw-until" className={label}>
                {t("Until", "إلى")}
              </label>
              <input id="rw-until" type="date" dir="ltr" className={field} value={until} min={from || undefined} onChange={(e) => setUntil(e.target.value)} data-testid="rw-f-until" aria-invalid={!datesOk} />
            </div>
          </div>
          {!datesOk && <p className="mt-2 text-[11px] text-red-300">{t("“Until” can't be before “From”.", "تاريخ النهاية لا يمكن أن يسبق تاريخ البداية.")}</p>}
        </fieldset>

        {reward && (
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-mute">
            <IconInfoCircle size={13} className="mt-0.5 shrink-0" />
            {t("Requests already waiting keep the name and cost they were made with. Your changes apply to new requests only.", "الطلبات المعلّقة تحتفظ بالاسم والتكلفة التي قُدّمت بها. تعديلاتك تسري على الطلبات الجديدة فقط.")}
          </p>
        )}
        {err && (
          <div role="alert" className="rounded-xl border border-red-400/40 bg-red-500/10 p-2.5 text-xs text-red-300" data-testid="rw-f-error">
            {err}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={save.isPending}>
            {t("Cancel", "إلغاء")}
          </button>
          <button type="submit" className="btn-teal inline-flex min-h-[40px] items-center gap-1.5" disabled={!valid || save.isPending} data-testid="rw-f-save">
            {save.isPending && <span className="lyc-spinner" aria-hidden="true" />}
            {reward ? t("Save changes", "حفظ التعديلات") : t("Create reward", "إنشاء الجائزة")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

