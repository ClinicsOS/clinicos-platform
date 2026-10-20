import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/lib/providers";
import { GoogleAnalytics } from "@next/third-parties/google";
import { ChatWidget } from "@/components/chatbot/ChatWidget";
export const metadata: Metadata = {
  title: "ClinicOS — Run your clinic on autopilot",
  description:
    "Appointments, patient records and invoices in one smart system, with an online booking page your patients will love.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          {children}
          <ChatWidget />
        </Providers>
        {/* PHASE 6 — only when a measurement id is configured (an unset variable used to request gtag/js?id=undefined). */}
        {process.env.NEXT_PUBLIC_GA_ID ? <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID} /> : null}
      </body>
    </html>
  );
}
