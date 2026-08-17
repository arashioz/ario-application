import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ISalesTarget extends Document {
  marketerId: Types.ObjectId;
  year: number;
  month: number;
  targetAmount: number;
  targetKg: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SalesTargetSchema = new Schema<ISalesTarget>(
  {
    marketerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    targetAmount: { type: Number, default: 0 },
    targetKg: { type: Number, default: 0 },
    notes: { type: String },
  },
  { timestamps: true }
);

SalesTargetSchema.index({ marketerId: 1, year: 1, month: 1 }, { unique: true });

export const SalesTarget = mongoose.model<ISalesTarget>('SalesTarget', SalesTargetSchema);
