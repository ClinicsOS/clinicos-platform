"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi, adminErrMsg } from "@/lib/adminApi";
import PlanBadge from "@/components/admin/PlanBadge";
import StatusBadge from "@/components/admin/StatusBadge";
import ExpiryBadge from "@/components/admin/ExpiryBadge";
import {
  IconAlertTriangle,
  IconClock,
  IconExternalLink,
  IconClockPlus,
  IconX,
} from "@tabler/icons-react";

interface ClinicRow {
  _id: string;
  name: string;
  slug: string;
  specialty: string;
  plan: "trial" | "basic" | "pro";
  status: "active" | "suspended" | "expired";
  planExpiresAt: string;
  daysUntilExpiry: number;
}

export default function ExpiringPage() {
  const [window, setWindow] = useState<"3" | "7">("7");
  const qc = useQueryClient();

  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const showToast = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3500);
  };

  const { data, isLoading } = useQuery<{ clinics: ClinicRow[]; total: number }>({
    queryKey: ["admin", "expiring", window],
    queryFn: async () =>
      (await adminApi.get(`/admin/clinics?expiring=${window}&limit=50`)).data,
  });

  const [extending, setExtending] = useState<ClinicRow | null>(null);

  return (
    <div className="p-6">
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-white">Expiring Soon</h1>
        <p className="mt-1 text-[12px] text-red-200/50">
          Clinics whose subscription expires soon. Extend with a single click.
        </p>
      </header>

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

      {/* Time window tabs */}
      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setWindow("3")}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium ${
            window === "3"
              ? "bg-red-600 text-white"
              : "border border-red-900/40 bg-black/30 text-red-100/70 hover:bg-red-900/20"
          }`}
        >
          <IconAlertTriangle size={13} /> ≤ 3 days (Urgent)
        </button>
        <button
          onClick={() => setWindow("7")}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium ${
            window === "7"
              ? "bg-red-600 text-white"
              : "border border-red-900/40 bg-black/30 text-red-100/70 hover:bg-red-900/20"
          }`}
        >
          <IconClock size={13} /> ≤ 7 days
        </button>
      </div>

      {/* Grid */}
      {isLoading ? (
        <p className="py-8 text-center text-[11px] text-red-200/40">Loading...</p>
      ) : data && data.clinics.length === 0 ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-12 text-center">
          <p className="text-[12px] text-emerald-200">
            🎉 No clinics expiring in the next {window} days.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {data?.clinics.map((c) => (
            <div
              key={c._id}
              className={`rounded-lg border p-4 ${
                c.daysUntilExpiry <= 3
                  ? "border-red-500/40 bg-red-500/5"
                  : "border-amber-500/40 bg-amber-500/5"
              }`}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-white">{c.name}</div>
                  <div className="text-[10px] text-red-200/50">
                    /{c.slug} · {c.specialty}
                  </div>
                </div>
                <ExpiryBadge daysUntilExpiry={c.daysUntilExpiry} />
              </div>
              <div className="mb-3 flex items-center gap-2">
                <PlanBadge plan={c.plan} />
                <StatusBadge status={c.status} />
              </div>
              <div className="mb-3 text-[11px] text-red-200/60">
                Expires{" "}
                <span className="text-white">
                  {new Date(c.planExpiresAt).toLocaleDateString()}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setExtending(c)}
                  className="flex flex-1 items-center justify-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-red-500"
                >
                  <IconClockPlus size={13} /> Extend
                </button>
                <Link
                  href={`/admin/clinics/${c._id}`}
                  className="flex items-center justify-center rounded-md border border-red-800/50 bg-red-900/20 px-3 py-1.5 text-[11px] font-medium text-red-100 hover:bg-red-900/40"
                >
                  <IconExternalLink size={13} />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Extend modal */}
      {extending && (
        <ExtendModal
          clinic={extending}
          onClose={() => setExtending(null)}
          onSuccess={(days) => {
            setExtending(null);
            qc.invalidateQueries({ queryKey: ["admin", "expiring"] });
            qc.invalidateQueries({ queryKey: ["admin", "stats"] });
            showToast("success", `${extending.name} extended by ${days} day(s)`);
          }}
          onError={(msg) => showToast("error", msg)}
        />
      )}
    </div>
  );
}

function ExtendModal({
  clinic,
  onClose,
  onSuccess,
  onError,
}: {
  clinic: ClinicRow;
  onClose: () => void;
  onSuccess: (days: number) => void;
  onError: (msg: string) => void;
}) {
  const [days, setDays] = useState(30);
  const [reason, setReason] = useState("");

  const extend = useMutation({
    mutationFn: async () =>
      (await adminApi.patch(`/admin/clinics/${clinic._id}/extend`, {
        days,
        reason: reason || undefined,
      })).data,
    onSuccess: () => onSuccess(days),
    onError: (e) => onError(adminErrMsg(e, "Failed to extend")),
  });

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
          <h3 className="text-sm font-semibold text-white">Quick Extend</h3>
          <button onClick={onClose} className="text-red-300/60 hover:text-white">
            <IconX size={16} />
          </button>
        </div>

        <p className="mb-3 text-[12px] text-red-200/60">
          Extending <span className="text-white">{clinic.name}</span>
        </p>

        <div className="mb-3 grid grid-cols-4 gap-2">
          {[7, 30, 90, 365].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-md border px-2 py-2 text-[11px] ${
                days === d
                  ? "border-red-500 bg-red-600/30 text-white"
                  : "border-red-900/40 bg-black/30 text-red-100/70 hover:bg-red-900/20"
              }`}
            >
              {d === 7 ? "1w" : d === 30 ? "1mo" : d === 90 ? "3mo" : "1y"}
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

        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="Reason (optional)..."
          className="mb-4 w-full rounded-md border border-red-900/40 bg-black/30 px-3 py-2 text-[12px] text-white focus:border-red-500 focus:outline-none"
        />

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-red-900/40 bg-black/30 px-3 py-2 text-[11px] text-red-100 hover:bg-red-900/20"
          >
            Cancel
          </button>
          <button
            onClick={() => extend.mutate()}
            disabled={extend.isPending}
            className="rounded-md bg-red-600 px-3 py-2 text-[11px] font-medium text-white hover:bg-red-500 disabled:opacity-50"
          >
            {extend.isPending ? "Extending..." : `Extend by ${days} day(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}
