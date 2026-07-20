"use client";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errMsg } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import Modal from "@/components/Modal";
import type { Appointment, Patient, Staff, Clinic, WorkingHour } from "@/lib/types";
import { fmtTime, todayLocal, combineToUTC } from "@/lib/dates";
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
} from "@tabler/icons-react";

const AR_DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const EN_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type SlotVisual = {
  time: string;                     // "HH:mm"
  utcStart: Date;                   // absolute date for this slot
  appt: Appointment | null;         // if booked
  isPast: boolean;                  // slot is in the past
};

export default function AppointmentsPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();

  // ==== Day selection ====
  const [date, setDate] = useState(todayLocal());
  const [docFilter, setDocFilter] = useState("all");
  const [creating, setCreating] = useState(false);
  const [creatingAt, setCreatingAt] = useState<string | null>(null); // pre-fill time
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
    const [fromH, fromM] = wh.from.split(":").map(Number);
    const [toH, toM] = wh.to.split(":").map(Number);
    const openM = fromH * 60 + fromM;
    const closeM = toH * 60 + toM;
    const step = clinic.slotDuration || 30;

    const rows: SlotVisual[] = [];
    const now = new Date();

    for (let m = openM; m + step <= closeM; m += step) {
      const h = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(m % 60).padStart(2, "0");
      const time = `${h}:${mm}`;
      // Interpret the time as WALL-CLOCK local time (no Z)
      const utcStart = new Date(`${date}T${time}:00`);

      // Find an appointment that starts at exactly this slot for the filtered doctor
      const appt = (appointments ?? []).find((a) => {
        const t = fmtTime(a.startAt);
        const did = typeof a.doctorId === "string" ? a.doctorId : a.doctorId?._id;
        const doctorMatch = docFilter === "all" || did === docFilter;
        return t === time && doctorMatch && a.status !== "cancelled";
      });

      rows.push({
        time,
        utcStart,
        appt: appt || null,
        isPast: utcStart.getTime() < now.getTime(),
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

        <div className="ms-auto flex items-center gap-1.5">
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
              setCreating(true);
            }}
            className="btn-teal ms-2 !py-2 text-xs"
          >
            <IconPlus size={14} /> {t("dash.new")}
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
          initialDate={date}
          initialTime={creatingAt}
          onClose={() => {
            setCreating(false);
            setCreatingAt(null);
          }}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["appointments-day"] });
            setCreating(false);
            setCreatingAt(null);
          }}
        />
      )}
      {editing && (
        <EditAppointmentModal
          appointment={editing}
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
  const { time, appt, isPast } = row;

  // Booked row
  if (appt) {
    const did = typeof appt.doctorId === "string" ? appt.doctorId : appt.doctorId?._id;
    const doctor = typeof appt.doctorId === "object" ? appt.doctorId : doctors.find((d) => d._id === did);
    const patient = typeof appt.patientId === "object" ? appt.patientId : null;
    const color = docColor(did || "");
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
        <div className="w-14 font-mono text-[11px] font-medium text-ink">{time}</div>
        <div
          className="h-8 w-1 rounded-full"
          style={{ background: color }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12px] font-medium text-ink">
              {patient?.fullName ?? "—"}
            </span>
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
        <div className="w-14 font-mono text-[11px] text-mute">{time}</div>
        <div className="h-6 w-1 rounded-full bg-mute/30" />
        <span className="text-[10px] italic text-mute">{t("ap.rowPast")}</span>
      </div>
    );
  }

  // Available row
  return (
    <button
      onClick={() => onCreate(time)}
      className="group flex w-full items-center gap-3 border-b border-edge px-4 py-2 text-start transition-colors hover:bg-teal/5"
    >
      <div className="w-14 font-mono text-[11px] text-mute group-hover:text-teal">{time}</div>
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
  onClose,
  onDone,
}: {
  doctors: Staff[];
  clinic: Clinic;
  initialDate: string;
  initialTime: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [patientId, setPatientId] = useState("");
  const [doctorId, setDoctorId] = useState(doctors[0]?._id ?? "");
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime || "");
  const [duration, setDuration] = useState(clinic.slotDuration || 30);
  const [error, setError] = useState("");

  const { data: patients } = useQuery({
    queryKey: ["patients-pick", search],
    queryFn: async () =>
      (
        await api.get<{ patients: Patient[] }>(
          `/patients?search=${encodeURIComponent(search)}`
        )
      ).data.patients,
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
    const day = new Date(date + "T00:00:00");
    const dow = day.getDay();
    const wh = clinic.workingHours.find((w: WorkingHour) => w.day === dow);
    if (!wh || !wh.isOpen) return { list: [], closed: true };

    const [fromH, fromM] = wh.from.split(":").map(Number);
    const [toH, toM] = wh.to.split(":").map(Number);
    const openM = fromH * 60 + fromM;
    const closeM = toH * 60 + toM;
    const step = clinic.slotDuration || 30;

    const bookedTimes = new Set(
      (dayAppts ?? [])
        .filter((a) => a.status === "scheduled" || a.status === "confirmed")
        .map((a) => fmtTime(a.startAt))
    );

    const now = Date.now();
    const list: { time: string; taken: boolean; past: boolean }[] = [];
    for (let m = openM; m + step <= closeM; m += step) {
      const h = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(m % 60).padStart(2, "0");
      const timeStr = `${h}:${mm}`;
      // Interpret time as local wall-clock (no Z)
      const slotDate = new Date(`${date}T${timeStr}:00`);
      list.push({
        time: timeStr,
        taken: bookedTimes.has(timeStr),
        past: slotDate.getTime() < now,
      });
    }
    return { list, closed: false };
  }, [doctorId, date, clinic, dayAppts]);

  const create = useMutation({
    mutationFn: async () => {
      const startAt = combineToUTC(date, time);
      await api.post("/appointments", { patientId, doctorId, startAt, duration });
    },
    onSuccess: onDone,
    onError: (e) => setError(errMsg(e, t("ap.taken"))),
  });

  return (
    <Modal title={t("dash.new")} onClose={onClose}>
      <label className="lbl">{t("ap.patient")}</label>
      <input
        className="inp mb-1.5"
        placeholder={t("pt.search")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <select
        className="inp mb-3"
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
            onChange={(e) => setDuration(Number(e.target.value))}
          >
            {[10, 15, 20, 30, 45, 60].map((d) => (
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
              disabled={s.taken || s.past}
              onClick={() => setTime(s.time)}
              className={`rounded-md border py-1.5 text-[11px] font-mono transition-colors ${
                time === s.time
                  ? "border-teal bg-teal text-navy"
                  : s.taken
                  ? "border-red-500/30 bg-red-500/10 text-red-400 opacity-60 line-through"
                  : s.past
                  ? "border-edge bg-card2 text-mute opacity-40"
                  : "border-sky/50 bg-card2 text-blue hover:bg-soft"
              }`}
              title={s.taken ? t("ap.taken") : s.past ? t("ap.rowPast") : ""}
            >
              {s.taken && <IconLock size={8} className="me-1 inline" />}
              {s.time}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
      <button
        onClick={() => {
          setError("");
          create.mutate();
        }}
        disabled={!patientId || !doctorId || !time || create.isPending}
        className="btn-blue w-full !py-2.5"
      >
        {create.isPending ? t("common.loading") : t("ap.create")}
      </button>
    </Modal>
  );
}

function EditAppointmentModal({
  appointment,
  onClose,
  onDone,
}: {
  appointment: Appointment;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, lang } = useI18n();
  const [status, setStatus] = useState(appointment.status);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const patient = typeof appointment.patientId === "object" ? appointment.patientId : null;
  const doctor = typeof appointment.doctorId === "object" ? appointment.doctorId : null;

  const update = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = { status };
      if (status === "cancelled" && reason) body.cancelReason = reason;
      await api.patch(`/appointments/${appointment._id}/status`, body);
    },
    onSuccess: onDone,
    onError: (e) => setError(errMsg(e, t("common.error"))),
  });

  const isPending = appointment.source === "public" && appointment.status === "scheduled";

  return (
    <Modal title={t("ap.details")} onClose={onClose}>
      {isPending && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
          <IconAlertCircle size={13} />
          {t("ap.pendingNote")}
        </div>
      )}

      <div className="mb-3 rounded-lg border border-edge bg-card2 p-3">
        <div className="mb-1 text-[9px] tracking-widest text-mute">{t("ap.patient")}</div>
        <div className="text-sm font-medium text-ink">{patient?.fullName || "—"}</div>
        {patient?.phone && <div className="text-[10px] text-mute" dir="ltr">{patient.phone}</div>}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
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
            · {fmtTime(appointment.startAt)}
          </div>
        </div>
      </div>

      {appointment.refCode && (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-dashed border-sky/50 bg-soft px-3 py-2">
          <span className="text-[10px] text-mute">{t("bk.ref")}</span>
          <span className="font-mono text-[11px] text-sky">{appointment.refCode}</span>
        </div>
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
        disabled={update.isPending}
        className="btn-blue w-full !py-2.5"
      >
        {update.isPending ? t("common.loading") : t("ap.save")}
      </button>
    </Modal>
  );
}
