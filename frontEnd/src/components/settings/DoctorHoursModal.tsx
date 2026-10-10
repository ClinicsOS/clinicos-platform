"use client";
// PHASE 4 — the owner's editor for ONE doctor's own weekly hours (PUT /users/:id/working-hours; owner-only on the server).
// No own hours = the doctor follows the clinic's hours. Own hours can only narrow the clinic's: the server rejects anything outside
// them (and the clinic's closed days / breaks always still apply), so this form just reports the server's message.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errMsg } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/Toast";
import Modal from "@/components/Modal";
import type { Clinic, DoctorHoursDay, Staff } from "@/lib/types";

const DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export default function DoctorHoursModal({ doctor, clinic, onClose }: { doctor: Staff; clinic: Clinic | undefined; onClose: () => void }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const days = lang === "ar" ? DAYS_AR : DAYS_EN;
  const hasOwn = !!doctor.workingHours && doctor.workingHours.length === 7;
  const [custom, setCustom] = useState(hasOwn);
  const [error, setError] = useState("");
  // Start from the doctor's own hours, else from the clinic's hours (the natural starting point for narrowing them).
  const [hours, setHours] = useState<DoctorHoursDay[]>(() => {
    const src = new Map((hasOwn ? doctor.workingHours! : clinic?.workingHours ?? []).map((w) => [w.day, w]));
    return Array.from({ length: 7 }, (_, day) => {
      const w = src.get(day);
      return { day, isOpen: w?.isOpen ?? false, from: w?.from ?? "10:00", to: w?.to ?? "18:00", breakFrom: w?.breakFrom, breakTo: w?.breakTo };
    });
  });
  const set = (i: number, patch: Partial<DoctorHoursDay>) => setHours(hours.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.put(`/users/${doctor._id}/working-hours`, {
          workingHours: custom
            ? hours.map((h) => ({ day: h.day, isOpen: h.isOpen, from: h.from, to: h.to, breakFrom: h.breakFrom || "", breakTo: h.breakTo || "" }))
            : null,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      toast.success(t("tst.savedTitle"), t("md.hours.saved"));
      onClose();
    },
    onError: (e) => setError(errMsg(e, t("common.error"))),
  });

  return (
    <Modal title={`${t("md.hours.title")} — ${doctor.name}`} onClose={onClose} size="lg">
      <p className="mb-3 text-[11px] text-mute">{t("md.hours.note")}</p>
      <div className="mb-3 flex gap-2">
        <button type="button" data-testid="dh-follow" onClick={() => setCustom(false)} className={`rounded-full border px-3 py-1 text-[11px] ${!custom ? "border-blue bg-blue text-white" : "border-edge bg-card text-mute"}`}>
          {t("md.hours.followsClinic")}
        </button>
        <button type="button" data-testid="dh-custom" onClick={() => setCustom(true)} className={`rounded-full border px-3 py-1 text-[11px] ${custom ? "border-blue bg-blue text-white" : "border-edge bg-card text-mute"}`}>
          {t("md.hours.custom")}
        </button>
      </div>

      {custom && (
        <div className="mb-3">
          {hours.map((h, i) => (
            <div key={h.day} className="flex flex-col gap-1.5 border-b border-edge py-1.5 text-xs last:border-0">
              <div className="flex flex-wrap items-center gap-2.5" dir="ltr">
                <span className="w-20 font-medium text-ink">{days[h.day]}</span>
                <button type="button" onClick={() => set(i, { isOpen: !h.isOpen })} className={`relative h-4 w-7 rounded-full transition-colors ${h.isOpen ? "bg-teal" : "bg-edge"}`} aria-label={days[h.day]}>
                  <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${h.isOpen ? "start-3.5" : "start-0.5"}`} />
                </button>
                {h.isOpen ? (
                  <>
                    <input type="time" className="inp !w-24 !px-2 !py-1 font-mono text-[11px]" value={h.from} onChange={(e) => set(i, { from: e.target.value })} />
                    <span className="text-mute">—</span>
                    <input type="time" className="inp !w-24 !px-2 !py-1 font-mono text-[11px]" value={h.to} onChange={(e) => set(i, { to: e.target.value })} />
                    {h.breakFrom && h.breakTo ? (
                      <>
                        <span className="text-[10px] text-mute">{t("st.breakLabel")}</span>
                        <input type="time" className="inp !w-24 !px-2 !py-1 font-mono text-[11px]" value={h.breakFrom} onChange={(e) => set(i, { breakFrom: e.target.value })} />
                        <span className="text-mute">—</span>
                        <input type="time" className="inp !w-24 !px-2 !py-1 font-mono text-[11px]" value={h.breakTo} onChange={(e) => set(i, { breakTo: e.target.value })} />
                        <button type="button" onClick={() => set(i, { breakFrom: undefined, breakTo: undefined })} className="text-[10px] text-red-400 hover:underline">{t("st.removeBreak")}</button>
                      </>
                    ) : (
                      <button type="button" onClick={() => set(i, { breakFrom: "13:00", breakTo: "14:00" })} className="text-[10px] text-blue hover:underline">{t("st.addBreak")}</button>
                    )}
                  </>
                ) : (
                  <span className="text-[11px] italic text-mute opacity-70">{t("md.hours.dayOff")}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <p className="mb-2 text-xs text-red-400" data-testid="dh-error">{error}</p>}
      <button className="btn-teal w-full" data-testid="dh-save" disabled={save.isPending} onClick={() => { setError(""); save.mutate(); }}>
        {save.isPending ? t("common.loading") : t("st.saveChanges")}
      </button>
    </Modal>
  );
}
