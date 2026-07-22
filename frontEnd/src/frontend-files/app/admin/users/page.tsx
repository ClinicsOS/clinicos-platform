"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi, adminErrMsg } from "@/lib/adminApi";
import {
  IconSearch,
  IconKey,
  IconPower,
  IconMailCheck,
  IconChevronLeft,
  IconChevronRight,
  IconX,
  IconAlertTriangle,
  IconCopy,
  IconCheck,
} from "@tabler/icons-react";

interface UserRow {
  _id: string;
  name: string;
  email: string;
  role: "owner" | "doctor" | "receptionist";
  isActive: boolean;
  emailVerified: boolean;
  createdAt: string;
  clinicId?: { _id: string; name: string; slug: string };
}

interface UsersResponse {
  users: UserRow[];
  total: number;
  page: number;
  pages: number;
}

export default function UsersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const qc = useQueryClient();

  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const showToast = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3500);
  };

  const { data, isLoading } = useQuery<UsersResponse>({
    queryKey: ["admin", "users", { page, search, roleFilter }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (search) params.set("search", search);
      if (roleFilter) params.set("role", roleFilter);
      return (await adminApi.get(`/admin/users?${params}`)).data;
    },
  });

  const toggleActive = useMutation({
    mutationFn: async (id: string) =>
      (await adminApi.patch(`/admin/users/${id}/toggle-active`)).data,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      showToast("success", data.message);
    },
    onError: (e) => showToast("error", adminErrMsg(e, "Failed to toggle status")),
  });

  const verifyEmail = useMutation({
    mutationFn: async (id: string) =>
      (await adminApi.patch(`/admin/users/${id}/verify-email`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      showToast("success", "Email marked as verified");
    },
    onError: (e) => showToast("error", adminErrMsg(e, "Failed to verify email")),
  });

  const [resetting, setResetting] = useState<UserRow | null>(null);

  return (
    <div className="p-6">
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-white">Users</h1>
        <p className="mt-1 text-[12px] text-red-200/50">
          {data ? `${data.total} user${data.total !== 1 ? "s" : ""} across all clinics` : "Loading..."}
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

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[240px]">
          <IconSearch
            size={13}
            className="absolute start-3 top-1/2 -translate-y-1/2 text-red-300/50"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by name or email..."
            className="w-full rounded-lg border border-red-900/40 bg-[#150606]/60 px-9 py-2 text-[12px] text-white placeholder:text-red-300/30 focus:border-red-500 focus:outline-none"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => {
            setRoleFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-red-900/40 bg-[#150606]/60 px-3 py-2 text-[12px] text-white focus:border-red-500 focus:outline-none"
        >
          <option value="">All roles</option>
          <option value="owner">Owner</option>
          <option value="doctor">Doctor</option>
          <option value="receptionist">Receptionist</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-lg border border-red-900/30 bg-[#150606]/60">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-red-900/30 bg-[#0f0505] text-[10px] uppercase tracking-wider text-red-200/50">
                <th className="px-4 py-3 text-start">User</th>
                <th className="px-4 py-3 text-start">Clinic</th>
                <th className="px-4 py-3 text-start">Role</th>
                <th className="px-4 py-3 text-start">Status</th>
                <th className="px-4 py-3 text-start">Email</th>
                <th className="px-4 py-3 text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[11px] text-red-200/40">
                    Loading...
                  </td>
                </tr>
              )}
              {data && data.users.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-[11px] text-red-200/40">
                    No users match these filters.
                  </td>
                </tr>
              )}
              {data?.users.map((u) => (
                <tr
                  key={u._id}
                  className="border-b border-red-900/20 text-[12px] text-red-50 last:border-0 hover:bg-red-900/10"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{u.name}</div>
                    <div className="text-[10px] text-red-200/40" dir="ltr">
                      {u.email}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {u.clinicId ? (
                      <div>
                        <div className="text-red-100/80">{u.clinicId.name}</div>
                        <div className="text-[10px] text-red-200/40">/{u.clinicId.slug}</div>
                      </div>
                    ) : (
                      <span className="text-red-300/40">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-red-900/30 px-2 py-0.5 text-[10px] uppercase tracking-wide text-red-200/70">
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {u.isActive ? (
                      <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300 ring-1 ring-emerald-500/40">
                        Active
                      </span>
                    ) : (
                      <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-medium text-red-300 ring-1 ring-red-500/40">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {u.emailVerified ? (
                      <IconCheck size={14} className="text-emerald-400" />
                    ) : (
                      <span className="text-[10px] text-amber-400">Not verified</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-end">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => setResetting(u)}
                        title="Reset password"
                        className="rounded-md border border-red-800/50 bg-red-900/20 p-1.5 text-red-100 hover:bg-red-900/40"
                      >
                        <IconKey size={12} />
                      </button>
                      {!u.emailVerified && (
                        <button
                          onClick={() => verifyEmail.mutate(u._id)}
                          disabled={verifyEmail.isPending}
                          title="Mark email as verified"
                          className="rounded-md border border-emerald-800/50 bg-emerald-900/20 p-1.5 text-emerald-200 hover:bg-emerald-900/40 disabled:opacity-50"
                        >
                          <IconMailCheck size={12} />
                        </button>
                      )}
                      <button
                        onClick={() => toggleActive.mutate(u._id)}
                        disabled={toggleActive.isPending}
                        title={u.isActive ? "Deactivate" : "Activate"}
                        className="rounded-md border border-red-800/50 bg-red-900/20 p-1.5 text-red-100 hover:bg-red-900/40 disabled:opacity-50"
                      >
                        <IconPower size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data && data.pages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <div className="text-[11px] text-red-200/50">
            Page {data.page} of {data.pages}
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

      {resetting && (
        <ResetPasswordModal
          user={resetting}
          onClose={() => setResetting(null)}
          onSuccess={() => {
            setResetting(null);
            showToast("success", "Password reset. Share the new password with the user.");
          }}
          onError={(msg) => showToast("error", msg)}
        />
      )}
    </div>
  );
}

function ResetPasswordModal({
  user,
  onClose,
  onSuccess,
  onError,
}: {
  user: UserRow;
  onClose: () => void;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [copied, setCopied] = useState(false);
  const [done, setDone] = useState(false);

  const reset = useMutation({
    mutationFn: async () =>
      (await adminApi.post(`/admin/users/${user._id}/reset-password`, { newPassword })).data,
    onSuccess: () => setDone(true),
    onError: (e) => onError(adminErrMsg(e, "Failed to reset")),
  });

  const generate = () => {
    // Simple readable password: 3 syllables + 3 digits
    const syllables = ["ba", "co", "de", "fi", "go", "hu", "ji", "ko", "lu", "ma", "ne", "pa", "qu", "ra", "so", "ti", "vo"];
    const s = () => syllables[Math.floor(Math.random() * syllables.length)];
    const pw =
      s().charAt(0).toUpperCase() + s().slice(1) + s() + s() + Math.floor(Math.random() * 900 + 100);
    setNewPassword(pw);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(newPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
          <h3 className="text-sm font-semibold text-white">Reset Password</h3>
          <button onClick={onClose} className="text-red-300/60 hover:text-white">
            <IconX size={16} />
          </button>
        </div>

        <p className="mb-3 text-[12px] text-red-200/60">
          Resetting password for <span className="text-white">{user.name}</span>
          <br />
          <span className="font-mono text-[10px] text-red-200/40" dir="ltr">
            {user.email}
          </span>
        </p>

        {done ? (
          <>
            <div className="mb-3 flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-[11px] text-emerald-200">
              <IconCheck size={14} className="mt-0.5 shrink-0" />
              <span>
                Password reset. Share the new password with the user out of band (WhatsApp, phone).
                We do NOT email it automatically.
              </span>
            </div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-red-200/50">
              New password (copy now)
            </label>
            <div className="mb-4 flex gap-2">
              <input
                type="text"
                value={newPassword}
                readOnly
                className="flex-1 rounded-md border border-red-900/40 bg-black/30 px-3 py-2 font-mono text-[12px] text-white"
              />
              <button
                onClick={copy}
                className="flex items-center gap-1 rounded-md border border-red-800/50 bg-red-900/20 px-3 py-2 text-[11px] text-red-100 hover:bg-red-900/40"
              >
                {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="flex justify-end">
              <button
                onClick={onSuccess}
                className="rounded-md bg-emerald-600 px-3 py-2 text-[11px] font-medium text-white hover:bg-emerald-500"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-200">
              <IconAlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                The user&apos;s current password will be replaced. You must share the new password
                with them directly — we do not email it.
              </span>
            </div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-red-200/50">
              New password (min 8 characters)
            </label>
            <div className="mb-4 flex gap-2">
              <input
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                className="flex-1 rounded-md border border-red-900/40 bg-black/30 px-3 py-2 font-mono text-[12px] text-white focus:border-red-500 focus:outline-none"
                dir="ltr"
              />
              <button
                onClick={generate}
                className="rounded-md border border-red-800/50 bg-red-900/20 px-3 py-2 text-[11px] text-red-100 hover:bg-red-900/40"
              >
                Generate
              </button>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-md border border-red-900/40 bg-black/30 px-3 py-2 text-[11px] text-red-100 hover:bg-red-900/20"
              >
                Cancel
              </button>
              <button
                onClick={() => reset.mutate()}
                disabled={reset.isPending || newPassword.length < 8}
                className="rounded-md bg-red-600 px-3 py-2 text-[11px] font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                {reset.isPending ? "Resetting..." : "Reset Password"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
