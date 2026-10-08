"use client";
import TiersTab from "@/components/loyalty/TiersTab";
import { useLoyaltyBrand } from "@/lib/loyalty";

export default function TiersPage() {
  const { brand } = useLoyaltyBrand();
  return <TiersTab brand={brand} />;
}
