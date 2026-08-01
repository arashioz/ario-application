import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ICompanyPayment extends Document {
  supplier: string;
  amount: number;
  method: 'cash' | 'card';
  date: Date;
  notes?: string;
  supplierDebtId?: Types.ObjectId;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const CompanyPaymentSchema = new Schema<ICompanyPayment>(
  {
    supplier: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, enum: ['cash', 'card'], required: true },
    date: { type: Date, required: true, default: Date.now },
    notes: { type: String },
    supplierDebtId: { type: Schema.Types.ObjectId, ref: 'SupplierDebt' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

CompanyPaymentSchema.index({ date: -1 });

export const CompanyPayment = mongoose.model<ICompanyPayment>('CompanyPayment', CompanyPaymentSchema);
