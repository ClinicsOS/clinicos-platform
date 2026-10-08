import { NextResponse } from "next/server";

/**
 * Web App Manifest for ONE clinic's patient Loyalty app (Phase 9): `/c/<slug>/loyalty/manifest.webmanifest`.
 *
 *  • name / short_name come from the clinic's PUBLIC brand (the same public endpoint the page uses); if that can't be read the manifest
 *    still works with a neutral "Loyalty" name — installability never depends on the API being up.
 *  • start_url / scope are the clinic's own Loyalty URL, so the installed icon opens the right card. `?src=pwa` is ignored by the app
 *    (it is NOT QR/NFC and never creates a check-in).
 *  • nothing personal is in here. No token, no patient data.
 */
export const dynamic = "force-dynamic";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const slug = params.slug;
  const valid = /^[A-Za-z0-9_-]{1,80}$/.test(slug);
  let name = "Loyalty";
  let short = "Loyalty";
  if (valid) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 2500);
      const r = await fetch(`${API}/public/loyalty/${encodeURIComponent(slug)}`, { signal: ctl.signal, cache: "no-store" });
      clearTimeout(timer);
      if (r.ok) {
        const j = (await r.json()) as { clinic?: { name?: string; programName?: string | null } };
        const clinic = (j.clinic?.name ?? "").trim();
        const program = (j.clinic?.programName ?? "").trim();
        if (clinic) {
          name = (program || clinic).slice(0, 45);
          short = clinic.slice(0, 12);
        }
      }
    } catch {
      /* neutral name */
    }
  }
  const base = valid ? `/c/${slug}/loyalty` : "/";
  const manifest = {
    id: base,
    name,
    short_name: short,
    description: "Your Loyalty card, points and rewards.",
    start_url: valid ? `${base}?src=pwa` : "/",
    scope: base,
    display: "standalone",
    orientation: "portrait",
    background_color: "#05060a",
    theme_color: "#05060a",
    lang: "en",
    categories: ["lifestyle", "health"],
    icons: [
      { src: "/loyalty-pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/loyalty-pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/loyalty-pwa/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new NextResponse(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=300, must-revalidate" },
  });
}
