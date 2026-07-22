"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/lib/adminApi";
import PlanBadge from "@/components/admin/PlanBadge";
import StatusBadge from "@/components/admin/StatusBadge";
import ExpiryBadge from "@/components/admin/ExpiryBadge";
import { IconSearch, IconEye, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";

interface ClinicRow {
  _id: string;
  name: string;
  slug: string;
  specialty: string;
  plan: "trial" | "basic" | "pro";
  status: "active" | "suspended" | "expired";
  planExpiresAt: string;
  daysUntilExpiry: number;
  isExpired: boolean;
  userCount: number;
  patientCount: number;
  createdAt: string;
}

interface ClinicsResponse {
  clinics: ClinicRow[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export default function ClinicsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const { data, isLoading } = useQuery<ClinicsResponse>({
    queryKey: ["admin", "clinics", { page, search, planFilter, statusFilter }],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: "20",
      });
      if (search) params.set("search", search);
      if (planFilter) params.set("plan", planFilter);
      if (statusFilter) params.set("status", statusFilter);
      return (await adminApi.get(`/admin/clinics?${params}`)).data;
    },
  });

  return (
    <div className="p-6">
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-white">Clinics</h1>
        <p className="mt-1 text-[12px] text-red-200/50">
          {data ? `${data.total} clinic${data.total !== 1 ? "s" : ""} total` : "Loading..."}
        </p>
      </header>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[240px]">
          <IconSearch
            size={13}
            className="absolute start-3 top-1/2 -translate-y-1/2 text-red-300/50"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by clinic name, slug or specialty..."
            className="w-full rounded-lg border border-red-900/40 bg-[#150606]/60 px-9 py-2 text-[12px] text-white placeholder:text-red-300/30 focus:border-red-500 focus:outline-none"
          />
        </div>

        <select
          value={planFilter}
          onChange={(e) => {
            setPlanFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-red-900/40 bg-[#150606]/60 px-3 py-2 text-[12px] text-white focus:border-red-500 focus:outline-none"
        >
          <option value="">All plans</option>
          <option value="trial">Trial</option>
          <option value="basic">Basic</option>
          <option value="pro">Pro</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-red-900/40 bg-[#150606]/60 px-3 py-2 text-[12px] text-white focus:border-red-500 focus:outline-none"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-red-900/30 bg-[#150606]/60">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-red-900/30 bg-[#0f0505] text-[10px] uppercase tracking-wider text-red-200/50">
                <th className="px-4 py-3 text-start">Clinic</th>
                <th className="px-4 py-3 text-start">Specialty</th>
                <th className="px-4 py-3 text-start">Plan</th>
                <th className="px-4 py-3 text-start">Status</th>
                <th className="px-4 py-3 text-start">Expires</th>
                <th className="px-4 py-3 text-start">Users</th>
                <th className="px-4 py-3 text-start">Patients</th>
                <th className="px-4 py-3 text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-[11px] text-red-200/40">
                    Loading clinics...
                  </td>
                </tr>
              )}
              {data && data.clinics.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[11px] text-red-200/40">
                    No clinics match these filters.
                  </td>
                </tr>
              )}
              {data?.clinics.map((c) => (
                <tr
                  key={c._id}
                  className="border-b border-red-900/20 text-[12px] text-red-50 last:border-0 hover:bg-red-900/10"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{c.name}</div>
                    <div className="text-[10px] text-red-200/40">/{c.slug}</div>
                  </td>
                  <td className="px-4 py-3 text-red-100/80">{c.specialty}</td>
                  <td className="px-4 py-3">
                    <PlanBadge plan={c.plan} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-3">
                    <ExpiryBadge daysUntilExpiry={c.daysUntilExpiry} />
                    <div className="mt-0.5 text-[10px] text-red-200/40">
                      {new Date(c.planExpiresAt).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-red-100/80">{c.userCount}</td>
                  <td className="px-4 py-3 text-red-100/80">{c.patientCount}</td>
                  <td className="px-4 py-3 text-end">
                    <Link
                      href={`/admin/clinics/${c._id}`}
                      className="inline-flex items-center gap-1 rounded-md border border-red-800/50 bg-red-900/20 px-2.5 py-1 text-[10px] font-medium text-red-100 hover:bg-red-900/40 hover:text-white"
                    >
                      <IconEye size={12} />
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <div className="text-[11px] text-red-200/50">
            Page {data.page} of {data.pages}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 rounded-md border border-red-800/50 bg-red-900/20 px-3 py-1.5 text-[11px] text-red-100 hover:bg-red-900/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <IconChevronLeft size={13} />
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
              disabled={page === data.pages}
              className="flex items-center gap-1 rounded-md border border-red-800/50 bg-red-900/20 px-3 py-1.5 text-[11px] text-red-100 hover:bg-red-900/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
              <IconChevronRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
