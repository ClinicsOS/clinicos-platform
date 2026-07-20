"use client";
import { useState } from "react";
import Link from "next/link";
import axios from "axios";
import { api, errMsg } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import Cube3D from "@/components/Cube3D";
import FloatingPlus from "@/components/FloatingPlus";
import {
  IconArrowLeft,
  IconSearch,
  IconClock,
  IconCalendar,
  IconUser,
  IconStethoscope,
  IconX,
  IconCircleCheck,
} from "@tabler/icons-react";

interface Booking {
  refCode: string;
  status: "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show";
  startAt: string;
  duration: number;
  clinicName: string;
  clinicSlug: string;
  patientName: string;
  canCancel: boolean;
}

const pill: Record<string, string> = {
  scheduled: "bg-blue/15 text-sky",
  confirmed: "bg-teal/15 text-teal",
  completed: "bg-mute/15 text-mute",
  cancelled: "bg-red-500/15 text-red-400",
  no_show: "bg-amber-500/15 text-amber-400",
};

export default function TrackPage() {
  const { t, lang } = useI18n();
  const [refCode, setRefCode] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);

  const check = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    setBooking(null);
    setCancelled(false);
    try {
      const res = await api.post("/public/track", { refCode: refCode.trim(), phone: phone.trim() });
      setBooking(res.data);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        setError(t("track.notFound"));
      } else {
        setError(errMsg(err, t("common.error")));
      }
    } finally {
      setLoading(false);
    }
  };

  const cancel = async () => {
    if (!window.confirm(t("track.cancelConfirm"))) return;
    setCancelling(true);
    try {
      await api.post("/public/track/cancel", { refCode: refCode.trim(), phone: phone.trim() });
      setCancelled(true);
      if (booking) setBooking({ ...booking, status: "cancelled", canCancel: false });
    } catch (err) {
      setError(errMsg(err, t("common.error")));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <main className="min-h-screen bg-hero px-6 py-8">
      {/* Ambient */}
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(circle at 25% 20%, rgba(111,189,245,0.15), transparent 45%), radial-gradient(circle at 75% 75%, rgba(79,195,184,0.12), transparent 40%)",
        }}
      />
      <FloatingPlus style={{ top: "18%", left: "12%" }} />
      <FloatingPlus style={{ top: "24%", right: "14%" }} delay={2} />
      <FloatingPlus style={{ bottom: "20%", left: "18%" }} delay={3.5} />

      <div className="relative z-10 mx-auto max-w-md">
        <Link href="/" className="mb-6 flex items-center gap-2 text-xs text-[color:var(--hero-text-mute)] hover:text-sky">
          <IconArrowLeft size={14} className="rtl-flip" />
          <span>{t("back.home")}</span>
        </Link>

        <div className="mb-6 flex items-center gap-3">
          <Cube3D size={32} />
          <div>
            <h1 className="text-lg font-medium text-[color:var(--hero-text)]">{t("track.title")}</h1>
            <p className="text-xs text-[color:var(--hero-text-mute)]">{t("track.sub")}</p>
          </div>
        </div>

        {/* Search form */}
        <div className="rounded-2xl border border-sky/25 bg-[color:var(--card)] p-5 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.5)] backdrop-blur">
          <form onSubmit={check}>
            <label className="mb-1 block text-[10.5px] font-medium tracking-wide text-[color:var(--hero-text-mute)]">
              {t("track.ref")}
            </label>
            <input
              required
              minLength={3}
              className="mb-3 w-full rounded-lg border border-sky/35 bg-black/10 px-3 py-2.5 font-mono text-sm uppercase text-[color:var(--hero-text)] outline-none placeholder:text-[color:var(--hero-text-mute)] focus:border-sky"
              placeholder="BK-XXXXX"
              value={refCode}
              onChange={(e) => setRefCode(e.target.value.toUpperCase())}
            />
            <label className="mb-1 block text-[10.5px] font-medium tracking-wide text-[color:var(--hero-text-mute)]">
              {t("track.phone")}
            </label>
            <input
              required
              className="mb-3 w-full rounded-lg border border-sky/35 bg-black/10 px-3 py-2.5 text-sm text-[color:var(--hero-text)] outline-none placeholder:text-[color:var(--hero-text-mute)] focus:border-sky"
              placeholder="0790000000"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              dir="ltr"
            />
            {error && <p className="mb-2 text-center text-xs text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal py-2.5 text-sm font-medium text-navy hover:brightness-110 disabled:opacity-50"
            >
              <IconSearch size={14} />
              {loading ? t("common.loading") : t("track.check")}
            </button>
          </form>
        </div>

        {/* Result */}
        {booking && (
          <div className="mt-4 rounded-2xl border border-sky/25 bg-[color:var(--card)] p-5 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.5)] backdrop-blur">
            {cancelled && (
              <div className="mb-3 flex items-center gap-2 rounded-lg bg-teal/15 px-3 py-2 text-[11px] text-teal">
                <IconCircleCheck size={14} />
                {t("track.cancelled")}
              </div>
            )}
            <div className="mb-3 flex items-center justify-between">
              <span className="rounded-full border border-dashed border-sky/50 bg-black/10 px-3 py-1 font-mono text-[11px] text-sky">
                {booking.refCode}
              </span>
              <span className={`pill ${pill[booking.status]}`}>{t(`track.status.${booking.status}`)}</span>
            </div>

            {[
              { icon: <IconStethoscope size={13} />, l: t("bk.clinicLabel"), v: booking.clinicName },
              { icon: <IconUser size={13} />, l: t("bk.name"), v: booking.patientName },
              {
                icon: <IconCalendar size={13} />,
                l: t("ap.date"),
                v: new Date(booking.startAt).toLocaleDateString(lang === "ar" ? "ar" : undefined, {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                }),
              },
              {
                icon: <IconClock size={13} />,
                l: t("ap.time"),
                v: new Date(booking.startAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                }),
              },
            ].map((row) => (
              <div
                key={row.l}
                className="flex items-center justify-between border-b border-sky/15 py-2 text-[11px] last:border-0"
              >
                <span className="flex items-center gap-1.5 text-[color:var(--hero-text-mute)]">
                  {row.icon}
                  {row.l}
                </span>
                <span className="font-medium text-[color:var(--hero-text)]">{row.v}</span>
              </div>
            ))}

            {booking.canCancel && (
              <button
                onClick={cancel}
                disabled={cancelling}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 py-2 text-xs font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-50"
              >
                <IconX size={13} />
                {cancelling ? t("common.loading") : t("track.cancelBtn")}
              </button>
            )}

            <Link
              href={`/book/${booking.clinicSlug}`}
              className="mt-2 block w-full rounded-lg border border-sky/40 bg-sky/10 py-2 text-center text-xs font-medium text-[color:var(--hero-text-mute)]"
            >
              {t("track.new")}
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
