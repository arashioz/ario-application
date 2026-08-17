import mongoose, { Schema, Document } from 'mongoose';

export type TransactionType =
  | 'sale_cash'
  | 'sale_card'
  | 'sale_credit'
  | 'purchase'
  | 'expense'
  | 'debt_payment'
  | 'card_deposit'
  | 'adjustment';

export interface ICashTransaction extends Document {
  type: TransactionType;
  amount: number;
  direction: 'in' | 'out';
  description: string;
  referenceId?: string;
  referenceModel?: string;
  /** نقد / کارت / کارت‌به‌کارت — برای ادیت سمت صندوق */
  paymentMethod?: 'cash' | 'card' | 'card_to_card';
  date: Date;
  createdAt: Date;
}

const CashTransactionSchema = new Schema<ICashTransaction>(
  {
    type: {
      type: String,
      enum: [
        'sale_cash', 'sale_card', 'sale_credit', 'purchase',
        'expense', 'debt_payment', 'card_deposit', 'adjustment',
      ],
      required: true,
    },
    amount: { type: Number, required: true },
    direction: { type: String, enum: ['in', 'out'], required: true },
    description: { type: String, required: true },
    referenceId: { type: String },
    referenceModel: { type: String },
    paymentMethod: {
      type: String,
      enum: ['cash', 'card', 'card_to_card'],
    },
    date: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

CashTransactionSchema.index({ date: -1 });
CashTransactionSchema.index({ type: 1 });

export const CashTransaction = mongoose.model<ICashTransaction>('CashTransaction', CashTransactionSchema);
