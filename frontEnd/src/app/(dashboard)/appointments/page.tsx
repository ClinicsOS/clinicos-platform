"use client";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useAuth } from "@/store/auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errMsg } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useSelectedPatient } from "@/store/patient";
import { useToast } from "@/components/Toast";
import Modal from "@/components/Modal";
import type { Appointment, Patient, Staff, Clinic, WorkingHour } from "@/lib/types";
import {
  fmtTime,
  fmtTime12,
  to12h,
  todayLocal,
  combineToUTC,
  ymd,
  fmtDate,
  fmtCalendarDate,
  clinicLocalToUtc,
  addDaysYmd,
  weekdayOfYmd,
  parseYmd,
} from "@/lib/dates";
import { timeToMinutes, intervalsOverlap } from "@/lib/workingHoursTime";
import { useAccess } from "@/lib/access";
import DatePickerPopover from "@/components/appointments/DatePickerPopover";
import { SkeletonList } from "@/components/Skeleton";
import { newRequestId } from "@/lib/clinical/hooks";
import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronDown,
  IconPlus,
  IconCalendarEvent,
  IconAlertCircle,
  IconLock,
  IconUserCircle,
  IconClock,
  IconInfoCircle,
  IconCoffee,
  IconDoorEnter,
  IconUserPlus,
} from "@tabler/icons-react";

const AR_DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const EN_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * The ONE duration-aware, break-aware, overlap-aware slot grid computation —
 * shared by "New appointment" AND "Edit appointment" (FIX #6's reschedule),
 * so a reschedule preview can never drift from what a fresh booking shows.
 *
 * `activeAppts` must already be filtered to the relevant doctor + day by the
 * caller, and — when rescheduling an existing appointment — must exclude
 * that appointment itself, mirroring the backend's self-exclusion rule (an
 * appointment must never conflict with its own current slot).
 */
function computeSlots(
  clinic: Clinic,
  date: string,
  duration: number,
  activeAppts: Appointment[],
  doctor?: Staff | null
): { list: { time: string; taken: boolean; past: boolean; isBreak: boolean }[]; closed: boolean; doctorOff?: boolean } {
  const dow = weekdayOfYmd(date); // weekday of the calendar date itself — no timezone involved
  const wh = clinic.workingHours.find((w: WorkingHour) => w.day === dow);
  if (!wh || !wh.isOpen) return { list: [], closed: true };
  // PHASE 4 — the doctor's OWN hours (optional) can only NARROW the clinic's: the clinic's rules always still apply, the doctor's
  // are checked in addition (the server enforces the same on every create/reschedule/public booking — this just mirrors it).
  const dwh = doctor?.workingHours?.find((w) => w.day === dow);
  if (doctor?.workingHours && (!dwh || !dwh.isOpen)) return { list: [], closed: true, doctorOff: true };

  const openM = Math.max(timeToMinutes(wh.from), dwh ? timeToMinutes(dwh.from) : 0);
  const closeM = Math.min(timeToMinutes(wh.to, { endOfDay: true }), dwh ? timeToMinutes(dwh.to, { endOfDay: true }) : 24 * 60);
  const step = clinic.slotDuration || 30;

  // Optional break windows (e.g. lunch break) — the clinic's and, when set, the doctor's own
  const breaks: [number, number][] = [];
  if (wh.breakFrom && wh.breakTo) breaks.push([timeToMinutes(wh.breakFrom), timeToMinutes(wh.breakTo)]);
  if (dwh?.breakFrom && dwh?.breakTo) breaks.push([timeToMinutes(dwh.breakFrom), timeToMinutes(dwh.breakTo)]);

  // Other active appointments/blocks for this doctor/day, as minute-of-day
  // intervals using THEIR OWN duration — a candidate start is "taken" if
  // [m, m+duration) overlaps any of them, not only an appointment that
  // starts at exactly m (that exact-match check was the double-booking
  // hole: a 60-minute appointment at 10:00 occupies 10:30 too, even though
  // nothing else starts exactly at 10:30).
  // PHASE 3.5 — a walk-in is a visit RECORD, not a reservation: it never makes a slot "taken" here (the backend's
  // overlap check and the public booking page already ignore it the same way), so this picker can't disagree with them.
  const activeIntervals = activeAppts
    .filter((a) => a.source !== "walk_in" && (a.status === "scheduled" || a.status === "confirmed"))
    .map((a) => {
      const start = timeToMinutes(fmtTime(a.startAt));
      return { start, end: start + a.duration };
    });

  const now = Date.now();
  const list: { time: string; taken: boolean; past: boolean; isBreak: boolean }[] = [];
  // The candidate's FULL selected duration must fit before closing — not
  // just the grid step — so changing Duration recalculates which start
  // times are even offered (e.g. 23:30 disappears once Duration is long
  // enough to run past a midnight closing time).
  for (let m = openM; m + duration <= closeM; m += step) {
    const h = String(Math.floor(m / 60)).padStart(2, "0");
    const mm = String(m % 60).padStart(2, "0");
    const timeStr = `${h}:${mm}`;
    // The slot's absolute instant = this wall-clock time on the CLINIC's calendar
    const slotDate = clinicLocalToUtc(date, timeStr);
    const end = m + duration;
    const overlapsBreak = breaks.some(([bs, be]) => intervalsOverlap(m, end, bs, be));
    const overlapsExisting = activeIntervals.some((iv) => intervalsOverlap(m, end, iv.start, iv.end));
    list.push({
      time: timeStr,
      taken: overlapsExisting,
      past: slotDate.getTime() < now,
      isBreak: overlapsBreak,
    });
  }
  return { list, closed: false };
}

/**
 * One appointment as it appears on one grid row. A longer appointment spans several rows but is still ONE
 * appointment: it is a full card on the first row it touches and a lightweight "continued" marker on the rest.
 */
type SlotEntry = {
  appt: Appointment;
  isContinuation: boolean;          // true when this appointment already got its card on an earlier row
};

type SlotVisual = {
  time: string;                     // "HH:mm"
  utcStart: Date;                   // absolute date for this slot
  entries: SlotEntry[];             // EVERY appointment/block covering this row (several doctors can share one time)
  walkIns: Appointment[];           // walk-ins whose real check-in time falls inside this row (never spill into later rows)
  isPast: boolean;                  // slot is in the past
  isBreak: boolean;                 // falls inside the clinic's break window
};

const apptDoctorId = (a: Appointment): string => (typeof a.doctorId === "string" ? a.doctorId : a.doctorId?._id ?? "");

// Dentistry-only section of the visit modal — loaded on demand, so other specialties never download it.
const VisitDentalSection = dynamic(() => import("@/components/dental/treatment/VisitDentalSection"), { ssr: false });

export default function AppointmentsPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();

  // ==== Day selection ====
  const [date, setDate] = useState(todayLocal());
  const [docFilter, setDocFilter] = useState("all");
  const [creating, setCreating] = useState(false);
  const [creatingAt, setCreatingAt] = useState<string | null>(null); // pre-fill time
  const [walkInMode, setWalkInMode] = useState(false); // opened via "Add Walk-in" instead of "New appointment"
  const [editing, setEditing] = useState<Appointment | null>(null);

  // `date` ("YYYY-MM-DD" on the CLINIC's calendar) is the ONE source of truth for the schedule: the title, the
  // working-hours lookup, the query below and the timeline all derive from it. Pure calendar arithmetic, so
  // month/year rollover and DST can never skip or repeat a day.
  const shiftDay = (delta: number) => setDate((d) => addDaysYmd(d, delta));

  // ==== Data ====
  // One request per day, for ALL doctors. The doctor filter is applied client-side to this same cached list, so
  // switching doctors never refetches, never shows another day's data and never flashes a loading state.
  const {
    data: appointments,
    isLoading: apptsLoading,
    isError: apptsError,
    refetch: refetchAppts,
  } = useQuery({
    queryKey: ["appointments-day", date],
    queryFn: async () =>
      (await api.get<Appointment[]>(`/appointments?date=${date}`)).data,
    refetchInterval: 5_000,
  });

  // /appointments?appt=<id> — open straight into that visit's modal (e.g. from the Dental Dashboard's "Open Visit"),
  // the same deep-link pattern already used by /invoices?invoice=. Reads today's list (the default `date`), so it
  // only resolves same-day appointments; nothing here changes scheduling or the default view for a plain visit.
  const searchParams = useSearchParams();
  // C4 (Connect "View Appointment"): /appointments?appt=<id>&date=<YYYY-MM-DD> jumps to that clinic day first. This only picks which day's schedule
  // to load — the appointment is still looked up in what the normal API returned for THIS user, so a card never reveals a visit the user may not see.
  const deepDate = searchParams.get("appt") ? searchParams.get("date") : null;
  const validDeepDate = deepDate && /^\d{4}-\d{2}-\d{2}$/.test(deepDate) ? deepDate : null;
  useEffect(() => {
    if (validDeepDate) setDate(validDeepDate);
  }, [validDeepDate]);
  const openedAppt = useRef<string | null>(null);
  useEffect(() => {
    const apptParam = searchParams.get("appt");
    if (apptParam && appointments && openedAppt.current !== apptParam) {
      if (validDeepDate && date !== validDeepDate) return; // wait for the requested day's schedule
      openedAppt.current = apptParam; // open it once; closing the modal must not re-open it on the next refresh
      const found = appointments.find((a) => a._id === apptParam);
      if (found) setEditing(found);
      else if (validDeepDate) toast.error(t("share.unavailable"));
    }
  }, [searchParams, appointments, date, validDeepDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // /appointments?schedule=<patientId>&name=&doctor=&note= — "Schedule Next Visit" from a Dental treatment
  // session opens straight into New Appointment with the patient (and doctor/context note) pre-filled. The
  // person still chooses date, time and duration, and every normal scheduling rule still applies.
  const [scheduleFor, setScheduleFor] = useState<{ patientId: string; name: string; doctorId?: string; note?: string } | null>(null);
  useEffect(() => {
    const sp = searchParams.get("schedule");
    if (sp) {
      setScheduleFor({ patientId: sp, name: searchParams.get("name") ?? "", doctorId: searchParams.get("doctor") ?? undefined, note: searchParams.get("note") ?? undefined });
      setCreatingAt(null); setWalkInMode(false); setCreating(true);
    }
  }, [searchParams]);

  const { data: staff, isLoading: staffLoading } = useQuery({
    queryKey: ["staff"],
    queryFn: async () => (await api.get<Staff[]>("/users")).data,
  });

  const { data: clinic, isLoading: clinicLoading } = useQuery({
    queryKey: ["clinic"],
    queryFn: async () => (await api.get<Clinic>("/clinic")).data,
    refetchInterval: 5_000,
    staleTime: 3_000,
  });

  // PHASE 4 — a doctor works on THEIR OWN schedule: the server already returns only their appointments and rejects anyone else's,
  // so the pickers/chips here are limited to themselves too (presentation; the backend is the enforcement).
  const access = useAccess();
  const myId = useAuth((st) => st.user?.id);
  const doctors = (staff ?? []).filter((s) => s.role === "doctor" && s.isActive && (!access.isDoctor || s._id === myId));

  // ==== Working hours for the picked day ====
  const dayInfo = useMemo(() => {
    if (!clinic) return null;
    const dow = weekdayOfYmd(date);
    const wh = clinic.workingHours.find((w) => w.day === dow);
    if (!wh || !wh.isOpen) return { closed: true, wh: null };
    return { closed: false, wh };
  }, [clinic, date]);

  // ==== Appointments that should be on screen for the current doctor filter ====
  // Deduplicated by the appointment's stable id (one record is one appointment, however many grid rows it spans),
  // cancelled ones hidden exactly as before, each with its own minute-of-day interval on the clinic's clock.
  const visibleAppts = useMemo(() => {
    const byId = new Map<string, { appt: Appointment; start: number; end: number; doctorIdx: number }>();
    for (const a of appointments ?? []) {
      if (a.status === "cancelled") continue;
      const did = apptDoctorId(a);
      if (docFilter !== "all" && did !== docFilter) continue;
      if (byId.has(a._id)) continue;
      const start = timeToMinutes(fmtTime(a.startAt));
      byId.set(a._id, { appt: a, start, end: start + a.duration, doctorIdx: doctors.findIndex((d) => d._id === did) });
    }
    // Stable, predictable order: by start time, then by the doctor's position in the doctor list, then by id.
    return Array.from(byId.values()).sort(
      (x, y) => x.start - y.start || x.doctorIdx - y.doctorIdx || (x.appt._id < y.appt._id ? -1 : 1)
    );
  }, [appointments, docFilter, staff]);

  // PHASE 3.5 — Walk-ins are visit records at an exact check-in instant, NOT reservations of a slot: they are kept out of
  // the interval/overlap layout (so one can never turn the next row into a "Continued" ghost or hide a real
  // appointment) and are drawn on the row that contains their check-in time, labelled with that exact time.
  const scheduledAppts = useMemo(() => visibleAppts.filter((iv) => iv.appt.source !== "walk_in"), [visibleAppts]);
  const walkInAppts = useMemo(() => visibleAppts.filter((iv) => iv.appt.source === "walk_in"), [visibleAppts]);

  // ==== Build the timeline: one row per slotDuration between open and close ====
  // A row holds EVERY appointment/block that covers it (`entries`), so two doctors booked at 10:00 are both
  // present on the 10:00 row. An appointment is a full card on the first row it touches and a "continued" marker on
  // later rows — it is never counted or drawn as a new appointment again.
  const timeline = useMemo((): SlotVisual[] => {
    if (!clinic || !dayInfo || dayInfo.closed || !dayInfo.wh) return [];
    const wh = dayInfo.wh;
    const openM = timeToMinutes(wh.from);
    const closeM = timeToMinutes(wh.to, { endOfDay: true });
    const step = clinic.slotDuration || 30;

    // Optional break window (e.g. lunch break)
    let breakStart = -1;
    let breakEnd = -1;
    if (wh.breakFrom && wh.breakTo) {
      breakStart = timeToMinutes(wh.breakFrom);
      breakEnd = timeToMinutes(wh.breakTo);
    }

    const rows: SlotVisual[] = [];
    const nowMs = Date.now();
    const placed = new Set<string>(); // appointments that already got their full card on an earlier row

    for (let m = openM; m + step <= closeM; m += step) {
      const h = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(m % 60).padStart(2, "0");
      const time = `${h}:${mm}`;
      // The row's absolute instant = this wall-clock time on the CLINIC's calendar (not the browser's)
      const utcStart = clinicLocalToUtc(date, time);

      // Every appointment whose interval covers this grid cell — not only one starting exactly here.
      const entries: SlotEntry[] = scheduledAppts
        .filter((iv) => intervalsOverlap(m, m + step, iv.start, iv.end))
        .map((iv) => ({ appt: iv.appt, isContinuation: placed.has(iv.appt._id) }));
      for (const e of entries) placed.add(e.appt._id);
      // New cards first, continuation markers after them (the order within each group is already stable).
      entries.sort((a, b) => Number(a.isContinuation) - Number(b.isContinuation));

      // Walk-ins checked in during this row [m, m+step), oldest first (visibleAppts is already ordered by start time).
      const walkIns = walkInAppts.filter((iv) => iv.start >= m && iv.start < m + step).map((iv) => iv.appt);

      rows.push({
        time,
        utcStart,
        entries,
        walkIns,
        isPast: utcStart.getTime() < nowMs,
        isBreak: breakStart !== -1 && intervalsOverlap(m, m + step, breakStart, breakEnd),
      });
    }
    return rows;
  }, [clinic, dayInfo, date, scheduledAppts, walkInAppts]);

  // Appointments that fall on no grid row (e.g. a walk-in recorded after closing time, or the day was later marked
  // closed). They must stay visible — nothing may silently disappear from the schedule.
  const outsideHours = useMemo(() => {
    const placedIds = new Set(timeline.flatMap((r) => [...r.entries.map((e) => e.appt._id), ...r.walkIns.map((w) => w._id)]));
    return visibleAppts.filter((iv) => !placedIds.has(iv.appt._id)).map((iv) => iv.appt);
  }, [timeline, visibleAppts]);

  // ==== Doctor color mapping ====
  const palette = ["#4FC3B8", "#6FBDF5", "#F5B36F", "#C8A2F5", "#F58FA4", "#B9E68C"];
  const docColor = (id: string) => {
    const idx = doctors.findIndex((d) => d._id === id);
    return palette[idx % palette.length] || "#6FBDF5";
  };

  // ==== Stats for the header ====
  // "Booked" counts UNIQUE appointment records (a 90-minute appointment is 1, not one per 30-minute cell).
  // "Available" is still slot-based: grid rows with nothing on them that are not already in the past.
  const stats = useMemo(() => {
    const total = timeline.length;
    const booked = scheduledAppts.length; // walk-ins are counted separately — they don't reserve a slot
    const walkIns = walkInAppts.length;
    const bookedRows = timeline.filter((r) => r.entries.length > 0).length;
    const past = timeline.filter((r) => r.isPast).length;
    const available = total - bookedRows - past + timeline.filter((r) => r.entries.length > 0 && r.isPast).length;
    const pending = (appointments ?? []).filter(
      (a) => a.source === "public" && a.status === "scheduled"
    ).length;
    return { total, booked, walkIns, available: Math.max(0, available), pending };
  }, [timeline, scheduledAppts, walkInAppts, appointments]);

  const dayNames = lang === "ar" ? AR_DAYS : EN_DAYS;
  const { y: dayYear, d: dayOfMonth } = parseYmd(date);
  // Year is shown only when it differs from the current one, so jumping to next January is unambiguous.
  const dayLabel = `${dayNames[weekdayOfYmd(date)]} · ${dayOfMonth} ${fmtCalendarDate(date, lang, { month: "long" })}${
    dayYear !== parseYmd(todayLocal()).y ? ` · ${dayYear}` : ""
  }`;
  const isToday = date === todayLocal();
  // Nothing about the day is known until the clinic, the doctors and this day's appointments have all loaded —
  // until then the schedule shows skeleton rows instead of a misleading "everything is free".
  const scheduleLoading = apptsLoading || clinicLoading || staffLoading;

  return (
    <div>
      {/* ============ Header ============ */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-medium text-ink">{t("nav.appointments")}</h1>
        {stats.pending > 0 && (
          <span className="relative rounded-full bg-amber-500/20 px-2.5 py-1 text-[10px] font-medium text-amber-400">
            <span className="absolute -start-1 -top-1 flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
            </span>
            <IconAlertCircle size={10} className="me-1 inline" />
            {stats.pending} {t("ap.pendingCount")}
          </span>
        )}

        <div className="ms-auto flex flex-wrap items-center gap-1.5">
          {/* Date navigation: previous day · click the date to open the calendar · next day · jump back to today */}
          <button
            onClick={() => shiftDay(-1)}
            className="rounded-lg border border-edge bg-card p-1.5 text-mute transition-colors hover:border-sky hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky/60"
            title={t("ap.prevDay")}
            aria-label={t("ap.prevDay")}
          >
            <IconChevronLeft size={14} className="rtl-flip" />
          </button>
          <DatePickerPopover
            value={date}
            onChange={setDate}
            today={todayLocal()}
            lang={lang === "ar" ? "ar" : "en"}
            t={t}
            triggerClassName="flex min-w-[10.5rem] items-center justify-center gap-1.5 rounded-lg border border-edge bg-card px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:border-sky"
          >
            <IconCalendarEvent size={13} className="shrink-0 text-sky" />
            <span dir="auto" className="whitespace-nowrap">
              {fmtCalendarDate(date, lang === "ar" ? "ar" : "en", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
            </span>
            <IconChevronDown size={12} className="shrink-0 text-mute" />
          </DatePickerPopover>
          <button
            onClick={() => shiftDay(1)}
            className="rounded-lg border border-edge bg-card p-1.5 text-mute transition-colors hover:border-sky hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky/60"
            title={t("ap.nextDay")}
            aria-label={t("ap.nextDay")}
          >
            <IconChevronRight size={14} className="rtl-flip" />
          </button>
          {/* Always rendered (disabled when already on today) so the header never shifts sideways when the date changes */}
          <button
            onClick={() => setDate(todayLocal())}
            disabled={isToday}
            className="rounded-lg border border-blue bg-blue/10 px-2.5 py-1.5 text-[11px] text-sky transition-colors hover:bg-blue/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky/60 disabled:cursor-default disabled:border-edge disabled:bg-transparent disabled:text-mute disabled:opacity-60 disabled:hover:bg-transparent"
          >
            <IconCalendarEvent size={11} className="me-1 inline" />
            {t("ap.today")}
          </button>
          <button
            onClick={() => {
              setCreatingAt(null);
              setWalkInMode(false);
              setCreating(true);
            }}
            className="btn-teal ms-2 !py-2 text-xs"
          >
            <IconPlus size={14} /> {t("dash.new")}
          </button>
          <button
            onClick={() => {
              setCreatingAt(null);
              setWalkInMode(true);
              setCreating(true);
            }}
            className="btn-ghost !py-2 text-xs"
          >
            <IconDoorEnter size={14} /> {t("ap.addWalkIn")}
          </button>
        </div>
      </div>

      {/* ============ Day title & stats card ============ */}
      <div className="mb-3 flex items-center justify-between rounded-xl border border-edge bg-card p-4">
        <div className="min-w-0">
          <div className="text-[10px] tracking-widest text-mute">{isToday ? t("ap.today").toUpperCase() : ""}</div>
          <div className="text-base font-medium text-ink">{dayLabel}</div>
        </div>
        {!dayInfo?.closed && dayInfo?.wh && (
          <div className="flex min-w-0 flex-wrap justify-end gap-x-4 gap-y-1 text-center">
            <div>
              <div className="text-xs font-medium text-teal">{scheduleLoading ? "—" : stats.available}</div>
              <div className="text-[9px] tracking-widest text-mute">{t("ap.stats.available")}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-blue">{scheduleLoading ? "—" : stats.booked}</div>
              <div className="text-[9px] tracking-widest text-mute">{t("ap.stats.booked")}</div>
            </div>
            {!scheduleLoading && stats.walkIns > 0 && (
              <div data-testid="stat-walkins">
                <div className="text-xs font-medium text-sky">{stats.walkIns}</div>
                <div className="text-[9px] tracking-widest text-mute">{t("ap.stats.walkIns")}</div>
              </div>
            )}
            <div>
              <div className="text-xs font-medium text-mute" dir="ltr">
                {dayInfo.wh.from}–{dayInfo.wh.to}
              </div>
              <div className="text-[9px] tracking-widest text-mute">{t("ap.stats.hours")}</div>
            </div>
          </div>
        )}
      </div>

      {/* ============ Doctor filter chips ============ */}
      {access.isDoctor && <div className="mb-3 text-[10px] text-mute">{t("md.ap.mine")}</div>}
      {doctors.length > 0 && !access.isDoctor && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setDocFilter("all")}
            className={`rounded-full border px-3 py-1 text-[11px] ${
              docFilter === "all" ? "border-blue bg-blue text-white" : "border-edge bg-card text-mute"
            }`}
          >
            {t("ap.allDoctors")}
          </button>
          {doctors.map((d) => (
            <button
              key={d._id}
              onClick={() => setDocFilter(d._id)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] ${
                docFilter === d._id ? "border-blue bg-blue text-white" : "border-edge bg-card text-mute"
              }`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: docColor(d._id) }} />
              {d.name}
            </button>
          ))}
        </div>
      )}

      {/* ============ Timeline (main content) ============ */}
      {scheduleLoading ? (
        // Same footprint as the real schedule, so nothing jumps when the data arrives — and no false "all free" day.
        <div className="card overflow-hidden" aria-busy="true">
          <div className="h-[34px] border-b border-edge bg-card2" />
          <div className="px-4 py-1">
            <SkeletonList rows={8} />
          </div>
        </div>
      ) : apptsError && !appointments ? (
        <div className="card flex flex-col items-center py-14 text-center" role="alert">
          <IconAlertCircle size={28} className="mb-3 text-amber-400" />
          <p className="text-sm font-medium text-ink">{t("ap.loadError")}</p>
          <button onClick={() => refetchAppts()} className="btn-ghost mt-3 !py-1.5 text-xs">
            {t("ap.retry")}
          </button>
        </div>
      ) : dayInfo?.closed ? (
        <>
          <ClosedDayEmptyState />
          {outsideHours.length > 0 && (
            <OutsideHoursList appts={outsideHours} doctors={doctors} docColor={docColor} onEdit={setEditing} t={t} />
          )}
        </>
      ) : !doctors.length ? (
        <NoDoctorsEmptyState />
      ) : (
        <div className="card overflow-hidden">
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-edge bg-card2 px-4 py-2 text-[9px] text-mute">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-teal" /> {t("ap.legend.available")}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-blue" /> {t("ap.legend.booked")}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-mute/40" /> {t("ap.legend.past")}
            </span>
            <span className="ms-auto flex items-center gap-1">
              <IconClock size={10} />
              {t("ap.step")}: {clinic?.slotDuration || 30} {t("ap.min")}
            </span>
          </div>

          {/* Rows — keyed by the day so a date change replays the soft fade-in, never a layout jump */}
          <div key={date} className="ap-fade max-h-[calc(100vh-320px)] overflow-y-auto">
            {timeline.map((row, i) => (
              <Fragment key={i}>
                {/* A row that holds only walk-ins is drawn by WalkInRow itself (no "Past"/"Available" filler under it). */}
                {(row.entries.length > 0 || row.walkIns.length === 0) && (
                  <TimelineRow
                    row={row}
                    doctors={doctors}
                    docColor={docColor}
                    onCreate={(time) => {
                      setCreatingAt(time);
                      setCreating(true);
                    }}
                    onEdit={setEditing}
                    t={t}
                  />
                )}
                {row.walkIns.length > 0 && (
                  <WalkInRow time={row.time} walkIns={row.walkIns} showTime={row.entries.length === 0} isPast={row.isPast} doctors={doctors} docColor={docColor} onEdit={setEditing} t={t} />
                )}
              </Fragment>
            ))}
          </div>
          {outsideHours.length > 0 && (
            <OutsideHoursList appts={outsideHours} doctors={doctors} docColor={docColor} onEdit={setEditing} t={t} embedded />
          )}
        </div>
      )}

      {creating && clinic && scheduleFor ? (
        <NewAppointmentModal
          doctors={doctors}
          clinic={clinic}
          initialDate={date}
          initialTime={null}
          initialPatientId={scheduleFor.patientId}
          initialPatientName={scheduleFor.name}
          initialDoctorId={scheduleFor.doctorId}
          initialVisitType={scheduleFor.note ? "procedure" : undefined}
          initialProcedureNote={scheduleFor.note}
          onClose={() => { setCreating(false); setScheduleFor(null); }}
          onDone={() => { setCreating(false); setScheduleFor(null); qc.invalidateQueries({ queryKey: ["appointments-day"] }); }}
        />
      ) : creating && clinic && (
        <NewAppointmentModal
          doctors={doctors}
          clinic={clinic}
          initialDate={walkInMode ? todayLocal() : date}
          initialTime={creatingAt}
          isWalkIn={walkInMode}
          onClose={() => {
            setCreating(false);
            setCreatingAt(null);
            setWalkInMode(false);
          }}
          onDone={() => {
            // A walk-in is always registered for TODAY: if the board is showing another day, bring the user to today so
            // the record they just created is visibly there (nothing "disappears" onto a day they aren't looking at).
            if (walkInMode) setDate(todayLocal());
            qc.invalidateQueries({ queryKey: ["appointments-day"] });
            setCreating(false);
            setCreatingAt(null);
            setWalkInMode(false);
          }}
        />
      )}
      {editing && clinic && (
        <EditAppointmentModal
          appointment={editing}
          doctors={doctors}
          clinic={clinic}
          onClose={() => setEditing(null)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["appointments-day"] });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

// ==================================================================
// Shared pieces for rendering appointments (used by the timeline rows and the
// "outside working hours" list, so both always look and behave the same)
// ==================================================================
type DoctorLike = { _id: string; name: string };

/** Everything a card needs to know about an appointment's people. */
function apptParties(appt: Appointment, doctors: Staff[], docColor: (id: string) => string) {
  const did = apptDoctorId(appt);
  const doctor: DoctorLike | undefined = typeof appt.doctorId === "object" ? appt.doctorId : doctors.find((d) => d._id === did);
  const patient = typeof appt.patientId === "object" ? appt.patientId : null;
  return { doctor, patient, color: docColor(did) };
}

/** "10:00 AM–10:30 AM" on the clinic's clock. */
function apptRange(appt: Appointment): string {
  const end = new Date(new Date(appt.startAt).getTime() + appt.duration * 60_000);
  return `${to12h(fmtTime(appt.startAt))}–${to12h(fmtTime(end))}`;
}

function statusPillClass(appt: Appointment): string {
  const isPending = appt.source === "public" && appt.status === "scheduled";
  return isPending
    ? "bg-amber-500/15 text-amber-400"
    : appt.status === "confirmed"
    ? "bg-teal/15 text-teal"
    : appt.status === "completed"
    ? "bg-mute/15 text-mute"
    : "bg-blue/15 text-sky";
}

/** A full appointment (or blocked-time) card — used whenever several appointments share a row. */
function ApptCard({
  appt,
  doctors,
  docColor,
  onEdit,
  t,
  dim = false,
}: {
  appt: Appointment;
  doctors: Staff[];
  docColor: (id: string) => string;
  onEdit: (a: Appointment) => void;
  t: (k: string) => string;
  dim?: boolean;
}) {
  const { doctor, patient, color } = apptParties(appt, doctors, docColor);
  const isWalkIn = appt.source === "walk_in";
  // A walk-in shows its real check-in time ("10:37 AM"), not a reserved range.
  const range = isWalkIn ? fmtTime12(appt.startAt) : apptRange(appt);
  const base =
    "group flex min-w-0 items-stretch gap-2.5 rounded-lg border border-edge bg-card2 px-2.5 py-2 text-start transition-colors hover:border-sky hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky/60";

  if (appt.type === "blocked") {
    return (
      <button onClick={() => onEdit(appt)} className={`${base} ${dim ? "opacity-60" : ""}`}>
        <span className="w-1 shrink-0 rounded-full bg-mute/40" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[12px] font-medium text-mute">
            <IconLock size={11} /> {t("ap.blockedLabel")}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-mute">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
            <span className="truncate">{doctor?.name}</span>
            <span>·</span>
            <span dir="ltr" className="shrink-0">{range}</span>
          </span>
        </span>
      </button>
    );
  }

  const isPending = appt.source === "public" && appt.status === "scheduled";
  return (
    <button onClick={() => onEdit(appt)} className={`${base} ${dim ? "opacity-60" : ""}`} data-testid="appt-card" data-source={appt.source} data-id={appt._id}>
      <span className="w-1 shrink-0 rounded-full" style={{ background: color }} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[12px] font-medium text-ink">{patient?.fullName ?? "—"}</span>
          {appt.visitType === "procedure" && (
            <span className="pill shrink-0 bg-purple-500/15 text-[8px] text-purple-300">{t("visit.procedureBadge")}</span>
          )}
          {appt.source === "walk_in" && (
            <span className="pill shrink-0 bg-sky/15 text-[8px] text-sky">{t("ap.walkInBadge")}</span>
          )}
          {isPending && (
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
            </span>
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-mute">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
          <span className="truncate font-medium text-ink/80">{doctor?.name}</span>
          <span>·</span>
          <span dir="ltr" className="shrink-0">{range}</span>
        </span>
      </span>
      <span className={`pill h-fit shrink-0 text-[9px] ${statusPillClass(appt)}`}>{statusLabel(appt, t)}</span>
    </button>
  );
}

/** A walk-in that has not been seen yet is "Waiting" — a display label over the existing `scheduled` status (no new status). */
function statusLabel(appt: Appointment, t: (k: string) => string): string {
  return appt.source === "walk_in" && appt.status === "scheduled" ? t("ap.walkInWaiting") : t(`status.${appt.status}`);
}

/**
 * Walk-ins checked in during one grid row. Each shows its exact check-in time; several can sit side by side. They are
 * visit records, so they never reserve the row (the row's own availability is drawn by TimelineRow, untouched).
 */
function WalkInRow({
  time, walkIns, showTime, isPast, doctors, docColor, onEdit, t,
}: {
  time: string;
  walkIns: Appointment[];
  showTime: boolean;
  isPast: boolean;
  doctors: Staff[];
  docColor: (id: string) => string;
  onEdit: (a: Appointment) => void;
  t: (k: string) => string;
}) {
  return (
    <div data-testid="walkin-row" className="flex items-start gap-3 border-b border-edge px-4 py-2.5">
      <div className="w-14 shrink-0 pt-2 font-mono text-[11px] font-medium text-ink">{showTime ? to12h(time) : ""}</div>
      <div className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-1.5">
        {walkIns.map((a) => (
          <ApptCard key={a._id} appt={a} doctors={doctors} docColor={docColor} onEdit={onEdit} t={t} dim={isPast && a.status === "completed"} />
        ))}
      </div>
    </div>
  );
}

/** Lightweight marker for the rows a longer appointment continues through (the card lives on its first row). */
function ContinuedChip({
  appt,
  doctors,
  docColor,
  onEdit,
  t,
}: {
  appt: Appointment;
  doctors: Staff[];
  docColor: (id: string) => string;
  onEdit: (a: Appointment) => void;
  t: (k: string) => string;
}) {
  const { doctor, patient, color } = apptParties(appt, doctors, docColor);
  const label = appt.type === "blocked" ? t("ap.blockedLabel") : patient?.fullName ?? doctor?.name ?? "—";
  return (
    <button
      onClick={() => onEdit(appt)}
      className="flex min-w-0 items-center gap-2 rounded-lg border border-dashed border-edge px-2.5 py-1.5 text-start transition-colors hover:border-sky hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky/60"
    >
      <span className="h-4 w-1 shrink-0 rounded-full opacity-40" style={{ background: color }} />
      <span className="truncate text-[10px] italic text-mute">
        {t("ap.rowContinued")} · {label}
        {doctor?.name && appt.type !== "blocked" ? ` · ${doctor.name}` : ""}
      </span>
    </button>
  );
}

// ==================================================================
// One row of the timeline — clearly shows availability at that time.
// A row can hold SEVERAL appointments (different doctors at the same time).
// ==================================================================
function TimelineRow({
  row,
  doctors,
  docColor,
  onCreate,
  onEdit,
  t,
}: {
  row: SlotVisual;
  doctors: Staff[];
  docColor: (id: string) => string;
  onCreate: (time: string) => void;
  onEdit: (a: Appointment) => void;
  t: (k: string) => string;
}) {
  const { time, entries, isPast, isBreak } = row;

  // ---- Several appointments share this row: a responsive grid of cards, every one clickable ----
  if (entries.length > 1) {
    return (
      <div className="flex items-start gap-3 border-b border-edge px-4 py-2.5">
        <div className="w-14 shrink-0 pt-2 font-mono text-[11px] font-medium text-ink">{to12h(time)}</div>
        <div className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-1.5">
          {entries.map((e) =>
            e.isContinuation ? (
              <ContinuedChip key={e.appt._id} appt={e.appt} doctors={doctors} docColor={docColor} onEdit={onEdit} t={t} />
            ) : (
              <ApptCard key={e.appt._id} appt={e.appt} doctors={doctors} docColor={docColor} onEdit={onEdit} t={t} dim={isPast} />
            )
          )}
        </div>
      </div>
    );
  }

  const single = entries[0];
  const appt = single?.appt;

  // Continuation row — this grid cell belongs to a longer appointment whose card is on an earlier row.
  // Show it's occupied without duplicating the patient card — clicking still opens the same appointment.
  if (appt && single.isContinuation) {
    const { doctor, patient, color } = apptParties(appt, doctors, docColor);
    const label = appt.type === "blocked" ? t("ap.blockedLabel") : patient?.fullName ?? doctor?.name ?? "—";

    return (
      <button
        onClick={() => onEdit(appt)}
        className={`flex w-full items-center gap-3 border-b border-edge px-4 py-2 text-start transition-colors hover:bg-soft ${
          isPast ? "opacity-60" : ""
        }`}
      >
        <div className="w-14 font-mono text-[11px] text-mute">{to12h(time)}</div>
        <div className="h-6 w-1 rounded-full opacity-40" style={{ background: color }} />
        <span className="flex items-center gap-1 text-[10px] italic text-mute">
          {t("ap.rowContinued")} · {label}
        </span>
      </button>
    );
  }

  // Booked row
  if (appt) {
    const { doctor, patient, color } = apptParties(appt, doctors, docColor);

    // Blocked row — the doctor reserved this slot for themselves, no patient involved
    if (appt.type === "blocked") {
      return (
        <button
          onClick={() => onEdit(appt)}
          className={`flex w-full items-center gap-3 border-b border-edge px-4 py-2.5 text-start transition-colors hover:bg-soft ${
            isPast ? "opacity-60" : ""
          }`}
        >
          <div className="w-14 font-mono text-[11px] font-medium text-ink">{to12h(time)}</div>
          <div className="h-8 w-1 rounded-full bg-mute/40" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[12px] font-medium text-mute">
              <IconLock size={11} /> {t("ap.blockedLabel")}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-mute">
              <span>{doctor?.name}</span>
              {appt.blockNote && (
                <>
                  <span>·</span>
                  <span className="truncate">{appt.blockNote}</span>
                </>
              )}
            </div>
          </div>
        </button>
      );
    }

    const isPending = appt.source === "public" && appt.status === "scheduled";

    return (
      <button
        onClick={() => onEdit(appt)}
        className={`flex w-full items-center gap-3 border-b border-edge px-4 py-2.5 text-start transition-colors hover:bg-soft ${
          isPast ? "opacity-60" : ""
        }`}
      >
        <div className="w-14 font-mono text-[11px] font-medium text-ink">{to12h(time)}</div>
        <div
          className="h-8 w-1 rounded-full"
          style={{ background: color }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12px] font-medium text-ink">
              {patient?.fullName ?? "—"}
            </span>
            {appt.visitType === "procedure" && (
              <span className="pill shrink-0 bg-purple-500/15 text-[8px] text-purple-300">
                {t("visit.procedureBadge")}
              </span>
            )}
            {appt.source === "walk_in" && (
              <span className="pill shrink-0 bg-sky/15 text-[8px] text-sky">
                {t("ap.walkInBadge")}
              </span>
            )}
            {isPending && (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-mute">
            <span>{doctor?.name}</span>
            {patient?.phone && (
              <>
                <span>·</span>
                <span dir="ltr">{patient.phone}</span>
              </>
            )}
            {appt.visitType === "procedure" && appt.procedureNote && (
              <>
                <span>·</span>
                <span className="truncate">{appt.procedureNote}</span>
              </>
            )}
          </div>
        </div>
        <span className={`pill text-[9px] ${statusPillClass(appt)}`}>
          {t(`status.${appt.status}`)}
        </span>
      </button>
    );
  }

  // Past empty row
  if (isPast) {
    return (
      <div className="flex items-center gap-3 border-b border-edge px-4 py-2 opacity-40">
        <div className="w-14 font-mono text-[11px] text-mute">{to12h(time)}</div>
        <div className="h-6 w-1 rounded-full bg-mute/30" />
        <span className="text-[10px] italic text-mute">{t("ap.rowPast")}</span>
      </div>
    );
  }

  // Break row — clinic is unavailable at this time, not because it's booked
  if (isBreak) {
    return (
      <div className="flex items-center gap-3 border-b border-edge px-4 py-2 opacity-70">
        <div className="w-14 font-mono text-[11px] text-amber-500/80">{to12h(time)}</div>
        <div className="h-6 w-1 rounded-full bg-amber-500/30" />
        <span className="flex items-center gap-1 text-[10px] italic text-amber-500/80">
          <IconCoffee size={11} /> {t("ap.rowBreak")}
        </span>
      </div>
    );
  }

  // Available row
  return (
    <button
      onClick={() => onCreate(time)}
      className="group flex w-full items-center gap-3 border-b border-edge px-4 py-2 text-start transition-colors hover:bg-teal/5"
    >
      <div className="w-14 font-mono text-[11px] text-mute group-hover:text-teal">{to12h(time)}</div>
      <div className="h-6 w-1 rounded-full bg-teal/30 group-hover:bg-teal" />
      <span className="text-[10px] text-mute group-hover:text-teal">{t("ap.rowAvailable")}</span>
      <IconPlus size={11} className="ms-auto text-mute opacity-0 group-hover:opacity-100" />
    </button>
  );
}

/** Appointments that fall outside the day's grid (after closing, on a day later marked closed…) — never hidden. */
function OutsideHoursList({
  appts,
  doctors,
  docColor,
  onEdit,
  t,
  embedded = false,
}: {
  appts: Appointment[];
  doctors: Staff[];
  docColor: (id: string) => string;
  onEdit: (a: Appointment) => void;
  t: (k: string) => string;
  embedded?: boolean;
}) {
  return (
    <div className={embedded ? "border-t border-edge" : "card mt-3 overflow-hidden"}>
      <div className="flex items-center gap-1.5 bg-card2 px-4 py-2 text-[9px] tracking-widest text-mute">
        <IconClock size={10} />
        {t("ap.outsideHours").toUpperCase()}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-1.5 px-4 py-2.5">
        {appts.map((a) => (
          <ApptCard key={a._id} appt={a} doctors={doctors} docColor={docColor} onEdit={onEdit} t={t} />
        ))}
      </div>
    </div>
  );
}

function ClosedDayEmptyState() {
  const { t } = useI18n();
  return (
    <div className="card flex flex-col items-center py-16 text-center">
      <IconInfoCircle size={30} className="mb-3 text-mute" />
      <p className="text-sm font-medium text-ink">{t("ap.dayClosed")}</p>
      <p className="mt-1 text-[11px] text-mute">{t("ap.dayClosedSub")}</p>
    </div>
  );
}

function NoDoctorsEmptyState() {
  const { t } = useI18n();
  return (
    <div className="card flex flex-col items-center py-16 text-center">
      <IconUserCircle size={30} className="mb-3 text-mute" />
      <p className="text-sm font-medium text-ink">{t("ap.noDoctors")}</p>
      <p className="mt-1 text-[11px] text-mute">{t("ap.noDoctorsSub")}</p>
    </div>
  );
}

// ==================================================================
// New appointment modal — uses the smart slot picker
// ==================================================================
function NewAppointmentModal({
  doctors,
  clinic,
  initialDate,
  initialTime,
  isWalkIn = false,
  initialPatientId,
  initialPatientName,
  initialDoctorId,
  initialVisitType,
  initialProcedureNote,
  onClose,
  onDone,
}: {
  doctors: Staff[];
  clinic: Clinic;
  initialDate: string;
  initialTime: string | null;
  isWalkIn?: boolean;
  // Pre-fill for "Schedule Next Visit" (Dental) — the user still picks date/time/duration and confirms; all
  // normal scheduling rules (working hours, overlap, availability) still run exactly as for any other booking.
  initialPatientId?: string;
  initialPatientName?: string;
  initialDoctorId?: string;
  initialVisitType?: "consultation" | "procedure";
  initialProcedureNote?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<"appointment" | "block">("appointment");
  const [search, setSearch] = useState(initialPatientName ?? "");
  const [patientId, setPatientId] = useState(initialPatientId ?? "");
  // A walk-in is attributed to a REAL doctor reference. With several doctors nobody is silently pre-picked (that would
  // mis-attribute the visit); with a single doctor the choice is obvious and pre-filled.
  const [doctorId, setDoctorId] = useState(initialDoctorId ?? (isWalkIn ? (doctors.length === 1 ? doctors[0]._id : "") : doctors[0]?._id ?? ""));
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime || "");
  const [duration, setDuration] = useState(clinic.slotDuration || 30);
  const [blockNote, setBlockNote] = useState("");
  const [visitType, setVisitType] = useState<"consultation" | "procedure">(initialVisitType ?? "consultation");
  const [procedureNote, setProcedureNote] = useState(initialProcedureNote ?? "");
  const [error, setError] = useState("");
  // Walk-in extras: an optional reason for the visit, an idempotency token (one per dialog, so a double click or a retry
  // is the SAME walk-in on the server too), a submit lock, and a live read-out of the check-in time that will be recorded.
  const [reason, setReason] = useState("");
  const requestId = useMemo(() => newRequestId(), []);
  const submitLock = useRef(false);
  const [nowLabel, setNowLabel] = useState(() => fmtTime12(new Date()));
  useEffect(() => {
    if (!isWalkIn) return;
    const id = setInterval(() => setNowLabel(fmtTime12(new Date())), 15_000);
    return () => clearInterval(id);
  }, [isWalkIn]);

  // Quick "register a new patient" — for a walk-in (or any) patient who
  // isn't in the system yet, without leaving this modal.
  const [addingPatient, setAddingPatient] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newPatientError, setNewPatientError] = useState("");

  const { data: patients } = useQuery({
    queryKey: ["patients-pick", search],
    queryFn: async () =>
      (
        await api.get<{ patients: Patient[] }>(
          `/patients?search=${encodeURIComponent(search)}`
        )
      ).data.patients,
  });

  const createPatient = useMutation({
    mutationFn: async () =>
      (
        await api.post<Patient>("/patients", {
          fullName: newName.trim(),
          phone: newPhone.trim(),
        })
      ).data,
    onSuccess: (p) => {
      setPatientId(p._id);
      setSearch(p.fullName);
      setAddingPatient(false);
      setNewName("");
      setNewPhone("");
      setNewPatientError("");
      qc.invalidateQueries({ queryKey: ["patients-pick"] });
      qc.invalidateQueries({ queryKey: ["patients"] });
    },
    onError: (e) => setNewPatientError(errMsg(e, t("common.error"))),
  });

  const { data: dayAppts } = useQuery({
    queryKey: ["appts-for-day-modal", doctorId, date],
    queryFn: async () =>
      (
        await api.get<Appointment[]>(
          `/appointments?doctorId=${doctorId}&date=${date}`
        )
      ).data,
    enabled: !isWalkIn && !!doctorId && !!date, // a walk-in never picks a slot, so it needs no availability data
    refetchInterval: 5_000,
  });

  const slots = useMemo(() => {
    if (isWalkIn || !doctorId || !date) return { list: [], closed: false };
    return computeSlots(clinic, date, duration, dayAppts ?? [], doctors.find((d) => d._id === doctorId));
  }, [isWalkIn, doctorId, date, clinic, dayAppts, duration, doctors]);

  const create = useMutation({
    mutationFn: async () => {
      if (isWalkIn) {
        // No date, no time, no duration: the SERVER stamps the real check-in instant (and verifies the patient/doctor
        // belong to this clinic). `requestId` makes a double click / retry resolve to the same record.
        return (
          await api.post<Appointment>("/appointments", {
            patientId,
            doctorId,
            source: "walk_in",
            visitType,
            procedureNote: visitType === "procedure" ? procedureNote.trim() : undefined,
            reason: reason.trim() || undefined,
            requestId,
          })
        ).data;
      }
      const startAt = combineToUTC(date, time);
      await api.post("/appointments", {
        patientId,
        doctorId,
        startAt,
        duration,
        visitType,
        procedureNote: visitType === "procedure" ? procedureNote.trim() : undefined,
      });
      return null;
    },
    onSuccess: (created) => {
      if (isWalkIn && created) {
        toast.success(t("ap.walkInRegistered"), `${t("ap.walkInRegisteredAt")} ${fmtTime12(created.startAt)}`);
        onDone();
        return;
      }
      // The Timeline only shows ONE day — if this appointment was booked
      // for a different date than the one currently in view, closing the
      // modal changes nothing visible on screen. Without this, there is no
      // confirmation at all that the booking succeeded.
      toast.success(t("tst.savedTitle"), t("tst.savedBody"));
      onDone();
    },
    onError: (e) => setError(errMsg(e, isWalkIn ? t("common.error") : t("ap.taken"))),
    onSettled: () => { submitLock.current = false; },
  });

  const createBlock = useMutation({
    mutationFn: async () => {
      const startAt = combineToUTC(date, time);
      await api.post("/appointments/block", { doctorId, startAt, duration, note: blockNote || undefined });
    },
    onSuccess: () => {
      toast.success(t("tst.savedTitle"), t("tst.savedBody"));
      onDone();
    },
    onError: (e) => setError(errMsg(e, t("ap.taken"))),
  });

  return (
    <Modal
      title={mode === "block" ? t("ap.blockTitle") : isWalkIn ? t("ap.addWalkIn") : t("dash.new")}
      size="lg"
      onClose={onClose}
    >
      {!isWalkIn && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <button
            onClick={() => setMode("appointment")}
            className={`rounded-lg border py-2 text-[11px] font-medium ${
              mode === "appointment" ? "border-blue bg-blue/15 text-sky" : "border-edge bg-card2 text-mute"
            }`}
          >
            {t("ap.modeAppointment")}
          </button>
          <button
            onClick={() => setMode("block")}
            className={`rounded-lg border py-2 text-[11px] font-medium ${
              mode === "block" ? "border-blue bg-blue/15 text-sky" : "border-edge bg-card2 text-mute"
            }`}
          >
            {t("ap.modeBlock")}
          </button>
        </div>
      )}

      {mode === "appointment" ? (
        <>
          <label className="lbl">{t("ap.patient")}</label>
          <input
            className="inp mb-1.5"
            placeholder={t("pt.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="inp mb-1.5"
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
          >
            <option value="">—</option>
            {(patients ?? []).map((p) => (
              <option key={p._id} value={p._id}>
                #{String(p.fileNumber).padStart(4, "0")} · {p.fullName}
              </option>
            ))}
          </select>

          {!addingPatient ? (
            <button
              type="button"
              onClick={() => setAddingPatient(true)}
              className="mb-3 flex items-center gap-1 text-[10px] text-sky hover:underline"
            >
              <IconUserPlus size={12} /> {t("ap.newPatientToggle")}
            </button>
          ) : (
            <div className="mb-3 rounded-lg border border-dashed border-sky/40 bg-soft p-2.5">
              <div className="mb-2 grid grid-cols-2 gap-2">
                <input
                  dir="auto"
                  className="inp"
                  placeholder={t("pt.name")}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <input
                  className="inp"
                  placeholder={t("pt.phone")}
                  dir="ltr"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                />
              </div>
              {newPatientError && <p className="mb-2 text-[10px] text-red-400">{newPatientError}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => createPatient.mutate()}
                  disabled={newName.trim().length < 2 || newPhone.trim().length < 7 || createPatient.isPending}
                  className="btn-teal !py-1.5 text-[10px]"
                >
                  {createPatient.isPending ? t("common.loading") : t("ap.registerPatient")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddingPatient(false);
                    setNewPatientError("");
                  }}
                  className="btn-ghost !py-1.5 text-[10px]"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          )}

          <label className="lbl">{t("visit.type")}</label>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setVisitType("consultation")}
              className={`rounded-lg border py-2 text-[11px] font-medium ${
                visitType === "consultation" ? "border-blue bg-blue/15 text-sky" : "border-edge bg-card2 text-mute"
              }`}
            >
              {t("visit.consultation")}
            </button>
            <button
              type="button"
              onClick={() => setVisitType("procedure")}
              className={`rounded-lg border py-2 text-[11px] font-medium ${
                visitType === "procedure" ? "border-blue bg-blue/15 text-sky" : "border-edge bg-card2 text-mute"
              }`}
            >
              {t("visit.procedure")}
            </button>
          </div>
          {visitType === "procedure" && (
            <input
              className="inp mb-3"
              placeholder={t("visit.procedureNotePlaceholder")}
              value={procedureNote}
              onChange={(e) => setProcedureNote(e.target.value)}
            />
          )}
        </>
      ) : (
        <>
          <label className="lbl">{t("ap.blockNote")}</label>
          <input
            className="inp mb-3"
            placeholder={t("ap.blockNotePlaceholder")}
            value={blockNote}
            onChange={(e) => setBlockNote(e.target.value)}
          />
        </>
      )}

      <label className="lbl">{t("ap.doctor")}</label>
      {doctors.length === 0 ? (
        <p className="mb-3 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
          {t("ap.noDoctors")}
        </p>
      ) : (
        <select
          className="inp mb-3"
          value={doctorId}
          onChange={(e) => {
            setDoctorId(e.target.value);
            setTime("");
          }}
        >
          {isWalkIn && doctorId === "" && <option value="">{t("ap.walkInPickDoctor")}</option>}
          {doctors.map((d) => (
            <option key={d._id} value={d._id}>
              {d.name}
            </option>
          ))}
        </select>
      )}

      {isWalkIn && (
        <>
          <div data-testid="walkin-checkin" className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-sky/30 bg-sky/5 px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-[9px] tracking-widest text-mute">{t("ap.walkInCheckIn")}</div>
              <div className="text-[10px] text-mute">{t("ap.walkInCheckInHint")}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-sky" dir="ltr">
              <IconClock size={14} /> {nowLabel}
            </div>
          </div>
          <label className="lbl">{t("ap.walkInReason")}</label>
          <input
            dir="auto"
            className="inp mb-3"
            maxLength={300}
            placeholder={t("ap.walkInReasonPh")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </>
      )}

      {!isWalkIn && (
      <>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div>
          <label className="lbl">{t("ap.date")}</label>
          <input
            type="date"
            className="inp"
            value={date}
            min={todayLocal()}
            onChange={(e) => {
              setDate(e.target.value);
              setTime("");
            }}
          />
        </div>
        <div>
          <label className="lbl">{t("ap.duration")}</label>
          <select
            className="inp"
            value={duration}
            onChange={(e) => {
              setDuration(Number(e.target.value));
              setTime("");
            }}
          >
            {[10, 15, 20, 30, 45, 60, 90, 120].map((d) => (
              <option key={d} value={d}>
                {d} {t("ap.min")}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="lbl">{t("ap.time")}</label>
      {slots.closed ? (
        <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-center text-[11px] text-red-400">
          {slots.doctorOff ? t("md.hours.doctorOff") : t("ap.dayClosed")}
        </p>
      ) : slots.list.length === 0 ? (
        <p className="mb-3 py-3 text-center text-[11px] text-mute">{t("common.loading")}</p>
      ) : (
        <div className="mb-3 grid max-h-40 grid-cols-4 gap-1.5 overflow-y-auto" dir="ltr">
          {slots.list.map((s) => (
            <button
              key={s.time}
              disabled={s.taken || s.past || s.isBreak}
              onClick={() => setTime(s.time)}
              className={`rounded-md border py-1.5 text-[11px] font-mono transition-colors ${
                time === s.time
                  ? "border-teal bg-teal text-navy"
                  : s.taken
                  ? "border-red-500/30 bg-red-500/10 text-red-400 opacity-60 line-through"
                  : s.isBreak
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-500/80 opacity-60 line-through"
                  : s.past
                  ? "border-edge bg-card2 text-mute opacity-40"
                  : "border-sky/50 bg-card2 text-blue hover:bg-soft"
              }`}
              title={s.taken ? t("ap.taken") : s.isBreak ? t("ap.rowBreak") : s.past ? t("ap.rowPast") : ""}
            >
              {s.taken && <IconLock size={8} className="me-1 inline" />}
              {s.isBreak && <IconCoffee size={8} className="me-1 inline" />}
              {to12h(s.time)}
            </button>
          ))}
        </div>
      )}

      </>
      )}

      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
      <button
        onClick={() => {
          setError("");
          if (mode === "block") createBlock.mutate();
          else {
            if (submitLock.current) return; // belt and braces with isPending: a second click in the same tick is ignored
            submitLock.current = true;
            create.mutate();
          }
        }}
        data-testid="appt-submit"
        disabled={
          mode === "block"
            ? !doctorId || !time || createBlock.isPending
            : !patientId ||
              !doctorId ||
              (!isWalkIn && !time) ||
              (visitType === "procedure" && procedureNote.trim().length < 2) ||
              create.isPending
        }
        className="btn-blue w-full !py-2.5"
      >
        {mode === "block"
          ? createBlock.isPending
            ? t("common.loading")
            : t("ap.createBlock")
          : create.isPending
          ? t("common.loading")
          : isWalkIn
          ? t("ap.walkInRegister")
          : t("ap.create")}
      </button>
    </Modal>
  );
}

function EditAppointmentModal({
  appointment,
  doctors,
  clinic,
  onClose,
  onDone,
}: {
  appointment: Appointment;
  doctors: Staff[];
  clinic: Clinic;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const selectPatient = useSelectedPatient((s) => s.select);
  const role = useAuth((s) => s.user?.role);
  const [status, setStatus] = useState(appointment.status);
  const [reason, setReason] = useState("");
  const [visitNote, setVisitNote] = useState(appointment.visitNote ?? "");
  const [error, setError] = useState("");

  const patient = typeof appointment.patientId === "object" ? appointment.patientId : null;
  const doctor = typeof appointment.doctorId === "object" ? appointment.doctorId : null;
  const currentDoctorId = typeof appointment.doctorId === "string" ? appointment.doctorId : appointment.doctorId?._id ?? "";
  // PHASE 3.5 — a walk-in's check-in time is a recorded fact: it can't be "rescheduled", but the visit can be (re)assigned
  // to a doctor (a real user reference) at any time.
  const isWalkInAppt = appointment.source === "walk_in" && appointment.type !== "blocked";

  // ==== FIX #6 — reschedule (date/time/duration/doctor). Collapsed by
  // default so a quick status/note edit stays a small form, exactly like
  // before this fix; opening "Reschedule" reveals the same duration-aware,
  // overlap-aware slot grid used by "New appointment". ====
  const [rescheduling, setRescheduling] = useState(false);
  const [editDoctorId, setEditDoctorId] = useState(currentDoctorId);
  const [editDate, setEditDate] = useState(ymd(appointment.startAt));
  const [editTime, setEditTime] = useState(fmtTime(appointment.startAt));
  const [editDuration, setEditDuration] = useState(appointment.duration);

  const { data: dayApptsForEdit } = useQuery({
    queryKey: ["appts-for-day-modal", editDoctorId, editDate],
    queryFn: async () =>
      (await api.get<Appointment[]>(`/appointments?doctorId=${editDoctorId}&date=${editDate}`)).data,
    enabled: rescheduling && !!editDoctorId && !!editDate,
    refetchInterval: 5_000,
  });

  const editSlots = useMemo(() => {
    if (!editDoctorId || !editDate) return { list: [], closed: false };
    // Exclude THIS appointment from the "taken" set — it must never
    // conflict with its own current slot (same rule the backend enforces).
    const others = (dayApptsForEdit ?? []).filter((a) => a._id !== appointment._id);
    return computeSlots(clinic, editDate, editDuration, others, doctors.find((d) => d._id === editDoctorId));
  }, [editDoctorId, editDate, editDuration, clinic, dayApptsForEdit, appointment._id, doctors]);

  const update = useMutation({
    mutationFn: async () => {
      const body: Record<string, string | number> = { status, visitNote: visitNote.trim() };
      if (status === "cancelled" && reason) body.cancelReason = reason;
      if (rescheduling) {
        body.startAt = combineToUTC(editDate, editTime);
        body.duration = editDuration;
        body.doctorId = editDoctorId;
      } else if (isWalkInAppt && editDoctorId && editDoctorId !== currentDoctorId) {
        body.doctorId = editDoctorId;
      }
      await api.patch(`/appointments/${appointment._id}/status`, body);
    },
    onSuccess: () => {
      // A reschedule to a different day/doctor makes this appointment
      // disappear from the Timeline the user is currently looking at —
      // without this, that looks like the edit silently failed.
      toast.success(t("tst.savedTitle"), t("tst.savedBody"));
      onDone();
    },
    onError: (e) => setError(errMsg(e, t("ap.taken"))),
  });

  const openPatientFile = () => {
    if (!patient) return;
    selectPatient(patient);
    router.push("/patients/profile");
  };

  const isPending = appointment.source === "public" && appointment.status === "scheduled";

  return (
    <Modal title={t("ap.details")} size="lg" onClose={onClose}>
      {isPending && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
          <IconAlertCircle size={13} />
          {t("ap.pendingNote")}
        </div>
      )}

      <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-edge bg-card2 p-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-1.5 text-[9px] tracking-widest text-mute">
            {appointment.type === "blocked" ? t("ap.blockedLabel") : t("ap.patient")}
            {appointment.source === "walk_in" && (
              <span className="pill !py-0 bg-sky/15 text-[8px] normal-case tracking-normal text-sky">
                {t("ap.walkInBadge")}
              </span>
            )}
          </div>
          {appointment.type === "blocked" ? (
            <div className="text-sm font-medium text-ink">{appointment.blockNote || t("ap.blockNoNote")}</div>
          ) : (
            <>
              <div className="truncate text-sm font-medium text-ink">{patient?.fullName || "—"}</div>
              {patient?.phone && <div className="text-[10px] text-mute" dir="ltr">{patient.phone}</div>}
            </>
          )}
        </div>
        {appointment.type !== "blocked" && patient && (
          <button
            onClick={openPatientFile}
            className="btn-ghost shrink-0 !py-1.5 !px-2.5 text-[10px]"
          >
            <IconUserCircle size={13} /> {t("ap.openPatientFile")}
          </button>
        )}
      </div>

      {appointment.type !== "blocked" && (
        <div className="mb-3 rounded-lg border border-edge bg-card2 p-3">
          <div className="mb-1 text-[9px] tracking-widest text-mute">{t("visit.type")}</div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-ink">
              {appointment.visitType === "procedure" ? t("visit.procedure") : t("visit.consultation")}
            </span>
          </div>
          {appointment.visitType === "procedure" && appointment.procedureNote && (
            <div className="mt-1 text-[11px] text-mute">{appointment.procedureNote}</div>
          )}
        </div>
      )}

      {!rescheduling ? (
        <div className="mb-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-edge bg-card2 p-2.5">
              <div className="text-[9px] tracking-widest text-mute">{t("ap.doctor")}</div>
              {isWalkInAppt && doctors.length > 0 ? (
                <select
                  data-testid="walkin-doctor"
                  className="inp mt-0.5 !py-1 text-xs"
                  value={editDoctorId}
                  onChange={(e) => setEditDoctorId(e.target.value)}
                >
                  {doctors.map((d) => (
                    <option key={d._id} value={d._id}>{d.name}</option>
                  ))}
                </select>
              ) : (
                <div className="text-xs font-medium text-ink">{doctor?.name || "—"}</div>
              )}
            </div>
            <div className="rounded-lg border border-edge bg-card2 p-2.5">
              <div className="text-[9px] tracking-widest text-mute">{isWalkInAppt ? t("ap.checkedInAt") : t("ap.time")}</div>
              <div className="text-xs font-medium text-ink" dir="ltr" data-testid="appt-time">
                {fmtDate(appointment.startAt, lang === "ar" ? "ar" : "en")}{" "}
                · {fmtTime12(appointment.startAt)}{isWalkInAppt ? "" : ` · ${appointment.duration} ${t("ap.min")}`}
              </div>
            </div>
          </div>
          {!isWalkInAppt && (
            <button
              type="button"
              onClick={() => setRescheduling(true)}
              className="mt-1.5 flex items-center gap-1 text-[10px] text-sky hover:underline"
            >
              <IconClock size={12} /> {t("ap.reschedule")}
            </button>
          )}
        </div>
      ) : (
        <div className="mb-3 rounded-lg border border-dashed border-sky/40 bg-soft p-2.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-medium text-sky">{t("ap.reschedule")}</span>
            <button
              type="button"
              onClick={() => {
                setRescheduling(false);
                setEditDoctorId(currentDoctorId);
                setEditDate(ymd(appointment.startAt));
                setEditTime(fmtTime(appointment.startAt));
                setEditDuration(appointment.duration);
              }}
              className="text-[10px] text-mute hover:text-ink"
            >
              {t("common.cancel")}
            </button>
          </div>

          <label className="lbl">{t("ap.doctor")}</label>
          <select
            className="inp mb-2"
            value={editDoctorId}
            onChange={(e) => {
              setEditDoctorId(e.target.value);
              setEditTime("");
            }}
          >
            {doctors.map((d) => (
              <option key={d._id} value={d._id}>
                {d.name}
              </option>
            ))}
          </select>

          <div className="mb-2 grid grid-cols-2 gap-2">
            <div>
              <label className="lbl">{t("ap.date")}</label>
              <input
                type="date"
                className="inp"
                value={editDate}
                min={todayLocal()}
                onChange={(e) => {
                  setEditDate(e.target.value);
                  setEditTime("");
                }}
              />
            </div>
            <div>
              <label className="lbl">{t("ap.duration")}</label>
              <select
                className="inp"
                value={editDuration}
                onChange={(e) => {
                  setEditDuration(Number(e.target.value));
                  setEditTime("");
                }}
              >
                {[10, 15, 20, 30, 45, 60, 90, 120].map((d) => (
                  <option key={d} value={d}>
                    {d} {t("ap.min")}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="lbl">{t("ap.time")}</label>
          {editSlots.closed ? (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-center text-[11px] text-red-400">
              {editSlots.doctorOff ? t("md.hours.doctorOff") : t("ap.dayClosed")}
            </p>
          ) : editSlots.list.length === 0 ? (
            <p className="py-3 text-center text-[11px] text-mute">{t("common.loading")}</p>
          ) : (
            <div className="grid max-h-40 grid-cols-4 gap-1.5 overflow-y-auto" dir="ltr">
              {editSlots.list.map((s) => (
                <button
                  key={s.time}
                  type="button"
                  disabled={s.taken || s.past || s.isBreak}
                  onClick={() => setEditTime(s.time)}
                  className={`rounded-md border py-1.5 text-[11px] font-mono transition-colors ${
                    editTime === s.time
                      ? "border-teal bg-teal text-navy"
                      : s.taken
                      ? "border-red-500/30 bg-red-500/10 text-red-400 opacity-60 line-through"
                      : s.isBreak
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-500/80 opacity-60 line-through"
                      : s.past
                      ? "border-edge bg-card2 text-mute opacity-40"
                      : "border-sky/50 bg-card2 text-blue hover:bg-soft"
                  }`}
                  title={s.taken ? t("ap.taken") : s.isBreak ? t("ap.rowBreak") : s.past ? t("ap.rowPast") : ""}
                >
                  {s.taken && <IconLock size={8} className="me-1 inline" />}
                  {s.isBreak && <IconCoffee size={8} className="me-1 inline" />}
                  {to12h(s.time)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {appointment.refCode && (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-dashed border-sky/50 bg-soft px-3 py-2">
          <span className="text-[10px] text-mute">{t("bk.ref")}</span>
          <span className="font-mono text-[11px] text-sky">{appointment.refCode}</span>
        </div>
      )}

      {appointment.type !== "blocked" && (
        <>
          <label className="lbl">{t("ap.visitNote")}</label>
          <textarea
            dir="auto"
            className="inp mb-3 min-h-20"
            placeholder={t("ap.visitNotePlaceholder")}
            value={visitNote}
            maxLength={1000}
            onChange={(e) => setVisitNote(e.target.value)}
          />
        </>
      )}

      {/* Dentistry only, real visits only (never a blocked slot). Complements — never replaces — the visit note above. */}
      {clinic.specialty === "dentistry" && appointment.type !== "blocked" && patient?._id && (
        <VisitDentalSection patientId={patient._id} patientName={patient.fullName} appointmentId={appointment._id} canWrite={role === "owner" || role === "doctor"} />
      )}

      <label className="lbl">{t("ap.status")}</label>
      <div className="mb-3 grid grid-cols-2 gap-1.5">
        {(["scheduled", "confirmed", "completed", "cancelled", "no_show"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-lg border px-2 py-1.5 text-[10px] font-medium ${
              status === s
                ? s === "confirmed"
                  ? "border-teal bg-teal text-navy"
                  : s === "cancelled"
                  ? "border-red-500 bg-red-500/20 text-red-400"
                  : "border-blue bg-blue text-white"
                : "border-edge bg-card2 text-mute"
            }`}
          >
            {isWalkInAppt && s === "scheduled" ? t("ap.walkInWaiting") : t(`status.${s}`)}
          </button>
        ))}
      </div>

      {status === "cancelled" && (
        <>
          <label className="lbl">{t("ap.cancelReason")}</label>
          <input
            className="inp mb-3"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </>
      )}

      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
      <button
        onClick={() => update.mutate()}
        disabled={update.isPending || (rescheduling && !editTime)}
        className="btn-blue w-full !py-2.5"
      >
        {update.isPending ? t("common.loading") : t("ap.save")}
      </button>
    </Modal>
  );
}
