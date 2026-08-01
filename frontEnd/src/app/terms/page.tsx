"use client";
import Link from "next/link";
import Cube3D from "@/components/Cube3D";
import { useI18n } from "@/lib/i18n";
import { IconArrowLeft, IconFileText, IconMail } from "@tabler/icons-react";

export default function TermsPage() {
  const { t, lang, setLang } = useI18n();

  const sections = [
    { title: t("terms.accept.title"), body: t("terms.accept.body") },
    {
      title: t("terms.subscription.title"),
      body: t("terms.subscription.body"),
    },
    { title: t("terms.user.title"), body: t("terms.user.body") },
    { title: t("terms.our.title"), body: t("terms.our.body") },
    { title: t("terms.use.title"), body: t("terms.use.body") },
    { title: t("terms.cancel.title"), body: t("terms.cancel.body") },
    { title: t("terms.liability.title"), body: t("terms.liability.body") },
    {
      title: t("terms.law.title"),
      body: t("terms.law.body"),
      isContact: true, // علامة إضافة زر التواصل للإيميل في البند الأخير
    },
  ];

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-hero">
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(circle at 80% 15%, rgba(79,195,184,0.10), transparent 40%)",
        }}
      />

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

      <section className="relative z-10 mx-auto max-w-3xl px-6 pb-20 pt-4">
        <div className="text-center">
          <div className="mb-4 flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal/20 text-teal">
              <IconFileText size={24} />
            </div>
          </div>
          <h1 className="text-3xl font-medium leading-tight text-[color:var(--hero-text)] sm:text-4xl">
            {t("terms.title")}
          </h1>
          <p className="mt-3 text-[11px] uppercase tracking-widest text-[color:var(--hero-text-mute)]">
            {t("terms.lastUpdated")}
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
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal/20 text-[10px] font-medium text-teal">
                  {idx + 1}
                </span>
                {s.title}
              </h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-[color:var(--hero-text-mute)]">
                {s.body}
              </p>

              {/* زر التواصل عبر الإيميل */}
              {s.isContact && (
                <div className="mt-4">
                  <a
                    href="mailto:clinicos.system@gmail.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-xl border border-teal/30 bg-teal/10 px-4 py-2 text-xs font-medium text-teal transition-colors hover:bg-teal/20"
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
