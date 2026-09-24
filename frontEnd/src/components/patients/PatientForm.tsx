"use client";
import { useMemo, useState } from "react";
import axios from "axios";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/Toast";
import type { Patient } from "@/lib/types";
import {
  MEDICAL_GROUPS,
  ALL_MEDICAL_KEYS,
  FEMALE_ONLY,
  BLOOD_TYPES,
  MARITAL,
  REFERRALS,
  severityOf,
  severityPill,
  type MedicalKey,
} from "@/lib/medical";
import {
  IconUser,
  IconHeartbeat,
  IconLifebuoy,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCircleCheck,
} from "@tabler/icons-react";

/**
 * NEW COMPONENT — the complete patient file, used in TWO places so they can
 * never drift apart:
 *   - "Add patient" modal on /patients         (mode="create")
 *   - "Edit file" modal on /patients/profile   (mode="edit")
 *
 * Every medical question is a switch; turning it on opens a details field.
 * The medical history is only sent once the user has actually answered
 * it (touched a switch, or pressed "None of the above"), so a quick
 * name + phone registration never falsely records "no conditions".
 */

type Tab = "personal" | "medical" | "contact";
const TABS: Tab[] = ["personal", "medical", "contact"];

interface Flag {
  has: boolean;
  details: string;
}

interface FormState {
  fullName: string;
  phone: string;
  email: string;
  gender: string;
  birthDate: string;
  nationalId: string;
  address: string;
  occupation: string;
  maritalStatus: string;
  bloodType: string;
  referralSource: string;
  whatsappOptIn: boolean;
  medicalNotes: string;
  ecName: string;
  ecRelation: string;
  ecPhone: string;
  insProvider: string;
  insNumber: string;
  medical: Record<MedicalKey, Flag>;
}

const emptyMedical = (): Record<MedicalKey, Flag> =>
  Object.fromEntries(ALL_MEDICAL_KEYS.map((k) => [k, { has: false, details: "" }])) as Record<MedicalKey, Flag>;

function fromPatient(p?: Patient): FormState {
  const medical = emptyMedical();
  for (const k of ALL_MEDICAL_KEYS) {
    const f = p?.medicalHistory?.[k];
    if (f) medical[k] = { has: !!f.has, details: f.details ?? "" };
  }
  return {
    fullName: p?.fullName ?? "",
    phone: p?.phone ?? "",
    email: p?.email ?? "",
    gender: p?.gender ?? "",
    birthDate: p?.birthDate ? p.birthDate.slice(0, 10) : "",
    nationalId: p?.nationalId ?? "",
    address: p?.address ?? "",
    occupation: p?.occupation ?? "",
    maritalStatus: p?.maritalStatus ?? "",
    bloodType: p?.bloodType ?? "",
    referralSource: p?.referralSource ?? "",
    whatsappOptIn: p?.whatsappOptIn !== false,
    medicalNotes: p?.medicalNotes ?? "",
    ecName: p?.emergencyContact?.name ?? "",
    ecRelation: p?.emergencyContact?.relation ?? "",
    ecPhone: p?.emergencyContact?.phone ?? "",
    insProvider: p?.insurance?.provider ?? "",
    insNumber: p?.insurance?.policyNumber ?? "",
    medical,
  };
}

/** Server validation errors carry `details` — show the first one, it's the useful part. */
function readError(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    const d = e.response?.data as { message?: string; details?: string[] } | undefined;
    if (d?.details?.length) return d.details[0];
    if (d?.message) return d.message;
  }
  return fallback;
}

export default function PatientForm({
  mode,
  initial,
  startTab = "personal",
  onSaved,
}: {
  mode: "create" | "edit";
  initial?: Patient;
  startTab?: Tab;
  onSaved: (p: Patient) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>(startTab);
  const [form, setForm] = useState<FormState>(() => fromPatient(initial));
  const [medicalTouched, setMedicalTouched] = useState(
    !!initial?.medicalHistory && Object.keys(initial.medicalHistory).length > 0
  );
  const [error, setError] = useState("");

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setFlag = (key: MedicalKey, patch: Partial<Flag>) => {
    setMedicalTouched(true);
    setForm((f) => ({ ...f, medical: { ...f.medical, [key]: { ...f.medical[key], ...patch } } }));
  };

  const showFemale = form.gender !== "male";
  const visibleKeys = (keys: MedicalKey[]) => keys.filter((k) => showFemale || !FEMALE_ONLY.includes(k));

  const flagged = useMemo(
    () =>
      ALL_MEDICAL_KEYS.filter((k) => form.medical[k].has && (showFemale || !FEMALE_ONLY.includes(k))).sort(
        (a, b) =>
          ["critical", "caution", "info"].indexOf(severityOf(a)) - ["critical", "caution", "info"].indexOf(severityOf(b))
      ),
    [form.medical, showFemale]
  );

  const valid = form.fullName.trim().length >= 2 && form.phone.trim().length >= 7;

  const age = useMemo(() => {
    if (!form.birthDate) return null;
    const ms = Date.now() - new Date(form.birthDate).getTime();
    return ms > 0 ? Math.floor(ms / 3.15576e10) : null;
  }, [form.birthDate]);

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        gender: form.gender,
        birthDate: form.birthDate,
        nationalId: form.nationalId.trim(),
        address: form.address.trim(),
        occupation: form.occupation.trim(),
        maritalStatus: form.maritalStatus,
        bloodType: form.bloodType,
        referralSource: form.referralSource,
        whatsappOptIn: form.whatsappOptIn,
        medicalNotes: form.medicalNotes.trim(),
        emergencyContact: { name: form.ecName.trim(), relation: form.ecRelation.trim(), phone: form.ecPhone.trim() },
        insurance: { provider: form.insProvider.trim(), policyNumber: form.insNumber.trim() },
      };
      if (medicalTouched) {
        body.medicalHistory = Object.fromEntries(
          ALL_MEDICAL_KEYS.map((k) => {
            const f = form.medical[k];
            return [k, f.has && f.details.trim() ? { has: true, details: f.details.trim() } : { has: f.has }];
          })
        );
      }
      const res =
        mode === "create"
          ? await api.post<Patient>("/patients", body)
          : await api.patch<Patient>(`/patients/${initial!._id}`, body);
      return res.data;
    },
    onSuccess: (p) => {
      toast.success(t("tst.savedTitle"), t("tst.savedBody"));
      onSaved(p);
    },
    onError: (e) => {
      const msg = readError(e, t("common.error"));
      setError(msg);
      toast.error(t("common.error"), msg);
    },
  });

  const submit = () => {
    setError("");
    if (!valid) {
      setTab("personal");
      setError(t("pf.required"));
      return;
    }
    save.mutate();
  };

  const tabIndex = TABS.indexOf(tab);
  const tabMeta: Record<Tab, { icon: typeof IconUser; label: string }> = {
    personal: { icon: IconUser, label: t("pf.tab.personal") },
    medical: { icon: IconHeartbeat, label: t("pf.tab.medical") },
    contact: { icon: IconLifebuoy, label: t("pf.tab.contact") },
  };

  return (
    <div>
      {/* ===== Section switcher ===== */}
      <div role="tablist" className="mb-4 grid grid-cols-3 gap-1 rounded-lg border border-edge bg-card2 p-1">
        {TABS.map((id) => {
          const Icon = tabMeta[id].icon;
          const active = tab === id;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(id)}
              className={`relative flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky ${
                active ? "bg-teal text-navy" : "text-mute hover:text-ink"
              }`}
            >
              <Icon size={14} className="shrink-0" />
              <span className="truncate">{tabMeta[id].label}</span>
              {id === "medical" && flagged.length > 0 && (
                <span
                  className={`flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] ${
                    active ? "bg-navy text-teal" : "bg-red-500 text-white"
                  }`}
                >
                  {flagged.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ===== Personal ===== */}
      {tab === "personal" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("pt.name")} required>
            <input className="inp" value={form.fullName} onChange={(e) => set("fullName", e.target.value)} autoFocus={mode === "create"} />
          </Field>
          <Field label={t("pt.phone")} required>
            <input className="inp" dir="ltr" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="079 000 0000" />
          </Field>
          <Field label={t("pt.gender")}>
            <div className="grid grid-cols-2 gap-1.5">
              {(["male", "female"] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => set("gender", form.gender === g ? "" : g)}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                    form.gender === g ? "border-teal bg-teal/15 text-teal" : "border-edge bg-card2 text-mute hover:text-ink"
                  }`}
                >
                  {t(`pt.${g}`)}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t("pt.birth")} hint={age !== null ? `${age} ${t("pp.years")}` : undefined}>
            <input type="date" className="inp" value={form.birthDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => set("birthDate", e.target.value)} />
          </Field>

          <Field label={t("pf.blood")} className="sm:col-span-2">
            <div className="flex flex-wrap gap-1.5" dir="ltr">
              {BLOOD_TYPES.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => set("bloodType", form.bloodType === b ? "" : b)}
                  aria-pressed={form.bloodType === b}
                  className={`h-8 min-w-[44px] rounded-lg border px-2 font-mono text-xs font-medium transition-colors ${
                    form.bloodType === b ? "border-red-400 bg-red-500/15 text-red-400" : "border-edge bg-card2 text-mute hover:text-ink"
                  }`}
                >
                  {b}
                </button>
              ))}
            </div>
          </Field>

          <Field label={t("pf.marital")}>
            <select className="inp" value={form.maritalStatus} onChange={(e) => set("maritalStatus", e.target.value)}>
              <option value="">—</option>
              {MARITAL.map((m) => (
                <option key={m} value={m}>{t(`pf.marital.${m}`)}</option>
              ))}
            </select>
          </Field>
          <Field label={t("pf.occupation")}>
            <input className="inp" value={form.occupation} onChange={(e) => set("occupation", e.target.value)} />
          </Field>
          <Field label={t("pf.nationalId")}>
            <input className="inp" dir="ltr" inputMode="numeric" value={form.nationalId} onChange={(e) => set("nationalId", e.target.value)} />
          </Field>
          <Field label={t("pf.email")}>
            <input className="inp" dir="ltr" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label={t("pf.address")} className="sm:col-span-2">
            <input className="inp" value={form.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
          <Field label={t("pf.referral")}>
            <select className="inp" value={form.referralSource} onChange={(e) => set("referralSource", e.target.value)}>
              <option value="">—</option>
              {REFERRALS.map((r) => (
                <option key={r} value={r}>{t(`pf.ref.${r}`)}</option>
              ))}
            </select>
          </Field>
          <div className="flex items-center gap-3 rounded-lg border border-edge bg-card2 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium text-ink">{t("pf.whatsapp")}</div>
              <div className="text-[10px] leading-snug text-mute">{t("pf.whatsappSub")}</div>
            </div>
            <Switch on={form.whatsappOptIn} onChange={(v) => set("whatsappOptIn", v)} label={t("pf.whatsapp")} />
          </div>
        </div>
      )}

      {/* ===== Medical history ===== */}
      {tab === "medical" && (
        <div>
          {/* Live summary of everything marked "yes" — what the doctor sees first */}
          <div className="mb-4 rounded-lg border border-edge bg-card2 p-3">
            {flagged.length > 0 ? (
              <>
                <div className="mb-2 text-[10px] font-medium text-mute">
                  {t("pf.flaggedCount").replace("{n}", String(flagged.length))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {flagged.map((k) => (
                    <span key={k} className={`pill ${severityPill[severityOf(k)]}`}>
                      {t(`med.${k}`)}
                      {form.medical[k].details.trim() && (
                        <span className="ms-1 max-w-[140px] truncate opacity-80">
                          · <bdi>{form.medical[k].details.trim()}</bdi>
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <p className="flex-1 text-[11px] text-mute">{t("pf.noneFlagged")}</p>
                <button
                  type="button"
                  onClick={() => setMedicalTouched(true)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-medium transition-colors ${
                    medicalTouched ? "border-teal bg-teal/15 text-teal" : "border-edge text-ink hover:border-sky"
                  }`}
                >
                  <IconCircleCheck size={14} />
                  {t("pf.noneOfAbove")}
                </button>
              </div>
            )}
          </div>

          {MEDICAL_GROUPS.map((g) => {
            const keys = visibleKeys(g.keys);
            if (!keys.length) return null;
            return (
              <section key={g.id} className="mb-4">
                <h4 className="mb-2 text-[11px] font-medium text-ink">{t(`pf.group.${g.id}`)}</h4>
                <div className="grid items-start gap-2 sm:grid-cols-2">
                  {keys.map((k) => (
                    <MedicalRow
                      key={k}
                      id={k}
                      label={t(`med.${k}`)}
                      placeholder={t(`med.${k}.ph`)}
                      flag={form.medical[k]}
                      onToggle={(v) => setFlag(k, { has: v })}
                      onDetails={(v) => setFlag(k, { details: v })}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          <Field label={t("pf.notesTitle")}>
            <textarea
              dir="auto"
              className="inp min-h-20"
              placeholder={t("pf.notesPh")}
              value={form.medicalNotes}
              maxLength={2000}
              onChange={(e) => set("medicalNotes", e.target.value)}
            />
          </Field>
        </div>
      )}

      {/* ===== Emergency & insurance ===== */}
      {tab === "contact" && (
        <div className="grid gap-4">
          <section>
            <h4 className="mb-2 text-[11px] font-medium text-ink">{t("pf.ec.title")}</h4>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("pf.ec.name")}>
                <input className="inp" value={form.ecName} onChange={(e) => set("ecName", e.target.value)} />
              </Field>
              <Field label={t("pf.ec.relation")}>
                <input className="inp" value={form.ecRelation} onChange={(e) => set("ecRelation", e.target.value)} />
              </Field>
              <Field label={t("pf.ec.phone")}>
                <input className="inp" dir="ltr" value={form.ecPhone} onChange={(e) => set("ecPhone", e.target.value)} placeholder="079 000 0000" />
              </Field>
            </div>
          </section>
          <section>
            <h4 className="mb-2 text-[11px] font-medium text-ink">{t("pf.ins.title")}</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("pf.ins.provider")}>
                <input className="inp" value={form.insProvider} onChange={(e) => set("insProvider", e.target.value)} />
              </Field>
              <Field label={t("pf.ins.number")}>
                <input className="inp" dir="ltr" value={form.insNumber} onChange={(e) => set("insNumber", e.target.value)} />
              </Field>
            </div>
          </section>
        </div>
      )}

      {/* ===== Sticky actions ===== */}
      <div className="sticky bottom-0 -mx-5 mt-5 border-t border-edge bg-card px-5 py-3">
        {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
        <div className="flex items-center gap-2">
          {tabIndex > 0 && (
            <button type="button" onClick={() => setTab(TABS[tabIndex - 1])} className="btn-ghost !px-3 !py-2 text-xs">
              <IconChevronLeft size={14} className="rtl-flip" /> {t("pf.back")}
            </button>
          )}
          {tabIndex < TABS.length - 1 && (
            <button type="button" onClick={() => setTab(TABS[tabIndex + 1])} className="btn-ghost !px-3 !py-2 text-xs">
              {t("pf.next")} <IconChevronRight size={14} className="rtl-flip" />
            </button>
          )}
          <button type="button" onClick={submit} disabled={save.isPending} className="btn-teal ms-auto !py-2 text-xs">
            <IconCheck size={14} />
            {save.isPending ? t("common.loading") : mode === "create" ? t("pt.save") : t("pf.saveChanges")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===================================================================
// Small building blocks
// ===================================================================

function Field({
  label,
  required,
  hint,
  className = "",
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="lbl flex items-center gap-1">
        {label}
        {required && <span className="text-red-400">*</span>}
        {hint && <span className="ms-auto font-normal text-sky">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky ${
        on ? "border-teal bg-teal" : "border-edge bg-soft"
      }`}
    >
      <span
        className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform start-0.5 ${
          on ? "translate-x-4 rtl:-translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

/**
 * One medical question. When switched on, the row takes the colour of its
 * severity and the details field slides open underneath.
 */
function MedicalRow({
  id,
  label,
  placeholder,
  flag,
  onToggle,
  onDetails,
}: {
  id: MedicalKey;
  label: string;
  placeholder: string;
  flag: Flag;
  onToggle: (v: boolean) => void;
  onDetails: (v: string) => void;
}) {
  const sev = severityOf(id);
  const onBorder =
    sev === "critical" ? "border-red-500/50 bg-red-500/5" : sev === "caution" ? "border-amber-500/50 bg-amber-500/5" : "border-sky/50 bg-sky/5";
  return (
    <div className={`rounded-lg border transition-colors ${flag.has ? onBorder : "border-edge bg-card2"}`}>
      <button
        type="button"
        onClick={() => onToggle(!flag.has)}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-start"
        aria-expanded={flag.has}
      >
        <span className={`flex-1 text-[11px] font-medium ${flag.has ? "text-ink" : "text-mute"}`}>{label}</span>
        <span
          aria-hidden
          className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
            flag.has
              ? sev === "critical"
                ? "border-red-500 bg-red-500"
                : sev === "caution"
                ? "border-amber-500 bg-amber-500"
                : "border-sky bg-sky"
              : "border-edge bg-soft"
          }`}
        >
          <span
            className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform start-0.5 ${
              flag.has ? "translate-x-4 rtl:-translate-x-4" : "translate-x-0"
            }`}
          />
        </span>
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
          flag.has ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-2.5">
            <input
              dir="auto"
              className="inp !py-1.5 text-xs"
              placeholder={placeholder}
              value={flag.details}
              maxLength={500}
              tabIndex={flag.has ? 0 : -1}
              onChange={(e) => onDetails(e.target.value)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
