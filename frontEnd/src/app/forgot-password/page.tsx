"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { api, errMsg } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import Cube3D from "@/components/Cube3D";
import FloatingPlus from "@/components/FloatingPlus";
import { IconArrowLeft, IconMail, IconSun, IconMoon, IconCheck } from "@tabler/icons-react";

export default function ForgotPasswordPage() {
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  const send = useMutation({
    mutationFn: async () => {
      return (await api.post("/auth/forgot-password", { email: email.trim() })).data;
    },
    onError: (e) => setError(errMsg(e, t("common.error"))),
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-hero p-4">
      <FloatingPlus style={{ top: "10%", left: "12%" }} />
      <FloatingPlus style={{ bottom: "12%", right: "10%" }} delay={2} />

      {/* Theme + language toggle */}
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
        {/* Logo */}
        <div className="mb-6 flex items-center justify-center gap-2">
          <Cube3D size={30} />
          <span className="text-lg font-medium text-[color:var(--hero-text)]">ClinicOS</span>
        </div>

        <div className="rounded-2xl border border-edge bg-black/10 p-6 backdrop-blur-sm">
          {send.isSuccess ? (
            /* Success state */
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-teal/20 text-teal">
                <IconCheck size={28} />
              </div>
              <h1 className="text-lg font-medium text-[color:var(--hero-text)]">
                {t("fp.sent.title")}
              </h1>
              <p className="mt-2 text-[11px] leading-relaxed text-[color:var(--hero-text-mute)]">
                {t("fp.sent.body").replace("{email}", email)}
              </p>
              <div className="mt-5">
                <Link
                  href="/signin"
                  className="inline-flex items-center gap-1.5 text-[11px] font-medium text-sky hover:underline"
                >
                  <IconArrowLeft size={12} className="rtl-flip" />
                  {t("fp.backToSignin")}
                </Link>
              </div>
              <p className="mt-6 text-[10px] text-[color:var(--hero-text-mute)]">
                {t("fp.didntGet")}{" "}
                <button
                  onClick={() => send.mutate()}
                  disabled={send.isPending}
                  className="text-sky hover:underline disabled:opacity-50"
                >
                  {t("fp.resend")}
                </button>
              </p>
            </div>
          ) : (
            /* Form state */
            <>
              <h1 className="text-lg font-medium text-[color:var(--hero-text)]">
                {t("fp.title")}
              </h1>
              <p className="mt-1.5 text-[11px] text-[color:var(--hero-text-mute)]">
                {t("fp.subtitle")}
              </p>

              <label className="mt-5 mb-1.5 block text-[10px] tracking-widest text-[color:var(--hero-text-mute)]">
                {t("auth.email")}
              </label>
              <div className="relative">
                <IconMail
                  size={13}
                  className="absolute start-3 top-1/2 -translate-y-1/2 text-[color:var(--hero-text-mute)]"
                />
                <input
                  className="w-full rounded-lg border border-edge bg-card px-9 py-2.5 text-[12px] text-[color:var(--hero-text)] placeholder:text-[color:var(--hero-text-mute)] focus:border-sky focus:outline-none"
                  type="email"
                  placeholder="you@clinic.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  dir="ltr"
                />
              </div>

              {error && <p className="mt-3 text-center text-xs text-red-400">{error}</p>}

              <button
                onClick={() => {
                  setError("");
                  send.mutate();
                }}
                disabled={!email.includes("@") || send.isPending}
                className="mt-4 w-full rounded-lg bg-teal py-2.5 text-sm font-medium text-navy hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {send.isPending ? t("common.loading") : t("fp.sendLink")}
              </button>

              <Link
                href="/signin"
                className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-[color:var(--hero-text-mute)] hover:text-sky"
              >
                <IconArrowLeft size={12} className="rtl-flip" />
                {t("fp.backToSignin")}
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
