import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ISupplierDebt extends Document {
  supplier: string;
  purchaseInvoiceId?: Types.ObjectId;
  amount: number;
  paidAmount: number;
  date: Date;
  notes?: string;
  isSettled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SupplierDebtSchema = new Schema<ISupplierDebt>(
  {
    supplier: { type: String, required: true, trim: true, index: true },
    purchaseInvoiceId: { type: Schema.Types.ObjectId, ref: 'PurchaseInvoice' },
    amount: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, default: 0 },
    date: { type: Date, required: true, default: Date.now },
    notes: { type: String },
    isSettled: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const SupplierDebt = mongoose.model<ISupplierDebt>('SupplierDebt', SupplierDebtSchema);
