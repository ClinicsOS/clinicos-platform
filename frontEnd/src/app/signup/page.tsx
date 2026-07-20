"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import Cube3D from "@/components/Cube3D";
import FloatingPlus from "@/components/FloatingPlus";
import {
  IconMail,
  IconLock,
  IconUser,
  IconBuildingHospital,
  IconStethoscope,
  IconArrowRight,
  IconArrowLeft,
  IconCircleCheck,
  IconSun,
  IconMoon,
} from "@tabler/icons-react";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

export default function SignUpPage() {
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();
  const router = useRouter();
  const setAuth = useAuth((s) => s.setAuth);

  const [clinicName, setClinicName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [origin, setOrigin] = useState("clinicos.com");

  useEffect(() => {
    if (typeof window !== "undefined") {
      // Show a friendly host preview: "localhost:3000" or "clinicos.jo"
      setOrigin(window.location.host || "clinicos.com");
    }
  }, []);

  const slug = clinicName ? slugify(clinicName) || "your-clinic" : "your-clinic";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agree) {
      setError(t("su.mustAgree"));
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await api.post("/auth/register-clinic", {
        clinicName,
        specialty,
        ownerName,
        email,
        password,
        phone: phone || undefined,
      });
      setAuth(res.data.token, res.data.user);
      router.push("/dashboard");
    } catch (err) {
      setError(errMsg(err, t("common.error")));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen bg-hero">
      {/* ==== LEFT SIDE — brand, ambient 3D, benefits ==== */}
      <aside className="relative hidden w-2/5 flex-col justify-between overflow-hidden bg-hero p-8 lg:flex">
        {/* ambient glows */}
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(circle at 30% 20%, rgba(111,189,245,0.18), transparent 45%), radial-gradient(circle at 70% 80%, rgba(79,195,184,0.14), transparent 40%)",
          }}
        />
        <FloatingPlus style={{ top: "18%", right: "18%" }} />
        <FloatingPlus style={{ bottom: "22%", left: "16%" }} delay={2.5} />

        <Link href="/" className="relative z-10 flex items-center gap-2 text-[color:var(--hero-text)]">
          <Cube3D size={26} />
          <span className="text-base font-medium">ClinicOS</span>
        </Link>

        <div className="relative z-10">
          <h2 className="text-2xl font-medium leading-snug text-[color:var(--hero-text)]">
            {t("su.leftTitle.a")}
            <br />
            <span className="text-teal">{t("su.leftTitle.b")}</span>
          </h2>
          <div className="mt-6 space-y-3">
            {[t("su.point1"), t("su.point2"), t("su.point3")].map((b) => (
              <div key={b} className="flex items-start gap-2.5 text-xs text-[color:var(--hero-text-mute)]">
                <IconCircleCheck size={16} className="mt-0.5 shrink-0 text-teal" />
                <span>{b}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-[10px] text-[color:var(--hero-text-mute)]">
          © {new Date().getFullYear()} ClinicOS · Amman, Jordan
        </p>
      </aside>

      {/* ==== RIGHT SIDE — form ==== */}
      <section className="relative flex flex-1 flex-col overflow-y-auto bg-base">
        {/* Home + lang + theme toggles */}
        <div className="flex items-center justify-between px-6 pt-5">
          <Link href="/" className="flex items-center gap-2 text-xs text-mute hover:text-sky">
            <IconArrowLeft size={14} className="rtl-flip" />
            <span>{t("back.home")}</span>
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLang(lang === "en" ? "ar" : "en")}
              className="rounded-full border border-edge bg-card2 px-3 py-1 text-[10px] text-ink"
            >
              {lang === "en" ? "AR" : "EN"}
            </button>
            <button
              onClick={toggle}
              className="rounded-full border border-edge bg-card2 p-1.5 text-ink"
              title="Theme"
            >
              {theme === "dark" ? <IconSun size={12} /> : <IconMoon size={12} />}
            </button>
          </div>
        </div>

        <div className="mx-auto w-full max-w-md px-6 py-6">
          {/* Mobile-only header */}
          <Link href="/" className="mb-5 flex items-center gap-2 lg:hidden">
            <Cube3D size={22} />
            <span className="text-base font-medium text-ink">ClinicOS</span>
          </Link>

          <h1 className="text-2xl font-medium text-ink">{t("su.title")}</h1>
          <p className="mt-1 text-xs text-mute">{t("su.sub")}</p>

          <form onSubmit={submit} className="mt-5 space-y-3">
            <div>
              <label className="lbl">{t("su.clinicName")}</label>
              <div className="relative">
                <IconBuildingHospital
                  size={14}
                  className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-mute ltr:left-3 rtl:right-3"
                />
                <input
                  required
                  minLength={2}
                  className="inp ltr:pl-9 rtl:pr-9"
                  placeholder={t("su.clinicHint")}
                  value={clinicName}
                  onChange={(e) => setClinicName(e.target.value)}
                />
              </div>
              {clinicName && (
                <p className="mt-1.5 text-[10px] text-mute" dir="ltr">
                  {t("su.linkPreview")}: <span className="font-mono text-sky">{origin}/book/{slug}</span>
                </p>
              )}
            </div>

            <div>
              <label className="lbl">{t("su.specialty")}</label>
              <div className="relative">
                <IconStethoscope
                  size={14}
                  className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-mute ltr:left-3 rtl:right-3"
                />
                <input
                  required
                  minLength={2}
                  className="inp ltr:pl-9 rtl:pr-9"
                  placeholder={t("su.specialtyHint")}
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="lbl">{t("su.fullName")}</label>
              <div className="relative">
                <IconUser
                  size={14}
                  className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-mute ltr:left-3 rtl:right-3"
                />
                <input
                  required
                  minLength={2}
                  className="inp ltr:pl-9 rtl:pr-9"
                  placeholder="Dr. Ahmad Khalil"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="lbl">{t("auth.email")}</label>
              <div className="relative">
                <IconMail
                  size={14}
                  className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-mute ltr:left-3 rtl:right-3"
                />
                <input
                  type="email"
                  required
                  className="inp ltr:pl-9 rtl:pr-9"
                  placeholder="you@clinic.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="lbl">{t("auth.password")}</label>
              <div className="relative">
                <IconLock
                  size={14}
                  className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-mute ltr:left-3 rtl:right-3"
                />
                <input
                  type="password"
                  required
                  minLength={8}
                  className="inp ltr:pl-9 rtl:pr-9"
                  placeholder={t("su.passwordPlaceholder")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="lbl">{t("su.phone")}</label>
              <input
                className="inp"
                placeholder="0790000000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                dir="ltr"
              />
            </div>

            <label className="flex cursor-pointer items-start gap-2 pt-1 text-[11px] text-mute">
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-teal"
              />
              <span>{t("su.terms")}</span>
            </label>

            {error && <p className="text-center text-xs text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={loading || !agree}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-teal py-2.5 text-sm font-medium text-navy hover:brightness-110 disabled:opacity-50"
            >
              {loading ? t("common.loading") : t("su.create")}
              {!loading && <IconArrowRight size={15} className="rtl-flip" />}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-mute">
            {t("auth.haveAccount")}{" "}
            <Link href="/signin" className="font-medium text-sky hover:underline">
              {t("nav.signin")}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
