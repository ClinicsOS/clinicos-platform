"use client";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { api, errMsg } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import Cube3D from "@/components/Cube3D";
import FloatingPlus from "@/components/FloatingPlus";
import type { Clinic, WorkingHour } from "@/lib/types";
import {
  IconClock,
  IconMapPin,
  IconUser,
  IconCalendar,
  IconCheck,
  IconArrowRight,
  IconCalendarPlus,
  IconClipboardList,
  IconSun,
  IconMoon,
  IconLock,
  IconChevronLeft,
  IconChevronRight,
  IconCalendarOff,
} from "@tabler/icons-react";

interface PublicClinic {
  clinic: Clinic;
  doctors: { _id: string; name: string }[];
  showPoweredBy: boolean;
}
interface SlotDetail {
  time: string;
  status: "available" | "booked" | "past";
}
interface SlotsRes {
  slots: string[];              // legacy — still supported by API
  slotDuration: number;
  closed?: boolean;
}
interface BookRes {
  refCode: string;
  clinicName: string;
  clinicSlug: string;
  doctorName: string;
  startAt: string;
  duration: number;
}

/**
 * Build a list of the next 14 days as YYYY-MM-DD strings so the patient can
 * scroll ahead to tomorrow, day-after-tomorrow, next week etc.
 */
const upcomingDays = (count = 14) =>
  Array.from({ length: count }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });

export default function PublicBookingPage() {
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();
  const qc = useQueryClient();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState(upcomingDays()[0]);
  const [dayOffset, setDayOffset] = useState(0);
  const [slot, setSlot] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<BookRes | null>(null);

  const allDays = useMemo(upcomingDays, []);
  const visibleDays = allDays.slice(dayOffset, dayOffset + 5);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["public-clinic", slug],
    queryFn: async () => (await api.get<PublicClinic>(`/public/clinics/${slug}`)).data,
    retry: false,
    // Poll clinic info every 5s so working-hours changes propagate quickly
    refetchInterval: 5_000,
    staleTime: 3_000,
  });

  const doctors = data?.doctors ?? [];
  const activeDoctor = doctorId || doctors[0]?._id || "";
  const clinic = data?.clinic;

  // ==================================================================
  // Build the full slot grid CLIENT-SIDE from working hours + bookings.
  // Server still validates on submit (source of truth) but the grid is
  // richer than the API's flat list — we want to show *booked* and *past*
  // slots too, not just the available ones.
  // ==================================================================
  const { data: dayBookings } = useQuery({
    queryKey: ["public-clinic-day", slug, activeDoctor, date],
    queryFn: async () =>
      (
        await api.get<SlotsRes>(
          `/public/clinics/${slug}/slots?doctorId=${activeDoctor}&date=${date}`
        )
      ).data,
    enabled: !!activeDoctor && !!date && !!clinic,
    refetchInterval: 5_000,
    staleTime: 3_000,
  });

  const slotGrid = useMemo((): { slots: SlotDetail[]; closed: boolean; noHours: boolean } => {
    if (!clinic) return { slots: [], closed: false, noHours: true };
    const day = new Date(date + "T00:00:00");
    const dow = day.getDay();
    const wh = clinic.workingHours.find((w: WorkingHour) => w.day === dow);
    if (!wh || !wh.isOpen) return { slots: [], closed: true, noHours: false };

    const [fromH, fromM] = wh.from.split(":").map(Number);
    const [toH, toM] = wh.to.split(":").map(Number);
    const openM = fromH * 60 + fromM;
    const closeM = toH * 60 + toM;
    const step = clinic.slotDuration || 30;

    // Available times from the API is the ground truth for "not booked and not past"
    const availableSet = new Set(dayBookings?.slots ?? []);

    // Rebuild the full grid to also show booked/past slots.
    // We treat clinic hours as WALL-CLOCK time in the user's timezone (Jordan/local).
    // So "10:00" on the button means 10:00 local time to the user.
    const now = new Date();
    const nowStamp = now.getTime();
    const grid: SlotDetail[] = [];
    for (let m = openM; m + step <= closeM; m += step) {
      const h = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(m % 60).padStart(2, "0");
      const time = `${h}:${mm}`;
      // Create a local Date (no Z) so JS interprets it in the user's timezone
      const slotDate = new Date(`${date}T${time}:00`);
      const isPast = slotDate.getTime() < nowStamp;

      let status: "available" | "booked" | "past";
      if (isPast) status = "past";
      else if (availableSet.has(time)) status = "available";
      else status = "booked";

      grid.push({ time, status });
    }
    return { slots: grid, closed: false, noHours: false };
  }, [clinic, date, dayBookings]);

  const book = useMutation({
    mutationFn: async () => {
      // Interpret the picked time as local (Jordan) wall-clock, convert to UTC
      const startAt = new Date(`${date}T${slot}:00`).toISOString();
      const body: Record<string, string> = {
        doctorId: activeDoctor,
        startAt,
        fullName: fullName.trim(),
        phone: phone.trim(),
      };
      if (email.trim()) body.email = email.trim();
      return (await api.post<BookRes>(`/public/clinics/${slug}/book`, body)).data;
    },
    onSuccess: (res) => {
      setDone(res);
      setError("");
      qc.invalidateQueries({ queryKey: ["public-clinic-day"] });
    },
    onError: (e) => {
      if (axios.isAxiosError(e) && e.response?.status === 409) {
        setError(t("ap.taken"));
        setSlot("");
        qc.invalidateQueries({ queryKey: ["public-clinic-day"] });
      } else {
        setError(errMsg(e, t("common.error")));
      }
    },
  });

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-hero">
        <Cube3D size={64} />
      </main>
    );
  }

  if (isError || !data || !clinic) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-hero p-6">
        <p className="text-sm text-mute">{t("bk.notfound")}</p>
      </main>
    );
  }

  const { showPoweredBy } = data;

  return (
    <main className="min-h-screen bg-base">
      <div className="mx-auto max-w-md pb-8">
        {/* ===== Clinic header ===== */}
        <header className="relative overflow-hidden bg-hero px-5 py-4 sm:rounded-b-2xl">
          <FloatingPlus style={{ top: 10, right: 16 }} />
          <FloatingPlus style={{ bottom: 8, right: 52 }} delay={2} />
          <div className="flex items-center gap-3">
            <Cube3D size={30} />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-sm font-medium" style={{ color: "var(--hero-text, #F2F7FC)" }}>
                {clinic.name}
              </h1>
              <p className="text-[10px]" style={{ color: "var(--hero-text-mute, #8FB3CC)" }}>
                {clinic.specialty}
                {clinic.address ? ` · ${clinic.address}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setLang(lang === "en" ? "ar" : "en")}
                className="rounded-full border border-sky/40 px-2.5 py-0.5 text-[10px]"
                style={{ color: "var(--hero-text-mute, #DCEBF7)" }}
              >
                {lang === "en" ? "AR" : "EN"}
              </button>
              <button
                onClick={toggle}
                className="rounded-full border border-sky/40 p-1"
                style={{ color: "var(--hero-text-mute, #DCEBF7)" }}
                title="Theme"
              >
                {theme === "dark" ? <IconSun size={11} /> : <IconMoon size={11} />}
              </button>
            </div>
          </div>
        </header>

        {done ? (
          /* ===== Confirmation ===== */
          <section className="px-5 pt-6">
            <div className="flex justify-center" style={{ perspective: 500 }}>
              <div className="preserve-3d spin-slow relative h-14 w-14">
                <span
                  className="absolute inset-0 rounded-2xl border border-teal/50"
                  style={{ transform: "translateZ(-12px) translate(6px,6px)" }}
                />
                <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-teal text-navy">
                  <IconCheck size={26} />
                </span>
              </div>
            </div>
            <h2 className="mt-3 text-center text-base font-medium text-ink">{t("bk.received")}</h2>
            <div className="mt-2 flex justify-center">
              <span className="rounded-full border border-dashed border-sky/60 bg-soft px-3.5 py-1 font-mono text-[11px] text-blue">
                {t("bk.ref")}: {done.refCode}
              </span>
            </div>

            <div className="card mt-4 px-4 py-1">
              {[
                { icon: <IconUser size={13} />, l: t("ap.doctor"), v: done.doctorName },
                {
                  icon: <IconCalendar size={13} />,
                  l: t("ap.date"),
                  v: new Date(done.startAt).toLocaleDateString(lang === "ar" ? "ar" : undefined, {
                    weekday: "long",
                    month: "short",
                    day: "numeric",
                  }),
                },
                {
                  icon: <IconClock size={13} />,
                  l: t("ap.time"),
                  v: new Date(done.startAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  }),
                },
                { icon: <IconMapPin size={13} />, l: t("st.address"), v: clinic.address || clinic.name },
              ].map((row) => (
                <div
                  key={row.l}
                  className="flex items-center justify-between border-b border-edge py-2.5 text-[11px] last:border-0"
                >
                  <span className="flex items-center gap-1.5 text-mute">
                    {row.icon} {row.l}
                  </span>
                  <span className="font-medium text-ink">{row.v}</span>
                </div>
              ))}
            </div>

            <div className="mt-3 flex gap-2 rounded-lg bg-sky/10 px-3 py-2.5 text-[10px] leading-relaxed text-sky">
              <IconClipboardList size={14} className="mt-0.5 shrink-0" />
              {t("bk.confirmNote")}
            </div>

            <Link
              href="/track"
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-sky/40 bg-sky/10 py-2.5 text-xs font-medium text-blue"
            >
              <IconClipboardList size={14} /> {t("bk.trackThis")}
            </Link>

            <button
              onClick={() => {
                setDone(null);
                setSlot("");
                setFullName("");
                setPhone("");
                setEmail("");
              }}
              className="btn-ghost mt-2 w-full"
            >
              <IconCalendarPlus size={15} /> {t("bk.another")}
            </button>
          </section>
        ) : (
          /* ===== Flow ===== */
          <section className="px-5 pt-4">
            {/* --- Doctor picker --- */}
            <p className="lbl !tracking-widest">{t("bk.choose")}</p>
            {doctors.length === 0 ? (
              <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-300">
                {t("bk.noDoctorsYet")}
              </div>
            ) : (
              <div className="mb-4 grid grid-cols-2 gap-2">
                {doctors.map((d) => (
                  <button
                    key={d._id}
                    onClick={() => {
                      setDoctorId(d._id);
                      setSlot("");
                    }}
                    className={`flex items-center gap-2 rounded-xl border p-2.5 text-start ${
                      activeDoctor === d._id ? "border-2 border-blue bg-card" : "border-edge bg-card2"
                    }`}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-soft text-[9px] font-medium text-blue">
                      {d.name
                        .split(" ")
                        .map((w) => w[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()}
                    </span>
                    <span className="truncate text-[11px] font-medium text-ink">{d.name}</span>
                  </button>
                ))}
              </div>
            )}

            {/* --- Day picker with pagination --- */}
            <p className="lbl !tracking-widest">{t("bk.day")}</p>
            <div className="mb-4 flex items-center gap-1" dir="ltr">
              <button
                onClick={() => setDayOffset(Math.max(0, dayOffset - 5))}
                disabled={dayOffset === 0}
                className="rounded-lg border border-edge bg-card2 p-1.5 text-mute disabled:opacity-30"
              >
                <IconChevronLeft size={12} />
              </button>
              <div className="flex flex-1 gap-1.5 overflow-x-auto pb-1">
                {visibleDays.map((d) => {
                  const dd = new Date(d + "T00:00:00");
                  const active = d === date;
                  const dow = dd.getDay();
                  const wh = clinic.workingHours.find((w: WorkingHour) => w.day === dow);
                  const closed = !wh || !wh.isOpen;
                  return (
                    <button
                      key={d}
                      disabled={closed}
                      onClick={() => {
                        setDate(d);
                        setSlot("");
                      }}
                      className={`min-w-12 rounded-lg border px-2 py-1.5 text-center transition-all ${
                        closed
                          ? "cursor-not-allowed border-red-500/20 bg-red-500/5 opacity-60"
                          : active
                          ? "border-blue bg-blue text-white"
                          : "border-edge bg-card2 text-ink hover:border-sky"
                      }`}
                      title={closed ? t("bk.closedDay") : ""}
                    >
                      <span className={`block text-[8px] ${active ? "text-white/70" : "text-mute"}`}>
                {dd.toLocaleDateString(lang === "ar" ? "ar" : undefined, { weekday: "short" })}
                      </span>
                      <span className="text-xs font-medium">{dd.getDate()}</span>
                      {closed && (
                        <span className="mt-0.5 block text-[7px] text-red-400">{t("st.closed")}</span>
                      )}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => setDayOffset(Math.min(allDays.length - 5, dayOffset + 5))}
                disabled={dayOffset + 5 >= allDays.length}
                className="rounded-lg border border-edge bg-card2 p-1.5 text-mute disabled:opacity-30"
              >
                <IconChevronRight size={12} />
              </button>
            </div>

            {/* --- Time slots grid --- */}
            <p className="lbl !tracking-widest">{t("bk.times")}</p>
            {slotGrid.closed ? (
              <div className="mb-4 flex flex-col items-center rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-6 text-center">
                <IconCalendarOff size={26} className="mb-2 text-red-400" />
                <p className="text-[12px] font-medium text-red-400">{t("bk.dayClosedTitle")}</p>
                <p className="mt-1 text-[10px] text-mute">{t("bk.dayClosedSub")}</p>
              </div>
            ) : slotGrid.slots.length === 0 ? (
              <p className="mb-4 py-3 text-center text-[11px] text-mute">{t("common.loading")}</p>
            ) : (
              <>
                {/* Legend */}
                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-mute">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-sm bg-teal" /> {t("bk.legend.available")}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-sm bg-red-500/40" /> {t("bk.legend.booked")}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-sm bg-mute/40" /> {t("bk.legend.past")}
                  </span>
                </div>

                <div className="mb-4 grid max-h-72 grid-cols-3 gap-1.5 overflow-y-auto pe-1" dir="ltr">
                  {slotGrid.slots.map((s) => {
                    const isSelected = slot === s.time;
                    if (s.status === "available") {
                      return (
                        <button
                          key={s.time}
                          onClick={() => setSlot(s.time)}
                          className={`rounded-lg border py-2 text-[11px] font-medium transition-all ${
                            isSelected
                              ? "border-teal bg-teal text-navy shadow-md"
                              : "border-teal/50 bg-teal/5 text-teal hover:bg-teal/15"
                          }`}
                        >
                          {s.time}
                        </button>
                      );
                    }
                    if (s.status === "booked") {
                      return (
                        <button
                          key={s.time}
                          disabled
                          className="flex cursor-not-allowed items-center justify-center gap-1 rounded-lg border border-red-500/25 bg-red-500/5 py-2 text-[11px] font-medium text-red-400/70 opacity-70"
                          title={t("bk.slotBooked")}
                        >
                          <IconLock size={9} />
                          <span className="line-through">{s.time}</span>
                        </button>
                      );
                    }
                    // past
                    return (
                      <button
                        key={s.time}
                        disabled
                        className="cursor-not-allowed rounded-lg border border-edge bg-card2 py-2 text-[11px] font-mono text-mute opacity-40"
                        title={t("bk.slotPast")}
                      >
                        {s.time}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* --- Patient details --- */}
            <p className="lbl !tracking-widest">{t("bk.details")}</p>
            <input
              className="inp mb-2"
              placeholder={t("bk.name")}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
            <input
              className="inp mb-2"
              placeholder={t("bk.phone")}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              dir="ltr"
            />
            <input
              className="inp mb-3"
              type="email"
              placeholder={t("bk.email")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              dir="ltr"
            />

            {error && <p className="mb-2 text-center text-xs text-red-400">{error}</p>}

            <button
              className="w-full rounded-lg py-3 text-sm font-medium text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                background: clinic.brandColor || "#3B9DE8",
              }}
              disabled={
                !activeDoctor ||
                !slot ||
                fullName.trim().length < 2 ||
                phone.trim().length < 7 ||
                book.isPending
              }
              onClick={() => book.mutate()}
            >
              {book.isPending ? t("common.loading") : t("bk.book")}{" "}
              <IconArrowRight size={15} className="rtl-flip inline" />
            </button>

            <Link
              href="/track"
              className="mt-3 flex w-full items-center justify-center gap-1.5 text-[10px] text-mute hover:text-sky"
            >
              <IconClipboardList size={11} /> {t("track.title")}
            </Link>
          </section>
        )}

        {showPoweredBy && (
          <p className="mt-6 text-center text-[9px] text-mute">
            {t("bk.powered")} <span className="font-medium text-ink">ClinicOS</span>
          </p>
        )}
      </div>
    </main>
  );
}
