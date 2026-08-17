import mongoose, { Schema, Document, Types } from 'mongoose';

export type WalletTxType =
  | 'commission_sale'
  | 'commission_order'
  | 'payout'
  | 'adjust'
  | 'shipping_earn'
  | 'shipping_pay';

export interface IWalletTransaction extends Document {
  userId: Types.ObjectId;
  type: WalletTxType;
  amount: number;
  direction: 'in' | 'out';
  balanceAfter: number;
  description: string;
  referenceId?: string;
  referenceModel?: string;
  createdAt: Date;
  updatedAt: Date;
}

const WalletTransactionSchema = new Schema<IWalletTransaction>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: [
        'commission_sale',
        'commission_order',
        'payout',
        'adjust',
        'shipping_earn',
        'shipping_pay',
      ],
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    direction: { type: String, enum: ['in', 'out'], required: true },
    balanceAfter: { type: Number, required: true },
    description: { type: String, required: true },
    referenceId: { type: String },
    referenceModel: { type: String },
  },
  { timestamps: true }
);

export const WalletTransaction = mongoose.model<IWalletTransaction>(
  'WalletTransaction',
  WalletTransactionSchema
);
