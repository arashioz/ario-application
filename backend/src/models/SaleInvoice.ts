import mongoose, { Schema, Document, Types } from 'mongoose';

export type PaymentMethod = 'cash' | 'card' | 'card_to_card' | 'credit' | 'mixed';
export type QtyUnit = 'kg' | 'package';
export type PriceTier = 'retail' | 'supermarket' | 'wholesale';
/** pending = بازاریاب | approved = تأیید | shipped = ارسال | delivered = تحویل | cancelled = لغو | inactive = غیرفعال (در محاسبات نیست، در تاریخچه هست) */
export type SaleStatus = 'pending' | 'approved' | 'shipped' | 'delivered' | 'cancelled' | 'inactive';

export interface IPaymentBreakdown {
  cash: number;
  card: number;
  credit: number;
}

export interface ISaleItem {
  productId: Types.ObjectId;
  productName: string;
  unit: QtyUnit;
  qtyInput: number;
  qtyKg: number;
  qtyPackages: number;
  kgPerPackage: number;
  unitCostPerKg: number;
  unitPricePerKg: number;
  unitPricePerPackage: number;
  quantity: number;
  unitCost: number;
  unitPrice: number;
  totalPrice: number;
  /** تخفیف اختصاصی این قلم (تومان) */
  discount: number;
  profit: number;
  priceTier?: PriceTier;
}

export interface ISaleInvoice extends Document {
  invoiceNumber: string;
  customerId?: Types.ObjectId;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  customerLat?: number;
  customerLng?: number;
  marketerId?: Types.ObjectId;
  driverId?: Types.ObjectId;
  items: ISaleItem[];
  totalAmount: number;
  totalCost: number;
  totalProfit: number;
  totalKg: number;
  paymentMethod: PaymentMethod;
  payment: IPaymentBreakdown;
  /** تخفیف سطح فاکتور (تومان) — جدا از تخفیف اقلام */
  discount: number;
  /** نحوه ورود تخفیف فاکتور */
  discountMode?: 'invoice' | 'per_kg' | 'product';
  /** اگر کیلویی: تومان به ازای هر کیلو */
  discountPerKg?: number;
  notes?: string;
  /** نام آفر تخفیفی اعمال‌شده (ملایم / ویژه / …) */
  appliedOffer?: string;
  shippingNotes?: string;
  /** ارسال با ما | مشتری | بدون ارسال */
  shippingBy?: 'us' | 'customer' | 'none';
  /** پخش شرکت یا شخصی همکار — برای پورسانت پلتفرم */
  deliveryMode?: 'company' | 'self';
  /** هزینه ارسال (تومان) — اختیاری */
  shippingCost?: number;
  /** اگر هزینه ثبت شد، لینک به Expense */
  shippingExpenseId?: Types.ObjectId;
  date: Date;
  dueDate?: Date;
  isPaid: boolean;
  /** نسیه با چک بوده */
  creditIsCheck?: boolean;
  priceTier: PriceTier;
  isGolden: boolean;
  status: SaleStatus;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  shippedAt?: Date;
  deliveredAt?: Date;
  deliveredBy?: Types.ObjectId;
  /** مبلغی که با تحویل به کیف پول راننده واریز شد */
  driverEarned: number;
  /** آیا به راننده پرداخت نقدی/کارت شده */
  driverPaid: boolean;
  driverPaidAt?: Date;
  driverPaidAmount: number;
  stockApplied: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SaleItemSchema = new Schema<ISaleItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true },
    unit: { type: String, enum: ['kg', 'package'], default: 'kg' },
    qtyInput: { type: Number, required: true },
    qtyKg: { type: Number, required: true },
    qtyPackages: { type: Number, required: true },
    kgPerPackage: { type: Number, required: true },
    unitCostPerKg: { type: Number, required: true },
    unitPricePerKg: { type: Number, required: true },
    unitPricePerPackage: { type: Number, required: true },
    quantity: { type: Number, required: true },
    unitCost: { type: Number, required: true },
    unitPrice: { type: Number, required: true },
    totalPrice: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    profit: { type: Number, required: true },
    priceTier: { type: String, enum: ['retail', 'supermarket', 'wholesale'], default: 'retail' },
  },
  { _id: false }
);

const PaymentBreakdownSchema = new Schema<IPaymentBreakdown>(
  {
    cash: { type: Number, default: 0 },
    card: { type: Number, default: 0 },
    credit: { type: Number, default: 0 },
  },
  { _id: false }
);

const SaleInvoiceSchema = new Schema<ISaleInvoice>(
  {
    invoiceNumber: { type: String, required: true, unique: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
    customerName: { type: String },
    customerPhone: { type: String },
    customerAddress: { type: String },
    customerLat: { type: Number },
    customerLng: { type: Number },
    marketerId: { type: Schema.Types.ObjectId, ref: 'User' },
    driverId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    items: { type: [SaleItemSchema], required: true },
    totalAmount: { type: Number, required: true },
    totalCost: { type: Number, required: true },
    totalProfit: { type: Number, required: true },
    totalKg: { type: Number, default: 0 },
    paymentMethod: {
      type: String,
      enum: ['cash', 'card', 'card_to_card', 'credit', 'mixed'],
      required: true,
    },
    payment: { type: PaymentBreakdownSchema, required: true },
    discount: { type: Number, default: 0 },
    discountMode: {
      type: String,
      enum: ['invoice', 'per_kg', 'product'],
      default: 'invoice',
    },
    discountPerKg: { type: Number, default: 0 },
    notes: { type: String },
    appliedOffer: { type: String },
    shippingNotes: { type: String },
    shippingBy: {
      type: String,
      enum: ['us', 'customer', 'none'],
      default: 'none',
    },
    deliveryMode: {
      type: String,
      enum: ['company', 'self'],
      default: 'company',
    },
    shippingCost: { type: Number, default: 0 },
    shippingExpenseId: { type: Schema.Types.ObjectId, ref: 'Expense' },
    date: { type: Date, required: true, default: Date.now },
    dueDate: { type: Date },
    isPaid: { type: Boolean, default: true },
    creditIsCheck: { type: Boolean, default: false },
    priceTier: {
      type: String,
      enum: ['retail', 'supermarket', 'wholesale'],
      default: 'retail',
    },
    isGolden: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['pending', 'approved', 'shipped', 'delivered', 'cancelled', 'inactive'],
      default: 'approved',
      index: true,
    },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    shippedAt: { type: Date },
    deliveredAt: { type: Date },
    deliveredBy: { type: Schema.Types.ObjectId, ref: 'User' },
    driverEarned: { type: Number, default: 0 },
    driverPaid: { type: Boolean, default: false },
    driverPaidAt: { type: Date },
    driverPaidAmount: { type: Number, default: 0 },
    stockApplied: { type: Boolean, default: false },
  },
  { timestamps: true }
);

SaleInvoiceSchema.index({ date: -1 });
SaleInvoiceSchema.index({ customerId: 1, date: -1 });
SaleInvoiceSchema.index({ marketerId: 1, date: -1 });
SaleInvoiceSchema.index({ status: 1, date: -1 });
SaleInvoiceSchema.index({ isGolden: 1, date: -1 });

export const SaleInvoice = mongoose.model<ISaleInvoice>('SaleInvoice', SaleInvoiceSchema);
