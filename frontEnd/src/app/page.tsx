"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Cube3D from "@/components/Cube3D";
import DepthIcon from "@/components/DepthIcon";
import FloatingPlus from "@/components/FloatingPlus";
import { useI18n } from "@/lib/i18n";
import {
  IconCalendarTime,
  IconWorld,
  IconFileInvoice,
  IconCircleCheck,
  IconTrendingUp,
  IconBell,
  IconLayoutDashboard,
  IconCalendar,
  IconUsers,
  IconReceipt,
  IconSettings,
  IconCheck,
  IconArrowRight,
  IconChartBar,
  IconBrandInstagram,
  IconBrandWhatsapp,
  IconMail,
  IconHeart,
} from "@tabler/icons-react";

/* ================ SPLASH ================ */
function Splash() {
  return (
    <div className="sp-overlay splash-play fixed inset-0 z-[60] overflow-hidden bg-hero">
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(circle at 30% 20%, rgba(111,189,245,0.15), transparent 45%), radial-gradient(circle at 75% 80%, rgba(79,195,184,0.12), transparent 40%)",
        }}
      />
      <FloatingPlus style={{ top: "22%", left: "16%" }} />
      <FloatingPlus style={{ top: "30%", right: "14%" }} delay={2} />
      <FloatingPlus style={{ bottom: "20%", left: "24%" }} delay={3.5} />
      <div
        className="sp-cube-wrap absolute left-1/2 top-1/2 z-10 h-[110px] w-[110px]"
        style={{ margin: "-55px 0 0 -55px", perspective: 900 }}
      >
        <div className="sp-cube preserve-3d relative h-[110px] w-[110px]">
          {[
            "translateZ(55px)",
            "rotateY(180deg) translateZ(55px)",
            "rotateY(90deg) translateZ(55px)",
            "rotateY(-90deg) translateZ(55px)",
            "rotateX(90deg) translateZ(55px)",
            "rotateX(-90deg) translateZ(55px)",
          ].map((f, i) => (
            <div key={i} className="cube-face" style={{ transform: f }} />
          ))}
          <div
            className="absolute rounded-sm bg-teal"
            style={{
              width: 52,
              height: 14,
              top: 48,
              left: 29,
              transform: "translateZ(2px)",
            }}
          />
          <div
            className="absolute rounded-sm bg-teal"
            style={{
              width: 14,
              height: 52,
              top: 29,
              left: 48,
              transform: "translateZ(2px)",
            }}
          />
        </div>
      </div>
      <div className="sp-text absolute left-1/2 top-1/2 z-0 -translate-x-1/2 translate-y-[72px] text-center">
        <div dir="ltr">
          {"Clinic".split("").map((c, i) => (
            <span
              key={i}
              className="letter text-4xl font-medium tracking-wide text-[color:var(--hero-text)]"
              style={{ animationDelay: `${0.15 + i * 0.1}s` }}
            >
              {c}
            </span>
          ))}
          {"OS".split("").map((c, i) => (
            <span
              key={i}
              className="letter text-4xl font-medium tracking-wide text-sky"
              style={{ animationDelay: `${0.8 + i * 0.1}s` }}
            >
              {c}
            </span>
          ))}
        </div>
        <div className="mt-3 text-xs uppercase tracking-[3px] text-[color:var(--hero-text-mute)]">
          Smart care starts here
        </div>
      </div>
    </div>
  );
}

/* ================ HERO 3D DECK ================
   A layered 3D scene: a large tilted dashboard behind, mid-plane floating notification cards,
   and a foreground stat card that "pops" toward you. Much richer than a single tilted panel.
*/
function HeroDeck() {
  return (
    <div className="relative mt-10 h-[420px]" style={{ perspective: 1400 }}>
      {/* ambient particles */}
      <FloatingPlus style={{ top: 60, left: "12%" }} />
      <FloatingPlus style={{ top: 20, right: "10%" }} delay={2} />
      <FloatingPlus style={{ bottom: 60, left: "20%" }} delay={3.5} />
      <FloatingPlus style={{ bottom: 90, right: "18%" }} delay={1} />

      {/* Back plane — deep dashboard, most tilted */}
      <div
        className="preserve-3d absolute left-1/2 top-8 w-[440px] rounded-2xl border border-sky/25 bg-hero/90 p-4 shadow-[0_40px_80px_-30px_rgba(0,0,0,0.6)]"
        style={{
          marginLeft: -220,
          transform:
            "rotateX(18deg) rotateY(-12deg) rotateZ(2deg) translateZ(-40px)",
        }}
        dir="ltr"
      >
        <div className="flex gap-3">
          <div className="flex w-10 flex-col items-center gap-3 border-r border-sky/15 pt-1 text-[#5E86A5]">
            <IconLayoutDashboard size={15} className="text-teal" />
            <IconCalendar size={15} />
            <IconUsers size={15} />
            <IconReceipt size={15} />
            <IconSettings size={15} />
          </div>
          <div className="flex-1">
            <div className="mb-2.5 flex gap-2">
              {[
                ["24", "TODAY"],
                ["1,240", "PATIENTS"],
                ["860 JD", "REVENUE"],
              ].map(([v, l]) => (
                <div
                  key={l}
                  className="flex-1 rounded-lg border border-sky/25 bg-sky/10 px-2 py-1.5"
                >
                  <div className="text-sm font-medium text-[color:var(--hero-text)]">
                    {v}
                  </div>
                  <div className="text-[8px] tracking-widest text-[color:var(--hero-text-mute)]">
                    {l}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex h-16 items-end gap-1.5 border-b border-sky/15 px-0.5">
              {[40, 65, 50, 85, 60, 95, 72].map((h, i) => (
                <div
                  key={i}
                  className={`grow-bar flex-1 origin-bottom rounded-t ${i % 2 ? "bg-teal" : "bg-blue"}`}
                  style={{
                    height: `${h}%`,
                    animationDelay: `${1.6 + i * 0.08}s`,
                  }}
                />
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2 text-[10px] text-[color:var(--hero-text-mute)]">
              <span className="h-1.5 w-1.5 rounded-full bg-teal" /> 09:30 — Omar
              K. · Cleaning
            </div>
            <div className="flex items-center gap-2 pt-1 text-[10px] text-[color:var(--hero-text-mute)]">
              <span className="h-1.5 w-1.5 rounded-full bg-blue" /> 10:00 — Lina
              S. · Follow-up
            </div>
          </div>
        </div>
      </div>

      {/* Floating cube (right corner) — spinning brand mark */}
      <div
        className="absolute right-4 top-4 hidden lg:block"
        style={{ perspective: 800 }}
      >
        <div className="bob">
          <Cube3D size={70} />
        </div>
      </div>

      {/* Mid-layer notification cards, tilted less than the back */}
      <FloatCard
        className="left-2 top-2 sm:left-6 sm:top-6"
        icon={<IconCircleCheck size={15} className="text-teal" />}
        title="Booking confirmed"
        sub="Sara A. — Tomorrow 11:30"
        tilt="rotateY(6deg) rotateX(-4deg)"
      />
      <FloatCard
        className="right-2 top-14 sm:right-8 sm:top-16"
        icon={<IconTrendingUp size={15} className="text-sky" />}
        title="+27% bookings"
        sub="Since going online"
        delay={1}
        tilt="rotateY(-6deg) rotateX(-4deg)"
      />
      <FloatCard
        className="bottom-8 left-1/2 -translate-x-1/2"
        icon={<IconBell size={15} className="text-sky" />}
        title="Reminder sent"
        sub="3 patients notified"
        delay={0.5}
        tilt="rotateX(-2deg)"
      />

      {/* Foreground pop — stats card */}
      <div
        className="absolute -bottom-2 left-2 z-20 hidden rounded-xl border border-teal/50 bg-card p-3 shadow-[0_20px_50px_-10px_rgba(79,195,184,0.35)] sm:block"
        style={{ transform: "translateZ(40px) rotateY(-4deg)" }}
      >
        <div className="flex items-center gap-2 text-[10px] font-medium text-teal">
          <IconChartBar size={14} /> This week
        </div>
        <div className="mt-1 text-lg font-medium text-ink">
          142 <span className="text-[10px] font-normal text-mute">visits</span>
        </div>
      </div>
    </div>
  );
}

function FloatCard({
  className,
  icon,
  title,
  sub,
  delay = 0,
  tilt = "",
}: {
  className: string;
  icon: React.ReactNode;
  title: string;
  sub: string;
  delay?: number;
  tilt?: string;
}) {
  return (
    <div
      className={`bob absolute z-10 rounded-xl border border-sky/40 bg-[#0E3A61]/95 px-3.5 py-2.5 backdrop-blur ${className}`}
      style={{ animationDelay: `${delay}s`, transform: tilt }}
      dir="ltr"
    >
      <div className="flex items-center gap-2 text-[11px] font-medium text-[color:var(--hero-text)]">
        {icon}
        {title}
      </div>
      <div className="mt-0.5 text-[10px] text-[color:var(--hero-text-mute)]">
        {sub}
      </div>
    </div>
  );
}

/* ================ PAGE ================ */
export default function LandingPage() {
  const { t, lang, setLang } = useI18n();
  const [splash, setSplash] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setSplash(false), 2650);
    return () => window.clearTimeout(timer);
  }, []);

  // Plans reflect the real backend gating we built
  const plans = [
    {
      name: t("sub.trial"),
      price: t("price.free"),
      per: t("sub.perTrial"),
      hot: false,
      feats: [
        t("sub.feat.oneDoctor"),
        t("sub.feat.appts20"),
        t("sub.feat.bookingPage"),
      ],
    },
    {
      name: t("sub.basic"),
      price: "19 JD",
      per: t("sub.per"),
      hot: true,
      feats: [
        "3 " + t("sub.feat.doctors"),
        t("sub.feat.apptsUnlim"),
        t("sub.feat.invoicing"),
        t("sub.feat.reports"),
      ],
    },
    {
      name: t("sub.pro"),
      price: "29 JD",
      per: t("sub.per"),
      hot: false,
      feats: [
        t("sub.feat.doctorsUnlim"),
        t("sub.feat.exports"),
        t("sub.feat.whiteLabel"),
        t("sub.feat.support24"),
      ],
    },
  ];

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-hero">
      {splash && <Splash />}

      {/* Ambient background — subtle radial glows + fine grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 15%, rgba(111,189,245,0.12), transparent 40%), radial-gradient(circle at 80% 60%, rgba(79,195,184,0.10), transparent 45%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(111,189,245,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(111,189,245,0.4) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage:
            "radial-gradient(ellipse at center, black 40%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, black 40%, transparent 75%)",
        }}
      />

      {/* Navbar */}
      <header className="relative z-10 mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link
          href="/"
          className="rm-show flex items-center gap-2 text-[color:var(--hero-text)] opacity-0"
          style={{ animation: "fadeup .4s ease 2.3s forwards" }}
        >
          <Cube3D size={24} />
          <span className="text-base font-medium text-white">ClinicOS</span>
        </Link>
        <nav className="hidden items-center gap-5 text-xs text-[color:var(--hero-text-mute)] sm:flex">
          <a href="#features" className="hover:text-sky">
            {t("nav.features")}
          </a>
          <a href="#pricing" className="hover:text-sky">
            {t("nav.pricing")}
          </a>
          <a href="#contact" className="hover:text-sky">
            {t("contact.badge")}
          </a>
          <Link href="/track" className="hover:text-sky">
            {t("track.title")}
          </Link>
          <button
            onClick={() => setLang(lang === "en" ? "ar" : "en")}
            className="rounded-full border border-sky/40 px-2.5 py-0.5 text-[10px] text-[color:var(--hero-text-mute)]"
          >
            {lang === "en" ? "AR" : "EN"}
          </button>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/signin"
            className="btn-ghost !border-[#8FB3CC]/50 !bg-sky/10 !px-3.5 !py-2 text-xs !text-[color:var(--hero-text-mute)]"
          >
            {t("nav.signin")}
          </Link>
          <Link href="/signup" className="btn-teal !px-3.5 !py-2 text-xs">
            {t("nav.signup")}
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 pb-20 pt-4">
        <h1 className="mx-auto max-w-2xl text-center text-4xl font-medium leading-tight text-[color:var(--hero-text)] sm:text-5xl">
          {t("hero.title.a")}{" "}
          <em className="not-italic text-sky">{t("hero.title.b")}</em>
          {t("hero.title.c")}
        </h1>
        <p className="mx-auto mt-5 max-w-lg text-center text-sm leading-relaxed text-[color:var(--hero-text-mute)]">
          {t("hero.sub")}
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link href="/signup" className="btn-teal !px-5 !py-3">
            {t("hero.cta")} <IconArrowRight size={15} />
          </Link>
          <a
            href="#pricing"
            className="btn-ghost !border-[#8FB3CC]/50 !bg-sky/10 !px-5 !py-3 !text-[color:var(--hero-text-mute)]"
          >
            {t("hero.talk")}
          </a>
        </div>

        <HeroDeck />
      </section>

      {/* Features */}
      <section id="features" className="relative bg-base px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className="mb-2 text-center text-[10px] tracking-widest text-mute">
            — {t("nav.features").toUpperCase()} —
          </div>
          <h2 className="text-center text-3xl font-medium text-ink">
            {t("feat.title")}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-center text-sm text-mute">
            {t("feat.sub")}
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              {
                icon: <IconCalendarTime size={18} />,
                tt: t("feat.1.t"),
                dd: t("feat.1.d"),
                d: 0,
              },
              {
                icon: <IconWorld size={18} />,
                tt: t("feat.2.t"),
                dd: t("feat.2.d"),
                d: 1,
              },
              {
                icon: <IconFileInvoice size={18} />,
                tt: t("feat.3.t"),
                dd: t("feat.3.d"),
                d: 2,
              },
            ].map((f) => (
              <div
                key={f.tt}
                className="card group relative overflow-hidden p-6 transition-transform hover:-translate-y-1"
              >
                <div className="mb-6">
                  <DepthIcon delay={f.d}>{f.icon}</DepthIcon>
                </div>
                <h3 className="text-sm font-medium text-ink">{f.tt}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-mute">
                  {f.dd}
                </p>
                <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-teal/5 opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats band */}
      <section className="relative bg-hero px-6 py-10">
        <div className="mx-auto grid max-w-4xl grid-cols-2 gap-6 text-center sm:grid-cols-4">
          {[
            ["60s", t("stats.1")],
            ["0", t("stats.2")],
            ["24/7", t("stats.3")],
            ["10min", t("stats.4")],
          ].map(([v, l]) => (
            <div key={l}>
              <div className="text-3xl font-medium text-sky">{v}</div>
              <div className="mt-1 text-[11px] text-[color:var(--hero-text-mute)]">
                {l}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="relative bg-base px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className="mb-2 text-center text-[10px] tracking-widest text-mute">
            — {t("nav.pricing").toUpperCase()} —
          </div>
          <h2 className="text-center text-3xl font-medium text-ink">
            {t("price.title")}
          </h2>
          <p className="mt-2 text-center text-sm text-mute">{t("price.sub")}</p>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {plans.map((p) => (
              <div
                key={p.name}
                className={`relative rounded-2xl border p-6 transition-transform hover:-translate-y-1 ${
                  p.hot
                    ? "border-2 border-blue bg-card shadow-[0_20px_60px_-20px_rgba(59,157,232,0.4)]"
                    : "border-edge bg-card2"
                }`}
              >
                {p.hot && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-blue px-3 py-0.5 text-[10px] text-white">
                    {t("price.popular")}
                  </span>
                )}
                <h3 className="text-xs font-medium tracking-wide text-mute">
                  {p.name}
                </h3>
                <div className="mt-2 text-3xl font-medium text-ink">
                  {p.price}{" "}
                  <small className="text-[11px] font-normal text-mute">
                    {p.per}
                  </small>
                </div>
                <ul className="mt-5 space-y-2">
                  {p.feats.map((f) => (
                    <li
                      key={f}
                      className="flex items-start gap-2 text-xs text-mute"
                    >
                      <IconCheck
                        size={13}
                        className="mt-0.5 shrink-0 text-teal"
                      />{" "}
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/signup"
                  className={`mt-6 block w-full rounded-lg py-2 text-center text-xs font-medium ${
                    p.hot
                      ? "bg-blue text-white"
                      : "border border-edge bg-card text-ink"
                  }`}
                >
                  {t("hero.cta")}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative bg-hero px-6 py-14 text-center">
        <div className="mx-auto flex justify-center">
          <div className="bob">
            <Cube3D size={54} />
          </div>
        </div>
        <h2 className="mt-4 text-2xl font-medium text-[color:var(--hero-text)]">
          {t("cta.title")}
        </h2>
        <p className="mt-2 text-xs text-[color:var(--hero-text-mute)]">
          {t("cta.sub")}
        </p>
        <Link href="/signup" className="btn-teal mt-6 !px-6 !py-3">
          {t("hero.cta")} <IconArrowRight size={15} />
        </Link>
      </section>

      {/* ================ CONTACT US — luxurious section ================ */}
      <section
        id="contact"
        className="relative overflow-hidden bg-hero px-6 py-20"
      >
        {/* Ambient starfield */}
        <div className="pointer-events-none absolute inset-0 opacity-40">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 30%, rgba(111,189,245,0.15), transparent 40%), radial-gradient(circle at 80% 70%, rgba(79,195,184,0.15), transparent 40%)",
            }}
          />
          {[
            { top: "12%", left: "8%", delay: "0s" },
            { top: "30%", left: "22%", delay: "1.2s" },
            { top: "18%", right: "12%", delay: "0.6s" },
            { top: "60%", left: "14%", delay: "1.8s" },
            { top: "75%", right: "20%", delay: "0.3s" },
            { top: "45%", right: "8%", delay: "2.1s" },
          ].map((s, i) => (
            <span
              key={i}
              className="star-twinkle absolute h-1 w-1 rounded-full bg-teal"
              style={{ ...s }}
            />
          ))}
        </div>

        <FloatingPlus style={{ top: "8%", right: "10%" }} delay={1.5} />
        <FloatingPlus style={{ bottom: "10%", left: "8%" }} delay={3} />

        <div className="relative mx-auto max-w-4xl">
          {/* Section heading */}
          <div className="text-center">
            <span className="inline-block rounded-full border border-teal/40 bg-teal/10 px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-teal">
              {t("contact.badge")}
            </span>
            <h2 className="mt-4 text-3xl font-medium text-[color:var(--hero-text)] sm:text-4xl">
              {t("contact.title")}
            </h2>
            <div className="mx-auto mt-3 h-0.5 w-16 bg-gradient-to-r from-transparent via-teal to-transparent" />
            <p className="mx-auto mt-4 max-w-xl text-sm text-[color:var(--hero-text-mute)]">
              {t("contact.subtitle")}
            </p>
          </div>

          {/* Three big contact cards */}
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {/* Instagram */}
            <a
              href="https://www.instagram.com/clinics.os/"
              target="_blank"
              rel="noopener noreferrer"
              className="contact-card group relative flex flex-col items-center overflow-hidden rounded-2xl border border-sky/20 bg-white/5 p-6 text-center backdrop-blur-sm transition-all hover:-translate-y-1 hover:border-pink-400/50 hover:shadow-[0_20px_50px_-20px_rgba(236,72,153,0.5)]"
            >
              <div
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
                style={{
                  background:
                    "radial-gradient(circle at 50% 0%, rgba(236,72,153,0.15), transparent 70%)",
                }}
              />
              <div className="relative mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 shadow-lg transition-transform group-hover:scale-110">
                <IconBrandInstagram
                  size={26}
                  className="text-white"
                  strokeWidth={2}
                />
              </div>
              <div className="relative text-xs uppercase tracking-widest text-[color:var(--hero-text-mute)]">
                Instagram
              </div>
              <div className="relative mt-1 text-sm font-medium text-[color:var(--hero-text)]">
                Clinic.OS
              </div>
              <div className="relative mt-3 text-[10px] text-[color:var(--hero-text-mute)]">
                {t("contact.instagram.sub")}
              </div>
            </a>

            {/* Email */}
            <a
              href="clinicos.system@gmail.com"
              className="contact-card group relative flex flex-col items-center overflow-hidden rounded-2xl border border-sky/20 bg-white/5 p-6 text-center backdrop-blur-sm transition-all hover:-translate-y-1 hover:border-sky/60 hover:shadow-[0_20px_50px_-20px_rgba(111,189,245,0.5)]"
            >
              <div
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
                style={{
                  background:
                    "radial-gradient(circle at 50% 0%, rgba(111,189,245,0.15), transparent 70%)",
                }}
              />
              <div className="relative mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 shadow-lg transition-transform group-hover:scale-110">
                <IconMail size={26} className="text-white" strokeWidth={2} />
              </div>
              <div className="relative text-xs uppercase tracking-widest text-[color:var(--hero-text-mute)]">
                Email
              </div>
              <div
                className="relative mt-1 text-sm font-medium text-[color:var(--hero-text)]"
                dir="ltr"
              >
                Clinic.OS
              </div>
              <div className="relative mt-3 text-[10px] text-[color:var(--hero-text-mute)]">
                {t("contact.email.sub")}
              </div>
            </a>

            {/* WhatsApp */}
            <a
              href="https://wa.me/962778676359"
              target="_blank"
              rel="noopener noreferrer"
              className="contact-card group relative flex flex-col items-center overflow-hidden rounded-2xl border border-sky/20 bg-white/5 p-6 text-center backdrop-blur-sm transition-all hover:-translate-y-1 hover:border-emerald-400/60 hover:shadow-[0_20px_50px_-20px_rgba(52,211,153,0.5)]"
            >
              <div
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
                style={{
                  background:
                    "radial-gradient(circle at 50% 0%, rgba(52,211,153,0.15), transparent 70%)",
                }}
              />
              <div className="relative mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-green-600 shadow-lg transition-transform group-hover:scale-110">
                <IconBrandWhatsapp
                  size={26}
                  className="text-white"
                  strokeWidth={2}
                />
              </div>
              <div className="relative text-xs uppercase tracking-widest text-[color:var(--hero-text-mute)]">
                WhatsApp
              </div>
              <div
                className="relative mt-1 text-sm font-medium text-[color:var(--hero-text)]"
                dir="ltr"
              >
                Clinic.OS
              </div>
              <div className="relative mt-3 text-[10px] text-[color:var(--hero-text-mute)]">
                {t("contact.whatsapp.sub")}
              </div>
            </a>
          </div>

          {/* Thank-you message */}
          <div className="mx-auto mt-12 max-w-2xl rounded-2xl border border-teal/25 bg-gradient-to-br from-teal/5 via-transparent to-blue/5 p-6 text-center backdrop-blur-sm">
            <div className="mb-3 flex justify-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal/20 text-teal">
                <IconHeart size={18} strokeWidth={2} />
              </div>
            </div>
            <p className="text-base font-medium text-white">
              {t("contact.thanks.title")}
            </p>
            <p className="mt-2 text-xs text-[color:var(--hero-text-mute)]">
              {t("contact.thanks.body")}
            </p>
          </div>
        </div>
      </section>

      {/* ================ Refined footer ================ */}
      <footer className="relative border-t border-sky/10 bg-hero px-6 py-8">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-3 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2">
            <Cube3D size={18} />
            <span className="text-[11px] font-medium text-[color:var(--hero-text)]">
              ClinicOS
            </span>
          </div>
          <div className="text-[10px] text-[color:var(--hero-text-mute)]">
            © {new Date().getFullYear()} ClinicOS ·{" "}
            {t("contact.footer.location")}
          </div>
          <div className="flex items-center gap-3 text-[10px] text-[color:var(--hero-text-mute)]">
            <Link href="/track" className="hover:text-sky">
              {t("nav.track")}
            </Link>
            <span>·</span>
            <Link href="/signin" className="hover:text-sky">
              {t("nav.signin")}
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
