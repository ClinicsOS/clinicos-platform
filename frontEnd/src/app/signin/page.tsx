"use client";
import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import Cube3D from "@/components/Cube3D";
import FloatingPlus from "@/components/FloatingPlus";
import { IconMail, IconLock, IconArrowRight, IconArrowLeft, IconSun, IconMoon, IconAlertCircle } from "@tabler/icons-react";

function SignInContent() {
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();
  const router = useRouter();
  const params = useSearchParams();
  const setAuth = useAuth((s) => s.setAuth);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [expiredNotice, setExpiredNotice] = useState(false);

  useEffect(() => {
    if (params.get("expired") === "1") {
      setExpiredNotice(true);
    }
  }, [params]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.post("/auth/login", { email, password });
      setAuth(res.data.token, res.data.user);
      router.push("/dashboard");
    } catch (err) {
      setError(errMsg(err, t("common.error")));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-hero px-6 py-10">
      {/* Ambient background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(circle at 25% 20%, rgba(111,189,245,0.15), transparent 45%), radial-gradient(circle at 75% 75%, rgba(79,195,184,0.12), transparent 40%)",
        }}
      />
      <FloatingPlus style={{ top: "20%", left: "15%" }} />
      <FloatingPlus style={{ top: "30%", right: "12%" }} delay={2} />
      <FloatingPlus style={{ bottom: "18%", left: "20%" }} delay={3.5} />

      {/* Home link — top left */}
      <Link
        href="/"
        className="absolute top-6 start-6 z-10 flex items-center gap-2 text-xs text-[color:var(--hero-text-mute)] hover:text-sky"
      >
        <IconArrowLeft size={14} className="rtl-flip" />
        <span>{t("back.home")}</span>
      </Link>

      {/* Language + theme toggles — top right */}
      <div className="absolute top-6 end-6 z-10 flex items-center gap-2">
        <button
          onClick={() => setLang(lang === "en" ? "ar" : "en")}
          className="rounded-full border border-sky/40 bg-sky/10 px-3 py-1 text-[10px] text-[color:var(--hero-text-mute)]"
        >
          {lang === "en" ? "AR" : "EN"}
        </button>
        <button
          onClick={toggle}
          className="rounded-full border border-sky/40 bg-sky/10 p-1.5 text-[color:var(--hero-text-mute)]"
          title="Theme"
        >
          {theme === "dark" ? <IconSun size={12} /> : <IconMoon size={12} />}
        </button>
      </div>

      {/* Card */}
      <div className="relative z-10 w-full max-w-sm">
        {/* Clickable brand — logo + name → home */}
        <Link href="/" className="mb-5 flex flex-col items-center gap-2 text-center">
          <div className="relative" style={{ perspective: 600 }}>
            {/* Orbital rings for extra 3D */}
            <div
              className="pointer-events-none absolute inset-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-sky/20"
              style={{ transform: "translate(-50%,-50%) rotateX(70deg)" }}
            />
            <div
              className="pointer-events-none absolute inset-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full border border-teal/20"
              style={{ transform: "translate(-50%,-50%) rotateX(70deg) rotate(45deg)" }}
            />
            <Cube3D size={44} />
          </div>
          <div className="text-lg font-medium text-[color:var(--hero-text)]">ClinicOS</div>
        </Link>

        <div className="rounded-2xl border border-sky/25 bg-[color:var(--card)] p-6 shadow-[0_25px_60px_-20px_rgba(0,0,0,0.6)] backdrop-blur">
          <h1 className="text-center text-lg font-medium text-[color:var(--hero-text)]">{t("auth.welcome")}</h1>
          <p className="mt-1 text-center text-xs text-[color:var(--hero-text-mute)]">{t("auth.subSignin")}</p>

          <form onSubmit={submit} className="mt-5">
            {expiredNotice && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-[11px] text-amber-200">
                <IconAlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{t("auth.sessionExpired")}</span>
              </div>
            )}
            <label className="mb-1 block text-[10.5px] font-medium tracking-wide text-[color:var(--hero-text-mute)]">
              {t("auth.email")}
            </label>
            <div className="relative mb-3">
              <IconMail
                size={14}
                className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-[color:var(--hero-text-mute)] ltr:left-3 rtl:right-3"
              />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-sky/35 bg-black/10 px-3 py-2.5 text-sm text-[color:var(--hero-text)] outline-none placeholder:text-[color:var(--hero-text-mute)] focus:border-sky ltr:pl-9 rtl:pr-9"
                placeholder="you@clinic.com"
              />
            </div>

            <label className="mb-1 block text-[10.5px] font-medium tracking-wide text-[color:var(--hero-text-mute)]">
              {t("auth.password")}
            </label>
            <div className="relative mb-2">
              <IconLock
                size={14}
                className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-[color:var(--hero-text-mute)] ltr:left-3 rtl:right-3"
              />
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-sky/35 bg-black/10 px-3 py-2.5 text-sm text-[color:var(--hero-text)] outline-none placeholder:text-[color:var(--hero-text-mute)] focus:border-sky ltr:pl-9 rtl:pr-9"
                placeholder="••••••••"
              />
            </div>

            <div className="mb-3 flex justify-end">
              <Link
                href="/forgot-password"
                className="text-[10.5px] text-sky hover:underline"
              >
                {t("auth.forgotPassword")}
              </Link>
            </div>

            {error && (
              <p className="mb-2 text-center text-xs text-red-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-teal py-2.5 text-sm font-medium text-navy hover:brightness-110 disabled:opacity-50"
            >
              {loading ? t("common.loading") : t("auth.signin")}
              {!loading && <IconArrowRight size={15} className="rtl-flip" />}
            </button>
          </form>

          <p className="mt-5 text-center text-xs text-[color:var(--hero-text-mute)]">
            {t("auth.noAccount")}{" "}
            <Link href="/signup" className="font-medium text-sky hover:underline">
              {t("nav.signup")}
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-hero" />}>
      <SignInContent />
    </Suspense>
  );
}
