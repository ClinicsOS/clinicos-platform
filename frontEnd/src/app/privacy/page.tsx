"use client";
import Link from "next/link";
import Cube3D from "@/components/Cube3D";
import { useI18n } from "@/lib/i18n";
import { IconArrowLeft, IconShieldLock, IconMail } from "@tabler/icons-react";

export default function PrivacyPage() {
  const { t, lang, setLang } = useI18n();

  const sections = [
    { title: t("privacy.intro.title"), body: t("privacy.intro.body") },
    { title: t("privacy.collect.title"), body: t("privacy.collect.body") },
    { title: t("privacy.use.title"), body: t("privacy.use.body") },
    { title: t("privacy.protect.title"), body: t("privacy.protect.body") },
    { title: t("privacy.share.title"), body: t("privacy.share.body") },
    { title: t("privacy.rights.title"), body: t("privacy.rights.body") },
    { title: t("privacy.cookies.title"), body: t("privacy.cookies.body") },
    {
      title: t("privacy.contact.title"),
      body: t("privacy.contact.body"),
      isContact: true, // علامة لتمييز قسم التواصل
    },
  ];

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-hero">
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 15%, rgba(111,189,245,0.10), transparent 40%)",
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
        <div className="text-center">
          <div className="mb-4 flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky/20 text-sky">
              <IconShieldLock size={24} />
            </div>
          </div>
          <h1 className="text-3xl font-medium leading-tight text-[color:var(--hero-text)] sm:text-4xl">
            {t("privacy.title")}
          </h1>
          <p className="mt-3 text-[11px] uppercase tracking-widest text-[color:var(--hero-text-mute)]">
            {t("privacy.lastUpdated")}
          </p>
        </div>

        <div className="mt-10 space-y-5">
          {sections.map((s, idx) => (
            <div
              key={idx}
              className="rounded-2xl border border-sky/20 bg-white/5 p-6 backdrop-blur-sm"
            >
              {/* تعديل لون العنوان للون الأبيض text-white */}
              <h2 className="mb-2 flex items-center gap-2 text-base font-medium text-white">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky/20 text-[10px] font-medium text-sky">
                  {idx + 1}
                </span>
                {s.title}
              </h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-[color:var(--hero-text-mute)]">
                {s.body}
              </p>

              {/* إضافة زر البريد الإلكتروني الجديد إذا كان قسم التواصل */}
              {s.isContact && (
                <div className="mt-4">
                  <a
                    href="mailto:clinicos.system@gmail.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-xl border border-sky/30 bg-sky/10 px-4 py-2 text-xs font-medium text-sky transition-colors hover:bg-sky/20"
                  >
                    <IconMail size={14} /> clinicos.system@gmail.com
                  </a>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <footer className="relative border-t border-sky/10 bg-hero px-6 py-6">
        <div className="mx-auto flex max-w-4xl items-center justify-center text-[10px] text-[color:var(--hero-text-mute)]">
          © {new Date().getFullYear()} ClinicOS · {t("contact.footer.location")}
        </div>
      </footer>
    </main>
  );
}
