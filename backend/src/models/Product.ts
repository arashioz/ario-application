import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IProduct extends Document {
  name: string;
  normalizedName: string;
  categoryId: Types.ObjectId;
  /** میانگین موزون هزینه به ازای هر کیلو */
  avgCostPerKg: number;
  /** آخرین قیمت خرید به ازای هر کیلو (بدون میانگین) */
  lastPurchasePricePerKg: number;
  /** سازگاری قدیمی — معمولاً همان avgCostPerKg */
  purchasePrice: number;
  /** موجودی به کیلوگرم */
  stockKg: number;
  /** سازگاری قدیمی — همان stockKg */
  stock: number;
  /** وزن هر بسته به کیلو (۳، ۵، ۱۰، …) */
  kgPerPackage: number;
  /** درصد سود اختصاصی؛ اگر خالی باشد از دسته استفاده می‌شود */
  profitPercent?: number;
  sku?: string;
  notes?: string;
  /** مسیر تصویر برای کاتالوگ */
  imageUrl?: string;
  /** نمایش در کاتالوگ عمومی */
  catalogVisible: boolean;
  /** حداقل تعداد خرید (بسته) برای نمایش در کاتالوگ */
  catalogMinQty: number;
  /** قیمت نمایشی به ازای کیلو (اگر خالی باشد از قیمت محاسبه‌شده استفاده می‌شود) */
  catalogPricePerKg?: number;
  /** توضیح کوتاه کاتالوگ */
  catalogNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ProductSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, trim: true },
    normalizedName: { type: String, required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    avgCostPerKg: { type: Number, required: true, default: 0 },
    lastPurchasePricePerKg: { type: Number, required: true, default: 0 },
    purchasePrice: { type: Number, required: true, default: 0 },
    stockKg: { type: Number, required: true, default: 0 },
    stock: { type: Number, required: true, default: 0 },
    kgPerPackage: { type: Number, required: true, default: 5, min: 0.001 },
    profitPercent: { type: Number },
    sku: { type: String },
    notes: { type: String },
    imageUrl: { type: String },
    catalogVisible: { type: Boolean, default: false },
    catalogMinQty: { type: Number, default: 1, min: 0 },
    catalogPricePerKg: { type: Number },
    catalogNote: { type: String },
  },
  { timestamps: true }
);

ProductSchema.index({ normalizedName: 1 }, { unique: true });

export const Product = mongoose.model<IProduct>('Product', ProductSchema);
