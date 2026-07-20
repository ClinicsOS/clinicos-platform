"use client";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/store/auth";
import { fmtTime } from "@/lib/dates";
import type { Appointment, Patient } from "@/lib/types";
import { IconBell, IconCheck, IconCalendarPlus, IconInbox } from "@tabler/icons-react";

export default function NotificationBell({ appointments }: { appointments: Appointment[] }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const notifications = appointments
    .filter(
      (a) =>
        a.source === "public" &&
        a.status === "scheduled" &&
        new Date(a.startAt).getTime() > Date.now()
    )
    .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime());

  const isRead = (a: Appointment) =>
    !!user?.id && !!a.readBy && a.readBy.includes(user.id);

  const unreadCount = notifications.filter((a) => !isRead(a)).length;

  const markOne = useMutation({
    mutationFn: async (id: string) => (await api.patch(`/appointments/${id}/read`, {})).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["appointments-all"] }),
  });

  const markAll = useMutation({
    mutationFn: async () => (await api.patch("/appointments/read-all", {})).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["appointments-all"] }),
  });

  const fmtDay = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(lang === "ar" ? "ar" : undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg border border-edge bg-card p-1.5 text-mute hover:text-ink"
        title={t("ap.newBookingBell")}
      >
        <IconBell size={15} />
        {unreadCount > 0 && (
          <>
            <span className="absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-medium text-navy">
              {unreadCount}
            </span>
            <span className="absolute -end-1 -top-1 h-4 w-4 animate-ping rounded-full bg-amber-500/60" />
          </>
        )}
      </button>

      {open && (
        <div className="absolute end-0 top-[calc(100%+6px)] z-50 w-80 rounded-xl border border-edge bg-card shadow-[0_20px_50px_-20px_rgba(0,0,0,0.4)]">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
            <div>
              <div className="text-xs font-medium text-ink">{t("notif.title")}</div>
              <div className="text-[9px] text-mute">
                {unreadCount === 0
                  ? t("notif.allRead")
                  : `${unreadCount} ${t("notif.unread")}`}
              </div>
            </div>
            {unreadCount > 0 && (
              <button
                onClick={() => markAll.mutate()}
                disabled={markAll.isPending}
                className="text-[10px] font-medium text-blue hover:underline disabled:opacity-50"
              >
                {t("notif.markAllRead")}
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <IconInbox size={24} className="mb-2 text-mute" />
                <p className="text-[11px] text-mute">{t("notif.empty")}</p>
              </div>
            ) : (
              notifications.slice(0, 20).map((a) => {
                const patient = typeof a.patientId === "object" ? (a.patientId as Patient) : null;
                const doctor = typeof a.doctorId === "object" ? a.doctorId : null;
                const read = isRead(a);
                return (
                  <div
                    key={a._id}
                    className={`border-b border-edge px-4 py-2.5 last:border-0 ${
                      read ? "opacity-60" : ""
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {!read && (
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink">
                          <IconCalendarPlus size={11} className="text-teal" />
                          {t("notif.newBooking")}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-ink">
                          {patient?.fullName ?? "—"}
                        </div>
                        <div className="mt-0.5 text-[9px] text-mute" dir="ltr">
                          {fmtDay(a.startAt)} · {fmtTime(a.startAt)} · {doctor?.name}
                        </div>
                        {a.refCode && (
                          <div className="mt-1 inline-block rounded border border-dashed border-sky/40 bg-soft px-1.5 py-0.5 font-mono text-[8px] text-blue">
                            {a.refCode}
                          </div>
                        )}
                      </div>
                      {!read && (
                        <button
                          onClick={() => markOne.mutate(a._id)}
                          disabled={markOne.isPending}
                          className="text-mute hover:text-teal"
                          title={t("notif.markRead")}
                        >
                          <IconCheck size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="border-t border-edge px-4 py-2 text-center">
              <Link
                href="/appointments"
                onClick={() => setOpen(false)}
                className="text-[10px] font-medium text-blue hover:underline"
              >
                {t("notif.viewAll")}
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
