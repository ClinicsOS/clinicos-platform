"use client";
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import Modal from "@/components/Modal";
import type { Clinic, Staff, WorkingHour, Subscription, Plan } from "@/lib/types";
import {
  IconClock,
  IconLink,
  IconUsers,
  IconUserPlus,
  IconCopy,
  IconCheck,
  IconCreditCard,
  IconSparkles,
  IconAlertCircle,
  IconLock,
  IconShield,
  IconMail,
  IconDownload,
  IconTrash,
  IconEye,
  IconEyeOff,
} from "@tabler/icons-react";

const DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

const rolePill: Record<string, string> = {
  owner: "bg-purple-500/15 text-purple-400",
  doctor: "bg-blue/15 text-sky",
  receptionist: "bg-teal/15 text-teal",
};

type Tab = "clinic" | "staff" | "subscription" | "security";

export default function SettingsPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const isOwner = user?.role === "owner";
  const searchParams = useSearchParams();
  const toast = useToast();
  const { confirm } = useConfirm();

  const [tab, setTab] = useState<Tab>(() => {
    const q = searchParams.get("tab");
    if (q === "subscription" || q === "staff" || q === "security") return q;
    return "clinic";
  });
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  // --- clinic form state ---
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [slot, setSlot] = useState("30");
  const [brandColor, setBrandColor] = useState("#3B9DE8");
  const [hours, setHours] = useState<WorkingHour[]>([]);

  // --- add staff modal ---
  const [addingStaff, setAddingStaff] = useState(false);
  const [sName, setSName] = useState("");
  const [sEmail, setSEmail] = useState("");
  const [sPass, setSPass] = useState("");
  const [sRole, setSRole] = useState<"doctor" | "receptionist">("doctor");

  // --- edit staff modal ---
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [eName, setEName] = useState("");
  const [eEmail, setEEmail] = useState("");
  const [ePass, setEPass] = useState("");
  const [eRole, setERole] = useState<"doctor" | "receptionist">("doctor");
  const [ePhone, setEPhone] = useState("");

  // --- upgrade modal state ---
  const [upgradeFor, setUpgradeFor] = useState<Plan | null>(null);
  const [justSubmitted, setJustSubmitted] = useState<Plan | null>(null);
  const [submittedAt, setSubmittedAt] = useState<number | null>(null);
  const [bName, setBName] = useState("");
  const [bEmail, setBEmail] = useState("");
  const [bPhone, setBPhone] = useState("");
  const [bMethod, setBMethod] = useState<"cliq" | "bank_transfer" | "cash">("cliq");
  const [bRef, setBRef] = useState("");
  const [bNotes, setBNotes] = useState("");

  const { data: clinic } = useQuery({
    queryKey: ["clinic"],
    queryFn: async () => (await api.get<Clinic>("/clinic")).data,
  });

  const { data: staff } = useQuery({
    queryKey: ["staff"],
    queryFn: async () => (await api.get<Staff[]>("/users")).data,
  });

  const { data: subscription } = useQuery({
    queryKey: ["subscription"],
    queryFn: async () => (await api.get<Subscription>("/subscription")).data,
  });

  useEffect(() => {
    if (!clinic) return;
    setName(clinic.name);
    setPhone(clinic.phone ?? "");
    setAddress(clinic.address ?? "");
    setSlot(String(clinic.slotDuration));
    setBrandColor(clinic.brandColor ?? "#3B9DE8");
    const byDay = new Map(clinic.workingHours.map((w) => [w.day, w]));
    setHours(
      Array.from({ length: 7 }, (_, day) => {
        const w = byDay.get(day);
        return { day, isOpen: w?.isOpen ?? day !== 5, from: w?.from ?? "10:00", to: w?.to ?? "18:00" };
      })
    );
  }, [clinic]);

  // Pre-fill upgrade billing info once when we know who the owner is
  useEffect(() => {
    if (upgradeFor && user && !bName) {
      setBName(user.name);
      setBEmail(user.email);
      setBPhone(clinic?.phone ?? "");
    }
  }, [upgradeFor, user, clinic, bName]);

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, any> = {
        name,
        phone: phone || undefined,
        address: address || undefined,
        slotDuration: Number(slot) || 30,
        workingHours: hours.map((h) => ({ day: h.day, isOpen: h.isOpen, from: h.from, to: h.to })),
      };
      // Only include brandColor if the plan supports it (backend will reject otherwise)
      if (clinic?.planInfo?.limits.customBookingColor) {
        body.brandColor = brandColor;
      }
      return (await api.patch<Clinic>("/clinic", body)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clinic"] });
      setSaved(true);
      setError("");
      toast.success(t("tst.savedTitle"), t("tst.savedBody"));
      window.setTimeout(() => setSaved(false), 2000);
    },
    onError: (e) => {
      const msg = errMsg(e, t("common.error"));
      setError(msg);
      toast.error(t("common.error"), msg);
    },
  });

  const addStaff = useMutation({
    mutationFn: async () =>
      (await api.post("/users", { name: sName, email: sEmail, password: sPass, role: sRole })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      setAddingStaff(false);
      setSName("");
      setSEmail("");
      setSPass("");
      setError("");
    },
    onError: (e) => setError(errMsg(e, t("common.error"))),
  });

  const toggleActive = useMutation({
    mutationFn: async (s: Staff) => (await api.patch(`/users/${s._id}/active`, { isActive: !s.isActive })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
  });

  const editStaffMut = useMutation({
    mutationFn: async () => {
      if (!editingStaff) throw new Error("No staff to edit");
      const body: Record<string, string> = {
        name: eName,
        email: eEmail,
        role: eRole,
        phone: ePhone,
      };
      if (ePass) body.password = ePass;
      return (await api.patch(`/users/${editingStaff._id}`, body)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      setEditingStaff(null);
      setEPass("");
      setError("");
    },
    onError: (e) => setError(errMsg(e, t("common.error"))),
  });

  const openEditStaff = (s: Staff) => {
    setEditingStaff(s);
    setEName(s.name);
    setEEmail(s.email);
    setERole((s.role as "doctor" | "receptionist") || "doctor");
    setEPhone(s.phone || "");
    setEPass("");
    setError("");
  };

  const upgrade = useMutation({
    mutationFn: async () =>
      (
        await api.post("/subscription/upgrade", {
          plan: upgradeFor,
          billingName: bName,
          billingEmail: bEmail,
          billingPhone: bPhone,
          paymentMethod: bMethod,
          paymentRef: bRef || undefined,
          notes: bNotes || undefined,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subscription"] });
      setJustSubmitted(upgradeFor);
      setSubmittedAt(Date.now());
      setUpgradeFor(null);
      setBName("");
      setBEmail("");
      setBPhone("");
      setBRef("");
      setBNotes("");
      setError("");
    },
    onError: (e) => setError(errMsg(e, t("common.error"))),
  });

  const copyLink = async () => {
    if (!clinic || !origin) return;
    const url = `${origin}/book/${clinic.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t("tst.copiedTitle"), t("tst.copiedBody"));
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* no-op */
    }
  };

  const days = lang === "ar" ? DAYS_AR : DAYS_EN;

  return (
    <div>
      <h1 className="mb-3 text-lg font-medium text-ink">{t("st.title")}</h1>

      {/* Tabs */}
      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ["clinic", t("st.clinicInfo")],
            ["staff", t("st.staff")],
            ["subscription", t("sub.title")],
            ["security", t("sec.tabTitle")],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-full border px-4 py-1.5 text-xs ${
              tab === k ? "border-blue bg-blue text-white" : "border-edge bg-card text-mute"
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {/* ========== CLINIC TAB ========== */}
      {tab === "clinic" && (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="card p-4">
            <h2 className="mb-3 flex items-center gap-2 text-xs font-medium text-ink">
              <IconClock size={14} className="text-blue" /> {t("st.hours")}
            </h2>
            {hours.map((h, i) => (
              <div
                key={h.day}
                className="flex items-center gap-2.5 border-b border-edge py-1.5 text-xs last:border-0"
                dir="ltr"
              >
                <span className="w-16 font-medium text-ink">{days[h.day]}</span>
                <button
                  onClick={() =>
                    isOwner && setHours(hours.map((x, j) => (j === i ? { ...x, isOpen: !x.isOpen } : x)))
                  }
                  className={`relative h-4 w-7 rounded-full transition-colors ${h.isOpen ? "bg-teal" : "bg-edge"}`}
                  aria-label={days[h.day]}
                >
                  <span
                    className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
                      h.isOpen ? "start-3.5" : "start-0.5"
                    }`}
                  />
                </button>
                {h.isOpen ? (
                  <>
                    <input
                      type="time"
                      className="inp !w-24 !px-2 !py-1 font-mono text-[11px]"
                      value={h.from}
                      disabled={!isOwner}
                      onChange={(e) =>
                        setHours(hours.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))
                      }
                    />
                    <span className="text-mute">—</span>
                    <input
                      type="time"
                      className="inp !w-24 !px-2 !py-1 font-mono text-[11px]"
                      value={h.to}
                      disabled={!isOwner}
                      onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))}
                    />
                  </>
                ) : (
                  <span className="text-[11px] italic text-mute opacity-70">{t("st.closed")}</span>
                )}
              </div>
            ))}
            <div className="mt-3">
              <label className="lbl">{t("st.slot")}</label>
              <input
                className="inp !w-28"
                type="number"
                min={10}
                max={120}
                value={slot}
                disabled={!isOwner}
                onChange={(e) => setSlot(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="card p-4">
              <h2 className="mb-3 flex items-center gap-2 text-xs font-medium text-ink">
                <IconLink size={14} className="text-blue" /> {t("st.link")}
              </h2>
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-sky/60 bg-soft px-3 py-2" dir="ltr">
                <span className="min-w-0 flex-1 break-all font-mono text-[10px] text-blue">
                  {origin}/book/{clinic?.slug ?? "…"}
                </span>
                <button onClick={copyLink} className="btn-blue !px-2.5 !py-1 text-[10px]">
                  {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                  {copied ? t("st.copied") : t("st.copy")}
                </button>
              </div>
              <div className="mt-3">
                <label className="lbl">{t("st.name")}</label>
                <input className="inp mb-2" value={name} disabled={!isOwner} onChange={(e) => setName(e.target.value)} />
                <label className="lbl">{t("su.phone")}</label>
                <input className="inp mb-2" value={phone} disabled={!isOwner} onChange={(e) => setPhone(e.target.value)} />
                <label className="lbl">{t("st.address")}</label>
                <input className="inp" value={address} disabled={!isOwner} onChange={(e) => setAddress(e.target.value)} />

                {/* Brand colour — Pro only */}
                {clinic?.planInfo?.limits.customBookingColor ? (
                  <>
                    <label className="lbl mt-3">{t("st.brandColor")}</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={brandColor}
                        disabled={!isOwner}
                        onChange={(e) => setBrandColor(e.target.value)}
                        className="h-10 w-14 cursor-pointer rounded border border-edge bg-card2"
                      />
                      <div className="flex-1">
                        <input
                          className="inp !py-1.5"
                          value={brandColor}
                          disabled={!isOwner}
                          onChange={(e) => setBrandColor(e.target.value)}
                          dir="ltr"
                          pattern="^#[0-9a-fA-F]{6}$"
                        />
                        <p className="mt-1 text-[9px] text-mute">{t("st.brandColorHint")}</p>
                      </div>
                      <div
                        className="h-10 w-10 rounded-lg border border-edge"
                        style={{ background: brandColor }}
                        title={t("st.brandColorPreview")}
                      />
                    </div>
                  </>
                ) : (
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-edge bg-card2 p-3 text-[10px] text-mute">
                    <IconLock size={12} />
                    <span>{t("st.brandColorLocked")}</span>
                  </div>
                )}
              </div>
            </div>

            {isOwner ? (
              <div className="flex items-center gap-3">
                <button className="btn-teal" disabled={save.isPending} onClick={() => save.mutate()}>
                  {save.isPending ? t("common.loading") : saved ? t("st.saved") : t("st.saveAll")}
                </button>
                {error && <p className="text-xs text-red-400">{error}</p>}
              </div>
            ) : (
              <p className="text-xs text-mute">{t("st.ownerOnly")}</p>
            )}
          </div>
        </div>
      )}

      {/* ========== STAFF TAB ========== */}
      {tab === "staff" && (
        <div className="card max-w-2xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-xs font-medium text-ink">
              <IconUsers size={14} className="text-blue" /> {t("st.staff")} ({staff?.length ?? "…"})
            </h2>
            {isOwner && (
              <button onClick={() => setAddingStaff(true)} className="btn-ghost !py-1.5 text-[11px]">
                <IconUserPlus size={13} /> {t("st.addStaff")}
              </button>
            )}
          </div>
          {(staff ?? []).map((s) => (
            <div key={s._id} className="flex items-center gap-3 border-b border-edge py-2.5 last:border-0">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-soft text-[9px] font-medium text-blue">
                {s.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-[11px] font-medium ${
                    s.isActive ? "text-ink" : "text-mute line-through"
                  }`}
                >
                  {s.name}
                </span>
                <span className="text-[9px] text-mute">{s.email}</span>
              </span>
              <span className={`pill ${rolePill[s.role] ?? "bg-soft text-mute"}`}>
                {s.role === "owner" ? "Owner" : s.role === "doctor" ? t("st.doctor") : t("st.reception")}
              </span>
              {isOwner && s._id !== user?.id && s.role !== "owner" && (
                <>
                  <button
                    onClick={() => openEditStaff(s)}
                    className="text-[10px] font-medium text-blue hover:underline"
                  >
                    {t("st.editInfo")}
                  </button>
                  <button
                    onClick={async () => {
                      if (s.isActive) {
                        const ok = await confirm({
                          title: t("cf.deactivateStaff"),
                          message: t("cf.deactivateStaffBody"),
                          variant: "warning",
                        });
                        if (!ok) return;
                      }
                      toggleActive.mutate(s);
                    }}
                    className={`text-[10px] font-medium ${
                      s.isActive ? "text-red-400 hover:underline" : "text-teal hover:underline"
                    }`}
                  >
                    {s.isActive ? t("st.deactivate") : t("st.activate")}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ========== SUBSCRIPTION TAB ========== */}
      {tab === "subscription" && subscription && (
        <div className="max-w-3xl">
          {/* Current plan status card */}
          <div className="card mb-4 p-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <div className="text-[9px] tracking-widest text-mute">{t("sub.currentPlan")}</div>
                <div className="mt-1 text-base font-medium text-ink">
                  {subscription.plan === "trial" ? t("sub.trial") : subscription.plan === "basic" ? t("sub.basic") : t("sub.pro")}
                </div>
              </div>
              <div>
                <div className="text-[9px] tracking-widest text-mute">{t("sub.status")}</div>
                <div className="mt-1">
                  <span
                    className={`pill ${
                      subscription.status === "active"
                        ? "bg-teal/15 text-teal"
                        : "bg-red-500/15 text-red-400"
                    }`}
                  >
                    {subscription.status === "active" ? t("sub.active") : t("sub.expired")}
                  </span>
                </div>
              </div>
              <div>
                <div className="text-[9px] tracking-widest text-mute">{t("sub.expiresOn")}</div>
                <div className="mt-1 text-xs text-ink" dir="ltr">
                  {new Date(subscription.planExpiresAt).toLocaleDateString(lang === "ar" ? "ar" : undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                  {subscription.daysRemaining !== null && (
                    <span className="ml-1.5 text-mute">
                      · {subscription.daysRemaining} {subscription.daysRemaining === 1 ? t("sub.dayLeft") : t("sub.daysLeft")}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {subscription.pendingRequest && (
              <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2.5 text-[11px] text-amber-300">
                <IconAlertCircle size={14} className="mt-0.5 shrink-0" />
                {t("sub.pendingMsg").replace(
                  "{plan}",
                  subscription.pendingRequest.plan === "basic" ? t("sub.basic") : t("sub.pro")
                )}
              </div>
            )}
          </div>

          {/* Plans grid — only show upgrade options */}
          <div className="mb-2 text-xs font-medium text-ink">{t("sub.chooseYourPlan")}</div>
          <p className="mb-4 text-[11px] text-mute">{t("sub.chooseSub")}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {(["trial", "basic", "pro"] as const).map((p) => {
              const info = subscription.plans[p];
              const isCurrent = subscription.plan === p;
              const canSelect = isOwner && !isCurrent && p !== "trial" && !subscription.pendingRequest;
              return (
                <div
                  key={p}
                  className={`relative rounded-2xl border p-5 ${
                    p === "basic"
                      ? "border-2 border-blue bg-card"
                      : isCurrent
                      ? "border-2 border-teal bg-card"
                      : "border-edge bg-card2"
                  }`}
                >
                  {p === "basic" && !isCurrent && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue px-3 py-0.5 text-[9px] text-white">
                      {t("sub.mostPopular")}
                    </span>
                  )}
                  {isCurrent && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-teal px-3 py-0.5 text-[9px] text-navy">
                      {t("sub.current")}
                    </span>
                  )}
                  <h3 className="text-xs font-medium tracking-wide text-mute">
                    {p === "trial" ? t("sub.trial") : p === "basic" ? t("sub.basic") : t("sub.pro")}
                  </h3>
                  <div className="mt-2 text-2xl font-medium text-ink">
                    {info.price === 0 ? t("price.free") : `${info.price} JD`}
                    <small className="ms-1 text-[10px] font-normal text-mute">
                      {p === "trial" ? t("sub.perTrial") : t("sub.per")}
                    </small>
                  </div>

                  <ul className="mt-4 space-y-1.5 text-[11px]">
                    <FeatRow ok={info.limits.maxDoctors !== 0}>
                      {info.limits.maxDoctors === -1
                        ? t("sub.feat.doctorsUnlim")
                        : info.limits.maxDoctors === 1
                        ? t("sub.feat.oneDoctor")
                        : `${info.limits.maxDoctors} ${t("sub.feat.doctors")}`}
                    </FeatRow>
                    <FeatRow ok={info.limits.maxReceptionists !== 0}>
                      {info.limits.maxReceptionists === -1
                        ? t("sub.feat.receptionUnlim")
                        : info.limits.maxReceptionists === 0
                        ? t("sub.feat.noReception")
                        : `${info.limits.maxReceptionists} ${t("sub.feat.reception")}`}
                    </FeatRow>
                    <FeatRow ok={info.limits.maxAppointments === -1}>
                      {info.limits.maxAppointments === -1 ? t("sub.feat.apptsUnlim") : t("sub.feat.appts20")}
                    </FeatRow>
                    <FeatRow ok={info.limits.invoicing}>
                      {info.limits.maxInvoicesPerMonth === -1
                        ? t("sub.feat.invoicingUnlim")
                        : info.limits.maxInvoicesPerMonth > 0
                        ? `${info.limits.maxInvoicesPerMonth} ${t("sub.feat.invoicingCount")}`
                        : t("sub.feat.noInvoicing")}
                    </FeatRow>
                    <FeatRow ok={info.limits.reports}>
                      {info.limits.reports ? t("sub.feat.reports") : t("sub.feat.noReports")}
                    </FeatRow>
                    {p === "pro" && (
                      <>
                        <FeatRow ok>{t("sub.feat.exports")}</FeatRow>
                        <FeatRow ok>{t("sub.feat.whiteLabel")}</FeatRow>
                        <FeatRow ok>{t("sub.feat.brandColor")}</FeatRow>
                        <FeatRow ok>{t("sub.feat.support24")}</FeatRow>
                      </>
                    )}
                    {p === "basic" && <FeatRow ok>{t("sub.feat.support48")}</FeatRow>}
                  </ul>

                  {canSelect && (
                    <button
                      onClick={() => setUpgradeFor(p)}
                      className={`mt-5 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium ${
                        p === "pro" ? "bg-teal text-navy" : "bg-blue text-white"
                      }`}
                    >
                      <IconSparkles size={13} /> {t("sub.selectPlan")}
                    </button>
                  )}
                  {isCurrent && (
                    <p className="mt-5 rounded-lg border border-edge bg-card2 py-2 text-center text-[11px] text-mute">
                      {t("sub.current")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== Add staff modal ===== */}
      {addingStaff && (
        <Modal title={t("st.addStaff")} onClose={() => setAddingStaff(false)}>
          <label className="lbl">{t("su.fullName")}</label>
          <input className="inp mb-3" value={sName} onChange={(e) => setSName(e.target.value)} />
          <label className="lbl">{t("auth.email")}</label>
          <input className="inp mb-3" type="email" value={sEmail} onChange={(e) => setSEmail(e.target.value)} />
          <label className="lbl">{t("st.tempPass")}</label>
          <input className="inp mb-3" value={sPass} onChange={(e) => setSPass(e.target.value)} />
          <label className="lbl">{t("st.role")}</label>
          <div className="mb-4 flex gap-2">
            {(
              [
                ["doctor", t("st.doctor")],
                ["receptionist", t("st.reception")],
              ] as const
            ).map(([r, l]) => (
              <button
                key={r}
                onClick={() => setSRole(r)}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs ${
                  sRole === r ? "border-blue bg-blue/15 text-sky" : "border-edge bg-card2 text-mute"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
          {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
          <button
            className="btn-teal w-full"
            disabled={!sName || !sEmail || sPass.length < 6 || addStaff.isPending}
            onClick={() => addStaff.mutate()}
          >
            {addStaff.isPending ? t("common.loading") : t("st.addStaff")}
          </button>
        </Modal>
      )}

      {/* ===== Edit staff modal ===== */}
      {editingStaff && (
        <Modal title={t("st.editStaff")} onClose={() => setEditingStaff(null)}>
          <label className="lbl">{t("su.fullName")}</label>
          <input className="inp mb-3" value={eName} onChange={(e) => setEName(e.target.value)} />
          <label className="lbl">{t("auth.email")}</label>
          <input
            className="inp mb-3"
            type="email"
            value={eEmail}
            onChange={(e) => setEEmail(e.target.value)}
          />
          <label className="lbl">{t("su.phone")}</label>
          <input
            className="inp mb-3"
            value={ePhone}
            onChange={(e) => setEPhone(e.target.value)}
            dir="ltr"
          />
          <label className="lbl">{t("st.role")}</label>
          <div className="mb-3 flex gap-2">
            {(
              [
                ["doctor", t("st.doctor")],
                ["receptionist", t("st.reception")],
              ] as const
            ).map(([r, l]) => (
              <button
                key={r}
                onClick={() => setERole(r)}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs ${
                  eRole === r ? "border-blue bg-blue/15 text-sky" : "border-edge bg-card2 text-mute"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
          <label className="lbl">{t("st.newPassword")}</label>
          <input
            className="inp mb-4"
            type="password"
            value={ePass}
            onChange={(e) => setEPass(e.target.value)}
            placeholder="••••••••"
          />
          {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
          <button
            className="btn-teal w-full"
            disabled={!eName || !eEmail || editStaffMut.isPending}
            onClick={() => editStaffMut.mutate()}
          >
            {editStaffMut.isPending ? t("common.loading") : t("st.saveChanges")}
          </button>
        </Modal>
      )}

      {/* ===== Upgrade modal ===== */}
      {upgradeFor && (
        <Modal
          title={`${t("sub.upgrade")} — ${upgradeFor === "basic" ? t("sub.basic") : t("sub.pro")} · ${
            upgradeFor === "basic" ? "19" : "29"
          } JD`}
          onClose={() => setUpgradeFor(null)}
        >
          <p className="mb-4 text-xs text-mute">{t("sub.billingInfo")}</p>

          <label className="lbl">{t("sub.billingName")}</label>
          <input className="inp mb-2" value={bName} onChange={(e) => setBName(e.target.value)} />

          <label className="lbl">{t("sub.billingEmail")}</label>
          <input className="inp mb-2" type="email" value={bEmail} onChange={(e) => setBEmail(e.target.value)} />

          <label className="lbl">{t("sub.billingPhone")}</label>
          <input className="inp mb-3" value={bPhone} onChange={(e) => setBPhone(e.target.value)} dir="ltr" />

          <label className="lbl">{t("sub.paymentMethod")}</label>
          <div className="mb-3 grid grid-cols-3 gap-2">
            {(
              [
                ["cliq", t("sub.cliq")],
                ["bank_transfer", t("sub.bankTransfer")],
                ["cash", t("sub.cash")],
              ] as const
            ).map(([m, l]) => (
              <button
                key={m}
                onClick={() => setBMethod(m)}
                className={`rounded-lg border py-2 text-[11px] ${
                  bMethod === m ? "border-blue bg-blue/15 text-sky" : "border-edge bg-card2 text-mute"
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          {bMethod !== "cash" && (
            <>
              <label className="lbl">{t("sub.paymentRef")}</label>
              <input className="inp mb-2" value={bRef} onChange={(e) => setBRef(e.target.value)} />
            </>
          )}

          {upgradeFor === "pro" && (
            <>
              <label className="lbl">{t("sub.notes")}</label>
              <textarea
                className="inp mb-2 !min-h-16"
                value={bNotes}
                onChange={(e) => setBNotes(e.target.value)}
              />
            </>
          )}

          {error && <p className="mb-2 text-xs text-red-400">{error}</p>}

          <button
            className="btn-teal mt-2 w-full"
            disabled={!bName || !bEmail || !bPhone || upgrade.isPending}
            onClick={() => upgrade.mutate()}
          >
            <IconCreditCard size={14} />
            {upgrade.isPending ? t("common.loading") : t("sub.submitRequest")}
          </button>

          <p className="mt-3 text-center text-[10px] text-mute">{t("sub.submitted")}</p>
        </Modal>
      )}

      {tab === "security" && <SecurityTab isOwner={isOwner} />}

      {/* ===== Pending review screen — full overlay after submitting upgrade ===== */}
      {justSubmitted && submittedAt && (
        <PendingReviewScreen
          plan={justSubmitted}
          submittedAt={submittedAt}
          onClose={() => {
            setJustSubmitted(null);
            setSubmittedAt(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Full-screen overlay shown right after the owner submits an upgrade request.
 * Displays a live countdown from 1 hour showing the maximum expected time
 * for manual approval by the platform admin.
 */
function PendingReviewScreen({
  plan,
  submittedAt,
  onClose,
}: {
  plan: Plan;
  submittedAt: number;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [remaining, setRemaining] = useState(3600 - Math.floor((Date.now() - submittedAt) / 1000));

  useEffect(() => {
    const id = window.setInterval(() => {
      const rem = 3600 - Math.floor((Date.now() - submittedAt) / 1000);
      setRemaining(rem);
    }, 1000);
    return () => window.clearInterval(id);
  }, [submittedAt]);

  const mm = Math.max(0, Math.floor(remaining / 60));
  const ss = Math.max(0, remaining % 60);
  const isPast = remaining <= 0;

  const planName = plan === "basic" ? t("sub.basic") : t("sub.pro");

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-2xl border border-teal/40 bg-card p-6 text-center shadow-[0_30px_60px_-20px_rgba(0,0,0,0.6)]">
        {/* Spinning 3D hourglass */}
        <div className="mx-auto mb-4 flex justify-center" style={{ perspective: 500 }}>
          <div className="preserve-3d spin-slow relative h-16 w-16">
            <span
              className="absolute inset-0 rounded-2xl border-2 border-amber-500/50"
              style={{ transform: "translateZ(-12px) translate(6px,6px)" }}
            />
            <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-amber-500/20 text-amber-400">
              <IconClock size={32} />
            </span>
          </div>
        </div>

        <h2 className="text-lg font-medium text-ink">{t("sub.pending.title")}</h2>
        <p className="mt-2 text-xs text-mute">
          {t("sub.pending.sub").replace("{plan}", planName)}
        </p>

        {/* Countdown */}
        {!isPast ? (
          <div className="my-5">
            <div className="text-[10px] tracking-widest text-mute">
              {t("sub.pending.remaining")}
            </div>
            <div className="mt-1 font-mono text-3xl font-medium text-teal" dir="ltr">
              {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
            </div>
            <div className="mt-1 text-[10px] text-mute">
              {t("sub.pending.maxTime")}
            </div>
          </div>
        ) : (
          <div className="my-5 rounded-lg bg-amber-500/10 px-4 py-3 text-[11px] text-amber-300">
            {t("sub.pending.stillProcessing")}
          </div>
        )}

        {/* Benefits reminder */}
        <div className="rounded-lg border border-edge bg-card2 p-3 text-start">
          <div className="mb-2 text-[10px] tracking-widest text-mute">
            {t("sub.pending.willGet")}
          </div>
          <ul className="space-y-1.5 text-[11px]">
            {(plan === "basic"
              ? [
                  t("sub.pending.b1"),
                  t("sub.pending.b2"),
                  t("sub.pending.b3"),
                  t("sub.pending.b4"),
                ]
              : [
                  t("sub.pending.p1"),
                  t("sub.pending.p2"),
                  t("sub.pending.p3"),
                  t("sub.pending.p4"),
                  t("sub.pending.p5"),
                ]
            ).map((line) => (
              <li key={line} className="flex items-start gap-1.5 text-ink">
                <IconCheck size={12} className="mt-0.5 shrink-0 text-teal" />
                {line}
              </li>
            ))}
          </ul>
        </div>

        <button
          onClick={onClose}
          className="mt-5 w-full rounded-lg border border-edge bg-card2 py-2 text-xs font-medium text-ink hover:bg-soft"
        >
          {t("sub.pending.back")}
        </button>
      </div>
    </div>
  );
}

function FeatRow({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={`flex items-start gap-1.5 ${ok ? "text-ink" : "text-mute opacity-60"}`}>
      {ok ? (
        <IconCheck size={12} className="mt-0.5 shrink-0 text-teal" />
      ) : (
        <span className="mt-1 h-[3px] w-2.5 shrink-0 rounded bg-mute" />
      )}
      <span>{children}</span>
    </li>
  );
}

// ================================================================
// SECURITY TAB — change password, resend verification, export data,
// delete account.  Kept as its own component so the state stays local.
// ================================================================
function SecurityTab({ isOwner }: { isOwner: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const { confirm } = useConfirm();
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const patchUser = useAuth((s) => s.patchUser);

  // Change password
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPw, setShowPw] = useState(false);

  const meets = {
    length: newPw.length >= 8,
    number: /\d/.test(newPw),
    match: newPw.length > 0 && newPw === confirmPw,
    different: newPw.length > 0 && newPw !== currentPw,
  };
  const pwValid = meets.length && meets.number && meets.match && meets.different;

  const changePw = useMutation({
    mutationFn: async () =>
      (await api.post("/auth/change-password", { currentPassword: currentPw, newPassword: newPw })).data,
    onSuccess: () => {
      toast.success(t("sec.pwChanged"), t("sec.pwChangedSub"));
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    },
    onError: (e) => toast.error(t("common.error"), errMsg(e, t("common.error"))),
  });

  // Resend verification
  const resendVerify = useMutation({
    mutationFn: async () => (await api.post("/auth/resend-verification")).data,
    onSuccess: () => toast.success(t("sec.verifySent"), t("sec.verifySentSub")),
    onError: (e) => toast.error(t("common.error"), errMsg(e, t("common.error"))),
  });

  // Refresh user data (to detect verification after external click)
  const refreshUser = useMutation({
    mutationFn: async () => (await api.get("/auth/me")).data,
    onSuccess: (u) => {
      patchUser({ emailVerified: u.emailVerified });
      if (u.emailVerified) toast.success(t("sec.verifyOk"));
    },
  });

  // Export data
  const exportData = useMutation({
    mutationFn: async () => (await api.get("/clinic/export")).data,
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `clinicos-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(t("sec.exportOk"), t("sec.exportOkSub"));
    },
    onError: (e) => toast.error(t("common.error"), errMsg(e, t("common.error"))),
  });

  // Delete clinic
  const [deleteText, setDeleteText] = useState("");
  const deleteMut = useMutation({
    mutationFn: async () => (await api.delete("/clinic", { data: { confirmText: "DELETE" } })).data,
    onSuccess: () => {
      toast.success(t("sec.deleteOk"));
      window.setTimeout(() => {
        logout();
        router.replace("/");
      }, 1200);
    },
    onError: (e) => toast.error(t("common.error"), errMsg(e, t("common.error"))),
  });

  const onDelete = async () => {
    const ok = await confirm({
      title: t("sec.deleteConfirmTitle"),
      message: t("sec.deleteConfirmBody"),
      confirmText: t("sec.deleteConfirmBtn"),
      variant: "danger",
    });
    if (ok) deleteMut.mutate();
  };

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {/* Change password */}
      <div className="card p-4">
        <h2 className="mb-3 flex items-center gap-2 text-xs font-medium text-ink">
          <IconLock size={14} className="text-blue" /> {t("sec.changePwTitle")}
        </h2>
        <p className="mb-3 text-[10px] text-mute">{t("sec.changePwSub")}</p>

        <label className="lbl">{t("sec.currentPw")}</label>
        <div className="relative mb-2.5">
          <input
            type={showPw ? "text" : "password"}
            className="inp"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            dir="ltr"
          />
        </div>

        <label className="lbl">{t("sec.newPw")}</label>
        <div className="relative mb-2.5">
          <input
            type={showPw ? "text" : "password"}
            className="inp"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            dir="ltr"
          />
          <button
            type="button"
            onClick={() => setShowPw(!showPw)}
            className="absolute end-3 top-1/2 -translate-y-1/2 text-mute hover:text-sky"
          >
            {showPw ? <IconEyeOff size={13} /> : <IconEye size={13} />}
          </button>
        </div>

        <label className="lbl">{t("sec.confirmPw")}</label>
        <input
          type={showPw ? "text" : "password"}
          className="inp"
          value={confirmPw}
          onChange={(e) => setConfirmPw(e.target.value)}
          dir="ltr"
        />

        {(newPw.length > 0 || confirmPw.length > 0) && (
          <div className="mt-3 space-y-1 text-[10px]">
            <ReqLine met={meets.length} label={t("rp.reqLength")} />
            <ReqLine met={meets.number} label={t("rp.reqNumber")} />
            <ReqLine met={meets.match} label={t("rp.reqMatch")} />
            <ReqLine met={meets.different} label={t("sec.pwDifferent")} />
          </div>
        )}

        <button
          onClick={() => changePw.mutate()}
          disabled={!currentPw || !pwValid || changePw.isPending}
          className="mt-3 w-full rounded-lg bg-teal py-2 text-[11px] font-medium text-navy hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {changePw.isPending ? t("common.loading") : t("sec.updatePw")}
        </button>
      </div>

      {/* Email verification + Data export */}
      <div className="space-y-3">
        {/* Verification card */}
        <div className="card p-4">
          <h2 className="mb-3 flex items-center gap-2 text-xs font-medium text-ink">
            <IconMail size={14} className="text-blue" /> {t("sec.emailVerifyTitle")}
          </h2>
          {user?.emailVerified ? (
            <div className="flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 p-3">
              <IconCheck size={14} className="text-teal" />
              <span className="text-[11px] text-ink">{t("sec.verified")}</span>
            </div>
          ) : (
            <>
              <p className="mb-3 text-[10px] text-mute">{t("sec.emailVerifySub")}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => resendVerify.mutate()}
                  disabled={resendVerify.isPending}
                  className="flex-1 rounded-lg bg-blue py-2 text-[11px] font-medium text-white hover:brightness-110 disabled:opacity-50"
                >
                  {resendVerify.isPending ? t("common.loading") : t("sec.resendVerify")}
                </button>
                <button
                  onClick={() => refreshUser.mutate()}
                  disabled={refreshUser.isPending}
                  className="rounded-lg border border-edge bg-card2 px-3 py-2 text-[11px] font-medium text-ink hover:bg-soft disabled:opacity-50"
                >
                  {t("sec.iVerified")}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Export card */}
        {isOwner && (
          <div className="card p-4">
            <h2 className="mb-2 flex items-center gap-2 text-xs font-medium text-ink">
              <IconDownload size={14} className="text-blue" /> {t("sec.exportTitle")}
            </h2>
            <p className="mb-3 text-[10px] text-mute">{t("sec.exportSub")}</p>
            <button
              onClick={() => exportData.mutate()}
              disabled={exportData.isPending}
              className="w-full rounded-lg border border-edge bg-card2 py-2 text-[11px] font-medium text-ink hover:bg-soft disabled:opacity-50"
            >
              {exportData.isPending ? t("common.loading") : t("sec.exportBtn")}
            </button>
          </div>
        )}

        {/* Danger zone */}
        {isOwner && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
            <h2 className="mb-2 flex items-center gap-2 text-xs font-medium text-red-400">
              <IconTrash size={14} /> {t("sec.dangerTitle")}
            </h2>
            <p className="mb-3 text-[10px] leading-relaxed text-mute">{t("sec.dangerSub")}</p>
            <label className="lbl">{t("sec.dangerType")}</label>
            <input
              type="text"
              className="inp"
              placeholder="DELETE"
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
              dir="ltr"
            />
            <button
              onClick={onDelete}
              disabled={deleteText !== "DELETE" || deleteMut.isPending}
              className="mt-3 w-full rounded-lg bg-red-500 py-2 text-[11px] font-medium text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleteMut.isPending ? t("common.loading") : t("sec.deleteBtn")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ReqLine({ met, label }: { met: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-1.5 ${met ? "text-teal" : "text-mute"}`}>
      {met ? <IconCheck size={11} /> : <IconAlertCircle size={11} />}
      <span>{label}</span>
    </div>
  );
}
