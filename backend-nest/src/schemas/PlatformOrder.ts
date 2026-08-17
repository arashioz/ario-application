import mongoose, { Schema, Document, Types } from 'mongoose';

export type PlatformOrderStatus =
  | 'pending'
  | 'approved'
  | 'shipping'
  | 'delivered'
  | 'cancelled';
export type DeliveryMode = 'company' | 'self';
export type PriceTierOrder = 'supermarket' | 'wholesale';

export interface IPlatformOrderItem {
  productId: Types.ObjectId;
  productName: string;
  unit: 'kg' | 'package';
  qtyInput: number;
  qtyKg: number;
  unitPricePerKg: number;
  lineAmount: number;
  kgPerPackage: number;
}

export interface IPlatformOrder extends Document {
  orderNumber: string;
  marketerId: Types.ObjectId;
  marketerName: string;
  city: string;
  customerName?: string;
  customerPhone?: string;
  address?: string;
  items: IPlatformOrderItem[];
  priceTier: PriceTierOrder;
  totalKg: number;
  totalAmount: number;
  deliveryMode: DeliveryMode;
  status: PlatformOrderStatus;
  commissionPercent: number;
  commissionAmount: number;
  commissionCredited: boolean;
  notes?: string;
  paidAmount: number;
  createdAt: Date;
  updatedAt: Date;
  deliveredAt?: Date;
}

const ItemSchema = new Schema<IPlatformOrderItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true },
    unit: { type: String, enum: ['kg', 'package'], default: 'package' },
    qtyInput: { type: Number, required: true },
    qtyKg: { type: Number, required: true },
    unitPricePerKg: { type: Number, required: true },
    lineAmount: { type: Number, required: true },
    kgPerPackage: { type: Number, default: 5 },
  },
  { _id: false }
);

const PlatformOrderSchema = new Schema<IPlatformOrder>(
  {
    orderNumber: { type: String, required: true, unique: true },
    marketerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    marketerName: { type: String, required: true },
    city: { type: String, required: true, trim: true },
    customerName: { type: String },
    customerPhone: { type: String },
    address: { type: String },
    items: { type: [ItemSchema], required: true },
    priceTier: { type: String, enum: ['supermarket', 'wholesale'], default: 'supermarket' },
    totalKg: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    deliveryMode: { type: String, enum: ['company', 'self'], default: 'company' },
    status: {
      type: String,
      enum: ['pending', 'approved', 'shipping', 'delivered', 'cancelled'],
      default: 'pending',
      index: true,
    },
    commissionPercent: { type: Number, default: 0 },
    commissionAmount: { type: Number, default: 0 },
    commissionCredited: { type: Boolean, default: false },
    notes: { type: String },
    paidAmount: { type: Number, default: 0 },
    deliveredAt: { type: Date },
  },
  { timestamps: true }
);

export const PlatformOrder = mongoose.model<IPlatformOrder>('PlatformOrder', PlatformOrderSchema);
