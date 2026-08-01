import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IDebtor extends Document {
  name: string;
  phone?: string;
  customerId?: Types.ObjectId;
  amount: number;
  paidAmount: number;
  dueDate: Date;
  saleInvoiceId?: Types.ObjectId;
  description?: string;
  isSettled: boolean;
  reminderSent: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const DebtorSchema = new Schema<IDebtor>(
  {
    name: { type: String, required: true },
    phone: { type: String },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', index: true },
    amount: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, default: 0 },
    dueDate: { type: Date, required: true },
    saleInvoiceId: { type: Schema.Types.ObjectId, ref: 'SaleInvoice' },
    description: { type: String },
    isSettled: { type: Boolean, default: false },
    reminderSent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

DebtorSchema.index({ isSettled: 1, dueDate: 1 });

export const Debtor = mongoose.model<IDebtor>('Debtor', DebtorSchema);
