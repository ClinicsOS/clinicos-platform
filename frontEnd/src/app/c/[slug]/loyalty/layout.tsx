import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

/**
 * Patient Loyalty PWA shell metadata (Phase 9) for `/c/<clinic-slug>/loyalty`.
 *  • per-clinic Web App Manifest (see ./manifest.webmanifest/route.ts) so the installed app opens THIS clinic's card
 *  • standalone iOS web app, black-translucent status bar, notch-aware viewport (`viewport-fit=cover`) — the app handles safe areas itself
 *  • never indexed: it is a personal page
 * Zoom is NOT disabled (accessibility).
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#05060a",
  colorScheme: "dark",
};

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const slug = encodeURIComponent(params.slug);
  return {
    title: "Loyalty",
    manifest: `/c/${slug}/loyalty/manifest.webmanifest`,
    robots: { index: false, follow: false },
    applicationName: "Loyalty",
    appleWebApp: { capable: true, title: "Loyalty", statusBarStyle: "black-translucent" },
    formatDetection: { telephone: false },
    icons: {
      icon: [{ url: "/loyalty-pwa/icon-192.png", sizes: "192x192", type: "image/png" }],
      apple: [{ url: "/loyalty-pwa/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
  };
}

export default function PatientLoyaltyLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
