"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi, adminErrMsg } from "@/lib/adminApi";
import PlanBadge from "@/components/admin/PlanBadge";
import {
  IconCheck,
  IconX,
  IconArrowUpRight,
  IconExternalLink,
  IconAlertTriangle,
} from "@tabler/icons-react";

interface UpgradeRequest {
  _id: string;
  clinicId: { _id: string; name: string; slug: string; plan: string; planExpiresAt: string };
  requestedPlan: "trial" | "basic" | "pro";
  billingName: string;
  billingEmail: string;
  billingPhone: string;
  paymentMethod: "cliq" | "bank_transfer" | "cash";
  paymentRef?: string;
  notes?: string;
  status: "pending" | "approved" | "rejected";
  processedAt?: string;
  createdAt: string;
}

export default function UpgradeRequestsPage() {
  const params = useSearchParams();
  const initialStatus = params.get("status") || "pending";
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const qc = useQueryClient();

  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const showToast = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3500);
  };

  const { data, isLoading } = useQuery<{ requests: UpgradeRequest[] }>({
    queryKey: ["admin", "upgrade-requests", statusFilter],
    queryFn: async () => {
      const query = statusFilter ? `?status=${statusFilter}` : "";
      return (await adminApi.get(`/admin/upgrade-requests${query}`)).data;
    },
  });

  const [approving, setApproving] = useState<UpgradeRequest | null>(null);
  const [rejecting, setRejecting] = useState<UpgradeRequest | null>(null);

  return (
    <div className="p-6">
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-white">Upgrade Requests</h1>
        <p className="mt-1 text-[12px] text-red-200/50">
          Review and approve subscription upgrade requests from clinics.
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

      {/* Status tabs */}
      <div className="mb-4 flex gap-2">
        {[
          { value: "pending", label: "Pending" },
          { value: "approved", label: "Approved" },
          { value: "rejected", label: "Rejected" },
          { value: "", label: "All" },
        ].map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`rounded-md px-3 py-1.5 text-[11px] font-medium ${
              statusFilter === tab.value
                ? "bg-red-600 text-white"
                : "border border-red-900/40 bg-black/30 text-red-100/70 hover:bg-red-900/20"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="space-y-3">
        {isLoading && (
          <p className="py-8 text-center text-[11px] text-red-200/40">Loading requests...</p>
        )}
        {data && data.requests.length === 0 && (
          <div className="rounded-lg border border-red-900/30 bg-[#150606]/60 p-12 text-center">
            <p className="text-[12px] text-red-200/50">
              No {statusFilter || ""} requests {statusFilter && "found"}.
            </p>
          </div>
        )}
        {data?.requests.map((req) => (
          <div
            key={req._id}
            className="rounded-lg border border-red-900/30 bg-[#150606]/60 p-4"
          >
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">
                    {req.clinicId?.name || "Unknown clinic"}
                  </span>
                  <span className="text-[11px] text-red-200/40">wants to upgrade to</span>
                  <PlanBadge plan={req.requestedPlan} />
                </div>
                <Link
                  href={`/admin/clinics/${req.clinicId?._id}`}
                  className="inline-flex items-center gap-1 text-[11px] text-red-300 hover:text-white"
                >
                  View clinic <IconExternalLink size={11} />
                </Link>
              </div>
              <div className="flex items-center gap-2">
                {req.status === "pending" && (
                  <>
                    <button
                      onClick={() => setApproving(req)}
                      className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-500"
                    >
                      <IconCheck size={13} /> Approve
                    </button>
                    <button
                      onClick={() => setRejecting(req)}
                      className="flex items-center gap-1 rounded-md border border-red-500/50 bg-red-500/20 px-3 py-1.5 text-[11px] font-medium text-red-200 hover:bg-red-500/40"
                    >
                      <IconX size={13} /> Reject
                    </button>
                  </>
                )}
                {req.status === "approved" && (
                  <span className="rounded-full bg-emerald-500/20 px-2.5 py-1 text-[10px] font-medium text-emerald-300 ring-1 ring-emerald-500/40">
                    ✓ Approved
                  </span>
                )}
                {req.status === "rejected" && (
                  <span className="rounded-full bg-red-500/20 px-2.5 py-1 text-[10px] font-medium text-red-300 ring-1 ring-red-500/40">
                    ✗ Rejected
                  </span>
                )}
              </div>
            </div>

            {/* Details grid */}
            <div className="grid gap-3 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
              <Detail label="Billing name" value={req.billingName} />
              <Detail label="Billing email" value={req.billingEmail} monospace />
              <Detail label="Billing phone" value={req.billingPhone} monospace />
              <Detail
                label="Payment method"
                value={
                  req.paymentMethod === "cliq"
                    ? "CliQ"
                    : req.paymentMethod === "bank_transfer"
                    ? "Bank Transfer"
                    : "Cash"
                }
              />
              {req.paymentRef && (
                <Detail label="Payment reference" value={req.paymentRef} monospace />
              )}
              <Detail
                label="Submitted"
                value={new Date(req.createdAt).toLocaleString()}
              />
              {req.processedAt && (
                <Detail
                  label="Processed"
                  value={new Date(req.processedAt).toLocaleString()}
                />
              )}
            </div>

            {req.notes && (
              <div className="mt-3 rounded-md border border-red-900/20 bg-black/30 p-2.5 text-[11px] text-red-100/80">
                <span className="text-red-200/50">Notes: </span>
                {req.notes}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Approve modal */}
      {approving && (
        <ApproveModal
          request={approving}
          onClose={() => setApproving(null)}
          onSuccess={() => {
            setApproving(null);
            qc.invalidateQueries({ queryKey: ["admin", "upgrade-requests"] });
            qc.invalidateQueries({ queryKey: ["admin", "stats"] });
            showToast("success", "Request approved and clinic upgraded");
          }}
          onError={(msg) => showToast("error", msg)}
        />
      )}

      {/* Reject modal */}
      {rejecting && (
        <RejectModal
          request={rejecting}
          onClose={() => setRejecting(null)}
          onSuccess={() => {
            setRejecting(null);
            qc.invalidateQueries({ queryKey: ["admin", "upgrade-requests"] });
            showToast("success", "Request rejected");
          }}
          onError={(msg) => showToast("error", msg)}
        />
      )}
    </div>
  );
}

function Detail({ label, value, monospace }: { label: string; value: string; monospace?: boolean }) {
  return (
    <div>
      <div className="mb-0.5 text-[10px] uppercase tracking-wider text-red-200/50">{label}</div>
      <div className={`text-red-100/80 ${monospace ? "font-mono" : ""}`} dir="ltr">
        {value}
      </div>
    </div>
  );
}

function ApproveModal({
  request,
  onClose,
  onSuccess,
  onError,
}: {
  request: UpgradeRequest;
  onClose: () => void;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [extendDays, setExtendDays] = useState(30);
  const [notes, setNotes] = useState("");

  const approve = useMutation({
    mutationFn: async () =>
      (await adminApi.post(`/admin/upgrade-requests/${request._id}/approve`, {
        extendDays,
        notes: notes || undefined,
      })).data,
    onSuccess,
    onError: (e) => onError(adminErrMsg(e, "Failed to approve")),
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
          <h3 className="text-sm font-semibold text-white">Approve Upgrade</h3>
          <button onClick={onClose} className="text-red-300/60 hover:text-white">
            <IconX size={16} />
          </button>
        </div>

        <div className="mb-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-[11px] text-emerald-200">
          <div className="mb-1 font-medium">
            {request.clinicId?.name} → {request.requestedPlan.toUpperCase()}
          </div>
          <div className="text-emerald-300/70">
            Once approved, the clinic&apos;s plan will update immediately and their
            expiry will extend by the number of days you set below.
          </div>
        </div>

        <label className="mb-1 block text-[10px] uppercase tracking-wider text-red-200/50">
          Extend by (days)
        </label>
        <div className="mb-3 flex gap-2">
          {[30, 90, 365].map((d) => (
            <button
              key={d}
              onClick={() => setExtendDays(d)}
              className={`flex-1 rounded-md border px-2 py-1.5 text-[11px] ${
                extendDays === d
                  ? "border-emerald-500 bg-emerald-600/30 text-white"
                  : "border-red-900/40 bg-black/30 text-red-100/70 hover:bg-red-900/20"
              }`}
            >
              {d === 30 ? "1 month" : d === 90 ? "3 months" : "1 year"}
            </button>
          ))}
        </div>
        <input
          type="number"
          value={extendDays}
          onChange={(e) => setExtendDays(Number(e.target.value))}
          min={1}
          max={3650}
          className="mb-3 w-full rounded-md border border-red-900/40 bg-black/30 px-3 py-2 text-[12px] text-white focus:border-emerald-500 focus:outline-none"
        />

        <label className="mb-1 block text-[10px] uppercase tracking-wider text-red-200/50">
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="e.g. Payment confirmed via CliQ #12345"
          className="mb-4 w-full rounded-md border border-red-900/40 bg-black/30 px-3 py-2 text-[12px] text-white focus:border-emerald-500 focus:outline-none"
        />

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-red-900/40 bg-black/30 px-3 py-2 text-[11px] text-red-100 hover:bg-red-900/20"
          >
            Cancel
          </button>
          <button
            onClick={() => approve.mutate()}
            disabled={approve.isPending}
            className="rounded-md bg-emerald-600 px-3 py-2 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {approve.isPending ? "Approving..." : "Confirm Approve"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RejectModal({
  request,
  onClose,
  onSuccess,
  onError,
}: {
  request: UpgradeRequest;
  onClose: () => void;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [reason, setReason] = useState("");

  const reject = useMutation({
    mutationFn: async () =>
      (await adminApi.post(`/admin/upgrade-requests/${request._id}/reject`, {
        reason,
      })).data,
    onSuccess,
    onError: (e) => onError(adminErrMsg(e, "Failed to reject")),
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
          <h3 className="text-sm font-semibold text-white">Reject Upgrade</h3>
          <button onClick={onClose} className="text-red-300/60 hover:text-white">
            <IconX size={16} />
          </button>
        </div>

        <div className="mb-4 flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-[11px] text-red-200">
          <IconAlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Rejecting will mark this request closed. The clinic can submit a new
            request afterwards if needed.
          </span>
        </div>

        <label className="mb-1 block text-[10px] uppercase tracking-wider text-red-200/50">
          Rejection reason <span className="text-red-400">*</span>
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="e.g. Payment not received, incorrect billing info..."
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
            onClick={() => reject.mutate()}
            disabled={reject.isPending || !reason.trim()}
            className="rounded-md bg-red-600 px-3 py-2 text-[11px] font-medium text-white hover:bg-red-500 disabled:opacity-50"
          >
            {reject.isPending ? "Rejecting..." : "Confirm Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}
