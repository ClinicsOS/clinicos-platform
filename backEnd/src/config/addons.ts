/**
 * ClinicOS paid add-ons — central source of truth (sibling of config/plans.ts).
 *
 * An add-on is NOT a plan. A clinic keeps its normal plan (trial / basic / pro) and may,
 * independently, subscribe to any number of paid add-ons. Never create a "pro_loyalty"-style
 * plan: add-ons stack on top of plans, so we never need one plan per combination.
 *
 * What lives here vs. on the clinic:
 *   - HERE  = DEFAULT product definition (name, list price, default billing period).
 *   - CLINIC = the AGREED subscription for that clinic (its own monthlyPrice / setupFee / dates).
 *     Promotional or negotiated pricing is therefore just a different number on one clinic's
 *     record — nothing in this file needs to change.
 *
 * Adding a future add-on = add its id to ADDON_IDS + one entry in ADDONS (and, for now, nothing else:
 * the Clinic schema, the entitlement helpers and the admin endpoints are all driven by ADDON_IDS).
 */

export const ADDON_IDS = ["loyalty"] as const;
export type AddonId = (typeof ADDON_IDS)[number];

/**
 * Lifecycle of a clinic's subscription to ONE add-on.
 *   inactive  — never subscribed (also what a clinic with no record at all is treated as)
 *   active    — subscribed and allowed to use it
 *   suspended — temporarily switched off by the platform admin; record + data are kept
 *   cancelled — subscription ended; record + data are kept so it can be re-activated later
 */
export const ADDON_STATUSES = ["inactive", "active", "suspended", "cancelled"] as const;
export type AddonStatus = (typeof ADDON_STATUSES)[number];

export interface AddonDefinition {
  id: AddonId;
  /** Human-readable product name (used in API messages and the admin UI). */
  name: string;
  currency: "JOD";
  /** DEFAULT list price per month. A clinic's agreed price is stored on its own record. */
  defaultMonthlyPrice: number;
  /**
   * Advisory range for the ONE-TIME setup fee, shown to the admin as a hint only.
   * The setup fee is always set per clinic and is intentionally NOT defaulted anywhere.
   */
  setupFeeGuidance: { min: number; max: number } | null;
  /** Length of a billing period when the admin doesn't specify an end date. */
  defaultPeriodDays: number;
}

export const ADDONS: Record<AddonId, AddonDefinition> = {
  loyalty: {
    id: "loyalty",
    name: "ClinicOS Loyalty",
    currency: "JOD",
    defaultMonthlyPrice: 10,
    setupFeeGuidance: { min: 100, max: 150 },
    defaultPeriodDays: 30,
  },
};

export const isAddonId = (value: unknown): value is AddonId =>
  typeof value === "string" && (ADDON_IDS as readonly string[]).includes(value);

/**
 * Allowed lifecycle transitions. Anything not listed is rejected by the admin API.
 *   inactive  → active
 *   active    → suspended | cancelled
 *   suspended → active    | cancelled
 *   cancelled → active    (re-subscription; the old record is preserved and overwritten in place)
 */
export const ADDON_TRANSITIONS: Record<AddonStatus, readonly AddonStatus[]> = {
  inactive: ["active"],
  active: ["suspended", "cancelled"],
  suspended: ["active", "cancelled"],
  cancelled: ["active"],
};

export const canTransitionAddon = (from: AddonStatus, to: AddonStatus): boolean =>
  ADDON_TRANSITIONS[from].includes(to);
