/* CLINICOS CONNECT (C2) — browser test helpers (Playwright, real production build, real C1 backend).
   Not part of the app bundle and not a dependency of it: install Playwright wherever you run the E2E and point PW_NODE_PATH at its node_modules'
   parent (or run from a folder where `playwright-core` resolves). Env:
     PW_NODE_PATH   folder whose node_modules contains playwright-core            (default: resolve normally)
     CHROMIUM_PATH  chromium executable                                          (default: Playwright's own)
     APP_URL        the running frontend                                         (default http://localhost:3000)
     WORLD          path of c2-world.json written by backEnd/tests/connect/c2-world.js  */
import { createRequire } from "node:module";
import fs from "node:fs";

const req = createRequire((process.env.PW_NODE_PATH ? process.env.PW_NODE_PATH.replace(/\/$/, "") + "/" : import.meta.url) + (process.env.PW_NODE_PATH ? "noop.js" : ""));
export const { chromium } = req("playwright-core");
export const APP = process.env.APP_URL || "http://localhost:3000";
export const world = JSON.parse(fs.readFileSync(process.env.WORLD || "c2-world.json", "utf8"));

export async function launch() {
  return chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox"],
  });
}

/** A signed-in browser session for one of the seeded users. */
export async function session(browser, who, o = {}) {
  const u = world.users[who];
  const ctx = await browser.newContext({
    viewport: { width: o.w ?? 1440, height: o.h ?? 900 },
    deviceScaleFactor: 1,
    hasTouch: !!o.touch,
    isMobile: !!o.touch,
    reducedMotion: o.reducedMotion ? "reduce" : "no-preference",
    locale: o.lang === "ar" ? "ar-JO" : "en-US",
  });
  await ctx.addInitScript(
    ([auth, lang, theme]) => {
      try {
        localStorage.setItem("clinicos-auth", JSON.stringify({ state: auth, version: 0 }));
        localStorage.setItem("clinicos-lang", lang);
        localStorage.setItem("clinicos-theme", theme);
      } catch {}
    },
    [
      { token: u.token, user: { id: u.id, name: u.name, email: u.email, role: u.role, emailVerified: true }, clinic: { id: u.clinicId, name: "Clinic", slug: u.slug } },
      o.lang || "en",
      o.theme || "dark",
    ],
  );
  const page = await ctx.newPage();
  const log = { errors: [], connect: [], pageErrors: [], all: [] };
  page.on("console", (m) => { if (m.type() === "error") log.errors.push(m.text()); });
  page.on("pageerror", (e) => log.pageErrors.push(e.message));
  page.on("request", (r) => {
    const url = r.url();
    log.all.push(r.method() + " " + url);
    if (url.includes("/api/connect")) log.connect.push({ method: r.method(), url: url.replace(/^.*\/api\/connect/, ""), body: r.postData() });
  });
  return { ctx, page, log, user: u };
}

export async function openMessages(s, wait = true) {
  await s.page.goto(APP + "/messages");
  if (wait) await s.page.waitForSelector('[data-testid="messages-app"], [data-testid="messages-locked"]', { timeout: 20000 });
}

export function harness(title) {
  const t = { pass: 0, fail: 0, failures: [], title };
  t.ok = (cond, label, extra) => {
    if (cond) t.pass++;
    else { t.fail++; t.failures.push(label + (extra !== undefined ? " :: " + JSON.stringify(extra).slice(0, 300) : "")); console.log("  FAIL:", label, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ""); }
  };
  t.eq = (a, b, label) => t.ok(JSON.stringify(a) === JSON.stringify(b), label, { got: a, want: b });
  t.done = () => {
    console.log(`${title}: ${t.pass} passed, ${t.fail} failed`);
    for (const f of t.failures) console.log("  FAIL: " + f);
    return t.fail ? 1 : 0;
  };
  return t;
}
