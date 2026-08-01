import mongoose, { Schema, Document, Types } from 'mongoose';

export type CheckStatus = 'pending' | 'collected' | 'bounced' | 'cancelled';

export interface ICheckReminder extends Document {
  payerName: string;
  customerId?: Types.ObjectId;
  invoiceId?: Types.ObjectId;
  invoiceNumber?: string;
  amount: number;
  checkNumber?: string;
  bankName?: string;
  dueDate: Date;
  followUpDate: Date;
  notes?: string;
  status: CheckStatus;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const CheckReminderSchema = new Schema<ICheckReminder>(
  {
    payerName: { type: String, required: true, trim: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'SaleInvoice' },
    invoiceNumber: { type: String, trim: true },
    amount: { type: Number, required: true, min: 0 },
    checkNumber: { type: String, trim: true },
    bankName: { type: String, trim: true },
    dueDate: { type: Date, required: true, index: true },
    followUpDate: { type: Date, required: true, index: true },
    notes: { type: String },
    status: {
      type: String,
      enum: ['pending', 'collected', 'bounced', 'cancelled'],
      default: 'pending',
      index: true,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export const CheckReminder = mongoose.model<ICheckReminder>('CheckReminder', CheckReminderSchema);
