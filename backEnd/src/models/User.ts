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
  isActive: boolean;
  emailVerified: boolean;
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
    isActive: { type: Boolean, default: true },
    emailVerified: { type: Boolean, default: false },
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
