import mongoose, { Schema, Document } from "mongoose";
import type { Plan } from "../config/plans";
import { ADDON_IDS, ADDON_STATUSES, type AddonId, type AddonStatus } from "../config/addons";

/**
 * A clinic's subscription to ONE paid add-on (see config/addons.ts).
 * This is the ENTITLEMENT record — "has this clinic paid for the module and may it use it?".
 * It is controlled only by the ClinicOS platform admin. It is NOT where a module's own
 * settings live (e.g. a clinic's future loyalty rules); those belong to the module itself.
 */
export interface IAddonSubscription {
  enabled: boolean;               // denormalised: true only while status === "active"
  status: AddonStatus;
  setupFee: number;               // one-time fee agreed with THIS clinic (JOD)
  monthlyPrice: number;           // monthly price agreed with THIS clinic (JOD)
  activatedAt?: Date | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  suspendedAt?: Date | null;
  cancelledAt?: Date | null;
}

/** Keyed by add-on id. Every key is optional: a clinic with no record is simply "not subscribed". */
export type ClinicAddons = Partial<Record<AddonId, IAddonSubscription>>;

export interface IClinic extends Document {
  name: string;
  slug: string;
  specialty: string;
  phone?: string;
  address?: string;
  logoUrl?: string;
  brandColor?: string;                 // Pro feature — customise booking page colour
  workingHours: {
    day: number;
    isOpen: boolean;
    from: string;
    to: string;
    breakFrom?: string;
    breakTo?: string;
  }[];
  slotDuration: number;

  // ===== Subscription =====
  plan: Plan;
  planStartedAt: Date;
  planExpiresAt: Date;
  status: "active" | "suspended" | "expired";

  // ===== Paid add-ons (optional — absent on every clinic created before add-ons existed) =====
  addons?: ClinicAddons;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * Sub-schema for one add-on subscription. Defaults only apply when a record is created, and the
 * record itself has NO default — so existing Clinic documents (and new clinics) simply have no
 * `addons.<id>` and behave as "not subscribed". No migration is required.
 */
const addonSubscriptionSchema = new Schema<IAddonSubscription>(
  {
    enabled: { type: Boolean, default: false },
    status: { type: String, enum: ADDON_STATUSES, default: "inactive" },
    setupFee: { type: Number, min: 0, default: 0 },
    monthlyPrice: { type: Number, min: 0, default: 0 },
    activatedAt: { type: Date, default: null },
    currentPeriodStart: { type: Date, default: null },
    currentPeriodEnd: { type: Date, default: null },
    suspendedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
  },
  { _id: false }
);

// One optional path per add-on id: { loyalty: { type: addonSubscriptionSchema }, ... }
const addonsDefinition = Object.fromEntries(
  ADDON_IDS.map((id) => [id, { type: addonSubscriptionSchema }])
);

const clinicSchema = new Schema<IClinic>(
  {
    name: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9-]{3,50}$/,
    },
    specialty: { type: String, required: true },
    phone: { type: String },
    address: { type: String },
    logoUrl: { type: String },
    brandColor: { type: String },
    workingHours: [
      {
        day: { type: Number, required: true, min: 0, max: 6 },
        isOpen: { type: Boolean, default: true },
        from: { type: String, default: "10:00" },
        to: { type: String, default: "18:00" },
        breakFrom: { type: String },
        breakTo: { type: String },
      },
    ],
    slotDuration: { type: Number, default: 30 },

    plan: { type: String, enum: ["trial", "basic", "pro"], default: "trial" },
    planStartedAt: { type: Date, default: Date.now },
    planExpiresAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ["active", "suspended", "expired"],
      default: "active",
    },

    addons: addonsDefinition,
  },
  { timestamps: true }
);

export const Clinic = mongoose.model<IClinic>("Clinic", clinicSchema);
