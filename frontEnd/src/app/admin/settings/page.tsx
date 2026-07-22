"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { adminApi, adminErrMsg } from "@/lib/adminApi";
import { useAdminAuth } from "@/lib/adminAuth";
import {
  IconLock,
  IconShield,
  IconAlertTriangle,
  IconCopy,
  IconCheck,
  IconInfoCircle,
} from "@tabler/icons-react";

export default function SettingsPage() {
  const admin = useAdminAuth((s) => s.admin);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [generatedHash, setGeneratedHash] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const showToast = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const changePw = useMutation({
    mutationFn: async () =>
      (await adminApi.post("/admin/settings/change-password", {
        currentPassword,
        newPassword,
      })).data,
    onSuccess: (data) => {
      setGeneratedHash(data.newHash);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      showToast("success", "New hash generated. Update env var to apply.");
    },
    onError: (e) => showToast("error", adminErrMsg(e, "Failed to change password")),
  });

  const copy = async () => {
    if (!generatedHash) return;
    await navigator.clipboard.writeText(generatedHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    newPassword === confirmPassword;

  return (
    <div className="p-6">
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-[12px] text-red-200/50">
          Manage your admin account.
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

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Account info */}
        <div className="rounded-lg border border-red-900/30 bg-[#150606]/60 p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <IconShield size={14} /> Account
          </h2>
          <dl className="space-y-3 text-[12px]">
            <div>
              <dt className="mb-0.5 text-[10px] uppercase tracking-wider text-red-200/50">
                Signed-in email
              </dt>
              <dd className="text-white" dir="ltr">
                {admin?.email || "—"}
              </dd>
            </div>
            <div>
              <dt className="mb-0.5 text-[10px] uppercase tracking-wider text-red-200/50">
                Role
              </dt>
              <dd className="text-white">Super Administrator</dd>
            </div>
            <div>
              <dt className="mb-0.5 text-[10px] uppercase tracking-wider text-red-200/50">
                Session
              </dt>
              <dd className="text-red-100/80">
                Auto-expires after 12 hours of inactivity
              </dd>
            </div>
          </dl>
        </div>

        {/* Change password */}
        <div className="rounded-lg border border-red-900/30 bg-[#150606]/60 p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <IconLock size={14} /> Change Password
          </h2>

          <div className="mb-4 flex items-start gap-2 rounded-md border border-sky-500/40 bg-sky-500/10 p-3 text-[11px] text-sky-200">
            <IconInfoCircle size={14} className="mt-0.5 shrink-0" />
            <div>
              For security, the admin password is stored as a bcrypt hash in your
              environment variables — not in the database. This page generates a
              new hash for you to copy into your Render env vars.
            </div>
          </div>

          {!generatedHash && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (canSubmit) changePw.mutate();
              }}
            >
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-red-200/50">
                Current password
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="mb-3 w-full rounded-md border border-red-900/40 bg-black/30 px-3 py-2 text-[12px] text-white focus:border-red-500 focus:outline-none"
                autoComplete="current-password"
              />

              <label className="mb-1 block text-[10px] uppercase tracking-wider text-red-200/50">
                New password (min 8 characters)
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                className="mb-3 w-full rounded-md border border-red-900/40 bg-black/30 px-3 py-2 text-[12px] text-white focus:border-red-500 focus:outline-none"
                autoComplete="new-password"
              />

              <label className="mb-1 block text-[10px] uppercase tracking-wider text-red-200/50">
                Confirm new password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                className="mb-4 w-full rounded-md border border-red-900/40 bg-black/30 px-3 py-2 text-[12px] text-white focus:border-red-500 focus:outline-none"
                autoComplete="new-password"
              />

              {confirmPassword && confirmPassword !== newPassword && (
                <p className="mb-3 text-[11px] text-red-400">Passwords don&apos;t match</p>
              )}

              <button
                type="submit"
                disabled={!canSubmit || changePw.isPending}
                className="w-full rounded-md bg-red-600 py-2 text-[12px] font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {changePw.isPending ? "Generating..." : "Generate New Hash"}
              </button>
            </form>
          )}

          {generatedHash && (
            <div>
              <div className="mb-3 flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-[11px] text-emerald-200">
                <IconCheck size={14} className="mt-0.5 shrink-0" />
                <span>
                  New hash generated. Follow the steps below to apply it.
                </span>
              </div>

              <label className="mb-1 block text-[10px] uppercase tracking-wider text-red-200/50">
                New ADMIN_PASSWORD_HASH value
              </label>
              <div className="mb-3 flex gap-2">
                <input
                  type="text"
                  value={generatedHash}
                  readOnly
                  className="flex-1 rounded-md border border-red-900/40 bg-black/30 px-3 py-2 font-mono text-[10px] text-white"
                  dir="ltr"
                />
                <button
                  onClick={copy}
                  className="flex items-center gap-1 rounded-md border border-red-800/50 bg-red-900/20 px-3 py-2 text-[11px] text-red-100 hover:bg-red-900/40"
                >
                  {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>

              <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-200">
                <IconAlertTriangle size={14} className="mt-0.5 shrink-0" />
                <div>
                  <div className="mb-1 font-medium">To apply the new password:</div>
                  <ol className="list-inside list-decimal space-y-0.5">
                    <li>Open your Render dashboard → clinicos-api → Environment</li>
                    <li>Edit ADMIN_PASSWORD_HASH and paste the value above</li>
                    <li>Save changes (Render will redeploy automatically)</li>
                    <li>Sign out and back in with your new password</li>
                  </ol>
                </div>
              </div>

              <button
                onClick={() => setGeneratedHash(null)}
                className="w-full rounded-md border border-red-900/40 bg-black/30 py-2 text-[11px] text-red-100 hover:bg-red-900/20"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
