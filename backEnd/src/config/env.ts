/**
 * Production configuration validation (Phase 10).
 *
 * Called ONCE at start-up, before the database connection and before the server listens. In production a missing or obviously
 * weak secret stops the process with a clear message (it never starts "half secure"); outside production the same findings are
 * only warnings, so local development and the test-suite keep working with throw-away values.
 *
 * Messages name the VARIABLE, never its value — nothing secret is ever written to the log.
 */

/** Values that ship in tutorials / sample files and must never protect a real system. */
const WEAK_VALUES = new Set(
  [
    "secret",
    "jwt_secret",
    "jwtsecret",
    "changeme",
    "change-me",
    "change_me",
    "changethis",
    "password",
    "123456",
    "12345678",
    "123456789",
    "qwerty",
    "admin",
    "test",
    "default",
    "development",
    "development-secret",
    "dev-secret",
    "devsecret",
    "your-secret",
    "your_secret",
    "your-secret-key",
    "your_jwt_secret",
    "supersecret",
    "mysecret",
    "my-secret",
    "secretkey",
    "secret-key",
  ].map((s) => s.toLowerCase())
);

const MIN_SECRET_LENGTH = 16; // hard floor in production
const RECOMMENDED_SECRET_LENGTH = 32;

export interface EnvReport {
  errors: string[];
  warnings: string[];
}

const val = (env: NodeJS.ProcessEnv, k: string) => (env[k] ?? "").trim();

export function isWeakSecret(v: string): boolean {
  if (!v) return true;
  const low = v.toLowerCase();
  if (WEAK_VALUES.has(low)) return true;
  if (/^(.)\1+$/.test(v)) return true; // "aaaaaaaa…"
  if (/^(<|\[|\{|\$\{)?(your|change|replace|example|placeholder|todo|xxx)/i.test(v)) return true; // template text left in place
  return false;
}

function checkSecret(name: string, env: NodeJS.ProcessEnv, report: EnvReport, required: boolean) {
  const v = val(env, name);
  if (!v) {
    if (required) report.errors.push(`${name} is not set`);
    return;
  }
  if (isWeakSecret(v)) report.errors.push(`${name} is a known-weak or placeholder value`);
  else if (v.length < MIN_SECRET_LENGTH) report.errors.push(`${name} is shorter than ${MIN_SECRET_LENGTH} characters`);
  else if (v.length < RECOMMENDED_SECRET_LENGTH) report.warnings.push(`${name} is shorter than the recommended ${RECOMMENDED_SECRET_LENGTH} characters`);
}

/** Pure function (no exit, no logging) so it can be unit-tested. */
export function validateEnv(env: NodeJS.ProcessEnv = process.env): EnvReport {
  const report: EnvReport = { errors: [], warnings: [] };
  const production = env.NODE_ENV === "production";

  // --- required everywhere ---
  if (!val(env, "MONGO_URI")) report.errors.push("MONGO_URI is not set");
  checkSecret("JWT_SECRET", env, report, true);

  // --- clinic-user token vs. the admin token vs. the public Loyalty token must never share a key ---
  const jwtSecret = val(env, "JWT_SECRET");
  const adminSecret = val(env, "ADMIN_JWT_SECRET");
  const publicSecret = val(env, "LOYALTY_PUBLIC_SECRET");
  if (adminSecret) {
    checkSecret("ADMIN_JWT_SECRET", env, report, false);
    if (adminSecret === jwtSecret) report.errors.push("ADMIN_JWT_SECRET must differ from JWT_SECRET");
  } else {
    report.warnings.push("ADMIN_JWT_SECRET is not set — every platform-admin request will be refused");
  }
  if (publicSecret) {
    checkSecret("LOYALTY_PUBLIC_SECRET", env, report, false);
    if (publicSecret === jwtSecret) report.errors.push("LOYALTY_PUBLIC_SECRET must differ from JWT_SECRET");
    if (adminSecret && publicSecret === adminSecret) report.errors.push("LOYALTY_PUBLIC_SECRET must differ from ADMIN_JWT_SECRET");
  } else {
    report.warnings.push("LOYALTY_PUBLIC_SECRET is not set — the patient token key is derived from JWT_SECRET (set a separate value so rotating one does not affect the other)");
  }

  // --- browser origin ---
  const front = val(env, "FRONTEND_URL");
  if (!front) {
    report.errors.push("FRONTEND_URL is not set (production CORS would allow NO origin)");
  } else {
    try {
      const u = new URL(front);
      if (u.pathname !== "/" && u.pathname !== "") report.warnings.push("FRONTEND_URL should be an origin only (no path)");
      if (front.endsWith("/")) report.warnings.push("FRONTEND_URL has a trailing slash — the browser Origin header never has one, so CORS would not match");
      if (front.includes("*")) report.errors.push("FRONTEND_URL must not contain a wildcard");
      if (production && u.protocol !== "https:") report.errors.push("FRONTEND_URL must be https:// in production");
    } catch {
      report.errors.push("FRONTEND_URL is not a valid URL");
    }
  }

  // --- optional hardening knobs ---
  if (!val(env, "REMINDER_CRON_SECRET")) report.warnings.push("REMINDER_CRON_SECRET is not set — the scheduled reminder endpoints will refuse every call");
  else if (isWeakSecret(val(env, "REMINDER_CRON_SECRET")) || val(env, "REMINDER_CRON_SECRET").length < MIN_SECRET_LENGTH) {
    report.warnings.push("REMINDER_CRON_SECRET is weak or short — anyone who guesses it can trigger the reminder jobs"); // warning only: not a Loyalty secret
  }

  // Loyalty tuning values must be sane numbers (a typo must not silently disable a limit).
  for (const k of ["LOYALTY_SELF_ENROLL_MAX_PER_HOUR", "LOYALTY_PUBLIC_READ_MAX"]) {
    const raw = val(env, k);
    if (raw && !(Number.isInteger(Number(raw)) && Number(raw) > 0)) report.errors.push(`${k} must be a positive whole number`);
  }

  // Outside production nothing is fatal — the same findings are reported as warnings.
  if (!production) {
    report.warnings.push(...report.errors.map((e) => `(non-production) ${e}`));
    report.errors = [];
  }
  return report;
}

/** Start-up gate. Exits the process (code 1) in production when anything is wrong. */
export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  const { errors, warnings } = validateEnv(env);
  for (const w of warnings) console.warn(`[config] warning: ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`[config] ERROR: ${e}`);
    console.error("[config] Refusing to start with an unsafe production configuration. Fix the variables above and restart.");
    process.exit(1);
  }
}
