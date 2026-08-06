import mongoose, { Schema, Document } from 'mongoose';

export interface IBankCard {
  label: string;
  cardNumber: string;
  accountHolder?: string;
  bankName?: string;
}

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
  /** آدرس MongoDB برای اتصال Compass (فقط ادمین) */
  mongoCompassUri?: string;
  /** کارت‌های بانکی برای کارت‌به‌کارت */
  bankCards: IBankCard[];
  /** پیشنهاد خودکار فاکتور طلایی */
  goldenAutoEnabled: boolean;
  goldenMinKg: number;
  goldenSuggestGiftName: string;
  goldenSuggestGiftQty: number;
  goldenSuggestDiscountPercent: number;
  /** رمز عملیات حساس (حذف/ویرایش فاکتور، اصلاح موجودی، …) — پیش‌فرض delete-ario */
  actionPassword?: string;
  /** رمز پاک‌سازی توسعه — پیش‌فرض wipe-ario-dev */
  wipePassword?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BankCardSchema = new Schema<IBankCard>(
  {
    label: { type: String, required: true, trim: true },
    cardNumber: { type: String, required: true, trim: true },
    accountHolder: { type: String, trim: true },
    bankName: { type: String, trim: true },
  },
  { _id: false }
);

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
    platformCities: {
      type: String,
      default: 'مشهد,نیشابور,سبزوار,تربت حیدریه,قوچان,کاشمر,گناباد',
    },
    costBasis: { type: String, enum: ['weighted', 'last'], default: 'last' },
    mongoCompassUri: { type: String },
    bankCards: { type: [BankCardSchema], default: [] },
    goldenAutoEnabled: { type: Boolean, default: true },
    goldenMinKg: { type: Number, default: 500 },
    goldenSuggestGiftName: { type: String, default: 'کارتن' },
    goldenSuggestGiftQty: { type: Number, default: 1 },
    goldenSuggestDiscountPercent: { type: Number, default: 5 },
    actionPassword: { type: String, default: 'delete-ario' },
    wipePassword: { type: String, default: 'wipe-ario-dev' },
  },
  { timestamps: true }
);

export const ShopSettings = mongoose.model<IShopSettings>('ShopSettings', ShopSettingsSchema);
