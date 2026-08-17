import mongoose, { Schema, Document, Types } from 'mongoose';

export type QtyUnit = 'kg' | 'package';

export interface IPurchaseItem {
  productId: Types.ObjectId;
  productName: string;
  unit: QtyUnit;
  qtyInput: number;
  qtyKg: number;
  qtyPackages: number;
  kgPerPackage: number;
  unitPricePerKg: number;
  unitPricePerPackage: number;
  /** سازگاری: همان qtyKg */
  quantity: number;
  /** سازگاری: قیمت به ازای واحد ورودی */
  unitPrice: number;
  totalPrice: number;
}

export interface IPurchaseInvoice extends Document {
  invoiceNumber: string;
  supplier?: string;
  items: IPurchaseItem[];
  totalAmount: number;
  totalKg: number;
  notes?: string;
  date: Date;
  paidNow: boolean;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const PurchaseItemSchema = new Schema<IPurchaseItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true },
    unit: { type: String, enum: ['kg', 'package'], default: 'kg' },
    qtyInput: { type: Number, required: true, min: 0 },
    qtyKg: { type: Number, required: true, min: 0 },
    qtyPackages: { type: Number, required: true, min: 0 },
    kgPerPackage: { type: Number, required: true, default: 5 },
    unitPricePerKg: { type: Number, required: true, min: 0 },
    unitPricePerPackage: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    totalPrice: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const PurchaseInvoiceSchema = new Schema<IPurchaseInvoice>(
  {
    invoiceNumber: { type: String, required: true, unique: true },
    supplier: { type: String },
    items: { type: [PurchaseItemSchema], required: true },
    totalAmount: { type: Number, required: true },
    totalKg: { type: Number, default: 0 },
    notes: { type: String },
    date: { type: Date, required: true, default: Date.now },
    paidNow: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

PurchaseInvoiceSchema.index({ date: -1 });

export const PurchaseInvoice = mongoose.model<IPurchaseInvoice>('PurchaseInvoice', PurchaseInvoiceSchema);
