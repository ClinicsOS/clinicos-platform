"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconSearch, IconUserPlus, IconUsers, IconX, IconCheck, IconHistory, IconAdjustmentsHorizontal, IconAlertTriangle, IconPlus, IconMinus, IconGift, IconHandStop, IconTicket } from "@tabler/icons-react";
import {
  apiError,
  fmtNum,
  searchPatients,
  useAdjustPoints,
  useAgo,
  useDebounced,
  useEnrollMember,
  useLoyaltyMembers,
  useLoyaltyOverview,
  useLT,
  useMemberDetail,
  useMemberInsights,
  useMemberTransactions,
  useTiersConfig,
  type LoyaltyMember,
  type TierKey,
} from "@/lib/loyalty";
import { useLoyaltyUi } from "@/lib/loyaltyNav";
import LoyaltyCard3D from "./LoyaltyCard3D";
import { TierBadge } from "./TierCard3D";
import { MemberTierCell, MemberTierPanel } from "./TierParts";
import Dialog from "./Dialog";
import { Avatar, CountUp, EmptyState, ErrorBox, Pager, Skeleton, useFlash } from "./parts";
import { LoyaltyEmptyState, LoyaltyPanel, LoyaltySurface, LyxPortal, ProgressRail, StatusOrb, SuccessBurst, type OrbStatus } from "./ui/LoyaltyUI";
import { LedgerRow } from "./ui/Ledger";
import { TIER_ACCENT } from "./shell/loyaltyDesign";

const accentOf = (k?: TierKey | null) => (k ? TIER_ACCENT[k] : undefined);

/** Members (Phase 8): rows carry the tier's material as an edge + ring; the detail sheet shows the member's big 3D card, available points vs tier progress, rewards eligibility and every history. Filters survive navigation. */
export default function MembersTab({
  canEnroll,
  canAdjust,
  openEnroll,
  onEnrollHandled,
  clinicName,
  programName,
}: {
  canEnroll: boolean;
  canAdjust: boolean;
  openEnroll: boolean;
  onEnrollHandled: () => void;
  clinicName: string;
  programName: string | null;
}) {
  const { t, date } = useLT();
  const { search, tier: tierFilter, page } = useLoyaltyUi((s) => s.members);
  const setMembers = useLoyaltyUi((s) => s.setMembers);
  const term = useDebounced(search.trim(), 350);
  const [selected, setSelected] = useState<LoyaltyMember | null>(null);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const flash = useFlash();

  const q = useLoyaltyMembers(page, term, 10, tierFilter);
  const ov = useLoyaltyOverview();
  const programOn = !!ov.data?.program.enabled;
  const tiersCfg = useTiersConfig();
  const tiersOn = !!q.data?.tiersEnabled;
  const tierOptions = tiersCfg.data?.config.tiers ?? [];

  // a new search / filter starts on page 1 (but returning to this screen keeps the page the user was on)
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setMembers({ page: 1 });
  }, [term, tierFilter, setMembers]);
  useEffect(() => {
    if (openEnroll && canEnroll && programOn) {
      setEnrollOpen(true);
      onEnrollHandled();
    } else if (openEnroll && ov.data) onEnrollHandled();
  }, [openEnroll, canEnroll, programOn, ov.data, onEnrollHandled]);

  const live = selected ? q.data?.members.find((m) => m.id === selected.id) ?? selected : null;
  const noMembersAtAll = q.data && q.data.total === 0 && !term && !tierFilter;

  return (
    <div>
      {flash.node}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <IconSearch size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-mute" />
          <input
            className="inp !ps-9"
            value={search}
            onChange={(e) => setMembers({ search: e.target.value })}
            placeholder={t("Search members by name, phone or file number", "ابحث عن عضو بالاسم أو الهاتف أو رقم الملف")}
            aria-label={t("Search members", "بحث في الأعضاء")}
            maxLength={60}
          />
        </div>
        {(tiersOn || tierFilter) && (
          <select className="inp !w-auto min-w-[9rem] cursor-pointer" value={tierFilter} onChange={(e) => setMembers({ tier: e.target.value })} aria-label={t("Filter by tier", "تصفية حسب المستوى")} data-testid="members-tier-filter">
            <option value="">{t("All tiers", "كل المستويات")}</option>
            {tierOptions.map((x) => (
              <option key={x.key} value={x.key}>
                {x.name}
              </option>
            ))}
            <option value="none">{t("Not assigned yet", "غير محدد بعد")}</option>
          </select>
        )}
        {canEnroll && (
          <button className="btn-teal" disabled={!programOn} title={!programOn ? t("Switch the program on in Settings first", "فعّل البرنامج من الإعدادات أولًا") : undefined} onClick={() => setEnrollOpen(true)} data-testid="members-enroll">
            <IconUserPlus size={16} /> {t("Enroll patient", "تسجيل مريض")}
          </button>
        )}
      </div>
      {canEnroll && ov.data && !programOn && (
        <p className="mb-3 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
          <IconAlertTriangle size={14} className="mt-0.5 shrink-0" />
          {t("The program is switched off, so new members can't be enrolled. Turn it on in Settings.", "البرنامج متوقف، لذلك لا يمكن تسجيل أعضاء جدد. فعّله من الإعدادات.")}
        </p>
      )}

      <LoyaltySurface as="section" pad className="!p-3 sm:!p-4">
        {q.isError ? (
          <ErrorBox message={apiError(q.error, t("Couldn't load members", "تعذّر تحميل الأعضاء")).message} onRetry={() => q.refetch()} />
        ) : q.isLoading || !q.data ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : noMembersAtAll ? (
          <EmptyState
            kind="members"
            icon={<IconUsers size={30} stroke={1.5} />}
            title={t("No Loyalty members yet.", "لا يوجد أعضاء في برنامج الولاء بعد.")}
            text={t("Your Loyalty program is ready for member enrollment. Enrolled patients start with 0 points.", "برنامج الولاء جاهز لتسجيل الأعضاء. يبدأ كل مريض مسجَّل برصيد 0 نقطة.")}
            action={
              canEnroll && programOn ? (
                <button className="btn-teal text-xs" onClick={() => setEnrollOpen(true)}>
                  <IconUserPlus size={15} /> {t("Enroll first member", "تسجيل أول عضو")}
                </button>
              ) : undefined
            }
          />
        ) : q.data.members.length === 0 ? (
          <EmptyState kind="members" icon={<IconSearch size={30} stroke={1.5} />} title={tierFilter && !term ? t("No members in this tier.", "لا يوجد أعضاء في هذا المستوى.") : t("No members match your search.", "لا يوجد أعضاء مطابقون للبحث.")} text={tierFilter && !term ? t("Members appear here when they reach this tier.", "يظهر الأعضاء هنا عندما يبلغون هذا المستوى.") : t("Try a different name, phone number or file number.", "جرّب اسمًا أو رقم هاتف أو رقم ملف مختلفًا.")} />
        ) : (
          <>
            <ul className="lyx-stagger flex flex-col gap-2">
              {q.data.members.map((m, i) => (
                <li key={m.id} style={{ ["--i" as string]: i } as React.CSSProperties} data-testid="member-row">
                  <button type="button" onClick={() => setSelected(m)} className="lyx-mrow" data-tier={m.tier?.key ?? "none"}>
                    <Avatar name={m.patient?.fullName ?? "?"} tierColor={accentOf(m.tier?.key)} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-ink">{m.patient?.fullName ?? "—"}</div>
                      <div className="truncate text-[11px] text-mute" dir="ltr" style={{ textAlign: "start" }}>
                        {m.patient?.phone} · #{m.patient?.fileNumber}
                      </div>
                      {m.tier && (
                        <div className="mt-1 flex items-center gap-1.5 sm:hidden" data-testid="member-tier-compact">
                          <TierBadge tierKey={m.tier.key} name={m.tier.name} size="sm" />
                          <span className="text-[10px] tabular-nums text-mute">{m.tier.isTopTier ? t("Highest", "الأعلى") : `${m.tier.progressPercent}%`}</span>
                        </div>
                      )}
                    </div>
                    {m.tier && (
                      <div className="hidden w-48 shrink-0 sm:block">
                        <MemberTierCell tier={m.tier} />
                      </div>
                    )}
                    <div className="hidden text-[10px] text-mute lg:block">{date(m.joinedAt)}</div>
                    <div className="text-end">
                      <div className="lyx-num text-lg font-semibold text-ink" data-testid="member-balance">
                        {fmtNum(m.pointsBalance)}
                      </div>
                      <div className="text-[9px] uppercase tracking-wider text-mute">{m.tier ? t("available", "متاحة") : t("points", "نقطة")}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            <Pager page={page} pages={q.data.pages} onPage={(p) => setMembers({ page: p })} />
          </>
        )}
      </LoyaltySurface>

      {live && <MemberSheet member={live} clinicName={clinicName} programName={programName} canAdjust={canAdjust} onMemberUpdated={setSelected} onClose={() => setSelected(null)} />}
      {enrollOpen && <EnrollModal onClose={() => setEnrollOpen(false)} onDone={(msg) => flash.show("ok", msg)} />}
    </div>
  );
}

/* ---------- member detail (slide-over) ---------- */

const CK_VIA = { qr: "QR", nfc: "NFC", link: "Link" } as const;

function MemberSheet({ member, clinicName, programName, canAdjust, onMemberUpdated, onClose }: { member: LoyaltyMember; clinicName: string; programName: string | null; canAdjust: boolean; onMemberUpdated: (m: LoyaltyMember) => void; onClose: () => void }) {
  const [adjusting, setAdjusting] = useState(false);
  const { t, date } = useLT();
  const ago = useAgo();
  const [page, setPage] = useState(1);
  const tx = useMemberTransactions(member.id, page);
  // Phase 7: the full, server-calculated tier picture (only fetched once we know tiers are on for this member).
  const detail = useMemberDetail(member.tier ? member.id : null);
  const tierPanel = member.tier && detail.data?.tier ? detail.data : null;
  const insights = useMemberInsights(member.id);
  const closeRef = useRef<HTMLButtonElement>(null);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const prev = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".lyx-dialog")) onClose();
      if (e.key === "Tab" && ref.current) {
        const f = Array.from(ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'));
        if (!f.length || document.querySelector(".lyx-dialog")) return;
        if (e.shiftKey && document.activeElement === f[0]) (e.preventDefault(), f[f.length - 1].focus());
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) (e.preventDefault(), f[0].focus());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;
  const brand = programName || clinicName;
  const stats = [
    ...(member.tier ? [] : [{ l: t("Balance", "الرصيد"), v: fmtNum(member.pointsBalance) }, { l: t("Earned (lifetime)", "المكتسب (إجمالي)"), v: fmtNum(member.lifetimePointsEarned) }]),
    { l: t("Redeemed (lifetime)", "المستبدَل (إجمالي)"), v: fmtNum(member.lifetimePointsRedeemed) },
    { l: t("Last activity", "آخر نشاط"), v: member.lastActivityAt ? date(member.lastActivityAt) : "—" },
  ];
  const ins = insights.data;
  const rw = ins?.rewards;

  return (
    <LyxPortal>
      <div className="lyx-sheet-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()} data-testid="member-sheet-bg">
        <aside ref={ref} role="dialog" aria-modal="true" aria-label={member.patient?.fullName ?? t("Member", "عضو")} className="lyx-sheet" data-testid="member-sheet">
          <div className="lyx-sheet-h">
            <Avatar name={member.patient?.fullName ?? "?"} tierColor={accentOf(member.tier?.key)} />
            <div className="min-w-0 flex-1">
              <h3 className="lyx-display truncate text-[17px] font-semibold text-ink">{member.patient?.fullName ?? "—"}</h3>
              <p className="text-[11px] text-mute" dir="ltr" style={{ textAlign: "start" }}>
                {member.patient?.phone} · #{member.patient?.fileNumber}
              </p>
            </div>
            <button ref={closeRef} type="button" onClick={onClose} aria-label={t("Close", "إغلاق")} className="lyx-dialog-x">
              <IconX size={18} />
            </button>
          </div>

          <div className="lyx-sheet-body">
            {tierPanel ? (
              <MemberTierPanel detail={tierPanel} member={member} brand={brand} />
            ) : member.tier ? (
              detail.isError ? (
                <ErrorBox message={apiError(detail.error, t("Couldn't load the tier", "تعذّر تحميل المستوى")).message} onRetry={() => detail.refetch()} />
              ) : (
                <Skeleton className="h-56" />
              )
            ) : (
              <div className="lyx-stagebox">
                <LoyaltyCard3D clinicName={clinicName} programName={programName} memberName={member.patient?.fullName ?? null} balance={member.pointsBalance} since={date(member.joinedAt)} labels={{ points: t("POINTS", "النقاط"), preview: t("PREVIEW", "معاينة"), memberPlaceholder: t("MEMBER NAME", "اسم العضو"), since: t("SINCE", "منذ") }} />
              </div>
            )}

            <div className="mt-3 grid grid-cols-2 gap-2">
              {stats.map((s) => (
                <LoyaltySurface key={s.l} pad className="!p-3" solid>
                  <div className="truncate text-[10px] text-mute">{s.l}</div>
                  <div className="mt-0.5 break-words text-sm font-semibold text-ink">{s.v}</div>
                </LoyaltySurface>
              ))}
            </div>

            {canAdjust && (
              <button type="button" onClick={() => setAdjusting(true)} className="btn-ghost mt-3 flex w-full items-center justify-center gap-2 px-3 py-2.5 text-xs font-medium" data-testid="member-adjust">
                <IconAdjustmentsHorizontal size={15} /> {t("Adjust points manually", "تعديل النقاط يدويًا")}
              </button>
            )}
            {adjusting && <AdjustModal member={member} onClose={() => setAdjusting(false)} onDone={(m) => onMemberUpdated(m)} />}

            {/* rewards eligibility */}
            <SheetBlock icon={<IconGift size={15} />} title={t("Rewards", "المكافآت")} testId="member-rewards-eligibility">
              {insights.isError ? (
                <p className="text-[11px] text-mute">{t("Couldn't load rewards.", "تعذّر تحميل المكافآت.")}</p>
              ) : !rw ? (
                <Skeleton className="h-14" />
              ) : rw.openCount === 0 ? (
                <p className="text-[11px] leading-relaxed text-mute">{t("No rewards are available to redeem yet.", "لا توجد مكافآت متاحة للاستبدال بعد.")}</p>
              ) : (
                <div className="space-y-3">
                  <div>
                    <div className="mb-1.5 text-[11px] text-mute">
                      {rw.affordableCount > 0 ? t(`Can redeem ${rw.affordableCount} reward(s) right now`, `يستطيع استبدال ${rw.affordableCount} مكافأة الآن`) : t("Not enough points for a reward yet", "الرصيد لا يكفي لأي مكافأة بعد")}
                    </div>
                    {rw.affordable.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {rw.affordable.map((r) => (
                          <span key={r.id} className="lyx-orb" data-s="confirmed">
                            <span className="lyx-orb-dot">
                              <IconCheck size={10} stroke={2.6} />
                            </span>
                            {r.name} · {fmtNum(r.pointsRequired)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {rw.next && (
                    <div>
                      <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px]">
                        <span className="min-w-0 truncate text-ink" dir="auto">
                          {t("Next:", "التالية:")} {rw.next.name}
                        </span>
                        <span className="shrink-0 tabular-nums text-mute">{t(`${fmtNum(rw.next.remaining)} to go`, `متبقٍ ${fmtNum(rw.next.remaining)}`)}</span>
                      </div>
                      <ProgressRail value={ins!.balance} max={rw.next.pointsRequired} label={t("Progress to the next reward", "التقدّم نحو المكافأة التالية")} />
                    </div>
                  )}
                </div>
              )}
            </SheetBlock>

            <SheetBlock icon={<IconHandStop size={15} />} title={t("Recent check-ins", "آخر تسجيلات الوصول")} testId="member-checkins">
              {!ins ? (
                <Skeleton className="h-10" />
              ) : ins.checkIns.length === 0 ? (
                <p className="text-[11px] text-mute">{t("No check-ins yet.", "لا توجد تسجيلات وصول بعد.")}</p>
              ) : (
                <ul className="space-y-1.5">
                  {ins.checkIns.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="min-w-0 truncate text-mute">
                        {CK_VIA[c.via]} · {ago(c.resolvedAt ?? c.requestedAt)}
                      </span>
                      <StatusOrb status={c.status as OrbStatus} label={c.status === "pending" ? t("Pending", "بالانتظار") : c.status === "confirmed" ? t("Confirmed", "مؤكَّد") : c.status === "rejected" ? t("Rejected", "مرفوض") : c.status === "expired" ? t("Expired", "منتهٍ") : t("Cancelled", "ملغى")} />
                    </li>
                  ))}
                </ul>
              )}
            </SheetBlock>

            <SheetBlock icon={<IconTicket size={15} />} title={t("Redemptions", "الاستبدالات")} testId="member-redemptions">
              {!ins ? (
                <Skeleton className="h-10" />
              ) : ins.redemptions.length === 0 ? (
                <p className="text-[11px] text-mute">{t("No redemptions yet.", "لا توجد استبدالات بعد.")}</p>
              ) : (
                <ul className="space-y-2">
                  {ins.redemptions.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="min-w-0">
                        <span className="block truncate text-ink" dir="auto">
                          {r.rewardName}
                        </span>
                        <span className="block tabular-nums text-mute">{fmtNum(r.points)} · {ago(r.reversedAt ?? r.confirmedAt ?? r.requestedAt)}</span>
                      </span>
                      <StatusOrb status={r.status as OrbStatus} label={r.status === "pending" ? t("Pending", "بالانتظار") : r.status === "confirmed" ? t("Confirmed", "مؤكَّد") : r.status === "rejected" ? t("Rejected", "مرفوض") : t("Reversed", "معكوس")} />
                    </li>
                  ))}
                </ul>
              )}
            </SheetBlock>

            <SheetBlock icon={<IconHistory size={15} />} title={t("Points history", "سجل النقاط")} testId="member-history">
              {tx.isError ? (
                <ErrorBox message={apiError(tx.error, t("Couldn't load history", "تعذّر تحميل السجل")).message} onRetry={() => tx.refetch()} />
              ) : tx.isLoading || !tx.data ? (
                <Skeleton className="h-24" />
              ) : tx.data.transactions.length === 0 ? (
                <LoyaltyEmptyState kind="transactions" compact icon={<IconHistory size={26} stroke={1.5} />} title={t("No points activity yet.", "لا يوجد نشاط نقاط بعد.")} text={t("This member starts with 0 points. Every future movement will be recorded here permanently.", "يبدأ هذا العضو برصيد 0. ستُسجَّل هنا كل حركة مستقبلية بشكل دائم.")} />
              ) : (
                <>
                  <ul className="lyx-tl">
                    {tx.data.transactions.map((x, i) => (
                      <LedgerRow key={x.id} tx={x} index={i} date={date} />
                    ))}
                  </ul>
                  <Pager page={page} pages={tx.data.pages} onPage={setPage} />
                </>
              )}
            </SheetBlock>
          </div>
        </aside>
      </div>
    </LyxPortal>
  );
}

function SheetBlock({ icon, title, testId, children }: { icon: React.ReactNode; title: string; testId?: string; children: React.ReactNode }) {
  return (
    <LoyaltySurface as="section" pad solid className="mt-3 !p-3.5" data-testid={testId}>
      <h4 className="mb-2.5 flex items-center gap-2 text-xs font-semibold text-ink">
        <span className="text-[color:var(--lyx-gold)]">{icon}</span>
        {title}
      </h4>
      {children}
    </LoyaltySurface>
  );
}

/* ---------- enrol an existing patient ---------- */

function EnrollModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const { t } = useLT();
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim(), 300);
  const enroll = useEnrollMember();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [enrolled, setEnrolled] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

  const results = useQuery({ queryKey: ["loyalty", "patient-search", term], queryFn: () => searchPatients(term), enabled: term.length >= 2, staleTime: 10_000, retry: false });

  const doEnroll = async (id: string) => {
    setBusyId(id);
    setErrors((e) => ({ ...e, [id]: "" }));
    try {
      const r = await enroll.mutateAsync(id);
      setEnrolled((s) => new Set(s).add(id));
      onDone(r.message || t("Patient enrolled", "تم تسجيل المريض"));
    } catch (e) {
      const err = apiError(e, t("Couldn't enroll this patient", "تعذّر تسجيل هذا المريض"));
      if (err.code === "ALREADY_ENROLLED") setEnrolled((s) => new Set(s).add(id));
      setErrors((x) => ({ ...x, [id]: err.message }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open onClose={onClose} title={t("Enroll a patient", "تسجيل مريض في الولاء")}>
      <p className="mb-3 text-[11px] leading-relaxed text-mute">{t("Choose an existing patient. They join with 0 points — no welcome points are given.", "اختر مريضًا موجودًا. ينضم برصيد 0 نقطة — لا تُمنح نقاط ترحيبية.")}</p>
      <input className="inp mb-3" autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Search patients by name, phone or file number", "ابحث عن مريض بالاسم أو الهاتف أو رقم الملف")} aria-label={t("Search patients", "بحث في المرضى")} maxLength={60} />
      <div className="max-h-72 overflow-y-auto">
        {term.length < 2 ? (
          <p className="py-6 text-center text-xs text-mute">{t("Type at least 2 characters.", "اكتب حرفين على الأقل.")}</p>
        ) : results.isLoading ? (
          <Skeleton className="h-16" />
        ) : results.isError ? (
          <ErrorBox message={apiError(results.error, t("Search failed", "فشل البحث")).message} />
        ) : (results.data?.length ?? 0) === 0 ? (
          <p className="py-6 text-center text-xs text-mute">{t("No patients found.", "لم يتم العثور على مرضى.")}</p>
        ) : (
          <ul className="divide-y divide-edge">
            {results.data!.map((p) => {
              const done = enrolled.has(p._id);
              return (
                <li key={p._id} className="py-2.5">
                  <div className="flex items-center gap-3">
                    <Avatar name={p.fullName} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-ink">{p.fullName}</div>
                      <div className="text-[10px] text-mute" dir="ltr" style={{ textAlign: "start" }}>
                        {p.phone} · #{p.fileNumber}
                      </div>
                    </div>
                    {done ? (
                      <span className="flex items-center gap-1 text-[11px] text-emerald-400 lyc-pop">
                        <IconCheck size={14} /> {t("Member", "عضو")}
                      </span>
                    ) : (
                      <button className="btn-teal !px-3 !py-1.5 text-xs" disabled={busyId !== null} onClick={() => doEnroll(p._id)}>
                        {busyId === p._id ? <span className="lyc-spinner" aria-hidden="true" /> : <IconUserPlus size={14} />}
                        {busyId === p._id ? t("Enrolling…", "جارٍ التسجيل…") : t("Enroll", "تسجيل")}
                      </button>
                    )}
                  </div>
                  {errors[p._id] && <p className="mt-1 text-[11px] text-red-400" role="alert">{errors[p._id]}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <button className="btn-ghost text-xs" onClick={onClose}>
          {t("Done", "تم")}
        </button>
      </div>
    </Dialog>
  );
}

/* ---------- manual adjustment (owner / doctor): form → review → confirmed ---------- */

function AdjustModal({ member, onClose, onDone }: { member: LoyaltyMember; onClose: () => void; onDone: (m: LoyaltyMember) => void }) {
  const { t } = useLT();
  const adj = useAdjustPoints();
  const [dir, setDir] = useState<"credit" | "debit">("credit");
  const [pts, setPts] = useState("");
  const [reason, setReason] = useState("");
  const [step, setStep] = useState<"form" | "review" | "done">("form");
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(member.pointsBalance);
  const from = useRef(member.pointsBalance);

  const bal = member.pointsBalance;
  const n = /^\d{1,7}$/.test(pts.trim()) ? Number(pts.trim()) : NaN;
  const nOk = n >= 1 && n <= 1_000_000;
  const next = dir === "credit" ? bal + n : bal - n;
  const insufficient = dir === "debit" && nOk && n > bal;
  const reasonOk = reason.trim().length >= 3;
  const canReview = nOk && reasonOk && !insufficient;
  const name = member.patient?.fullName ?? "—";

  const confirm = async () => {
    setError(null);
    try {
      const r = await adj.mutateAsync({ memberId: member.id, direction: dir, points: n, reason: reason.trim() });
      onDone(r.member);
      from.current = bal;
      setShown(bal);
      setStep("done"); // only after the server confirmed
      setTimeout(() => setShown(r.member.pointsBalance), 120);
    } catch (e) {
      setError(apiError(e, t("Couldn't adjust points", "تعذّر تعديل النقاط")).message);
      setStep("form");
    }
  };

  return (
    <Dialog open onClose={onClose} title={t("Manual points adjustment", "تعديل النقاط يدويًا")}>
      <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-[11px] leading-relaxed text-amber-300">
        <IconAlertTriangle size={15} className="mt-0.5 shrink-0" />
        <span>{t("This is a manual change, not an automatic reward. It is recorded permanently with your name and reason and can't be edited or deleted.", "هذا تعديل يدوي وليس مكافأة تلقائية. يُسجَّل بشكل دائم باسمك وسببه ولا يمكن تعديله أو حذفه.")}</span>
      </div>

      {step === "form" && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("Adjustment type", "نوع التعديل")}>
            {(["credit", "debit"] as const).map((d) => (
              <button key={d} role="radio" aria-checked={dir === d} onClick={() => setDir(d)} className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-medium transition ${dir === d ? (d === "credit" ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-300" : "border-rose-400/60 bg-rose-400/15 text-rose-300") : "border-edge bg-soft text-mute hover:text-ink"}`}>
                {d === "credit" ? <IconPlus size={14} /> : <IconMinus size={14} />}
                {d === "credit" ? t("Add points", "إضافة نقاط") : t("Deduct points", "خصم نقاط")}
              </button>
            ))}
          </div>
          <label className="lbl" htmlFor="adj-pts">
            {t("Points", "النقاط")}
          </label>
          <input id="adj-pts" className="inp mb-1 text-center text-base font-medium tabular-nums" inputMode="numeric" autoFocus value={pts} onChange={(e) => setPts(e.target.value)} placeholder="—" dir="ltr" />
          {pts && !nOk && <p className="mb-1 text-[11px] text-red-400">{t("Enter a whole number from 1 to 1,000,000", "أدخل رقمًا صحيحًا من 1 إلى 1,000,000")}</p>}
          {insufficient && <p className="mb-1 text-[11px] text-red-400">{t(`Not enough points — the balance is ${fmtNum(bal)}.`, `الرصيد غير كافٍ — الرصيد ${fmtNum(bal)}.`)}</p>}
          <label className="lbl mt-2" htmlFor="adj-reason">
            {t("Reason (required)", "السبب (مطلوب)")}
          </label>
          <textarea id="adj-reason" className="inp" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("e.g. Service recovery gesture", "مثال: بادرة لتعويض تجربة سيئة")} />
          {error && (
            <p className="mt-2 text-[11px] text-red-400" role="alert">
              {error}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-ghost text-xs" onClick={onClose}>
              {t("Cancel", "إلغاء")}
            </button>
            <button className="btn-teal text-xs" disabled={!canReview} onClick={() => setStep("review")}>
              {t("Review", "مراجعة")}
            </button>
          </div>
        </>
      )}

      {step === "review" && (
        <>
          <dl className="divide-y divide-edge rounded-xl border border-edge bg-soft text-xs">
            {[
              [t("Patient", "المريض"), name],
              [t("Current balance", "الرصيد الحالي"), fmtNum(bal)],
              [t("Adjustment", "التعديل"), `${dir === "credit" ? "+" : "−"}${fmtNum(n)}`],
              [t("Resulting balance", "الرصيد بعد التعديل"), fmtNum(next)],
              [t("Reason", "السبب"), reason.trim()],
            ].map(([k, v]) => (
              <div key={k as string} className="flex items-start justify-between gap-4 px-3 py-2.5">
                <dt className="text-mute">{k}</dt>
                <dd className={`min-w-0 break-words text-end font-medium ${k === t("Adjustment", "التعديل") ? (dir === "credit" ? "text-emerald-400" : "text-rose-400") : "text-ink"}`} dir="auto">
                  {v}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-ghost text-xs" disabled={adj.isPending} onClick={() => setStep("form")}>
              {t("Back", "رجوع")}
            </button>
            <button className="btn-teal text-xs" disabled={adj.isPending} onClick={confirm}>
              {adj.isPending && <span className="lyc-spinner" aria-hidden="true" />}
              {adj.isPending ? t("Applying…", "جارٍ التطبيق…") : t("Confirm adjustment", "تأكيد التعديل")}
            </button>
          </div>
        </>
      )}

      {step === "done" && (
        <div className="lyc-tabin py-4 text-center">
          <div className="mb-3 flex justify-center">
            <SuccessBurst tone="mint" />
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-mute">{t("Balance updated", "تم تحديث الرصيد")}</div>
          <div className="mt-1 text-4xl font-medium tabular-nums text-ink" data-testid="adjust-balance">
            <CountUp value={shown} />
          </div>
          <button className="btn-teal mt-4 text-xs" onClick={onClose}>
            {t("Done", "تم")}
          </button>
        </div>
      )}
    </Dialog>
  );
}
