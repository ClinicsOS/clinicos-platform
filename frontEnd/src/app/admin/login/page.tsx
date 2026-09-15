"use client";
import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { adminApi, adminErrMsg } from "@/lib/adminApi";
import { useAdminAuth } from "@/lib/adminAuth";
import {
  IconShield,
  IconLock,
  IconMail,
  IconAlertTriangle,
  IconDeviceMobile,
  IconArrowLeft,
} from "@tabler/icons-react";

function AdminLoginContent() {
  const router = useRouter();
  const params = useSearchParams();
  const setAuth = useAdminAuth((s) => s.setAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [expiredNotice, setExpiredNotice] = useState(false);

  // Set once the password step succeeds AND the server says 2FA is
  // required. While this is non-null we show the 6-digit code step
  // instead of the email/password form.
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [code, setCode] = useState("");

  useEffect(() => {
    if (params.get("expired") === "1") setExpiredNotice(true);
  }, [params]);

  const login = useMutation({
    mutationFn: async () =>
      (await adminApi.post("/admin/auth/login", { email: email.trim().toLowerCase(), password })).data,
    onSuccess: (data) => {
      if (data.requiresTotp) {
        setPendingToken(data.pendingToken);
        return;
      }
      setAuth(data.token, data.admin);
      router.replace("/admin");
    },
    onError: (e) => setError(adminErrMsg(e, "Login failed")),
  });

  const verifyTotp = useMutation({
    mutationFn: async () =>
      (await adminApi.post("/admin/auth/verify-totp", { pendingToken, code })).data,
    onSuccess: (data) => {
      setAuth(data.token, data.admin);
      router.replace("/admin");
    },
    onError: (e) => setError(adminErrMsg(e, "Invalid code")),
  });

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-600 shadow-lg shadow-red-900/50">
            <IconShield size={28} className="text-white" />
          </div>
          <h1 className="text-lg font-bold text-white">ClinicOS Admin</h1>
          <p className="mt-0.5 text-[11px] text-red-300/60">Command Center Access</p>
        </div>

        <div className="rounded-2xl border border-red-900/40 bg-[#1a0808]/80 p-6 backdrop-blur">
          {expiredNotice && !pendingToken && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-200">
              <IconAlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>Your session has expired. Please sign in again.</span>
            </div>
          )}

          {!pendingToken ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError("");
                login.mutate();
              }}
            >
              <label className="mb-1 block text-[10px] uppercase tracking-widest text-red-300/60">
                Email
              </label>
              <div className="relative mb-3">
                <IconMail
                  size={13}
                  className="absolute start-3 top-1/2 -translate-y-1/2 text-red-300/50"
                />
                <input
                  className="w-full rounded-lg border border-red-900/40 bg-black/30 px-9 py-2.5 text-[12px] text-white placeholder:text-red-300/30 focus:border-red-500 focus:outline-none"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@clinicos.jo"
                  required
                  autoFocus
                  dir="ltr"
                />
              </div>

              <label className="mb-1 block text-[10px] uppercase tracking-widest text-red-300/60">
                Password
              </label>
              <div className="relative mb-4">
                <IconLock
                  size={13}
                  className="absolute start-3 top-1/2 -translate-y-1/2 text-red-300/50"
                />
                <input
                  className="w-full rounded-lg border border-red-900/40 bg-black/30 px-9 py-2.5 text-[12px] text-white placeholder:text-red-300/30 focus:border-red-500 focus:outline-none"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  dir="ltr"
                />
              </div>

              {error && (
                <p className="mb-3 text-center text-[11px] text-red-400">{error}</p>
              )}

              <button
                type="submit"
                disabled={login.isPending || !email || !password}
                className="w-full rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {login.isPending ? "Signing in..." : "Access Command Center"}
              </button>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError("");
                verifyTotp.mutate();
              }}
            >
              <div className="mb-4 flex flex-col items-center text-center">
                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-red-900/30 text-red-300">
                  <IconDeviceMobile size={20} />
                </div>
                <p className="text-[12px] text-red-100/80">
                  Enter the 6-digit code from your authenticator app.
                </p>
              </div>

              <input
                className="mb-4 w-full rounded-lg border border-red-900/40 bg-black/30 px-3 py-2.5 text-center text-lg tracking-[0.4em] text-white placeholder:text-red-300/30 focus:border-red-500 focus:outline-none"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                required
                autoFocus
                dir="ltr"
              />

              {error && (
                <p className="mb-3 text-center text-[11px] text-red-400">{error}</p>
              )}

              <button
                type="submit"
                disabled={verifyTotp.isPending || code.length !== 6}
                className="mb-2 w-full rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {verifyTotp.isPending ? "Verifying..." : "Verify & Sign In"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingToken(null);
                  setCode("");
                  setError("");
                }}
                className="flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] text-red-300/60 hover:text-red-200"
              >
                <IconArrowLeft size={12} /> Back
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-[10px] text-red-300/40">
          🔒 Authorized personnel only. All actions are logged.
        </p>
      </div>
    </main>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0a0303]" />}>
      <AdminLoginContent />
    </Suspense>
  );
}
