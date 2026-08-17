import mongoose, { Schema, Document, Types } from 'mongoose';

export type ExpenseType = string;

export interface IExpense extends Document {
  type: ExpenseType;
  categoryId?: Types.ObjectId;
  amount: number;
  description: string;
  date: Date;
  notes?: string;
  /** نحوه پرداخت هزینه */
  paymentMethod?: 'cash' | 'card' | 'card_to_card';
  createdAt: Date;
  updatedAt: Date;
}

const ExpenseSchema = new Schema<IExpense>(
  {
    type: { type: String, required: true, index: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'ExpenseCategory' },
    amount: { type: Number, required: true, min: 0 },
    description: { type: String, required: true },
    date: { type: Date, required: true, default: Date.now },
    notes: { type: String },
    paymentMethod: {
      type: String,
      enum: ['cash', 'card', 'card_to_card'],
      default: 'cash',
    },
  },
  { timestamps: true }
);

ExpenseSchema.index({ date: -1 });
ExpenseSchema.index({ type: 1 });

export const Expense = mongoose.model<IExpense>('Expense', ExpenseSchema);

export const EXPENSE_TYPE_LABELS: Record<string, string> = {
  shipping: 'ارسال بار',
  salary: 'حقوق',
  withdrawal: 'برداشت شخصی',
  loan_given: 'قرض دادن',
  loan_received: 'قرض گرفتن',
  rent: 'اجاره',
  utilities: 'قبوض',
  other: 'سایر',
};
