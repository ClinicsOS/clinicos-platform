/**
 * ClinicOS Loyalty — central constants for the Loyalty ENGINE (Phase 2).
 *
 * Two separate layers exist — never mix them:
 *   1. PAID ADD-ON ENTITLEMENT  → config/addons.ts + services/addons.ts (Platform Admin only, Phase 1).
 *   2. LOYALTY PROGRAM          → everything in this file and below (clinic users, only while layer 1 is active).
 *
 * IMPORTANT: no point VALUES live here. How many points a visit / a JOD earns, tier thresholds, reward costs
 * etc. are product decisions that have NOT been made. The demo numbers from the prototype (10 per visit,
 * 1 JOD = 1 point, 500 = Gold …) must never appear in this codebase as production rules.
 */

/* ---------- ledger vocabulary ---------- */

export const LOYALTY_TRANSACTION_TYPES = [
  "earn_visit",
  "earn_spending",
  "manual_credit",
  "manual_debit",
  "reward_redemption",
  "expiration",
  "reversal",
  "correction",
] as const;
export type LoyaltyTransactionType = (typeof LOYALTY_TRANSACTION_TYPES)[number];

/** Types whose points delta must be POSITIVE. */
export const CREDIT_TYPES: readonly LoyaltyTransactionType[] = ["earn_visit", "earn_spending", "manual_credit"];
/** Types whose points delta must be NEGATIVE. */
export const DEBIT_TYPES: readonly LoyaltyTransactionType[] = ["manual_debit", "reward_redemption", "expiration"];
/** Types that may go either way ("reversal" derives its sign from the transaction it reverses). */
export const SIGNED_TYPES: readonly LoyaltyTransactionType[] = ["reversal", "correction"];

/** Where a movement came from. `sourceId` identifies the record (invoice id, appointment id, check-in id…). */
export const LOYALTY_SOURCE_TYPES = ["manual", "invoice", "appointment", "checkin", "reward", "system"] as const;
export type LoyaltySourceType = (typeof LOYALTY_SOURCE_TYPES)[number];

/**
 * Earning types are idempotent per source: the same invoice / appointment / check-in can earn at most ONCE
 * (enforced by a unique index on `idempotencyKey`). They therefore must name a real source.
 */
export const IDEMPOTENT_EARN_TYPES: readonly LoyaltyTransactionType[] = ["earn_visit", "earn_spending"];
export const EARN_SOURCE_TYPES: readonly LoyaltySourceType[] = ["invoice", "appointment", "checkin"];

/** Types that REQUIRE a human-readable reason in the ledger. */
export const REASON_REQUIRED_TYPES: readonly LoyaltyTransactionType[] = ["manual_credit", "manual_debit", "reversal", "correction"];

export const LOYALTY_ACCOUNT_STATUSES = ["active", "suspended"] as const;
export type LoyaltyAccountStatus = (typeof LOYALTY_ACCOUNT_STATUSES)[number];

/**
 * How a Loyalty account came to exist (Phase 9.1).
 *   clinic           a staff member enrolled the patient from ClinicOS Loyalty
 *   self_enrollment  the patient activated Loyalty themselves from the public clinic page
 *   qr / nfc / admin RESERVED — only ever written when the system genuinely KNOWS the source. QR and NFC currently open the SAME url,
 *                    so a self-enrollment can never be attributed to one of them honestly; today nothing writes these values.
 * Accounts created before Phase 9.1 simply have no source (null).
 */
export const ENROLLMENT_SOURCES = ["clinic", "self_enrollment", "qr", "nfc", "admin"] as const;
export type EnrollmentSource = (typeof ENROLLMENT_SOURCES)[number];

/**
 * TECHNICAL sanity limits (overflow / abuse protection). These are NOT business rules about how generous a
 * program may be — those will be added as configurable, per-field limits when the points rules are decided.
 */
export const LOYALTY_TECHNICAL_LIMITS = {
  maxPointsPerTransaction: 1_000_000,
  maxBalance: 100_000_000,
  reasonMinLength: 3,
  reasonMaxLength: 300,
  metadataMaxKeys: 10,
  metadataMaxStringLength: 200,
  sourceIdMaxLength: 64,
} as const;

/* ---------- permissions (documented decisions) ---------- */

/**
 * Who may do what, per existing ClinicOS roles. Every Phase 2 clinic route reads from here, so a
 * permission change is a one-line edit. All of them additionally require an ACTIVE Loyalty add-on.
 *
 *  read       owner, doctor, receptionist — see settings, members, balances, ledger (staff already see patients).
 *  enroll     owner, doctor, receptionist — enrolling an existing patient creates a ZERO-balance account;
 *             reception does this at the desk and it cannot create points.
 *  configure  owner, doctor ONLY — changes the program itself. Receptionists never configure.
 *
 * Deliberately NOT granted to anyone in Phase 2: adjusting balances (no endpoint exists — see services/loyaltyService.ts).
 * The paid add-on itself is NEVER controllable by a clinic user (Platform Admin only, Phase 1).
 */
export const LOYALTY_ROLES = {
  read: ["owner", "doctor", "receptionist"],
  enroll: ["owner", "doctor", "receptionist"],
  configure: ["owner", "doctor"],
  /** Manual credit / debit of a member's balance. Never reception by default (money-like action). */
  adjust: ["owner", "doctor"],
  /** See and resolve patient check-in requests at the desk (Phase 5). Reception does this all day; it cannot create points. */
  checkin: ["owner", "doctor", "receptionist"],
  /** Reward catalog: create / edit / activate / deactivate / delete-if-unused (Phase 6). Reception sees rewards but never changes them. */
  rewardsManage: ["owner", "doctor"],
  /** See pending / past redemption requests and CONFIRM or REJECT them at the desk (Phase 6). Confirm deducts via the central ledger. */
  redemptionResolve: ["owner", "doctor", "receptionist"],
  /** Reverse an already CONFIRMED redemption (gives the points back). Money-like → never reception (Phase 6). */
  redemptionReverse: ["owner", "doctor"],
  /** Configure tiers (names, thresholds, metric, benefits) and run / preview recalculations (Phase 7). Reception can VIEW tiers (via `read`) but never configure. */
  tiersManage: ["owner", "doctor"],
} as const;

/* ---------- settings ---------- */

/**
 * Settings that clinic users may change in Phase 2 (structurally ready, no unresolved business rule behind them).
 * Everything else in the settings document is stored with safe defaults but is READ-ONLY until its rules are
 * decided; the API answers a clear NOT_CONFIGURABLE_YET if a client tries to write it.
 */
export const EDITABLE_SETTING_PATHS = [
  "program.enabled",
  "branding.displayName",
  "earning.visits.enabled",
  "earning.visits.pointsPerVisit",
  "earning.spending.enabled",
  "earning.spending.spendAmount",
  "earning.spending.pointsPerSpendAmount",
  "checkin.enabled",
] as const;
/** Still undecided / not built — the API answers NOT_CONFIGURABLE_YET if a client writes them. */
export const RESERVED_SETTING_SECTIONS = ["redemption", "expiration", "antiAbuse"] as const;
export const DISPLAY_NAME_MAX = 60;

/* ---------- Phase 3: configurable earning ---------- */

/**
 * TECHNICAL guardrails for the values a clinic may configure. These protect the system (overflow, absurd
 * values, floating-point trouble) — they are NOT a business opinion about how generous a program should be,
 * and there are deliberately NO default values: a clinic that has not configured earning earns nothing.
 */
export const EARNING_LIMITS = {
  pointsPerVisit: { min: 1, max: 10_000 },
  pointsPerSpendAmount: { min: 1, max: 10_000 },
  /** JOD, up to 3 decimals (fils). */
  spendAmount: { min: 0.001, max: 1_000_000 },
  /** Money is calculated in integer fils (1 JOD = 1000 fils) — never with floating point. */
  filsPerJod: 1000,
  currencyDecimals: 3,
} as const;

/* ---------- Phase 4: public patient experience ---------- */

export const PUBLIC_LOYALTY = {
  /** Public sessions are short-lived and Loyalty-only. */
  tokenTtlSeconds: 30 * 60,
  tokenAudience: "clinicos-loyalty-public",
  tokenIssuer: "clinicos",
  tokenType: "loyalty_public",
  /** Identification attempts (per IP, express-rate-limit) */
  identifyWindowMs: 15 * 60 * 1000,
  identifyMaxPerIp: 12,
  /** Failed lookups for the SAME number at the SAME clinic */
  failWindowMs: 15 * 60 * 1000,
  failMaxPerPhone: 5,
  /**
   * Phase 10 — identification limits are layered so a clinic's shared Wi-Fi is not punished for SUCCESSFUL visits while guessing stays expensive:
   *  • failures only (404 / 400 / 503 …), per IP across clinics ............ identifyMaxPerIp  (above)
   *  • failures only, per clinic + IP ......................................... identifyMaxFailsPerClinicIp
   *  • every attempt, whatever the outcome, per IP (hard ceiling) ............ identifyMaxAttemptsPerIp
   */
  identifyMaxFailsPerClinicIp: 8,
  identifyMaxAttemptsPerIp: 60,
  /** Reads with a valid session (per IP) */
  readWindowMs: 60 * 1000,
  /** Optional operational override (e.g. tests behind one IP). Identification limits are NOT overridable. */
  readMaxPerIp: Number(process.env.LOYALTY_PUBLIC_READ_MAX) > 0 ? Number(process.env.LOYALTY_PUBLIC_READ_MAX) : 90,
  /**
   * Phase 9.1 — self-enrolment safety valve: the most accounts the PUBLIC page may create for ONE clinic per hour (across all IPs).
   * Real clinics enrol a handful of patients an hour; a bulk "enrol every number I can guess" attempt hits this ceiling long before it matters.
   * Existing members are never affected (they are not enrolments).
   */
  selfEnrollMaxPerClinicPerHour: Number(process.env.LOYALTY_SELF_ENROLL_MAX_PER_HOUR) > 0 ? Number(process.env.LOYALTY_SELF_ENROLL_MAX_PER_HOUR) : 120,
  activityPageSize: 10,
  activityMaxPageSize: 20,
  /** How recent a REAL earning must be to be highlighted as "just earned". */
  highlightDays: 7,
  /** Phase 9: how recent a REAL tier promotion must be to still be offered to the patient app as "newly reached" (shown once per device). */
  promotionDays: 30,
  /** Phase 9: tier-change rows ever merged into the patient's activity timeline (a member only has a handful). */
  activityPromotionsMax: 20,
} as const;

/* ---------- Phase 5: patient check-in (QR / NFC → pending request → reception confirms) ---------- */

/**
 * TECHNICAL / operational guardrails for check-in. None of these is a points value: a check-in never awards points
 * (visit points still come only from a completed appointment — Phase 3). They keep the reception queue clean and
 * stop a public endpoint from being used to flood it.
 */
export const CHECKIN = {
  statuses: ["pending", "confirmed", "rejected", "cancelled", "expired"] as const,
  /** How the patient reached the page. Informational only (client-reported, never trusted for anything). */
  vias: ["qr", "nfc", "link"] as const,
  /** A request nobody answered stops being actionable after this long (it is marked `expired`, never deleted). */
  pendingTtlMinutes: 120,
  /** After a CONFIRMED check-in, another request within this window just returns the confirmed one (no duplicate queue entry). */
  confirmedDedupeMinutes: 120,
  /** How long a rejected / expired outcome is still shown to the patient. */
  recentOutcomeMinutes: 30,
  /** Per member: requests (any outcome) in the last 24 h. */
  maxRequestsPerAccountPer24h: 10,
  /** Per clinic: simultaneously pending requests. */
  maxPendingPerClinic: 300,
  /** Per member (falls back to IP when the session is invalid): new requests. */
  requestWindowMs: 15 * 60 * 1000,
  requestMaxPerKey: 8,
  /** Per member (falls back to IP): status reads — enough for polling every ~6 s with a tab open. */
  statusWindowMs: 60 * 1000,
  statusMaxPerKey: 30,
  /** An appointment can be linked to a check-in only if it starts within this many hours before / after now (reception list and server validation use the same window). */
  appointmentWindowHours: 12,
  linkableAppointmentStatuses: ["scheduled", "confirmed", "completed"] as const,
  /** Reception list sizes. */
  pendingListMax: 100,
  recentPageSize: 20,
} as const;
export type CheckInStatus = (typeof CHECKIN.statuses)[number];
export type CheckInVia = (typeof CHECKIN.vias)[number];

/* ---------- Phase 6: rewards + redemptions ---------- */

/**
 * TECHNICAL guardrails only. There are NO default rewards and NO universal point thresholds: every reward (name, cost,
 * validity) is created by the clinic. A redemption never moves points when it is requested; points move only when
 * staff CONFIRM it, through the central ledger (services/loyaltyService.ts → debitPoints, type `reward_redemption`).
 */
export const REWARD = {
  statuses: ["active", "inactive"] as const,
  nameMin: 2,
  nameMax: 80,
  descriptionMax: 300,
  pointsMin: 1,
  /** Same technical ceiling as one ledger movement (a reward can never cost more than a single debit may remove). */
  pointsMax: LOYALTY_TECHNICAL_LIMITS.maxPointsPerTransaction,
  maxPerClinic: 200,
  /** Jordan has used a fixed UTC+3 offset since 2022. Date-only validity values ("2026-12-31") are read in the clinic's local day. */
  clinicUtcOffset: "+03:00",
  yearMin: 2000,
  yearMax: 2100,
} as const;
export type RewardStatus = (typeof REWARD.statuses)[number];

export const REDEMPTION = {
  /**
   * pending    → waiting for staff.
   * confirming → INTERNAL claim while the ledger debit runs (shown as "pending"); a stale claim is re-claimable.
   * confirmed  → points were deducted (ledger row linked in `transactionId`).
   * rejected   → staff said no; ZERO points moved.
   * reversing  → INTERNAL claim while the reversal credit runs (shown as "confirmed").
   * reversed   → a NEW positive ledger row gave the points back (`reversalTransactionId`); the original debit row is untouched.
   */
  statuses: ["pending", "confirming", "confirmed", "rejected", "reversing", "reversed"] as const,
  /** A claim older than this (crashed worker) may be taken over; the ledger idempotency key makes a re-run safe. */
  claimStaleSeconds: 60,
  /** Per member: simultaneously open requests / requests in 24 h. */
  maxPendingPerAccount: 5,
  maxRequestsPerAccountPer24h: 20,
  /** Per clinic: simultaneously open requests. */
  maxPendingPerClinic: 500,
  /** Public rate limits (keyed by member session, falling back to IP). */
  requestWindowMs: 15 * 60 * 1000,
  requestMaxPerKey: 10,
  readWindowMs: 60 * 1000,
  readMaxPerKey: 30,
  rejectionReasonMax: 200,
  pendingListMax: 100,
  historyPageSize: 20,
  historyMaxPageSize: 50,
  patientRecentCount: 5,
} as const;
export type RedemptionStatus = (typeof REDEMPTION.statuses)[number];

/* ---------- Phase 7: tiers & progression ---------- */

/**
 * Stable tier identities. The DISPLAY name is clinic-editable content; these keys are what the database, the history and
 * every calculation use, so renaming "Gold" to "Elite" can never change what a stored tier means.
 */
export const TIER_KEYS = ["tier1", "tier2", "tier3", "tier4"] as const;
export type TierKey = (typeof TIER_KEYS)[number];
/** 1-based position. tier1 is the base tier every member belongs to when tiers are on. */
export const tierRank = (k: TierKey | null | undefined): number => (k ? TIER_KEYS.indexOf(k) + 1 : 0);

/** ONE progression metric per clinic (never combined). */
export const TIER_METRICS = ["lifetime_points", "completed_visits", "lifetime_spending"] as const;
export type TierMetric = (typeof TIER_METRICS)[number];

/** Suggested labels only (they are display names, never identities). Thresholds have NO defaults: the clinic decides them. */
export const TIER_DEFAULT_NAMES: Record<TierKey, string> = { tier1: "Member", tier2: "Silver", tier3: "Gold", tier4: "VIP" };

/** Why a tier changed (controlled vocabulary — never free text). */
export const TIER_HISTORY_SOURCES = [
  "points_earned",
  "appointment_completed",
  "payment_recorded",
  "settings_recalculation",
  "manual_reconciliation",
  "migration",
  "member_enrolled",
] as const;
export type TierHistorySource = (typeof TIER_HISTORY_SOURCES)[number];
export const TIER_DIRECTIONS = ["promotion", "demotion", "initial"] as const;
export type TierDirection = (typeof TIER_DIRECTIONS)[number];

/**
 * Which ledger rows count as LIFETIME EARNED POINTS for tier progression (the decision is documented in the CHANGELOG):
 *   COUNTED     earn_visit, earn_spending (+ their reversal, which un-earns a mistaken earning)
 *   NOT COUNTED manual_credit / manual_debit / correction (administrative), reward_redemption, expiration,
 *               and the reversal of a reward_redemption (that only gives a spent balance back — it was never earned)
 * Redemptions therefore never lower progress, and nobody can buy a tier with a manual credit.
 */
export const TIER_EARNING_TYPES: readonly LoyaltyTransactionType[] = ["earn_visit", "earn_spending"];

/** Technical guardrails (no business values). */
export const TIER_LIMITS = {
  nameMin: 2,
  nameMax: 24,
  descriptionMax: 160,
  benefitsMax: 6,
  benefitTitleMin: 2,
  benefitTitleMax: 60,
  benefitDescriptionMax: 120,
  /** Highest threshold accepted per metric, in DISPLAY units (points / visits / JOD). */
  maxThreshold: { lifetime_points: 100_000_000, completed_visits: 100_000, lifetime_spending: 10_000_000 } as Record<TierMetric, number>,
  /** Settings recalculation: how many members one request may process, and for how long, before it hands back "N still pending". */
  recalcBatchSize: 100,
  recalcMaxMembersPerRequest: 1500,
  recalcBudgetMs: 8000,
  /** "Close to the next tier" = at least this share of the way there. */
  nearNextPercent: 80,
  historyPageSize: 20,
  historyMaxPageSize: 50,
  recentPromotionsCount: 8,
  analyticsWindowDays: 30,
  previewMaxMembers: 5000,
} as const;

/* ---------- Phase 10: staff-side abuse limits (per signed-in user, in-memory per server process) ---------- */

/**
 * Staff actions are authenticated, so the key is the USER (not the IP — a reception desk shares one address).
 * `write*` covers every state-changing Loyalty route; `sensitive*` covers the ones with money-like or configuration impact
 * (manual point adjustment, reward / tier / settings changes, reversal, recalculation). The ceilings are far above any real
 * desk's pace (a receptionist confirming check-ins does not reach 120 actions a minute) and exist only to stop a stolen
 * session or a runaway script. Operators can raise them with LOYALTY_STAFF_WRITE_MAX / LOYALTY_STAFF_SENSITIVE_MAX.
 */
const posInt = (v: string | undefined, d: number) => (Number(v) > 0 && Number.isInteger(Number(v)) ? Number(v) : d);
export const STAFF_LIMITS = {
  windowMs: 60 * 1000,
  writeMax: posInt(process.env.LOYALTY_STAFF_WRITE_MAX, 120),
  sensitiveMax: posInt(process.env.LOYALTY_STAFF_SENSITIVE_MAX, 30),
} as const;
