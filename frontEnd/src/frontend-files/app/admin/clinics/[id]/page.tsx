"use client";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi, adminErrMsg } from "@/lib/adminApi";
import { useAdminAuth } from "@/lib/adminAuth";
import PlanBadge from "@/components/admin/PlanBadge";
import StatusBadge from "@/components/admin/StatusBadge";
import ExpiryBadge from "@/components/admin/ExpiryBadge";
import {
  IconArrowLeft,
  IconEdit,
  IconClock,
  IconPower,
  IconTrash,
  IconDownload,
  IconLogin,
  IconMail,
  IconUsers,
  IconUserPlus,
  IconCalendar,
  IconReceipt,
  IconHistory,
  IconAlertTriangle,
  IconX,
  IconCheck,
} from "@tabler/icons-react";

type Plan = "trial" | "basic" | "pro";

interface ClinicDetails {
  clinic: {
    _id: string;
    name: string;
    slug: string;
    specialty: string;
    phone?: string;
    address?: string;
    plan: Plan;
    planStartedAt: string;
    planExpiresAt: string;
    status: "active" | "suspended" | "expired";
    daysUntilExpiry: number;
    isExpired: boolean;
    createdAt: string;
  };
  users: {
    _id: string;
    name: string;
    email: string;
    role: string;
    isActive: boolean;
    emailVerified: boolean;
  }[];
  stats: {
    userCount: number;
    patientCount: number;
    appointmentCount: number;
    recentInvoicesTotal: number;
  };
  recentInvoices: { _id: string; total: number; createdAt: string; status?: string }[];
  subscriptionHistory: {
    _id: string;
    requestedPlan: Plan;
    status: string;
    createdAt: string;
    processedAt?: string;
  }[];
}

export default function ClinicDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const clinicId = params.id as string;
  const setAuth = useAdminAuth((s) => s.admin);

  const { data, isLoading } = useQuery<ClinicDetails>({
    queryKey: ["admin", "clinic", clinicId],
    queryFn: async () => (await adminApi.get(`/admin/clinics/${clinicId}`)).data,
  });

  // Modals
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Toast-style messages
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const showToast = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3500);
  };

  // Export
  const exportMutation = useMutation({
    mutationFn: async () => (await adminApi.get(`/admin/clinics/${clinicId}/export`)).data,
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `clinic-${data.clinic.slug}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("success", "Clinic data exported");
    },
    onError: (e) => showToast("error", adminErrMsg(e, "Export failed")),
  });

  // Impersonate
  const impersonateMutation = useMutation({
    mutationFn: async () =>
      (await adminApi.post(`/admin/clinics/${clinicId}/impersonate`)).data,
    onSuccess: (data) => {
      // Store the impersonation token in the CLINIC auth store, then navigate
      // to the dashboard.  We open in new tab so the admin session isn't lost.
      const authData = {
        state: {
          token: data.token,
          user: data.user,
          clinic: data.clinic,
        },
        version: 0,
      };
      localStorage.setItem("clinicos-auth", JSON.stringify(authData));
      showToast("success", `Signed in as ${data.user.email}. Opening dashboard...`);
      setTimeout(() => window.open("/dashboard", "_blank"), 800);
    },
    onError: (e) => showToast("error", adminErrMsg(e, "Impersonation failed")),
  });

  if (isLoading) {
    return (
      <div className="p-6 text-[12px] text-red-200/50">Loading clinic details...</div>
    );
  }

  if (!data) {
    return <div className="p-6 text-[12px] text-red-200/50">Clinic not found.</div>;
  }

  const { clinic, users, stats, recentInvoices, subscriptionHistory } = data;

  return (
    <div className="p-6">
      {/* Back link */}
      <Link
        href="/admin/clinics"
        className="mb-4 inline-flex items-center gap-1.5 text-[11px] text-red-300/60 hover:text-red-200"
      >
        <IconArrowLeft size={13} /> Back to clinics
      </Link>

      {/* Header */}
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <h1 className="text-2xl font-bold text-white">{clinic.name}</h1>
            <PlanBadge plan={clinic.plan} />
            <StatusBadge status={clinic.status} />
            <ExpiryBadge daysUntilExpiry={clinic.daysUntilExpiry} />
          </div>
          <div className="text-[12px] text-red-200/50">
            {clinic.specialty} · /{clinic.slug} · Registered{" "}
            {new Date(clinic.createdAt).toLocaleDateString()}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowPlanModal(true)}
            className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-red-500"
          >
            <IconEdit size={13} /> Change Plan
          </button>
          <button
            onClick={() => setShowExtendModal(true)}
            className="flex items-center gap-1.5 rounded-md border border-red-800/50 bg-red-900/20 px-3 py-1.5 text-[11px] font-medium text-red-100 hover:bg-red-900/40"
          >
            <IconClock size={13} /> Extend
          </button>
          <button
            onClick={() => setShowStatusModal(true)}
            className="flex items-center gap-1.5 rounded-md border border-red-800/50 bg-red-900/20 px-3 py-1.5 text-[11px] font-medium text-red-100 hover:bg-red-900/40"
          >
            <IconPower size={13} />
            {clinic.status === "suspended" ? "Reactivate" : "Suspend"}
          </button>
          <button
            onClick={() => impersonateMutation.mutate()}
            disabled={impersonateMutation.isPending}
            className="flex items-center gap-1.5 rounded-md border border-red-800/50 bg-red-900/20 px-3 py-1.5 text-[11px] font-medium text-red-100 hover:bg-red-900/40 disabled:opacity-50"
          >
            <IconLogin size={13} /> Impersonate
          </button>
          <button
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
            className="flex items-center gap-1.5 rounded-md border border-red-800/50 bg-red-900/20 px-3 py-1.5 text-[11px] font-medium text-red-100 hover:bg-red-900/40 disabled:opacity-50"
          >
            <IconDownload size={13} /> Export
          </button>
          <Link
            href={`/admin/email?clinicId=${clinic._id}`}
            className="flex items-center gap-1.5 rounded-md border border-red-800/50 bg-red-900/20 px-3 py-1.5 text-[11px] font-medium text-red-100 hover:bg-red-900/40"
          >
            <IconMail size={13} /> Email
          </Link>
          <button
            onClick={() => setShowDeleteModal(true)}
            className="flex items-center gap-1.5 rounded-md border border-red-500/50 bg-red-500/20 px-3 py-1.5 text-[11px] font-medium text-red-200 hover:bg-red-500/40"
          >
            <IconTrash size={13} /> Delete
          </button>
        </div>
      </header>

      {/* Toast */}
      {message && (
        <div
          className={`mb-4 rounded-md border p-3 text-[12px] ${
            message.type === "success"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
              : "border-red-500/40 bg-red-500/10 text-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Stats */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatBox icon={<IconUsers size={14} />} label="Staff" value={stats.userCount} />
        <StatBox icon={<IconUserPlus size={14} />} label="Patients" value={stats.patientCount} />
        <StatBox
          icon={<IconCalendar size={14} />}
          label="Appointments"
          value={stats.appointmentCount}
        />
        <StatBox
          icon={<IconReceipt size={14} />}
          label="Recent Revenue (JOD)"
          value={stats.recentInvoicesTotal.toLocaleString()}
        />
      </div>

      {/* Grid: subscription info + users + history */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Subscription info */}
        <div className="rounded-lg border border-red-900/30 bg-[#150606]/60 p-4 lg:col-span-1">
          <h2 className="mb-3 text-sm font-semibold text-white">Subscription</h2>
          <dl className="space-y-2 text-[12px]">
            <Field label="Current Plan">
              <PlanBadge plan={clinic.plan} />
            </Field>
            <Field label="Status">
              <StatusBadge status={clinic.status} />
            </Field>
            <Field label="Started">
              <span className="text-red-100/80">
                {new Date(clinic.planStartedAt).toLocaleDateString()}
              </span>
            </Field>
            <Field label="Expires">
              <div>
                <div className="text-red-100/80">
                  {new Date(clinic.planExpiresAt).toLocaleDateString()}
                </div>
                <ExpiryBadge daysUntilExpiry={clinic.daysUntilExpiry} />
              </div>
            </Field>
            {clinic.phone && (
              <Field label="Phone">
                <span className="text-red-100/80" dir="ltr">
                  {clinic.phone}
                </span>
              </Field>
            )}
            {clinic.address && (
              <Field label="Address">
                <span className="text-red-100/80">{clinic.address}</span>
              </Field>
            )}
          </dl>
        </div>

        {/* Users */}
        <div className="rounded-lg border border-red-900/30 bg-[#150606]/60 p-4 lg:col-span-2">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <IconUsers size={14} /> Staff ({users.length})
          </h2>
          <div className="space-y-2">
            {users.map((u) => (
              <div
                key={u._id}
                className="flex items-center justify-between rounded-md border border-red-900/20 bg-black/20 p-2.5 text-[11px]"
              >
                <div>
                  <div className="font-medium text-white">{u.name}</div>
                  <div className="text-red-200/50" dir="ltr">
                    {u.email}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-red-900/30 px-2 py-0.5 text-[10px] uppercase tracking-wide text-red-200/70">
                    {u.role}
                  </span>
                  {u.emailVerified ? (
                    <IconCheck size={12} className="text-emerald-400" />
                  ) : (
                    <IconX size={12} className="text-amber-400" />
                  )}
                  {u.isActive ? (
                    <span className="text-[10px] text-emerald-400">Active</span>
                  ) : (
                    <span className="text-[10px] text-red-400">Inactive</span>
                  )}
                </div>
              </div>
            ))}
            {users.length === 0 && (
              <p className="py-4 text-center text-[11px] text-red-200/40">
                No staff members registered.
              </p>
            )}
          </div>
        </div>

        {/* Subscription history */}
        {subscriptionHistory.length > 0 && (
          <div className="rounded-lg border border-red-900/30 bg-[#150606]/60 p-4 lg:col-span-2">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
              <IconHistory size={14} /> Subscription History
            </h2>
            <div className="space-y-1.5">
              {subscriptionHistory.map((sr) => (
                <div
                  key={sr._id}
                  className="flex items-center justify-between rounded-md border border-red-900/20 bg-black/20 px-3 py-2 text-[11px]"
                >
                  <div className="flex items-center gap-2">
                    <PlanBadge plan={sr.requestedPlan} />
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] ${
                        sr.status === "approved"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : sr.status === "rejected"
                          ? "bg-red-500/20 text-red-300"
                          : "bg-amber-500/20 text-amber-300"
                      }`}
                    >
                      {sr.status}
                    </span>
                  </div>
                  <div className="text-red-200/50">
                    {new Date(sr.createdAt).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent invoices */}
        {recentInvoices.length > 0 && (
          <div className="rounded-lg border border-red-900/30 bg-[#150606]/60 p-4 lg:col-span-1">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
              <IconReceipt size={14} /> Recent Invoices
            </h2>
            <div className="space-y-1.5">
              {recentInvoices.map((inv) => (
                <div
                  key={inv._id}
                  className="flex items-center justify-between rounded-md border border-red-900/20 bg-black/20 px-3 py-2 text-[11px]"
                >
                  <span className="text-red-100/80">
                    {new Date(inv.createdAt).toLocaleDateString()}
                  </span>
                  <span className="font-medium text-white">
                    {inv.total.toLocaleString()} JOD
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showPlanModal && (
        <PlanChangeModal
          clinic={clinic}
          onClose={() => setShowPlanModal(false)}
          onSuccess={() => {
            setShowPlanModal(false);
            qc.invalidateQueries({ queryKey: ["admin", "clinic", clinicId] });
            showToast("success", "Plan updated successfully");
          }}
          onError={(msg) => showToast("error", msg)}
        />
      )}
      {showExtendModal && (
        <ExtendModal
          clinicId={clinicId}
          currentExpiry={clinic.planExpiresAt}
          onClose={() => setShowExtendModal(false)}
          onSuccess={(days) => {
            setShowExtendModal(false);
            qc.invalidateQueries({ queryKey: ["admin", "clinic", clinicId] });
            showToast("success", `Extended by ${days} day(s)`);
          }}
          onError={(msg) => showToast("error", msg)}
        />
      )}
      {showStatusModal && (
        <StatusModal
          clinicId={clinicId}
          currentStatus={clinic.status}
          onClose={() => setShowStatusModal(false)}
          onSuccess={(newStatus) => {
            setShowStatusModal(false);
            qc.invalidateQueries({ queryKey: ["admin", "clinic", clinicId] });
            showToast(
              "success",
              newStatus === "active" ? "Clinic reactivated" : "Clinic suspended",
            );
          }}
          onError={(msg) => showToast("error", msg)}
        />
      )}
      {showDeleteModal && (
        <DeleteModal
          clinicId={clinicId}
          clinicName={clinic.name}
          onClose={() => setShowDeleteModal(false)}
          onSuccess={() => {
            showToast("success", "Clinic deleted");
            setTimeout(() => router.replace("/admin/clinics"), 800);
          }}
          onError={(msg) => showToast("error", msg)}
        />
      )}
    </div>
  );
}

/* ============================================================
 * Small pieces
 * ============================================================ */

function StatBox({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg border border-red-900/30 bg-[#150606]/60 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-red-200/50">
        <span className="text-red-400">{icon}</span>
        {label}
      </div>
      <div className="text-xl font-bold text-white">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-red-900/20 py-1.5 last:border-0">
      <dt className="text-[10px] uppercase tracking-wide text-red-200/50">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/* ============================================================
 * Plan Change Modal
 * ============================================================ */

function PlanChangeModal({
  clinic,
  onClose,
  onSuccess,
  onError,
}: {
  clinic: { plan: Plan; planExpiresAt: string };
  onClose: () => void;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [plan, setPlan] = useState<Plan>(clinic.plan);
  const [extendDays, setExtendDays] = useState(30);
  const [reason, setReason] = useState("");
  const params = useParams();
  const clinicId = params.id as string;

  const change = useMutation({
    mutationFn: async () =>
      (await adminApi.patch(`/admin/clinics/${clinicId}/plan`, {
        plan,
        extendDays,
        reason: reason || undefined,
      })).data,
    onSuccess,
    onError: (e) => onError(adminErrMsg(e, "Failed to change plan")),
  });

  return (
    <Modal title="Change Plan" onClose={onClose}>
      <label className="mb-1 block text-[10px] uppercase tracking-wider text-red-200/50">
        New Plan
      </label>
      <select
        value={plan}
        onChange={(e) => setPlan(e.target.value as Plan)}
        className="mb-3 w-full rounded-md border border-red-900/40 bg-black/30 px-3 py-2 text-[12px] text-white focus:border-red-500 focus:outline-none"
      >
        <option value="trial">Trial</option>
        <option value="basic">Basic (19 JOD/month)</option>
        <option value="pro">Pro (29 JOD/month)</option>
      </select>

      <label className="mb-1 block text-[10px] uppercase tracking-wider text-red-200/50">
        Extend by (days) — optional
      </label>
      <input
        type="number"
        value={extendDays}
        onChange={(e) => setExtendDays(Number(e.target.value))}
        min={0}
        max={3650}
        className="mb-3 w-full rounded-md border border-red-900/40 bg-black/30 px-3 py-2 text-[12px] text-white focus:border-red-500 focus:outline-none"
      />

      <label className="mb-1 block text-[10px] uppercase tracking-wider text-red-200/50">
        Reason (optional, for audit log)
      </label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="e.g. Customer paid via CliQ ref #12345"
        className="mb-4 w-full rounded-md border border-red-900/40 bg-black/30 px-3 py-2 text-[12px] text-white focus:border-red-500 focus:outline-none"
      />

      <ModalActions
        onClose={onClose}
        onConfirm={() => change.mutate()}
        confirmLabel={change.isPending ? "Saving..." : "Apply Changes"}
        disabled={change.isPending}
      />
    </Modal>
  );
}

/* ============================================================
 * Extend Modal
 * ============================================================ */

function ExtendModal({
  clinicId,
  currentExpiry,
  onClose,
  onSuccess,
  onError,
}: {
  clinicId: string;
  currentExpiry: string;
  onClose: () => void;
  onSuccess: (days: number) => void;
  onError: (msg: string) => void;
}) {
  const [days, setDays] = useState(30);
  const [reason, setReason] = useState("");

  const extend = useMutation({
    mutationFn: async () =>
      (await adminApi.patch(`/admin/clinics/${clinicId}/extend`, {
        days,
        reason: reason || undefined,
      })).data,
    onSuccess: () => onSuccess(days),
    onError: (e) => onError(adminErrMsg(e, "Failed to extend")),
  });

  const newExpiry = (() => {
    const base = new Date(currentExpiry) > new Date() ? new Date(currentExpiry) : new Date();
    return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  })();

  return (
    <Modal title="Extend Subscription" onClose={onClose}>
      <p className="mb-3 text-[11px] text-red-200/60">
        Current expiry: <span className="text-white">{new Date(currentExpiry).toLocaleDateString()}</span>
        <br />
        New expiry: <span className="text-emerald-300">{newExpiry.toLocaleDateString()}</span>
      </p>

      <label className="mb-1 block text-[10px] uppercase tracking-wider text-red-200/50">
        Extend by (days)
      </label>
      <div className="mb-3 flex gap-2">
        {[7, 30, 90, 365].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`flex-1 rounded-md border px-2 py-1.5 text-[11px] ${
              days === d
                ? "border-red-500 bg-red-600/30 text-white"
                : "border-red-900/40 bg-black/30 text-red-100/70 hover:bg-red-900/20"
            }`}
          >
            {d === 7 ? "1 week" : d === 30 ? "1 month" : d === 90 ? "3 months" : "1 year"}
          </button>
        ))}
      </div>
      <input
        type="number"
        value={days}
        onChange={(e) => setDays(Number(e.target.value))}
        min={1}
        max={3650}
        className="mb-3 w-full rounded-md border border-red-900/40 bg-black/30 px-3 py-2 text-[12px] text-white focus:border-red-500 focus:outline-none"
      />

      <label className="mb-1 block text-[10px] uppercase tracking-wider text-red-200/50">
        Reason (optional)
      </label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="e.g. Renewal, grace period, comp"
        className="mb-4 w-full rounded-md border border-red-900/40 bg-black/30 px-3 py-2 text-[12px] text-white focus:border-red-500 focus:outline-none"
      />

      <ModalActions
        onClose={onClose}
        onConfirm={() => extend.mutate()}
        confirmLabel={extend.isPending ? "Extending..." : `Extend by ${days} day(s)`}
        disabled={extend.isPending}
      />
    </Modal>
  );
}

/* ============================================================
 * Status Modal
 * ============================================================ */

function StatusModal({
  clinicId,
  currentStatus,
  onClose,
  onSuccess,
  onError,
}: {
  clinicId: string;
  currentStatus: "active" | "suspended" | "expired";
  onClose: () => void;
  onSuccess: (newStatus: "active" | "suspended") => void;
  onError: (msg: string) => void;
}) {
  const newStatus = currentStatus === "suspended" ? "active" : "suspended";
  const [reason, setReason] = useState("");

  const change = useMutation({
    mutationFn: async () =>
      (await adminApi.patch(`/admin/clinics/${clinicId}/status`, {
        status: newStatus,
        reason: reason || undefined,
      })).data,
    onSuccess: () => onSuccess(newStatus),
    onError: (e) => onError(adminErrMsg(e, "Failed to change status")),
  });

  return (
    <Modal
      title={newStatus === "suspended" ? "Suspend Clinic" : "Reactivate Clinic"}
      onClose={onClose}
    >
      <div
        className={`mb-3 flex items-start gap-2 rounded-md border p-3 text-[11px] ${
          newStatus === "suspended"
            ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
            : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
        }`}
      >
        <IconAlertTriangle size={14} className="mt-0.5 shrink-0" />
        <span>
          {newStatus === "suspended"
            ? "Suspended clinics cannot log in until reactivated. Their data is preserved."
            : "This clinic will regain access immediately upon reactivation."}
        </span>
      </div>

      <label className="mb-1 block text-[10px] uppercase tracking-wider text-red-200/50">
        Reason (optional)
      </label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        className="mb-4 w-full rounded-md border border-red-900/40 bg-black/30 px-3 py-2 text-[12px] text-white focus:border-red-500 focus:outline-none"
      />

      <ModalActions
        onClose={onClose}
        onConfirm={() => change.mutate()}
        confirmLabel={
          change.isPending
            ? "Saving..."
            : newStatus === "suspended"
            ? "Confirm Suspend"
            : "Confirm Reactivate"
        }
        disabled={change.isPending}
        confirmClass={
          newStatus === "suspended" ? "bg-amber-600 hover:bg-amber-500" : "bg-emerald-600 hover:bg-emerald-500"
        }
      />
    </Modal>
  );
}

/* ============================================================
 * Delete Modal
 * ============================================================ */

function DeleteModal({
  clinicId,
  clinicName,
  onClose,
  onSuccess,
  onError,
}: {
  clinicId: string;
  clinicName: string;
  onClose: () => void;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [reason, setReason] = useState("");

  const del = useMutation({
    mutationFn: async () =>
      (await adminApi.delete(`/admin/clinics/${clinicId}`, {
        data: { confirmText, reason: reason || undefined },
      })).data,
    onSuccess,
    onError: (e) => onError(adminErrMsg(e, "Failed to delete")),
  });

  return (
    <Modal title="Delete Clinic Permanently" onClose={onClose}>
      <div className="mb-3 flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-[11px] text-red-200">
        <IconAlertTriangle size={14} className="mt-0.5 shrink-0" />
        <span>
          This will permanently delete the clinic and ALL its data: users, patients,
          appointments, invoices. This cannot be undone.
        </span>
      </div>

      <label className="mb-1 block text-[10px] uppercase tracking-wider text-red-200/50">
        Type the clinic name to confirm:{" "}
        <span className="text-red-400 normal-case">&quot;{clinicName}&quot;</span>
      </label>
      <input
        type="text"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        className="mb-3 w-full rounded-md border border-red-900/40 bg-black/30 px-3 py-2 text-[12px] text-white focus:border-red-500 focus:outline-none"
      />

      <label className="mb-1 block text-[10px] uppercase tracking-wider text-red-200/50">
        Reason (optional)
      </label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        className="mb-4 w-full rounded-md border border-red-900/40 bg-black/30 px-3 py-2 text-[12px] text-white focus:border-red-500 focus:outline-none"
      />

      <ModalActions
        onClose={onClose}
        onConfirm={() => del.mutate()}
        confirmLabel={del.isPending ? "Deleting..." : "Delete Permanently"}
        disabled={confirmText !== clinicName || del.isPending}
        confirmClass="bg-red-600 hover:bg-red-500"
      />
    </Modal>
  );
}

/* ============================================================
 * Shared modal shell
 * ============================================================ */

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-red-900/40 bg-[#1a0808] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <button
            onClick={onClose}
            className="text-red-300/60 hover:text-white"
          >
            <IconX size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalActions({
  onClose,
  onConfirm,
  confirmLabel,
  disabled,
  confirmClass = "bg-red-600 hover:bg-red-500",
}: {
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  disabled?: boolean;
  confirmClass?: string;
}) {
  return (
    <div className="flex justify-end gap-2">
      <button
        onClick={onClose}
        className="rounded-md border border-red-900/40 bg-black/30 px-3 py-2 text-[11px] text-red-100 hover:bg-red-900/20"
      >
        Cancel
      </button>
      <button
        onClick={onConfirm}
        disabled={disabled}
        className={`rounded-md px-3 py-2 text-[11px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 ${confirmClass}`}
      >
        {confirmLabel}
      </button>
    </div>
  );
}
