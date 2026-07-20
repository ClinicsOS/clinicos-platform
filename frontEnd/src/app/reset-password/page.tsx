"use client";
import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { api, errMsg } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { useToast } from "@/components/Toast";
import Cube3D from "@/components/Cube3D";
import FloatingPlus from "@/components/FloatingPlus";
import { IconLock, IconEye, IconEyeOff, IconSun, IconMoon, IconCheck, IconX } from "@tabler/icons-react";

function ResetPasswordContent() {
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");

  const token = params.get("token") || "";

  useEffect(() => {
    if (!token) {
      setError(t("rp.noToken"));
    }
  }, [token, t]);

  // Password strength check
  const meets = {
    length: password.length >= 8,
    number: /\d/.test(password),
    match: password.length > 0 && password === confirm,
  };
  const allValid = meets.length && meets.number && meets.match;

  const reset = useMutation({
    mutationFn: async () => (await api.post("/auth/reset-password", { token, password })).data,
    onSuccess: () => {
      toast.success(t("rp.successTitle"), t("rp.successBody"));
      window.setTimeout(() => router.replace("/signin"), 1500);
    },
    onError: (e) => setError(errMsg(e, t("common.error"))),
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-hero p-4">
      <FloatingPlus style={{ top: "10%", left: "12%" }} />
      <FloatingPlus style={{ bottom: "12%", right: "10%" }} delay={2} />

      <div className="absolute end-4 top-4 flex items-center gap-1.5">
        <button
          onClick={() => setLang(lang === "en" ? "ar" : "en")}
          className="rounded-full border border-sky/40 px-2.5 py-0.5 text-[10px] text-[color:var(--hero-text-mute)]"
        >
          {lang === "en" ? "AR" : "EN"}
        </button>
        <button
          onClick={toggle}
          className="rounded-full border border-sky/40 p-1 text-[color:var(--hero-text-mute)]"
        >
          {theme === "dark" ? <IconSun size={12} /> : <IconMoon size={12} />}
        </button>
      </div>

      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <Cube3D size={30} />
          <span className="text-lg font-medium text-[color:var(--hero-text)]">ClinicOS</span>
        </div>

        <div className="rounded-2xl border border-edge bg-black/10 p-6 backdrop-blur-sm">
          <h1 className="text-lg font-medium text-[color:var(--hero-text)]">{t("rp.title")}</h1>
          <p className="mt-1.5 text-[11px] text-[color:var(--hero-text-mute)]">{t("rp.subtitle")}</p>

          {/* New password */}
          <label className="mt-5 mb-1.5 block text-[10px] tracking-widest text-[color:var(--hero-text-mute)]">
            {t("rp.newPassword")}
          </label>
          <div className="relative">
            <IconLock
              size={13}
              className="absolute start-3 top-1/2 -translate-y-1/2 text-[color:var(--hero-text-mute)]"
            />
            <input
              className="w-full rounded-lg border border-edge bg-card px-9 py-2.5 text-[12px] text-[color:var(--hero-text)] placeholder:text-[color:var(--hero-text-mute)] focus:border-sky focus:outline-none"
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              dir="ltr"
            />
            <button
              type="button"
              onClick={() => setShow(!show)}
              className="absolute end-3 top-1/2 -translate-y-1/2 text-[color:var(--hero-text-mute)] hover:text-sky"
            >
              {show ? <IconEyeOff size={13} /> : <IconEye size={13} />}
            </button>
          </div>

          {/* Confirm */}
          <label className="mt-3 mb-1.5 block text-[10px] tracking-widest text-[color:var(--hero-text-mute)]">
            {t("rp.confirmPassword")}
          </label>
          <div className="relative">
            <IconLock
              size={13}
              className="absolute start-3 top-1/2 -translate-y-1/2 text-[color:var(--hero-text-mute)]"
            />
            <input
              className="w-full rounded-lg border border-edge bg-card px-9 py-2.5 text-[12px] text-[color:var(--hero-text)] placeholder:text-[color:var(--hero-text-mute)] focus:border-sky focus:outline-none"
              type={show ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              dir="ltr"
            />
          </div>

          {/* Password requirements */}
          <div className="mt-3 space-y-1 text-[10px]">
            <Requirement met={meets.length} label={t("rp.reqLength")} />
            <Requirement met={meets.number} label={t("rp.reqNumber")} />
            <Requirement met={meets.match} label={t("rp.reqMatch")} />
          </div>

          {error && <p className="mt-3 text-center text-xs text-red-400">{error}</p>}

          <button
            onClick={() => {
              setError("");
              reset.mutate();
            }}
            disabled={!token || !allValid || reset.isPending}
            className="mt-4 w-full rounded-lg bg-teal py-2.5 text-sm font-medium text-navy hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {reset.isPending ? t("common.loading") : t("rp.submit")}
          </button>

          <Link
            href="/signin"
            className="mt-4 block text-center text-[11px] text-[color:var(--hero-text-mute)] hover:text-sky"
          >
            {t("fp.backToSignin")}
          </Link>
        </div>
      </div>
    </main>
  );
}

function Requirement({ met, label }: { met: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-1.5 ${met ? "text-teal" : "text-[color:var(--hero-text-mute)]"}`}>
      {met ? <IconCheck size={11} /> : <IconX size={11} />}
      <span>{label}</span>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-hero" />}>
      <ResetPasswordContent />
    </Suspense>
  );
}
