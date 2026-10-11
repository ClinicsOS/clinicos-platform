"use client";
// CLINICOS CONNECT (C4) — the structured card of a shared Appointment / Patient.
//   • It is a REFERENCE. It shows only what the server resolved for THIS viewer just now (ok | restricted | unavailable); it never
//     contains, and never grants, anything the viewer could not already open in ClinicOS.
//   • Its button navigates to the normal ClinicOS page, which authorises the request on its own.
//   • Names are plain text nodes (dir="auto"), so Arabic and Latin names render correctly in either direction.
import { useRouter } from "next/navigation";
import { IconCalendarEvent, IconLock, IconUserCircle, IconChevronRight, IconAlertCircle, IconCircleOff } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { useSelectedPatient } from "@/store/patient";
import type { Patient } from "@/lib/types";
import { appointmentHref, PATIENT_FILE_HREF } from "@/lib/connect/cards";
import { fmtClock, fmtDay } from "@/lib/connect/time";
import type { AppointmentCardData, CardView, PatientCardData, RefContentType } from "@/lib/connect/types";
import { cx } from "./ui";
import s from "./connect.module.css";

export function PatientBody({ p }: { p: PatientCardData }) {
  const { t } = useI18n();
  return (
    <>
      <div className={s.rcName} dir="auto" data-testid="rc-patient-name">{p.fullName}</div>
      <div className={s.rcMeta}>{t("share.fileNo")} #{p.fileNumber}</div>
    </>
  );
}

export function AppointmentBody({ a }: { a: AppointmentCardData }) {
  const { t, lang } = useI18n();
  return (
    <>
      <div className={s.rcRow}>
        <div className={s.rcName} dir="auto" data-testid="rc-appt-patient">{a.patientName ?? "—"}</div>
        <span className={s.rcStatus} data-status={a.status}>{t(`status.${a.status}`)}</span>
      </div>
      <div className={s.rcMeta} data-testid="rc-appt-when">
        <span>{fmtDay(a.startAt, lang)}</span>
        <i className={s.sep} aria-hidden="true" />
        <span dir="ltr">{fmtClock(a.startAt, lang)}</span>
      </div>
      <div className={s.rcMeta} dir="auto" data-testid="rc-appt-doctor">{a.doctorName ?? t("share.noDoctor")}</div>
    </>
  );
}

const ICON = { patient_reference: IconUserCircle, appointment_reference: IconCalendarEvent } as const;

export function ReferenceCard({
  contentType,
  card,
  loading,
  failed,
  onRetry,
  pending,
}: {
  contentType: RefContentType;
  /** undefined while the first answer is on its way. */
  card: CardView | undefined;
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
  /** My own card that the server has not confirmed yet: shown, but not clickable. */
  pending?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const select = useSelectedPatient((st) => st.select);
  const Icon = ICON[contentType];
  const label = contentType === "patient_reference" ? t("share.patient") : t("share.appointment");

  const head = (
    <div className={s.rcHead}>
      <Icon size={16} stroke={1.9} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );

  // not resolved yet / could not be resolved
  if (!card) {
    return (
      <div className={cx(s.rc, s.rcQuiet)} data-testid="ref-card" data-state={failed ? "error" : "loading"} aria-busy={!failed}>
        {head}
        {failed ? (
          <div className={s.rcNote} role="alert">
            <IconAlertCircle size={15} stroke={2} aria-hidden="true" />
            <span>{t("share.cardLoadErr")}</span>
            {onRetry && <button type="button" className={s.linkBtn} onClick={onRetry}>{t("msg.retry")}</button>}
          </div>
        ) : (
          <div className={s.rcSkel} aria-hidden="true"><i /><i /></div>
        )}
      </div>
    );
  }

  if (card.state === "restricted") {
    return (
      <div className={cx(s.rc, s.rcQuiet)} data-testid="ref-card" data-state="restricted">
        {head}
        <div className={s.rcNote}>
          <IconLock size={15} stroke={2} aria-hidden="true" />
          <span>{t("share.restricted")}</span>
        </div>
      </div>
    );
  }
  if (card.state === "unavailable") {
    return (
      <div className={cx(s.rc, s.rcQuiet)} data-testid="ref-card" data-state="unavailable">
        {head}
        <div className={s.rcNote}>
          <IconCircleOff size={15} stroke={2} aria-hidden="true" />
          <span>{t("share.unavailable")}</span>
        </div>
      </div>
    );
  }

  if ("patient" in card) {
    const p = card.patient;
    return (
      <div className={cx(s.rc, pending && s.rcPend)} data-testid="ref-card" data-state="ok" data-kind="patient">
        {head}
        <PatientBody p={p} />
        <button
          type="button"
          className={s.rcBtn}
          disabled={pending}
          data-testid="rc-open-patient"
          onClick={() => {
            select({ _id: p.id, fullName: p.fullName, fileNumber: p.fileNumber } as unknown as Patient); // the profile page loads the file through the normal API, which authorises it
            router.push(PATIENT_FILE_HREF);
          }}
        >
          {t("share.openPatient")}
          <IconChevronRight size={16} stroke={2} className="rtl-flip" aria-hidden="true" />
        </button>
      </div>
    );
  }
  if (!("appointment" in card)) return null;
  const a = card.appointment;
  return (
    <div className={cx(s.rc, pending && s.rcPend)} data-testid="ref-card" data-state="ok" data-kind="appointment">
      {head}
      <AppointmentBody a={a} />
      <button type="button" className={s.rcBtn} disabled={pending} data-testid="rc-view-appt" onClick={() => router.push(appointmentHref(a))}>
        {t("share.viewAppt")}
        <IconChevronRight size={16} stroke={2} className="rtl-flip" aria-hidden="true" />
      </button>
    </div>
  );
}
