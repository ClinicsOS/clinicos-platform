"use client";
import { ReactNode, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LanguageProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";
import { ToastProvider } from "@/components/Toast";
import { ConfirmProvider } from "@/components/Confirm";
import { useAuth } from "@/store/auth";
import { useSelectedPatient } from "@/store/patient";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } })
  );
  // PHASE 6 — nothing the previous account loaded may be shown to the next one. A logout, an expired session or a different user signing in on the same
  // tab (no page reload in between) leaves the in-memory query cache and the "selected patient" (sessionStorage, a full patient record) behind; both
  // are dropped the moment the signed-in user changes. A first sign-in / session restore (previous user = none) has nothing to drop and is left alone.
  useEffect(() => {
    return useAuth.subscribe((state, prev) => {
      if (!prev.user || state.user?.id === prev.user.id) return;
      client.removeQueries({ queryKey: ["connect"] }); // Connect threads / unread counters (ClinicOS Connect requirement)
      client.removeQueries({ predicate: (q) => q.queryKey[0] !== "connect" }); // clinic, patients, appointments, invoices … of the previous account
      useSelectedPatient.setState({ selected: null });
    });
  }, [client]);
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <LanguageProvider>
          <ToastProvider>
            <ConfirmProvider>{children}</ConfirmProvider>
          </ToastProvider>
        </LanguageProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
