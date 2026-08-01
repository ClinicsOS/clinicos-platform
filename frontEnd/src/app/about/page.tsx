"use client";
import Link from "next/link";
import Cube3D from "@/components/Cube3D";
import FloatingPlus from "@/components/FloatingPlus";
import { useI18n } from "@/lib/i18n";
import {
  IconArrowLeft,
  IconTarget,
  IconBook,
  IconHeart,
  IconShieldCheck,
  IconMapPin,
  IconMail,
} from "@tabler/icons-react";

export default function AboutPage() {
  const { t, lang, setLang } = useI18n();

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-hero">
      {/* Ambient background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 15%, rgba(111,189,245,0.12), transparent 40%), radial-gradient(circle at 80% 60%, rgba(79,195,184,0.10), transparent 45%)",
        }}
      />

      {/* Navbar */}
      <header className="relative z-10 mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link
          href="/"
          className="flex items-center gap-2 text-[color:var(--hero-text)]"
        >
          <Cube3D size={24} />
          <span className="text-base font-medium text-white">ClinicOS</span>
        </Link>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setLang(lang === "en" ? "ar" : "en")}
            className="rounded-full border border-sky/40 px-2.5 py-0.5 text-[10px] text-[color:var(--hero-text-mute)]"
          >
            {lang === "en" ? "AR" : "EN"}
          </button>
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs text-[color:var(--hero-text-mute)] hover:text-sky"
          >
            <IconArrowLeft size={14} className="rtl-flip" /> {t("common.back")}
          </Link>
        </div>
      </header>

      {/* Content */}
      <section className="relative z-10 mx-auto max-w-3xl px-6 pb-20 pt-4">
        <FloatingPlus style={{ top: 40, right: "10%" }} />
        <FloatingPlus style={{ top: 100, left: "8%" }} delay={2} />

        {/* Title */}
        <div className="text-center">
          <h1 className="text-4xl font-medium leading-tight text-[color:var(--hero-text)] sm:text-5xl">
            {t("about.title")}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-[color:var(--hero-text-mute)]">
            {t("about.subtitle")}
          </p>
        </div>

        {/* Mission */}
        <div className="mt-12 rounded-2xl border border-sky/20 bg-white/5 p-6 backdrop-blur-sm">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal/20 text-teal">
              <IconTarget size={18} />
            </div>
            <h2 className="text-lg font-medium text-[color:var(--hero-text)]">
              {t("about.mission.title")}
            </h2>
          </div>
          <p className="text-sm leading-relaxed text-[color:var(--hero-text-mute)]">
            {t("about.mission.body")}
          </p>
        </div>

        {/* Story */}
        <div className="mt-6 rounded-2xl border border-sky/20 bg-white/5 p-6 backdrop-blur-sm">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky/20 text-sky">
              <IconBook size={18} />
            </div>
            <h2 className="text-lg font-medium text-[color:var(--hero-text)]">
              {t("about.story.title")}
            </h2>
          </div>
          <p className="whitespace-pre-line text-sm leading-relaxed text-[color:var(--hero-text-mute)]">
            {t("about.story.body")}
          </p>
        </div>

        {/* Values */}
        <div className="mt-6 rounded-2xl border border-sky/20 bg-white/5 p-6 backdrop-blur-sm">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue/20 text-blue">
              <IconHeart size={18} />
            </div>
            <h2 className="text-lg font-medium text-[color:var(--hero-text)]">
              {t("about.values.title")}
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-sky/15 bg-white/5 p-4">
              <div className="mb-2 flex items-center gap-2 text-teal">
                <IconShieldCheck size={16} />
                <p className="text-sm font-medium text-[color:var(--hero-text)]">
                  {t("about.values.v1.title")}
                </p>
              </div>
              <p className="text-[11px] leading-relaxed text-[color:var(--hero-text-mute)]">
                {t("about.values.v1.body")}
              </p>
            </div>
            <div className="rounded-xl border border-sky/15 bg-white/5 p-4">
              <div className="mb-2 flex items-center gap-2 text-sky">
                <IconShieldCheck size={16} />
                <p className="text-sm font-medium text-[color:var(--hero-text)]">
                  {t("about.values.v2.title")}
                </p>
              </div>
              <p className="text-[11px] leading-relaxed text-[color:var(--hero-text-mute)]">
                {t("about.values.v2.body")}
              </p>
            </div>
            <div className="rounded-xl border border-sky/15 bg-white/5 p-4">
              <div className="mb-2 flex items-center gap-2 text-blue">
                <IconMapPin size={16} />
                <p className="text-sm font-medium text-[color:var(--hero-text)]">
                  {t("about.values.v3.title")}
                </p>
              </div>
              <p className="text-[11px] leading-relaxed text-[color:var(--hero-text-mute)]">
                {t("about.values.v3.body")}
              </p>
            </div>
          </div>
        </div>

        {/* Contact */}
        <div className="mt-6 rounded-2xl border border-teal/25 bg-gradient-to-br from-teal/5 via-transparent to-blue/5 p-6 text-center backdrop-blur-sm">
          <div className="mb-3 flex justify-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal/20 text-teal">
              <IconMail size={18} />
            </div>
          </div>
          <p className="text-base font-medium text-white">
            {t("about.contact.title")}
          </p>
          <p className="mt-2 text-xs text-[color:var(--hero-text-mute)]">
            {t("about.contact.body")}
          </p>

          {/* تم إضافة قفل الوسم <a ...> هنا */}
          <a
            href="mailto:clinicos.system@gmail.com"
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-teal/40 bg-teal/10 px-4 py-2 text-xs font-medium text-teal hover:bg-teal/20"
          >
            <IconMail size={13} /> clinicos.system@gmail.com
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative border-t border-sky/10 bg-hero px-6 py-6">
        <div className="mx-auto flex max-w-4xl items-center justify-center text-[10px] text-[color:var(--hero-text-mute)]">
          © {new Date().getFullYear()} ClinicOS · {t("contact.footer.location")}
        </div>
      </footer>
    </main>
  );
}
