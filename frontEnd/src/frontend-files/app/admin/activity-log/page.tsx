"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/lib/adminApi";
import {
  IconChevronLeft,
  IconChevronRight,
  IconHistory,
  IconUserCircle,
  IconBuildingHospital,
  IconArrowUpRight,
  IconMail,
  IconShield,
} from "@tabler/icons-react";

interface LogEntry {
  _id: string;
  action: string;
  actorEmail: string;
  targetType?: "clinic" | "user" | "subscription_request" | "system";
  targetLabel?: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

interface LogResponse {
  logs: LogEntry[];
  total: number;
  page: number;
  pages: number;
}

const ACTION_LABELS: Record<string, string> = {
  "admin.login_success": "Admin signed in",
  "admin.login_failed": "Failed admin login attempt",
  "admin.password_hash_generated": "Admin generated new password hash",
  "clinic.plan_changed": "Changed clinic plan",
  "clinic.plan_extended": "Extended clinic subscription",
  "clinic.suspended": "Suspended clinic",
  "clinic.reactivated": "Reactivated clinic",
  "clinic.deleted": "Deleted clinic",
  "clinic.exported": "Exported clinic data",
  "clinic.impersonated": "Impersonated clinic owner",
  "subscription_request.approved": "Approved upgrade request",
  "subscription_request.rejected": "Rejected upgrade request",
  "user.password_reset_by_admin": "Reset user password",
  "user.activated": "Activated user",
  "user.deactivated": "Deactivated user",
  "user.email_verified_by_admin": "Verified user email",
  "email.sent_to_clinic": "Sent email to clinic",
};

const ACTION_ICON: Record<string, typeof IconHistory> = {
  admin: IconShield,
  clinic: IconBuildingHospital,
  user: IconUserCircle,
  subscription_request: IconArrowUpRight,
  email: IconMail,
};

const iconFor = (action: string) => {
  const prefix = action.split(".")[0];
  return ACTION_ICON[prefix] || IconHistory;
};

const toneFor = (action: string) => {
  if (action.includes("deleted")) return "text-red-400";
  if (action.includes("failed") || action.includes("rejected")) return "text-red-400";
  if (action.includes("approved") || action.includes("activated") || action.includes("verified"))
    return "text-emerald-400";
  if (action.includes("suspended") || action.includes("deactivated")) return "text-amber-400";
  return "text-red-300";
};

export default function ActivityLogPage() {
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("");

  const { data, isLoading } = useQuery<LogResponse>({
    queryKey: ["admin", "activity-log", { page, actionFilter }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (actionFilter) params.set("action", actionFilter);
      return (await adminApi.get(`/admin/activity-log?${params}`)).data;
    },
  });

  return (
    <div className="p-6">
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-white">Activity Log</h1>
        <p className="mt-1 text-[12px] text-red-200/50">
          Complete audit trail of every admin action. Read-only.
        </p>
      </header>

      <div className="mb-4">
        <select
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-red-900/40 bg-[#150606]/60 px-3 py-2 text-[12px] text-white focus:border-red-500 focus:outline-none"
        >
          <option value="">All actions</option>
          <optgroup label="Clinics">
            <option value="clinic.plan_changed">Plan changed</option>
            <option value="clinic.plan_extended">Plan extended</option>
            <option value="clinic.suspended">Suspended</option>
            <option value="clinic.reactivated">Reactivated</option>
            <option value="clinic.deleted">Deleted</option>
            <option value="clinic.impersonated">Impersonated</option>
          </optgroup>
          <optgroup label="Upgrade Requests">
            <option value="subscription_request.approved">Approved</option>
            <option value="subscription_request.rejected">Rejected</option>
          </optgroup>
          <optgroup label="Users">
            <option value="user.password_reset_by_admin">Password reset</option>
            <option value="user.activated">Activated</option>
            <option value="user.deactivated">Deactivated</option>
            <option value="user.email_verified_by_admin">Email verified</option>
          </optgroup>
          <optgroup label="Admin">
            <option value="admin.login_success">Login success</option>
            <option value="admin.login_failed">Login failed</option>
          </optgroup>
        </select>
      </div>

      <div className="rounded-lg border border-red-900/30 bg-[#150606]/60">
        {isLoading && (
          <div className="p-8 text-center text-[11px] text-red-200/40">Loading...</div>
        )}
        {data && data.logs.length === 0 && (
          <div className="p-12 text-center text-[11px] text-red-200/40">
            No activity yet.
          </div>
        )}
        <div className="divide-y divide-red-900/20">
          {data?.logs.map((log) => {
            const Icon = iconFor(log.action);
            const tone = toneFor(log.action);
            return (
              <div key={log._id} className="flex items-start gap-3 p-3">
                <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-red-900/30 ${tone}`}>
                  <Icon size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className={`text-[12px] font-medium ${tone}`}>
                      {ACTION_LABELS[log.action] || log.action}
                    </span>
                    {log.targetLabel && (
                      <span className="text-[11px] text-white">
                        <span className="text-red-200/40">·</span> {log.targetLabel}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[10px] text-red-200/50" dir="ltr">
                    by {log.actorEmail} · {new Date(log.createdAt).toLocaleString()}
                  </div>
                  {log.details && Object.keys(log.details).length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[10px] text-red-300/60 hover:text-red-200">
                        Details
                      </summary>
                      <pre className="mt-1 overflow-x-auto rounded bg-black/40 p-2 text-[10px] text-red-100/70" dir="ltr">
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {data && data.pages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <div className="text-[11px] text-red-200/50">
            Page {data.page} of {data.pages} ({data.total} total)
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 rounded-md border border-red-800/50 bg-red-900/20 px-3 py-1.5 text-[11px] text-red-100 hover:bg-red-900/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <IconChevronLeft size={13} /> Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
              disabled={page === data.pages}
              className="flex items-center gap-1 rounded-md border border-red-800/50 bg-red-900/20 px-3 py-1.5 text-[11px] text-red-100 hover:bg-red-900/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next <IconChevronRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
