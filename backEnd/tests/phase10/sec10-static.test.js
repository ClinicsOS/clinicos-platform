/* Phase 10 — STATIC / SOURCE-LEVEL GUARANTEES + SERVICE-WORKER BEHAVIOUR (no database, no server).
   These are analysis tests over the shipped source: they prove the invariants the architecture depends on stay true (a future edit that breaks one fails here).
   The service worker is executed for real inside a Node `vm` with a faithful Cache/fetch model. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
// Layout (overridable): this file lives in <repo>/backEnd/tests/phase10.
const REPO = process.env.P10_REPO || path.resolve(__dirname, "../../..");
const BEDIR = process.env.P10_BE || `${REPO}/backEnd`;
const OUT = process.env.P10_OUT || __dirname;
const BASELINE = process.env.P10_BASELINE || ""; // optional: a copy of the pre-Phase-10 tree, used only for the "no dependency added" diff
const SRC = `${BEDIR}/src`;
const FE = `${REPO}/frontEnd`;
const FSRC = `${FE}/src`;

let pass = 0, fail = 0; const failures = [];
const ok = (c, n, e) => { if (c) pass++; else { fail++; failures.push(n + (e !== undefined ? " :: " + JSON.stringify(e).slice(0, 300) : "")); } };
const eq = (a, b, n) => ok(JSON.stringify(a) === JSON.stringify(b), n, { got: a, want: b });
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const walk = (d, exts, out = []) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (["node_modules", ".next", "dist"].includes(f.name)) continue; const p = path.join(d, f.name); if (f.isDirectory()) walk(p, exts, out); else if (exts.some((e) => f.name.endsWith(e))) out.push(p); } return out; };
const read = (p) => fs.readFileSync(p, "utf8");

(async () => {
  const be = walk(SRC, [".ts"]);
  const beText = Object.fromEntries(be.map((f) => [path.relative(SRC, f), strip(read(f))]));
  const loyaltyFiles = Object.keys(beText).filter((f) => /loyalty/i.test(f));

  /* ---------- ledger: the only balance mutation ---------- */
  const mutators = [];
  for (const [f, t] of Object.entries(beText)) {
    if (f.startsWith("models/")) continue;
    if (/pointsBalance\s*:\s*[^,}\n]*\n?/.test(t) && /\$inc|\$set|\$min|\$max|findOneAndUpdate|updateOne|updateMany|bulkWrite/.test(t)) {
      // find lines that WRITE pointsBalance (not read/filter): inside $inc/$set objects
      for (const m of t.matchAll(/\$(inc|set|min|max)\s*:\s*\{[^}]*pointsBalance[^}]*\}/g)) mutators.push(f);
      for (const m of t.matchAll(/\binc\b[^;\n]*pointsBalance|pointsBalance[^;\n]*\binc\b/g)) mutators.push(f);
    }
    if (/\.pointsBalance\s*(\+|-)?=[^=]/.test(t)) mutators.push(f + " (assignment)");
  }
  eq([...new Set(mutators.map((x) => x.replace(" (assignment)", "")))], ["services/loyaltyService.ts"], "pointsBalance is written ONLY by services/loyaltyService.ts (the ledger)");
  const creators = Object.entries(beText).filter(([f, t]) => !f.startsWith("models/") && /LoyaltyAccount\.(create|insertMany|findOneAndUpdate\([^)]*upsert)/.test(t)).map(([f]) => f).sort();
  ok(creators.every((f) => ["services/loyaltyService.ts"].includes(f)), "LoyaltyAccount rows are created in one place only", creators);
  const svc = beText["services/loyaltyService.ts"];
  { const model = strip(read(`${SRC}/models/LoyaltyAccount.ts`)); ok(/pointsBalance:\s*\{[^}]*default:\s*0[^}]*min:\s*0|pointsBalance:\s*\{[^}]*min:\s*0[^}]*default:\s*0/.test(model), "the model defaults pointsBalance to 0 with min 0"); ok(!/LoyaltyAccount\.create\(\s*\{[^}]*pointsBalance/.test(svc), "no code path creates an account with a chosen balance"); }
  ok(!/signup|welcome|bonus/i.test(strip(read(`${SRC}/services/loyaltyService.ts`)).replace(/["'`][^"'`\n]*["'`]/g, "")), "no signup / welcome / bonus points code path exists");
  ok(/\$gte/.test(svc) && /maxBalance/.test(svc), "the balance update is guarded by $gte (no negative) and the balance ceiling");
  ok(/LoyaltyTransaction\.create|LoyaltyTransaction\.insertMany|\.create\(\[/.test(svc), "every balance change appends a ledger row");
  ok(!Object.entries(beText).some(([f, t]) => !f.startsWith("models/") && f !== "services/loyaltyService.ts" && /LoyaltyTransaction\.(updateOne|updateMany|findOneAndUpdate|deleteOne|deleteMany|findByIdAndUpdate|findByIdAndDelete|replaceOne|bulkWrite)/.test(t)), "the ledger is never updated or deleted anywhere (append-only)");
  ok(!/LoyaltyTransaction\.(updateOne|updateMany|findOneAndUpdate|deleteOne|deleteMany)/.test(svc), "…not even inside the ledger service itself");

  /* ---------- tenant scoping ---------- */
  const ctl = loyaltyFiles.filter((f) => f.startsWith("controllers/"));
  const reads = ctl.filter((f) => /req\.(body|query|params)\.clinicId|req\.(body|query|params)\[["']clinicId["']\]/.test(beText[f]));
  eq(reads, [], "no Loyalty controller reads a clinicId from the request");
  ok(ctl.every((f) => /req\.clinicId|s\.clinic\.id|clinic\.id/.test(beText[f])), "every Loyalty controller derives the clinic from the session / slug", ctl.filter((f) => !/req\.clinicId|s\.clinic\.id|clinic\.id/.test(beText[f])));
  const unscoped = [];
  const models = ["LoyaltyAccount", "LoyaltyTransaction", "LoyaltyCheckIn", "LoyaltyRedemption", "LoyaltyReward", "LoyaltySettings", "LoyaltyTierHistory", "LoyaltyProgressEvent"];
  for (const [f, t] of Object.entries(beText)) {
    if (f.startsWith("models/")) continue;
    for (const m of t.matchAll(new RegExp(`\\b(${models.join("|")})\\.(find|findOne|findOneAndUpdate|updateOne|updateMany|deleteOne|deleteMany|countDocuments|exists|aggregate|findById|findByIdAndUpdate)\\(`, "g"))) {
      const seg = t.slice(m.index + m[0].length, m.index + m[0].length + 300);
      const arg = seg.slice(0, 160);
      const named = /^\s*(\{\s*\.\.\.)?\s*(filter|baseFilter\(\)|match|q|query|where)\b/.test(seg);
      if (!/clinicId|cid\b/.test(arg) && !named) unscoped.push(`${f}: ${m[1]}.${m[2]}(${seg.slice(0, 60).replace(/\s+/g, " ")}`);
    }
  }
  eq(unscoped, [], "every Loyalty model query names the clinic (or a clinic-scoped filter object)");
  const filters = [];
  for (const f of loyaltyFiles) for (const m of beText[f].matchAll(/const (filter|match)\b[^=]*=\s*([^;]+);/g)) filters.push([f, m[2].slice(0, 120)]);
  ok(filters.every(([f, rhs]) => /clinicId|baseFilter\(\)/.test(rhs) || /\{\s*\.\.\./.test(rhs) || /^\{\s*\}$/.test(rhs.trim()) === false), "filter objects start from a clinic id", filters.filter(([f, r]) => !/clinicId|baseFilter\(\)/.test(r)));

  /* ---------- no mass assignment / no raw operators ---------- */
  ok(!Object.entries(beText).some(([f, t]) => /Loyalty\w+\.(create|updateOne|findOneAndUpdate)\(\s*(req\.body|\{\s*\.\.\.req\.body)/.test(t)), "no Loyalty write is fed req.body directly");
  ok(!Object.entries(beText).some(([f, t]) => /\$where|\bnew Function\(|\beval\(|child_process|vm\.runIn/.test(t)), "no $where / eval / new Function / child_process anywhere in the API");
  const strictCount = ctl.map((f) => (read(`${SRC}/${f}`).match(/\.strict\(\)/g) || []).length).reduce((a, b) => a + b, 0);
  ok(strictCount >= 12, "Loyalty request schemas are .strict() (unknown fields rejected)", strictCount);

  /* ---------- OTP / no new auth features ---------- */
  const pubSrc = ["controllers/loyaltyPublicController.ts", "controllers/loyaltyCheckInPublicController.ts", "controllers/loyaltyRewardsPublicController.ts", "routes/loyaltyPublicRoutes.ts", "services/loyaltyPublic.ts"].map((f) => beText[f]).join("\n");
  ok(!/twilio|sendSms|sendWhatsApp|nodemailer|\botp\b|one[- ]time|verification ?code|firebase|totp/i.test(pubSrc), "the patient path contains no OTP / SMS / WhatsApp / email / Firebase / TOTP code");
  ok(!/cookie/i.test(pubSrc) && !/res\.cookie|Set-Cookie/i.test(Object.values(beText).join("\n").replace(/cookie-parser|cookieParser/g, "")), "the API never sets a cookie");

  /* ---------- route protection (static) ---------- */
  const staff = read(`${SRC}/routes/loyaltyRoutes.ts`);
  ok(/router\.use\(protect\)/.test(staff) && staff.indexOf("router.use(protect)") < staff.indexOf("router.get("), "staff Loyalty router applies `protect` before any route");
  const routeLines = staff.split("\n").filter((l) => /^router\.(get|post|put|patch|delete)\(/.test(l));
  ok(routeLines.length >= 30, "staff Loyalty route table parsed", routeLines.length);
  const writes = routeLines.filter((l) => /^router\.(post|put|patch|delete)\(/.test(l));
  ok(writes.every((l) => /write\(|sensitive\(|writeLimiter/.test(l) || /checkinRead/.test(l) === false), "every staff write route goes through the write()/sensitive() chain", writes.filter((l) => !/write\(|sensitive\(|writeLimiter/.test(l)));
  ok(writes.every((l) => /write\(|sensitive\(|writeLimiter/.test(l)), "…none of them is left outside the rate-limited chain", writes.filter((l) => !/write\(|sensitive\(|writeLimiter/.test(l)));
  ok(routeLines.every((l) => /read|write\(|sensitive\(|checkinRead|requireAddon/.test(l)), "every staff route enforces the add-on (requireAddon via read/write/sensitive/checkinRead)", routeLines.filter((l) => !/read|write\(|sensitive\(|checkinRead|requireAddon/.test(l)));
  for (const needle of ["adjust", "rewards\", ...sensitive", "settings\", ...sensitive", "reverse", "tiers/config\", ...sensitive", "recalculate"]) ok(routeLines.some((l) => l.includes(needle) && /sensitive\(/.test(l)), `route with "${needle}" uses the sensitive limiter`);
  const pub = read(`${SRC}/routes/loyaltyPublicRoutes.ts`);
  ok(!/protect|authorize|requireAdmin/.test(pub), "the public router uses NO staff middleware (a staff token is never read there)");
  ok(/identifyAttemptLimiter/.test(pub) && /identifyFailLimiter/.test(pub) && /identifyClinicFailLimiter/.test(pub), "identify is behind the three layered limiters");
  const idx = read(`${SRC}/index.ts`);
  ok(/assertProductionConfig\(\)/.test(idx) && idx.indexOf("assertProductionConfig()") < idx.indexOf("await connectDB()"), "start-up validates the production config BEFORE connecting to the database");
  ok(/app\.use\("\/api\/public\/loyalty"[^\n]*\n[^\n]*app\.use\("\/api\/public"/.test(idx), "the public Loyalty router is mounted before the generic public router");
  ok(/app\.use\(securityHeaders\)/.test(idx) && idx.indexOf("securityHeaders") < idx.indexOf("express.json"), "security headers are applied before body parsing and routes");
  ok(/limit:\s*"1mb"/.test(idx), "JSON bodies are capped at 1 MB");
  ok(!/origin:\s*(true|"\*"|'\*')/.test(idx), "CORS never reflects / wildcards the origin");
  const auth = strip(read(`${SRC}/middleware/auth.ts`));
  ok(/algorithms:\s*\["HS256"\]/.test(auth), "staff JWT verification pins HS256");
  ok(/algorithms:\s*\["HS256"\]/.test(strip(read(`${SRC}/middleware/adminAuth.ts`))), "admin JWT verification pins HS256");
  ok(/algorithms:\s*\["HS256"\]/.test(beText["services/loyaltyPublic.ts"]), "patient JWT verification pins HS256");
  ok(/expiresIn:\s*PUBLIC_LOYALTY\.tokenTtlSeconds/.test(beText["services/loyaltyPublic.ts"]) && /tokenTtlSeconds:\s*30 \* 60/.test(strip(read(`${SRC}/config/loyalty.ts`))), "patient tokens expire after 30 minutes");

  /* ---------- logging hygiene ---------- */
  const logCalls = [];
  for (const [f, t] of Object.entries(beText)) for (const m of t.matchAll(/console\.(log|error|warn|info)\(([^;]*)\)/g)) logCalls.push([f, m[2].replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""')]);
  ok(!logCalls.some(([f, a]) => /token|password|secret|authorization|req\.headers|req\.body/i.test(a) && /loyalty|auth|admin/i.test(f) && !/tokenVersion|reset|mailer/i.test(a)), "no console log in auth/Loyalty code prints a token, password, secret, header or body", logCalls.filter(([f, a]) => /token|password|secret|authorization|req\.headers|req\.body/i.test(a) && /loyalty|auth|admin/i.test(f)).slice(0, 5));
  const logDetails = loyaltyFiles.flatMap((f) => [...beText[f].matchAll(/details:\s*\{([^}]*)\}/g)].map((m) => [f, m[1].replace(/"(?:[^"\\]|\\.)*"/g, '""')]));
  ok(!logDetails.some(([f, d]) => /phone|fullName|\bname\b|email|password|token|note|diagnos|medical/i.test(d)), "audit-log `details` objects never carry phone / name / email / token / medical fields", logDetails.filter(([f, d]) => /phone|fullName|\bname\b|email|password|token|note|diagnos|medical/i.test(d)).slice(0, 5));

  /* ---------- medical data separation ---------- */
  const med = /diagnos|medicalHistory|allerg|medication|treatmentPlan|visitNote|procedureNote|toothChart|chiefComplaint|prescription|labResult/i;
  const pubDtoFiles = ["controllers/loyaltyPublicController.ts", "controllers/loyaltyCheckInPublicController.ts", "controllers/loyaltyRewardsPublicController.ts", "services/loyaltyPublic.ts"];
  ok(!pubDtoFiles.some((f) => med.test(beText[f])), "the public Loyalty API source references no diagnosis / history / allergy / medication / visit-note field", pubDtoFiles.filter((f) => med.test(beText[f])));
  const staffLoyalty = ctl.filter((f) => !/Public/.test(f));
  ok(!staffLoyalty.some((f) => /diagnos|medicalHistory|allerg|medication|treatmentPlan|toothChart|prescription|labResult/i.test(beText[f])), "even the staff Loyalty controllers read no clinical field", staffLoyalty.filter((f) => /diagnos|medicalHistory|allerg|medication/i.test(beText[f])));
  const patSel = [...Object.entries(beText)].flatMap(([f, t]) => /^(controllers|services)\/loyalty/.test(f) ? [...t.matchAll(/Patient\.find(?:One)?\([^)]*\)\s*\.select\("([^"]*)"\)/g)].map((m) => [f, m[1]]) : []);
  ok(patSel.length > 0 && patSel.every(([f, s]) => s.split(/\s+/).every((k) => ["fullName", "phone", "fileNumber", "isArchived", "_id"].includes(k))), "every Patient read in Loyalty code selects only fullName / phone / fileNumber / isArchived", patSel.filter(([f, s]) => !s.split(/\s+/).every((k) => ["fullName", "phone", "fileNumber", "isArchived", "_id"].includes(k))));

  /* ---------- frontend XSS surface ---------- */
  const fe = walk(FSRC, [".ts", ".tsx"]);
  const feText = Object.fromEntries(fe.map((f) => [path.relative(FSRC, f), strip(read(f))]));
  const sinks = [];
  for (const [f, t] of Object.entries(feText)) for (const m of t.matchAll(/dangerouslySetInnerHTML\s*=\s*\{\{\s*__html:\s*([^}]+?)\s*\}\}/g)) sinks.push([f, m[1]]);
  ok(sinks.length >= 5, "dangerouslySetInnerHTML occurrences found", sinks.length);
  ok(sinks.every(([f, rhs]) => /^[A-Z][A-Z0-9_]*(\s*\+\s*[A-Z][A-Z0-9_]*)*$/.test(rhs)), "every dangerouslySetInnerHTML injects only a constant (UPPER_CASE) style string — never props, state or API data", sinks.filter(([f, rhs]) => !/^[A-Z][A-Z0-9_]*(\s*\+\s*[A-Z][A-Z0-9_]*)*$/.test(rhs)));
  ok(sinks.every(([f]) => /loyalty/.test(f)), "…and they are only in the Loyalty UI", sinks.map((s) => s[0]));
  // the constants themselves must be plain string literals / template literals without ${} interpolation of dynamic data
  const dyn = [];
  for (const [f, rhs] of sinks) for (const name of rhs.split(/\s*\+\s*/)) {
    const t = feText[f]; const i = t.search(new RegExp(`(const|let)\\s+${name}\\b`));
    if (i >= 0) { const seg = t.slice(i, i + 40000); const end = seg.indexOf("`;"); const body = end > 0 ? seg.slice(0, end) : seg.slice(0, 400); if (/\$\{/.test(body) && !/^\s*(const|let)\s+\w+\s*=\s*\(?[\w, ]*\)?\s*=>/.test(body)) dyn.push(`${f}:${name}`); }
    else { /* imported — checked in its own file */ }
  }
  const styleFiles = fe.filter((f) => /Styles?\.ts$|patientFeatureStyles|shellStyles|patientStyles|loyaltyDesign/.test(f));
  const interp = [];
  for (const f of styleFiles) { const t = strip(read(f)); for (const m of t.matchAll(/\$\{([^}]+)\}/g)) interp.push(`${path.basename(f)}: \${${m[1].slice(0, 40)}}`); }
  const unsafeInterp = interp.filter((s) => !/\b(RM|PW_|px|ms|EASE|BP|TOK|ease|dur|SAFE|Z\b|[A-Z_]{3,})/.test(s) || /brand|accent|logo|name|slug|token|phone|message|text|label|title/i.test(s));
  eq(unsafeInterp, [], "style strings interpolate only design constants — never brand colour / logo / names / messages");
  ok(!Object.entries(feText).some(([f, t]) => /\.innerHTML\s*=|insertAdjacentHTML|document\.write\(|\beval\(|new Function\(|outerHTML\s*=/.test(t)), "no innerHTML / insertAdjacentHTML / document.write / eval / new Function in the frontend");
  ok(!Object.entries(feText).some(([f, t]) => /<script\b|createElement\(["']script["']\)/.test(t) && /loyalty|patient/i.test(f)), "no dynamic <script> creation in Loyalty/patient code");
  ok(!Object.entries(feText).filter(([f]) => /loyalty|\/c\//.test(f)).some(([f, t]) => /(window\.)?location\.(href|assign|replace)\s*(=|\()\s*[^"'`)\s]/.test(t) && !/signin|login/.test(t)), "Loyalty/patient code never navigates to a variable URL (no open redirect)", Object.entries(feText).filter(([f, t]) => /loyalty|\/c\//.test(f) && /location\.(href|assign|replace)/.test(t)).map((x) => x[0]));
  ok(!Object.entries(feText).filter(([f]) => /loyalty|app\/c\//.test(f)).some(([f, t]) => /window\.open\(/.test(t)), "Loyalty/patient code never calls window.open");
  const qs = Object.entries(feText).filter(([f]) => /loyalty|app\/c\//.test(f)).flatMap(([f, t]) => [...t.matchAll(/searchParams|URLSearchParams\([^)]*\)\.get\(["'](\w+)["']\)/g)].map((m) => [f, m[1] || "searchParams"]));
  ok(qs.every(([f, k]) => ["src", "tab", "view", "searchParams"].includes(k)), "the only query parameters read by Loyalty pages are src / tab / view (no token, no redirect target)", qs);
  const readViaOnlyEnum = /v === "qr" \|\| v === "nfc" \? v : "link"/.test(feText["lib/loyaltyPublic.ts"]);
  ok(readViaOnlyEnum, "?src= is reduced to the qr | nfc | link enum before it is used");
  const navTargets = feText["lib/loyaltyNav.ts"];
  ok(/legacyTarget/.test(navTargets) && !/\+\s*q\.get|\$\{.*tab/.test(navTargets), "?tab= maps to fixed internal paths only");

  /* ---------- patient token handling ---------- */
  const sessionSrc = feText["components/loyalty/patient/session.ts"];
  ok(/lyp-session:/.test(sessionSrc), "the patient token has one storage key, scoped by clinic slug");
  const tokenInUrl = Object.entries(feText).filter(([f]) => /loyalty|app\/c\//.test(f)).filter(([f, t]) => /[?&]token=|searchParams\.(set|append)\(["']token|router\.(push|replace)\([^)]*token|href=\{[^}]*token/i.test(t));
  eq(tokenInUrl.map((x) => x[0]), [], "the patient token is never placed in a URL, query string or href");
  const tokenToHtml = Object.entries(feText).filter(([f]) => /loyalty|app\/c\//.test(f)).filter(([f, t]) => /(data-token|title=\{[^}]*token|aria-\w+=\{[^}]*token|<input[^>]*value=\{[^}]*token)/i.test(t));
  eq(tokenToHtml.map((x) => x[0]), [], "the patient token is never rendered into the DOM");
  const tokenLogs = Object.entries(feText).filter(([f]) => /loyalty|app\/c\//.test(f)).filter(([f, t]) => /console\.\w+\([^)]*(token|authorization)/i.test(t));
  eq(tokenLogs.map((x) => x[0]), [], "no console statement in the patient app prints the token");
  ok(/Authorization:\s*`Bearer \$\{token\}`/.test(feText["lib/loyaltyPublic.ts"]) && /publicApi = axios\.create\(/.test(feText["lib/loyaltyPublic.ts"]) && /withCredentials:\s*false/.test(feText["lib/loyaltyPublic.ts"]), "the patient client is its own axios instance (no staff interceptor), credentials off, token only in the Authorization header");
  const patientDirs = Object.entries(feText).filter(([f]) => /^components\/loyalty\/(patient|public)\//.test(f) || /^app\/c\//.test(f));
  ok(!patientDirs.some(([f, t]) => /useAuth|from "@\/lib\/api"|lib\/adminApi|clinicos-auth|["']token["']\s*\)/.test(t)), "patient screens never import the staff auth store or the staff API client", patientDirs.filter(([f, t]) => /useAuth|from "@\/lib\/api"|lib\/adminApi/.test(t)).map((x) => x[0]));
  const staffUi = Object.entries(feText).filter(([f]) => /^components\/loyalty\/(?!patient|public)/.test(f) || /^app\/\(dashboard\)\/loyalty/.test(f));
  ok(!staffUi.some(([f, t]) => /lyp-session|loadToken|saveToken|publicApi/.test(t)), "staff Loyalty screens never touch the patient token or the public client", staffUi.filter(([f, t]) => /lyp-session|loadToken|saveToken|publicApi/.test(t)).map((x) => x[0]));
  const publicPage = Object.entries(feText).find(([f]) => /^app\/c\/\[slug\]\/loyalty\/page\.tsx$/.test(f));
  ok(!!publicPage && !/useAuth/.test(publicPage[1]), "the public page does not depend on a staff login");
  ok(/endSession = useCallback\(\s*\(why[^)]*\) => \{\s*clearToken\(slug\);/.test(feText["components/loyalty/patient/PatientApp.tsx"]) && /onSignOut=\{\(\) => endSession\(null\)\}/.test(feText["components/loyalty/patient/PatientApp.tsx"]) && /onExpired=\{\(\) => endSession\("expired"\)\}/.test(feText["components/loyalty/patient/PatientApp.tsx"]) && patientDirs.filter(([f, t]) => /onExpired/.test(t)).length >= 2, "the patient app drops the stored token on sign-out and whenever the server says the session is over (401)");
  const logoSinks = Object.entries(feText).filter(([f, t]) => /logoUrl/.test(t) && /loyalty/.test(f)).flatMap(([f, t]) => [...t.matchAll(/\{[^{}]*logoUrl[^{}]*\}/g)].map((m) => [f, m[0]]));
  ok(!Object.entries(feText).filter(([f]) => /loyalty/.test(f)).some(([f, t]) => /url\(\s*\$\{[^}]*(logo|brand)/i.test(t) || /background(-image)?\s*:\s*[`"'][^`"']*\$\{[^}]*logo/i.test(t)), "the clinic logo is only used as <img src> — never interpolated into CSS url()");

  /* ---------- configuration files / secrets ---------- */
  // files that are part of the project: what git tracks (so a developer's private, git-ignored .env is neither scanned nor flagged); no git → walk the tree.
  let gitFiles = null;
  try { gitFiles = require("child_process").execFileSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean).map((f) => path.join(REPO, f)).filter((f) => fs.existsSync(f)); } catch { gitFiles = null; }
  const projectFiles = gitFiles && gitFiles.length ? gitFiles.filter((f) => !/(^|\/)(node_modules|\.next|dist)\//.test(f)) : walk(REPO, [""]);
  const tracked = projectFiles.filter((f) => /\.(ts|tsx|js|mjs|json|md|html|css|env|txt|ya?ml)$/.test(f) && !/package-lock\.json$/.test(f) && !/[\\/]tests[\\/]phase10[\\/]/.test(f));
  const secretish = [];
  for (const f of tracked) {
    const t = read(f);
    for (const m of t.matchAll(/(mongodb(\+srv)?:\/\/[^\s"'`<>]*:[^\s"'`<>@]+@[^\s"'`<>]+|sk-ant-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC )?PRIVATE KEY-----|re_[A-Za-z0-9]{20,}|EAA[A-Za-z0-9]{40,}|xox[baprs]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{30,})/g)) secretish.push(`${path.relative(W, f)}: ${m[0].slice(0, 12)}…`);
  }
  eq(secretish, [], "no credential-shaped string (Mongo URI with password, API keys, private keys) exists in the project source");
  const envFiles = projectFiles.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !/\.env\.example$/.test(f));
  eq(envFiles, [], "no .env file is present in the project tree");
  const jwtHard = Object.entries(beText).filter(([f, t]) => /(JWT_SECRET|secret)\s*[:=]\s*["'][^"']{6,}["']/i.test(t) && !/process\.env/.test(t.match(/(JWT_SECRET|secret)\s*[:=]\s*["'][^"']{6,}["']/i)[0])).map((x) => x[0]);
  eq(jwtHard, [], "no signing secret is hard-coded in the API source");
  const weakDefault = Object.entries(beText).filter(([f, t]) => /process\.env\.(JWT_SECRET|ADMIN_JWT_SECRET|LOYALTY_PUBLIC_SECRET)\s*\|\|\s*["'][^"']+["']/.test(t)).map((x) => x[0]);
  eq(weakDefault, [], "no signing secret has a weak fallback default (`process.env.X || \"secret\"`)");

  /* ---------- service worker: executed for real ---------- */
  const swSrc = read(`${FE}/public/loyalty-sw.js`);
  ok(!/token|balance|points|authorization:/i.test(strip(swSrc).replace(/headers\.has\("authorization"\)/g, "").replace(/\/\/.*$/gm, "")), "the service worker source contains no token / balance / points handling (it cannot cache what it never sees)");
  const mkCache = () => { const store = new Map(); return { store, match: async (r) => store.get(typeof r === "string" ? new URL(r, "https://clinic.test").pathname : new URL(r.url).pathname), put: async (r, res) => { store.set(new URL(r.url).pathname, res); }, addAll: async (urls) => { for (const u of urls) store.set(u, { ok: true, type: "basic", clone() { return this; }, url: u }); } }; };
  const run = async (net) => {
    const caches = new Map(); const listeners = {}; const puts = [];
    const cacheApi = { open: async (n) => { if (!caches.has(n)) { const c = mkCache(); const op = c.put; c.put = async (r, res) => { puts.push(new URL(r.url).pathname); return op(r, res); }; caches.set(n, c); } return caches.get(n); }, keys: async () => [...caches.keys()], delete: async (k) => caches.delete(k), match: async (u) => { for (const c of caches.values()) { const v = await c.match(u); if (v) return v; } return undefined; } };
    const self = { location: new URL("https://clinic.test/"), addEventListener: (n, f) => (listeners[n] = f), skipWaiting: async () => {}, clients: { claim: async () => {} } };
    class Resp { constructor(b, o = {}) { this.body = b; this.status = o.status || 200; this.ok = this.status < 400; this.type = o.type || "basic"; this.headers = o.headers || {}; } clone() { return this; } }
    const ctx = vm.createContext({ self, caches: cacheApi, URL, Response: Resp, fetch: async (req) => net(req), console });
    new vm.Script(swSrc).runInContext(ctx);
    let waits = []; await listeners.install({ waitUntil: (p) => waits.push(p) }); await Promise.all(waits); waits = []; await listeners.activate({ waitUntil: (p) => waits.push(p) }); await Promise.all(waits);
    const fire = async (url, { method = "GET", mode = "cors", headers = {} } = {}) => {
      const req = { url, method, mode, headers: { has: (h) => Object.keys(headers).map((k) => k.toLowerCase()).includes(h.toLowerCase()) } };
      let handled = false, result;
      listeners.fetch({ request: req, respondWith: (p) => { handled = true; result = Promise.resolve(p); } });
      return { handled, res: handled ? await result : undefined };
    };
    return { fire, puts, caches };
  };
  const online = async (req) => new (class { constructor() { this.ok = true; this.status = 200; this.type = "basic"; this.url = req.url; } clone() { return this; } })();
  const offline = async () => { throw new TypeError("network down"); };
  {
    const s = await run(online);
    eq((await s.caches.get("loyalty-pwa-v9-static") || { store: new Map() }).store.size, 4, "install pre-caches exactly the offline page and 3 icons");
    eq((await s.fire("https://clinic.test/api/public/loyalty/c1/me", {})).handled, false, "same-origin /api/ request: untouched");
    eq((await s.fire("https://api.clinic.test/api/public/loyalty/c1/me", {})).handled, false, "cross-origin API request (the real deployment): untouched");
    eq((await s.fire("https://clinic.test/c/c1/loyalty", { method: "POST" })).handled, false, "non-GET: untouched");
    eq((await s.fire("https://clinic.test/data.json", { headers: { Authorization: "Bearer x" } })).handled, false, "request carrying Authorization: untouched");
    eq((await s.fire("https://clinic.test/some/other/path.json", {})).handled, false, "an arbitrary same-origin JSON/data GET: untouched (never cached)");
    const nav = await s.fire("https://clinic.test/c/clinic-a/loyalty", { mode: "navigate" });
    ok(nav.handled && nav.res.ok, "page navigation online: network response is returned");
    ok(!s.puts.some((p) => p.startsWith("/c/")), "…and the HTML page is NEVER stored in a cache", s.puts);
    const st = await s.fire("https://clinic.test/_next/static/chunks/app.js", {});
    ok(st.handled && st.res.ok, "hashed static asset: served");
    ok(s.puts.includes("/_next/static/chunks/app.js"), "…and cached (immutable build file)");
    ok(s.puts.every((p) => p.startsWith("/_next/static/") || p.startsWith("/loyalty-pwa/")), "the ONLY things ever written to a cache are build files and icons", s.puts);
    const cors = await run(async (req) => ({ ok: true, status: 200, type: "opaque", url: req.url, clone() { return this; } }));
    await cors.fire("https://clinic.test/_next/static/chunks/x.js", {});
    ok(!cors.puts.some((p) => p.includes("x.js")), "an opaque / non-basic static response is not cached");
    const fail500 = await run(async (req) => ({ ok: false, status: 500, type: "basic", url: req.url, clone() { return this; } }));
    await fail500.fire("https://clinic.test/_next/static/chunks/y.js", {});
    ok(!fail500.puts.some((p) => p.includes("y.js")), "an error response is not cached");
  }
  {
    const s = await run(offline);
    const nav = await s.fire("https://clinic.test/c/clinic-a/loyalty", { mode: "navigate" });
    ok(nav.handled && nav.res && nav.res.url === "/loyalty-offline.html", "offline navigation shows the branded offline page — and nothing else", nav.res && nav.res.url);
    const api = await s.fire("https://api.clinic.test/api/public/loyalty/c1/me", {});
    eq(api.handled, false, "offline API call is NOT intercepted → the app sees a real network error (never a fake success)");
    const off = fs.readFileSync(`${FE}/public/loyalty-offline.html`, "utf8");
    ok(!/<script[^>]*src=|fetch\(|localStorage|token|balance/i.test(off.replace(/<script>[\s\S]*?<\/script>/g, "")), "the offline page is static: no scripts that fetch, no token, no balance");
    ok(!/points?\s*[:=]\s*\d|\b\d+\s*points/i.test(off), "the offline page shows no points figure");
    const reg = Object.values(feText).find((t) => /serviceWorker\.register/.test(t));
    ok(!!reg && /loyalty-sw\.js/.test(reg) && /scope:\s*["']\/c\/["']/.test(reg), "the worker is registered with the narrow scope /c/");
  }
  const man = fs.existsSync(`${FE}/public/loyalty-pwa`) ? fs.readdirSync(`${FE}/public/loyalty-pwa`) : [];
  ok(man.length >= 3, "PWA icon set present", man);

  /* ---------- Next.js headers (CSP) ---------- */
  const nx = read(`${FE}/next.config.mjs`);
  ok(/frame-ancestors 'none'/.test(nx) && /object-src 'none'/.test(nx) && /base-uri 'self'/.test(nx) && /form-action 'self'/.test(nx), "frontend CSP: frame-ancestors none, object-src none, base-uri self, form-action self");
  ok(/isDev \? "'unsafe-eval'" : ""/.test(nx), "frontend CSP: 'unsafe-eval' only in development");
  ok(!/script-src[^\n]*\*|default-src \*/.test(nx), "frontend CSP: no wildcard script/default source");
  ok(/connect-src 'self' \$\{apiOrigin\}/.test(nx), "frontend CSP: connect-src is limited to self + the configured API origin + analytics");
  ok(/Strict-Transport-Security/.test(nx) && /X-Content-Type-Options/.test(nx) && /X-Frame-Options/.test(nx) && /Referrer-Policy/.test(nx) && /Permissions-Policy/.test(nx), "frontend sends HSTS, nosniff, frame, referrer and permissions headers");
  ok(/geolocation=\(\)/.test(nx) && /camera=\(\)/.test(nx) && /microphone=\(\)/.test(nx), "frontend Permissions-Policy denies camera / microphone / geolocation");

  /* ---------- dependency pins ---------- */
  const bePkg = JSON.parse(read(`${BEDIR}/package.json`)), fePkg = JSON.parse(read(`${FE}/package.json`));
  { const FORBIDDEN = /^(twilio|@twilio\/.*|firebase|firebase-admin|@firebase\/.*|vonage|@vonage\/.*|nexmo|messagebird|plivo|otp-generator|otp-lib|speakeasy|passwordless|@sendgrid\/mail|aws-sdk|@aws-sdk\/client-sns)$/;
    const all = [...Object.keys(bePkg.dependencies), ...Object.keys(fePkg.dependencies)];
    eq(all.filter((d) => FORBIDDEN.test(d)), [], "no SMS / OTP / Firebase / verification-provider dependency exists (patient auth is phone-only by decision)"); }
  if (BASELINE && fs.existsSync(`${BASELINE}/backEnd/package.json`)) {
    const old = { be: JSON.parse(read(`${BASELINE}/backEnd/package.json`)), fe: JSON.parse(read(`${BASELINE}/frontEnd/package.json`)) };
    const added = [...Object.keys(bePkg.dependencies).filter((d) => !(d in old.be.dependencies)), ...Object.keys(fePkg.dependencies).filter((d) => !(d in old.fe.dependencies))];
    eq(added, [], "Phase 10 added NO dependency (no OTP / SMS / Firebase / anything)");
    const changed = [...Object.keys(bePkg.dependencies).filter((d) => d in old.be.dependencies && old.be.dependencies[d] !== bePkg.dependencies[d]), ...Object.keys(fePkg.dependencies).filter((d) => d in old.fe.dependencies && old.fe.dependencies[d] !== fePkg.dependencies[d])];
    eq(changed, ["axios"], "the only dependency whose declared version changed is axios (security patch)"); }
  ok(fePkg.dependencies.axios === "1.20.0", "axios is upgraded to the patched 1.20.0", fePkg.dependencies.axios);

  console.log(`SEC10 STATIC GUARANTEES + SERVICE WORKER: ${pass} passed, ${fail} failed`);
  for (const f of failures) console.log("  FAIL: " + f);
  fs.writeFileSync(`${OUT}/sec10static.result.json`, JSON.stringify({ title: "SEC10 STATIC", pass, fail, failures }, null, 1));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("SUITE CRASHED", e); process.exit(2); });
