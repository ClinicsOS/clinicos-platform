"use client";
import PatientApp from "../patient/PatientApp";

/**
 * The patient's Loyalty page (public, mobile-first). QR code, NFC tag, the installed app icon and a shared link all open the same URL
 * (`/c/<clinic-slug>/loyalty`) and therefore the same experience.
 *
 * Phase 9 replaced the temporary page of Phases 4–7 with the Patient Loyalty PWA (components/loyalty/patient/*). This file stays as the
 * stable entry point the route already imports. Opening the page never awards points and never creates a check-in.
 */
export default function PatientLoyalty({ slug }: { slug: string }) {
  return <PatientApp slug={slug} />;
}
