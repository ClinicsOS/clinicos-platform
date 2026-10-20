/* PHASE 6 — frontend unit tests (pure source/logic checks; no browser, no network).
       node --import ./tests/support/register.mjs --experimental-transform-types --no-warnings --test tests/phase6-layers-nabd-dashboard.test.mjs
   What the REAL browser proves (Nabd click-through, modal-over-Nabd, drawer, RTL, mobile, role dashboards) lives in PHASE6-UI-SCREENSHOTS/acceptance-scripts/accept6*.js. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = new URL("../", import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const walk = (dir, out = []) => { for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) { const p = `${dir}/${e.name}`; if (e.isDirectory()) walk(p, out); else if (/\.(tsx?|css)$/.test(e.name)) out.push(p); } return out; };
const { LAYERS } = await import("../src/lib/layers.ts");

test("1. layer scale is strictly ascending in the documented order", () => {
  const order = ["raised", "dropdown", "nabd", "popover", "drawer", "modal", "dialog", "toast"];
  assert.deepEqual(Object.keys(LAYERS), order);
  const v = order.map((k) => LAYERS[k]);
  for (let i = 1; i < v.length; i++) assert.ok(v[i] > v[i - 1], `${order[i]} must be above ${order[i - 1]}`);
  assert.ok(v[v.length - 1] <= 100, "no random giant values");
});
test("2. Nabd sits ABOVE dropdowns and BELOW popovers, drawers, modals, dialogs and toasts", () => {
  assert.ok(LAYERS.nabd > LAYERS.dropdown);
  for (const k of ["popover", "drawer", "modal", "dialog", "toast"]) assert.ok(LAYERS.nabd < LAYERS[k], `nabd < ${k}`);
});
test("3. Tailwind config exposes exactly these tokens (single source of truth)", () => {
  const cfg = read("tailwind.config.ts");
  assert.match(cfg, /from "\.\/src\/lib\/layers"/);
  assert.match(cfg, /zIndex:\s*Object\.fromEntries\(Object\.entries\(LAYERS\)/);
});
test("4. globals.css CSS variables mirror the scale", () => {
  const css = read("src/app/globals.css");
  for (const [k, v] of Object.entries(LAYERS)) assert.match(css, new RegExp(`--z-${k}:\\s*${v}\\b`), `--z-${k}`);
});
test("5. no ad-hoc global z-index literal (z-[nn] / z-40 / z-50) outside the Loyalty product shells", () => {
  const bad = [];
  for (const f of walk("src")) {
    if (/components\/loyalty\//.test(f) || /connect\.module\.css/.test(f) || f.endsWith("layers.ts") || f.endsWith("globals.css")) continue;
    const s = read(f);
    for (const m of s.matchAll(/\bz-\[\d+\]|\bz-(40|50|60)\b/g)) bad.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(bad, []);
});
test("6. every blocking surface uses its layer token", () => {
  assert.match(read("src/components/Modal.tsx"), /fixed inset-0 z-modal/);
  assert.doesNotMatch(read("src/components/Modal.tsx"), /z-50/);
  assert.match(read("src/components/Confirm.tsx"), /z-dialog/);
  assert.match(read("src/components/invoices/InvoiceLifecycleDialogs.tsx"), /z-dialog/);
  const toast = read("src/components/Toast.tsx");
  assert.match(toast, /pointer-events-none fixed[^"]*z-toast/);
  assert.match(read("src/app/(dashboard)/layout.tsx"), /fixed inset-0 z-drawer/);
  assert.match(read("src/components/dental/ToothPanel.tsx"), /z-drawer/);
  assert.match(read("src/components/dental/MultiSelectPanel.tsx"), /z-drawer/);
  assert.match(read("src/components/dental/treatment/PrintExportMenu.tsx"), /z-popover/);
  assert.match(read("src/components/connect/connect.module.css"), /z-index: var\(--z-modal, 70\)/);
});
test("7. Nabd root is pointer-events-none and sized by its content; only launcher/panel take input", () => {
  const w = read("src/components/chatbot/ChatWidget.tsx");
  assert.match(w, /data-testid="nabd-root" className="pointer-events-none fixed z-nabd"/);
  assert.match(w, /data-testid="nabd-launcher"/);
  assert.match(w, /pointer-events-auto relative flex h-14 w-14/, "launcher hit box = the 56 px visible circle (no 64 px box)");
  assert.doesNotMatch(w, /h-16 w-16|w-16 h-16/);
  assert.match(w, /aria-label=\{BOT_NAME\[lang\]\}/);
  assert.match(w, /aria-haspopup="dialog"/);
  assert.match(w, /focus-visible:outline/);
  const rings = w.match(/pulse-ring pointer-events-none absolute inset-0/g) ?? [];
  assert.equal(rings.length, 2, "both decorative pulse rings are pointer-events-none");
  assert.match(w, /pointer-events-none absolute bottom-full[^"]*whitespace-nowrap/, "tooltip is absolute, so it adds no layout box");
  assert.match(w, /prefers-reduced-motion: reduce/);
});
test("8. Nabd honours the device safe area (home indicator / notch) on the side it sits on", () => {
  const w = read("src/components/chatbot/ChatWidget.tsx");
  assert.match(w, /env\(safe-area-inset-bottom, 0px\)/);
  assert.match(w, /env\(safe-area-inset-\$\{side\}, 0px\)/);
  assert.match(w, /isRtl \? "left" : "right"/);
});
test("9. Nabd panel: dialog semantics, pointer-events-auto, viewport-safe size, Escape closes, localized close label", () => {
  const c = read("src/components/chatbot/ChatWindow.tsx");
  assert.match(c, /role="dialog"/);
  assert.match(c, /data-testid="nabd-panel"/);
  assert.match(c, /pointer-events-auto/);
  assert.match(c, /max-w-\[calc\(100vw-2\.5rem\)\]/);
  assert.match(c, /e\.key === "Escape"\) onClose\(\)/);
  assert.match(c, /lang === "ar" \? "إغلاق" : "Close"/);
});
test("10. the dashboard layout leaves room for the launcher at the bottom of every page", () => {
  assert.match(read("src/app/(dashboard)/layout.tsx"), /<main className="px-3 pb-24 pt-3 md:px-5">/);
});
test("11. Dashboard: ONE layout for every role, in the required order (greeting → date/clinic → Today → KPIs → week → rest)", () => {
  const d = read("src/app/(dashboard)/dashboard/page.tsx");
  assert.doesNotMatch(d, /todayFirst/, "the owner-only 'cockpit first' branch is gone");
  const ret = d.slice(d.indexOf("// ===== ALL ROLES"));
  const at = (s) => ret.indexOf(s);
  const order = ["{header}", "{ownerFilter}", 'data-testid="dash-today"', "{kpis}", "{weekChart}", "<DentalDashboard part=\"rest\" />"];
  for (let i = 1; i < order.length; i++) assert.ok(at(order[i]) > at(order[i - 1]) && at(order[i - 1]) >= 0, `${order[i]} after ${order[i - 1]}`);
  assert.match(d, /data-testid="dash-greeting"/);
  assert.match(d, /user\?\.name\?\.split\(" "\)\[0\]/, "greeting uses the authenticated user");
  assert.doesNotMatch(d, /Dr\.? ?[A-Z][a-z]+|Good morning, [A-Z]/, "no hard-coded doctor name");
});
test("12. Dashboard date follows the UI language (not the browser locale); Arabic comma in the greeting", () => {
  const d = read("src/app/(dashboard)/dashboard/page.tsx");
  assert.equal((d.match(/toLocaleDateString\(undefined/g) ?? []).length, 0);
  assert.match(d, /lang === "ar" \? "ar-JO" : "en-US"/);
  assert.match(d, /lang === "ar" \? "،" : ","/);
});
test("13. Role privacy is still decided by the server figures: money card only when the role has a revenue figure; receptionist gets walk-ins instead", () => {
  const d = read("src/app/(dashboard)/dashboard/page.tsx");
  assert.match(d, /const showRevenue = !\(stats\?\.today\.revenue === null \|\| \(stats && !access\.can\("dashboardRevenue"\)\)\)/);
  assert.match(d, /access\.isReceptionist/);
  assert.match(d, /ownerFilter = access\.isOwner/);
  assert.match(d, /useClinicDoctors\(access\.isOwner\)/, "doctor list (owner filter) is only requested for the owner");
});
test("14. Today's list reuses data the page already has (no new endpoint) and the dental row shows the doctor", () => {
  const d = read("src/app/(dashboard)/dashboard/page.tsx");
  assert.equal((d.match(/api\.get</g) ?? []).length, 3, "clinic, stats, today appointments — nothing added by Phase 6");
  assert.match(read("src/components/dental/treatment/DentalDashboard.tsx"), /data-testid="dash-today-doctor"/);
});
test("15. Analytics is only mounted when a measurement id is configured", () => {
  assert.match(read("src/app/layout.tsx"), /process\.env\.NEXT_PUBLIC_GA_ID \? <GoogleAnalytics gaId=\{process\.env\.NEXT_PUBLIC_GA_ID\} \/> : null/);
});
test("16. Modal (md) cannot grow past the viewport", () => {
  assert.match(read("src/components/Modal.tsx"), /max-h-\[92vh\] w-full max-w-md overflow-y-auto/);
});
