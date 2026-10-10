import mongoose, { Schema, Document, Types } from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "crypto";

export interface IUser extends Document {
  clinicId: Types.ObjectId;
  name: string;
  email: string;
  password: string;
  role: "owner" | "doctor" | "receptionist";
  phone?: string;
  // PHASE 4 — OPTIONAL per-doctor working hours (same shape as Clinic.workingHours, always 7 entries when present).
  // Absent = the doctor simply follows the clinic's hours. When present they can only NARROW the clinic's hours: the clinic's
  // own rules (closed days, hours, breaks) always still apply, and the doctor's are checked in addition.
  workingHours?: {
    day: number;
    isOpen: boolean;
    from: string;
    to: string;
    breakFrom?: string;
    breakTo?: string;
  }[];
  isActive: boolean;
  emailVerified: boolean;
  // Bumped whenever we need to invalidate every previously-issued JWT for this
  // user (password change, password reset, admin reset, deactivation, role
  // change). The value is embedded in the JWT at sign time and re-checked on
  // every authenticated request — a token whose tokenVersion no longer matches
  // the user's current tokenVersion is rejected. Defaults to 0; existing
  // users (created before this field) read back as undefined and are treated
  // as 0, so this change never force-logs-out anyone on deploy.
  tokenVersion: number;
  verifyTokenHash?: string;
  verifyTokenExpires?: Date;
  resetTokenHash?: string;
  resetTokenExpires?: Date;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidate: string): Promise<boolean>;
}

const userSchema = new Schema<IUser>(
  {
    clinicId: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true, minlength: 6, select: false },
    role: {
      type: String,
      enum: ["owner", "doctor", "receptionist"],
      required: true,
    },
    phone: { type: String },
    workingHours: {
      type: [
        new Schema(
          {
            day: { type: Number, min: 0, max: 6, required: true },
            isOpen: { type: Boolean, default: true },
            from: { type: String, default: "09:00" },
            to: { type: String, default: "17:00" },
            breakFrom: { type: String },
            breakTo: { type: String },
          },
          { _id: false }
        ),
      ],
      default: undefined, // absent (not []) for every existing user
    },
    isActive: { type: Boolean, default: true },
    emailVerified: { type: Boolean, default: false },
    tokenVersion: { type: Number, default: 0 },
    verifyTokenHash: { type: String, select: false },
    verifyTokenExpires: { type: Date, select: false },
    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },
  },
  { timestamps: true }
);

userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.comparePassword = function (candidate: string) {
  return bcrypt.compare(candidate, this.password);
};

/**
 * Utility used by auth controllers — never exported on the model itself
 * so the surface area stays tight.  Returns [plainToken, hashedToken].
 */
export const generateToken = (): [string, string] => {
  const plain = crypto.randomBytes(32).toString("hex");
  const hashed = crypto.createHash("sha256").update(plain).digest("hex");
  return [plain, hashed];
};

export const hashToken = (plain: string): string =>
  crypto.createHash("sha256").update(plain).digest("hex");

export const User = mongoose.model<IUser>("User", userSchema);
