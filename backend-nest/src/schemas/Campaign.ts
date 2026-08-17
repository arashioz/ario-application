import mongoose, { Schema, Document, Types } from 'mongoose';

export type CampaignRuleType =
  | 'bundle'
  | 'volume_kg'
  | 'volume_amount'
  | 'payment_cash'
  | 'payment_card'
  | 'loyalty'
  | 'free_gift';

export interface IBundleRequirement {
  productId?: Types.ObjectId;
  /** تطبیق نام محصول (مثل نایلون، کارتن) */
  nameContains?: string;
  qty: number;
  unit: 'kg' | 'package';
}

export interface ISuggestedLine {
  productId?: Types.ObjectId;
  productName: string;
  qty: number;
  unit: 'kg' | 'package';
}

export interface ICampaignRule {
  type: CampaignRuleType;
  label?: string;
  discountPercent: number;
  /** برای bundle */
  bundleItems?: IBundleRequirement[];
  /** برای volume */
  minKg?: number;
  minAmount?: number;
  /** برای loyalty */
  minInvoiceCount?: number;
  minMonthKg?: number;
  /** برای free_gift: اگر X بسته بخرد → اشانتیون Y */
  triggerNameContains?: string;
  triggerQty?: number;
  triggerUnit?: 'kg' | 'package';
  giftProductName?: string;
  giftQty?: number;
  giftUnit?: 'kg' | 'package';
}

export interface ICampaign extends Document {
  name: string;
  description?: string;
  active: boolean;
  forMarketers: boolean;
  /** اگر خالی باشد برای همه؛ مثلاً ['gold'] فقط مشتریان طلایی */
  targetLoyaltyTiers?: Array<'gold' | 'silver' | 'bronze' | 'new'>;
  startDate?: Date;
  endDate?: Date;
  rules: ICampaignRule[];
  /** فاکتور پیشنهادی جشنواره — با یک دکمه به سبد اضافه می‌شود */
  suggestedInvoice?: {
    title: string;
    lines: ISuggestedLine[];
    note?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const BundleReqSchema = new Schema<IBundleRequirement>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product' },
    nameContains: { type: String },
    qty: { type: Number, required: true, min: 0 },
    unit: { type: String, enum: ['kg', 'package'], default: 'package' },
  },
  { _id: false }
);

const SuggestedLineSchema = new Schema<ISuggestedLine>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product' },
    productName: { type: String, required: true },
    qty: { type: Number, required: true, min: 0 },
    unit: { type: String, enum: ['kg', 'package'], default: 'package' },
  },
  { _id: false }
);

const CampaignRuleSchema = new Schema<ICampaignRule>(
  {
    type: {
      type: String,
      enum: [
        'bundle',
        'volume_kg',
        'volume_amount',
        'payment_cash',
        'payment_card',
        'loyalty',
        'free_gift',
      ],
      required: true,
    },
    label: { type: String },
    discountPercent: { type: Number, required: true, min: 0, max: 100, default: 0 },
    bundleItems: { type: [BundleReqSchema], default: [] },
    minKg: { type: Number },
    minAmount: { type: Number },
    minInvoiceCount: { type: Number },
    minMonthKg: { type: Number },
    triggerNameContains: { type: String },
    triggerQty: { type: Number },
    triggerUnit: { type: String, enum: ['kg', 'package'], default: 'package' },
    giftProductName: { type: String },
    giftQty: { type: Number },
    giftUnit: { type: String, enum: ['kg', 'package'], default: 'package' },
  },
  { _id: false }
);

const CampaignSchema = new Schema<ICampaign>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String },
    active: { type: Boolean, default: true, index: true },
    forMarketers: { type: Boolean, default: true },
    targetLoyaltyTiers: {
      type: [String],
      enum: ['gold', 'silver', 'bronze', 'new'],
      default: [],
    },
    startDate: { type: Date },
    endDate: { type: Date },
    rules: { type: [CampaignRuleSchema], default: [] },
    suggestedInvoice: {
      title: { type: String },
      lines: { type: [SuggestedLineSchema], default: [] },
      note: { type: String },
    },
  },
  { timestamps: true }
);

export const Campaign = mongoose.model<ICampaign>('Campaign', CampaignSchema);
