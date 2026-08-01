import mongoose, { Schema, Document } from 'mongoose';
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';

export type UserRole = 'admin' | 'marketer' | 'driver';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface IUser extends Document {
  username: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  active: boolean;
  /** وضعیت تأیید ثبت‌نام پلتفرم */
  approvalStatus: ApprovalStatus;
  phone?: string;
  city?: string;
  workActive?: boolean;
  lastLat?: number;
  lastLng?: number;
  lastLocationAt?: Date;
  walletBalance: number;
  cardNumber?: string;
  /** آیا خودش می‌تواند پخش کند */
  canSelfDeliver: boolean;
  /** درصد اختصاصی (خالی = از تنظیمات پلتفرم) */
  commissionPercentCompany?: number;
  commissionPercentSelf?: number;
  createdAt: Date;
  updatedAt: Date;
  verifyPassword(password: string): boolean;
}

const UserSchema = new Schema<IUser>(
  {
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: ['admin', 'marketer', 'driver'], required: true },
    active: { type: Boolean, default: true },
    approvalStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'approved',
      index: true,
    },
    phone: { type: String },
    city: { type: String },
    workActive: { type: Boolean, default: false },
    lastLat: { type: Number },
    lastLng: { type: Number },
    lastLocationAt: { type: Date },
    walletBalance: { type: Number, default: 0 },
    cardNumber: { type: String, trim: true },
    canSelfDeliver: { type: Boolean, default: true },
    commissionPercentCompany: { type: Number },
    commissionPercentSelf: { type: Number },
  },
  { timestamps: true }
);

UserSchema.methods.verifyPassword = function (password: string): boolean {
  const [salt, key] = (this.passwordHash as string).split(':');
  if (!salt || !key) return false;
  const hashed = scryptSync(password, salt, 64);
  try {
    return timingSafeEqual(Buffer.from(key, 'hex'), hashed);
  } catch {
    return false;
  }
};

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hashed = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hashed}`;
}

export const User = mongoose.model<IUser>('User', UserSchema);
