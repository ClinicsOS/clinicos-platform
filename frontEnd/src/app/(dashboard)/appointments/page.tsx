"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errMsg } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useSelectedPatient } from "@/store/patient";
import { useToast } from "@/components/Toast";
import Modal from "@/components/Modal";
import type { Appointment, Patient, Staff, Clinic, WorkingHour } from "@/lib/types";
import { fmtTime, fmtTime12, to12h, todayLocal, combineToUTC, ymd } from "@/lib/dates";
import { timeToMinutes, intervalsOverlap } from "@/lib/workingHoursTime";
import {
  IconChevronLeft,
  IconChevronRight,
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
  activeAppts: Appointment[]
): { list: { time: string; taken: boolean; past: boolean; isBreak: boolean }[]; closed: boolean } {
  const day = new Date(date + "T00:00:00");
  const dow = day.getDay();
  const wh = clinic.workingHours.find((w: WorkingHour) => w.day === dow);
  if (!wh || !wh.isOpen) return { list: [], closed: true };

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

  // Other active appointments/blocks for this doctor/day, as minute-of-day
  // intervals using THEIR OWN duration — a candidate start is "taken" if
  // [m, m+duration) overlaps any of them, not only an appointment that
  // starts at exactly m (that exact-match check was the double-booking
  // hole: a 60-minute appointment at 10:00 occupies 10:30 too, even though
  // nothing else starts exactly at 10:30).
  const activeIntervals = activeAppts
    .filter((a) => a.status === "scheduled" || a.status === "confirmed")
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
    // Interpret time as local wall-clock (no Z)
    const slotDate = new Date(`${date}T${timeStr}:00`);
    const end = m + duration;
    const overlapsBreak = breakStart !== -1 && intervalsOverlap(m, end, breakStart, breakEnd);
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

type SlotVisual = {
  time: string;                     // "HH:mm"
  utcStart: Date;                   // absolute date for this slot
  appt: Appointment | null;         // if booked (set for every grid cell the appointment spans, not just its start)
  isContinuation: boolean;          // true when `appt` started on an earlier row, not this one
  isPast: boolean;                  // slot is in the past
  isBreak: boolean;                 // falls inside the clinic's break window
};

export default function AppointmentsPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();

  // ==== Day selection ====
  const [date, setDate] = useState(todayLocal());
  const [docFilter, setDocFilter] = useState("all");
  const [creating, setCreating] = useState(false);
  const [creatingAt, setCreatingAt] = useState<string | null>(null); // pre-fill time
  const [walkInMode, setWalkInMode] = useState(false); // opened via "Add Walk-in" instead of "New appointment"
  const [editing, setEditing] = useState<Appointment | null>(null);

  const shiftDay = (delta: number) => {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + delta);
    setDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  };

  // ==== Data ====
  const { data: appointments } = useQuery({
    queryKey: ["appointments-day", date],
    queryFn: async () =>
      (await api.get<Appointment[]>(`/appointments?date=${date}`)).data,
    refetchInterval: 5_000,
  });

  const { data: staff } = useQuery({
    queryKey: ["staff"],
    queryFn: async () => (await api.get<Staff[]>("/users")).data,
  });

  const { data: clinic } = useQuery({
    queryKey: ["clinic"],
    queryFn: async () => (await api.get<Clinic>("/clinic")).data,
    refetchInterval: 5_000,
    staleTime: 3_000,
  });

  const doctors = (staff ?? []).filter((s) => s.role === "doctor" && s.isActive);

  // ==== Working hours for the picked day ====
  const dayInfo = useMemo(() => {
    if (!clinic) return null;
    const dow = new Date(date + "T00:00:00").getDay();
    const wh = clinic.workingHours.find((w) => w.day === dow);
    if (!wh || !wh.isOpen) return { closed: true, wh: null };
    return { closed: false, wh };
  }, [clinic, date]);

  // ==== Build the timeline: one row per slotDuration between open and close ====
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

    // Active appointments/blocks for the filtered doctor(s), as minute-of-day
    // intervals — used to mark EVERY grid row a longer appointment spans, not
    // just the one row matching its exact start time (a 60-minute appointment
    // covers two 30-minute grid rows, for example).
    const apptIntervals = (appointments ?? [])
      .filter((a) => {
        const did = typeof a.doctorId === "string" ? a.doctorId : a.doctorId?._id;
        const doctorMatch = docFilter === "all" || did === docFilter;
        return doctorMatch && a.status !== "cancelled";
      })
      .map((a) => {
        const start = timeToMinutes(fmtTime(a.startAt));
        return { appt: a, start, end: start + a.duration };
      });

    const rows: SlotVisual[] = [];
    const now = new Date();

    for (let m = openM; m + step <= closeM; m += step) {
      const h = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(m % 60).padStart(2, "0");
      const time = `${h}:${mm}`;
      // Interpret the time as WALL-CLOCK local time (no Z)
      const utcStart = new Date(`${date}T${time}:00`);

      // Any appointment whose interval covers this grid cell — not only one
      // starting exactly here.
      const covering = apptIntervals.find((iv) => intervalsOverlap(m, m + step, iv.start, iv.end));

      rows.push({
        time,
        utcStart,
        appt: covering ? covering.appt : null,
        isContinuation: covering ? covering.start !== m : false,
        isPast: utcStart.getTime() < now.getTime(),
        isBreak: breakStart !== -1 && intervalsOverlap(m, m + step, breakStart, breakEnd),
      });
    }
    return rows;
  }, [clinic, dayInfo, date, appointments, docFilter]);

  // ==== Doctor color mapping ====
  const palette = ["#4FC3B8", "#6FBDF5", "#F5B36F", "#C8A2F5", "#F58FA4", "#B9E68C"];
  const docColor = (id: string) => {
    const idx = doctors.findIndex((d) => d._id === id);
    return palette[idx % palette.length] || "#6FBDF5";
  };

  // ==== Stats for the header ====
  const stats = useMemo(() => {
    const total = timeline.length;
    const booked = timeline.filter((r) => r.appt).length;
    const past = timeline.filter((r) => r.isPast).length;
    const available = total - booked - past + timeline.filter((r) => r.appt && r.isPast).length;
    const pending = (appointments ?? []).filter(
      (a) => a.source === "public" && a.status === "scheduled"
    ).length;
    return { total, booked, available: Math.max(0, available), pending };
  }, [timeline, appointments]);

  const dayNames = lang === "ar" ? AR_DAYS : EN_DAYS;
  const dayDate = new Date(date + "T00:00:00");
  const dayLabel = `${dayNames[dayDate.getDay()]} · ${dayDate.getDate()} ${dayDate.toLocaleDateString(
    lang === "ar" ? "ar" : undefined,
    { month: "long" }
  )}`;
  const isToday = date === todayLocal();

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
          <button
            onClick={() => shiftDay(-1)}
            className="rounded-lg border border-edge bg-card p-1.5 text-mute hover:text-ink"
            title={t("ap.prevDay")}
          >
            <IconChevronLeft size={14} className="rtl-flip" />
          </button>
          <button
            onClick={() => shiftDay(1)}
            className="rounded-lg border border-edge bg-card p-1.5 text-mute hover:text-ink"
            title={t("ap.nextDay")}
          >
            <IconChevronRight size={14} className="rtl-flip" />
          </button>
          {!isToday && (
            <button
              onClick={() => setDate(todayLocal())}
              className="rounded-lg border border-blue bg-blue/10 px-2 py-1 text-[10px] text-sky hover:bg-blue/20"
            >
              <IconCalendarEvent size={11} className="me-1 inline" />
              {t("ap.today")}
            </button>
          )}
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
          <div className="flex gap-4 text-center">
            <div>
              <div className="text-xs font-medium text-teal">{stats.available}</div>
              <div className="text-[9px] tracking-widest text-mute">{t("ap.stats.available")}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-blue">{stats.booked}</div>
              <div className="text-[9px] tracking-widest text-mute">{t("ap.stats.booked")}</div>
            </div>
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
      {doctors.length > 0 && (
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
      {dayInfo?.closed ? (
        <ClosedDayEmptyState />
      ) : !doctors.length ? (
        <NoDoctorsEmptyState />
      ) : (
        <div className="card overflow-hidden">
          {/* Legend */}
          <div className="flex items-center gap-4 border-b border-edge bg-card2 px-4 py-2 text-[9px] text-mute">
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

          {/* Rows */}
          <div className="max-h-[calc(100vh-320px)] overflow-y-auto">
            {timeline.map((row, i) => (
              <TimelineRow
                key={i}
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
            ))}
          </div>
        </div>
      )}

      {creating && clinic && (
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
// One row of the timeline — clearly shows availability at that time
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
  const { time, appt, isPast, isBreak, isContinuation } = row;

  // Continuation row — this grid cell belongs to a longer appointment that
  // started on an earlier row. Show it's occupied without duplicating the
  // patient card (which stays on the row where the appointment actually
  // starts) — clicking still opens the same appointment.
  if (appt && isContinuation) {
    const did = typeof appt.doctorId === "string" ? appt.doctorId : appt.doctorId?._id;
    const doctor = typeof appt.doctorId === "object" ? appt.doctorId : doctors.find((d) => d._id === did);
    const color = docColor(did || "");
    const patient = typeof appt.patientId === "object" ? appt.patientId : null;
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
    const did = typeof appt.doctorId === "string" ? appt.doctorId : appt.doctorId?._id;
    const doctor = typeof appt.doctorId === "object" ? appt.doctorId : doctors.find((d) => d._id === did);
    const color = docColor(did || "");

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

    const patient = typeof appt.patientId === "object" ? appt.patientId : null;
    const isPending = appt.source === "public" && appt.status === "scheduled";
    const isConfirmed = appt.status === "confirmed";
    const isCompleted = appt.status === "completed";

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
        <span
          className={`pill text-[9px] ${
            isPending
              ? "bg-amber-500/15 text-amber-400"
              : isConfirmed
              ? "bg-teal/15 text-teal"
              : isCompleted
              ? "bg-mute/15 text-mute"
              : "bg-blue/15 text-sky"
          }`}
        >
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
  onClose,
  onDone,
}: {
  doctors: Staff[];
  clinic: Clinic;
  initialDate: string;
  initialTime: string | null;
  isWalkIn?: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<"appointment" | "block">("appointment");
  const [search, setSearch] = useState("");
  const [patientId, setPatientId] = useState("");
  const [doctorId, setDoctorId] = useState(doctors[0]?._id ?? "");
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime || "");
  const [duration, setDuration] = useState(clinic.slotDuration || 30);
  const [blockNote, setBlockNote] = useState("");
  const [visitType, setVisitType] = useState<"consultation" | "procedure">("consultation");
  const [procedureNote, setProcedureNote] = useState("");
  const [error, setError] = useState("");

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
    enabled: !!doctorId && !!date,
    refetchInterval: 5_000,
  });

  const slots = useMemo(() => {
    if (!doctorId || !date) return { list: [], closed: false };
    return computeSlots(clinic, date, duration, dayAppts ?? []);
  }, [doctorId, date, clinic, dayAppts, duration]);

  const create = useMutation({
    mutationFn: async () => {
      const startAt = combineToUTC(date, time);
      await api.post("/appointments", {
        patientId,
        doctorId,
        startAt,
        duration,
        visitType,
        procedureNote: visitType === "procedure" ? procedureNote.trim() : undefined,
        source: isWalkIn ? "walk_in" : undefined,
      });
    },
    onSuccess: () => {
      // The Timeline only shows ONE day — if this appointment was booked
      // for a different date than the one currently in view, closing the
      // modal changes nothing visible on screen. Without this, there is no
      // confirmation at all that the booking succeeded.
      toast.success(t("tst.savedTitle"), t("tst.savedBody"));
      onDone();
    },
    onError: (e) => setError(errMsg(e, t("ap.taken"))),
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
          {doctors.map((d) => (
            <option key={d._id} value={d._id}>
              {d.name}
            </option>
          ))}
        </select>
      )}

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
          {t("ap.dayClosed")}
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

      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
      <button
        onClick={() => {
          setError("");
          if (mode === "block") createBlock.mutate();
          else create.mutate();
        }}
        disabled={
          mode === "block"
            ? !doctorId || !time || createBlock.isPending
            : !patientId ||
              !doctorId ||
              !time ||
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
  const [status, setStatus] = useState(appointment.status);
  const [reason, setReason] = useState("");
  const [visitNote, setVisitNote] = useState(appointment.visitNote ?? "");
  const [error, setError] = useState("");

  const patient = typeof appointment.patientId === "object" ? appointment.patientId : null;
  const doctor = typeof appointment.doctorId === "object" ? appointment.doctorId : null;
  const currentDoctorId = typeof appointment.doctorId === "string" ? appointment.doctorId : appointment.doctorId?._id ?? "";

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
    return computeSlots(clinic, editDate, editDuration, others);
  }, [editDoctorId, editDate, editDuration, clinic, dayApptsForEdit, appointment._id]);

  const update = useMutation({
    mutationFn: async () => {
      const body: Record<string, string | number> = { status, visitNote: visitNote.trim() };
      if (status === "cancelled" && reason) body.cancelReason = reason;
      if (rescheduling) {
        body.startAt = combineToUTC(editDate, editTime);
        body.duration = editDuration;
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
              <div className="text-xs font-medium text-ink">{doctor?.name || "—"}</div>
            </div>
            <div className="rounded-lg border border-edge bg-card2 p-2.5">
              <div className="text-[9px] tracking-widest text-mute">{t("ap.time")}</div>
              <div className="text-xs font-medium text-ink" dir="ltr">
                {new Date(appointment.startAt).toLocaleDateString(lang === "ar" ? "ar" : undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}{" "}
                · {fmtTime12(appointment.startAt)} · {appointment.duration} {t("ap.min")}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setRescheduling(true)}
            className="mt-1.5 flex items-center gap-1 text-[10px] text-sky hover:underline"
          >
            <IconClock size={12} /> {t("ap.reschedule")}
          </button>
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
              {t("ap.dayClosed")}
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
            {t(`status.${s}`)}
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
