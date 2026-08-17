import {
  SaleInvoice,
  PurchaseInvoice,
  Customer,
  Debtor,
  Expense,
  CashTransaction,
  CompanyPayment,
  SupplierDebt,
  SmsMessage,
  CheckReminder,
  Campaign,
  PlatformOrder,
  WalletTransaction,
  SalesTarget,
  MutationLog,
  Session,
  Product,
  Category,
  ExpenseCategory,
} from '../models';
import { DEFAULT_DELETE_PASSWORD, getActionPassword } from './expenseService';
import { getOrCreateSettings } from './productService';
import { getShopOpeningDate } from '../config/database';

/** رمز پیش‌فرض پاک‌سازی توسعه */
export const WIPE_PASSWORD = 'wipe-ario-dev';

export type WipeSection =
  | 'sales'
  | 'purchases'
  | 'customers'
  | 'debtors'
  | 'expenses'
  | 'cash'
  | 'company'
  | 'campaigns'
  | 'platform'
  | 'targets'
  | 'checks'
  | 'sms'
  | 'products'
  | 'categories'
  | 'sessions'
  | 'logs'
  | 'balances';

const SECTION_LABELS: Record<WipeSection, string> = {
  sales: 'فاکتورهای فروش',
  purchases: 'فاکتورهای خرید',
  customers: 'مشتریان',
  debtors: 'نسیه / بدهکاران',
  expenses: 'هزینه‌ها',
  cash: 'گردش صندوق',
  company: 'پرداخت شرکت / بدهی تأمین',
  campaigns: 'جشنواره',
  platform: 'سفارش حجمی و کیف پول',
  targets: 'تارگت',
  checks: 'یادآور چک',
  sms: 'پیامک‌ها',
  products: 'محصولات',
  categories: 'دسته‌بندی‌ها',
  sessions: 'نشست‌ها',
  logs: 'لاگ تغییرات',
  balances: 'صفر کردن موجودی نقد/کارت',
};

export function listWipeSections() {
  return (Object.keys(SECTION_LABELS) as WipeSection[]).map((key) => ({
    key,
    label: SECTION_LABELS[key],
  }));
}

export async function wipeDevData(password: string | undefined, sections: WipeSection[]) {
  const settings = await getOrCreateSettings();
  const wipePw = (settings.wipePassword && String(settings.wipePassword).trim()) || WIPE_PASSWORD;
  const actionPw = await getActionPassword();
  if (password !== wipePw && password !== actionPw && password !== WIPE_PASSWORD && password !== DEFAULT_DELETE_PASSWORD) {
    throw new Error('رمز پاک‌سازی اشتباه است');
  }
  if (!sections?.length) throw new Error('حداقل یک بخش را انتخاب کنید');

  const cleared: Record<string, number> = {};

  const run = async (key: WipeSection, fn: () => Promise<{ deletedCount?: number }>) => {
    if (!sections.includes(key)) return;
    const res = await fn();
    cleared[key] = Number(res.deletedCount || 0);
  };

  await run('sales', () => SaleInvoice.deleteMany({}));
  await run('purchases', () => PurchaseInvoice.deleteMany({}));
  await run('customers', () => Customer.deleteMany({}));
  await run('debtors', () => Debtor.deleteMany({}));
  await run('expenses', () => Expense.deleteMany({}));
  await run('cash', () => CashTransaction.deleteMany({}));
  await run('company', async () => {
    const a = await CompanyPayment.deleteMany({});
    const b = await SupplierDebt.deleteMany({});
    return { deletedCount: (a.deletedCount || 0) + (b.deletedCount || 0) };
  });
  await run('campaigns', () => Campaign.deleteMany({}));
  await run('platform', async () => {
    const a = await PlatformOrder.deleteMany({});
    const b = await WalletTransaction.deleteMany({});
    return { deletedCount: (a.deletedCount || 0) + (b.deletedCount || 0) };
  });
  await run('targets', () => SalesTarget.deleteMany({}));
  await run('checks', () => CheckReminder.deleteMany({}));
  await run('sms', () => SmsMessage.deleteMany({}));
  await run('products', () => Product.deleteMany({}));
  await run('categories', async () => {
    const a = await Category.deleteMany({});
    const b = await ExpenseCategory.deleteMany({});
    return { deletedCount: (a.deletedCount || 0) + (b.deletedCount || 0) };
  });
  await run('sessions', () => Session.deleteMany({}));
  await run('logs', () => MutationLog.deleteMany({}));

  if (sections.includes('balances')) {
    const settings = await getOrCreateSettings();
    settings.cashBalance = 0;
    settings.cardBalance = 0;
    if (!settings.openingDate) settings.openingDate = getShopOpeningDate();
    await settings.save();
    cleared.balances = 1;
  }

  await getOrCreateSettings();

  return {
    ok: true,
    cleared,
    message: 'پاک‌سازی انجام شد',
  };
}

export function getMongoCompassHint(): string {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ario-shop';
  return uri.replace('://mongodb:', '://127.0.0.1:').replace('://mongo:', '://127.0.0.1:');
}
