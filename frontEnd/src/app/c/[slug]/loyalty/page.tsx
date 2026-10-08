"use client";
import { useParams } from "next/navigation";
import PatientLoyalty from "@/components/loyalty/public/PatientLoyalty";

/**
 * Public patient Loyalty page: /c/<clinic-slug>/loyalty
 * The SAME url is what the clinic puts in its QR code and NFC tag. Opening it only shows the identification form —
 * it never awards points and never creates a check-in.
 */
export default function PublicLoyaltyPage() {
  const params = useParams<{ slug: string }>();
  return <PatientLoyalty slug={String(params.slug)} />;
}
