import mongoose, { Schema, Document } from 'mongoose';

export interface IShopSettings extends Document {
  shopName: string;
  openingDate: Date;
  defaultCurrency: string;
  cashBalance: number;
  cardBalance: number;
  catalogEnabled: boolean;
  catalogTitle?: string;
  catalogPhone?: string;
  catalogNote?: string;
  /** حداقل کیلو برای قیمت سوپرمارکت */
  catalogSupermarketMinKg: number;
  /** حداقل کیلو برای قیمت عمده */
  catalogWholesaleMinKg: number;
  /** برند اپ / نمایشی */
  brandName?: string;
  brandTagline?: string;
  brandPrimaryColor?: string;
  brandLogoUrl?: string;
  /** پلتفرم همکاران */
  platformEnabled: boolean;
  /** پنل/قابلیت‌های راننده (نقشه، پرداخت، اپ راننده) */
  driverPanelEnabled: boolean;
  /** پنل/قابلیت‌های بازاریاب (ثبت‌نام، سفارش حجمی، تارگت، …) */
  marketerPanelEnabled: boolean;
  commissionPercentCompany: number;
  commissionPercentSelf: number;
  platformMinOrderKg: number;
  platformCities?: string;
  /** مبنای محاسبه قیمت فروش: میانگین موزون یا آخرین خرید */
  costBasis: 'weighted' | 'last';
  createdAt: Date;
  updatedAt: Date;
}

const ShopSettingsSchema = new Schema<IShopSettings>(
  {
    shopName: { type: String, default: 'مغازه من' },
    openingDate: { type: Date, required: true },
    defaultCurrency: { type: String, default: 'IRR' },
    cashBalance: { type: Number, default: 0 },
    cardBalance: { type: Number, default: 0 },
    catalogEnabled: { type: Boolean, default: true },
    catalogTitle: { type: String },
    catalogPhone: { type: String },
    catalogNote: { type: String },
    catalogSupermarketMinKg: { type: Number, default: 500 },
    catalogWholesaleMinKg: { type: Number, default: 2000 },
    brandName: { type: String },
    brandTagline: { type: String },
    brandPrimaryColor: { type: String, default: '#0d9488' },
    brandLogoUrl: { type: String },
    platformEnabled: { type: Boolean, default: true },
    driverPanelEnabled: { type: Boolean, default: true },
    marketerPanelEnabled: { type: Boolean, default: true },
    commissionPercentCompany: { type: Number, default: 3 },
    commissionPercentSelf: { type: Number, default: 5 },
    platformMinOrderKg: { type: Number, default: 500 },
    platformCities: { type: String, default: 'مشهد,نیشابور,سبزوار,تربت حیدریه,قوچان,کاشمر,گناباد' },
    costBasis: { type: String, enum: ['weighted', 'last'], default: 'last' },
  },
  { timestamps: true }
);

export const ShopSettings = mongoose.model<IShopSettings>('ShopSettings', ShopSettingsSchema);
