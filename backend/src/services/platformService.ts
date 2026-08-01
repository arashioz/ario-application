import {
  User,
  PlatformOrder,
  WalletTransaction,
  Product,
  hashPassword,
} from '../models';
import { getOrCreateSettings, calculateSalePrice, resolveQty } from './productService';
import { createExpense } from './expenseService';

export async function registerPartner(data: {
  username: string;
  password: string;
  name: string;
  phone?: string;
  city: string;
}) {
  const settings = await getOrCreateSettings();
  if (settings.platformEnabled === false) {
    throw new Error('ثبت‌نام پلتفرم فعلاً غیرفعال است');
  }
  const username = data.username.trim().toLowerCase();
  if (username.length < 3) throw new Error('نام کاربری حداقل ۳ حرف');
  if (!data.password || data.password.length < 4) throw new Error('رمز حداقل ۴ حرف');
  if (!data.name?.trim()) throw new Error('نام الزامی است');
  if (!data.city?.trim()) throw new Error('شهر الزامی است');

  const exists = await User.findOne({ username });
  if (exists) throw new Error('این نام کاربری قبلاً ثبت شده');

  const user = await User.create({
    username,
    passwordHash: hashPassword(data.password),
    name: data.name.trim(),
    role: 'marketer',
    active: false,
    approvalStatus: 'pending',
    phone: data.phone?.trim(),
    city: data.city.trim(),
    canSelfDeliver: true,
    walletBalance: 0,
  });

  return {
    id: user._id.toString(),
    username: user.username,
    name: user.name,
    city: user.city,
    approvalStatus: user.approvalStatus,
    message: 'ثبت شد — منتظر تأیید مدیر بمان',
  };
}

export async function listPartnerApprovals(status?: string) {
  const filter: Record<string, unknown> = { role: 'marketer' };
  if (status) filter.approvalStatus = status;
  else filter.approvalStatus = { $in: ['pending', 'rejected'] };
  return User.find(filter)
    .select('-passwordHash')
    .sort({ createdAt: -1 })
    .limit(200);
}

export async function setPartnerApproval(
  userId: string,
  action: 'approve' | 'reject',
  opts?: { canSelfDeliver?: boolean }
) {
  const user = await User.findById(userId);
  if (!user || user.role !== 'marketer') throw new Error('همکار یافت نشد');
  if (action === 'approve') {
    user.approvalStatus = 'approved';
    user.active = true;
    if (opts?.canSelfDeliver !== undefined) user.canSelfDeliver = opts.canSelfDeliver;
  } else {
    user.approvalStatus = 'rejected';
    user.active = false;
  }
  await user.save();
  return User.findById(userId).select('-passwordHash');
}

export async function getPlatformConfig() {
  const s = await getOrCreateSettings();
  return {
    platformEnabled: s.platformEnabled !== false,
    commissionPercentCompany: s.commissionPercentCompany ?? 3,
    commissionPercentSelf: s.commissionPercentSelf ?? 5,
    platformMinOrderKg: s.platformMinOrderKg ?? 500,
    platformCities: (s.platformCities || '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean),
    catalogSupermarketMinKg: s.catalogSupermarketMinKg || 500,
    catalogWholesaleMinKg: s.catalogWholesaleMinKg || 2000,
  };
}

export async function updatePlatformConfig(data: {
  platformEnabled?: boolean;
  commissionPercentCompany?: number;
  commissionPercentSelf?: number;
  platformMinOrderKg?: number;
  platformCities?: string;
}) {
  const s = await getOrCreateSettings();
  if (data.platformEnabled !== undefined) s.platformEnabled = data.platformEnabled;
  if (data.commissionPercentCompany !== undefined)
    s.commissionPercentCompany = Math.max(0, data.commissionPercentCompany);
  if (data.commissionPercentSelf !== undefined)
    s.commissionPercentSelf = Math.max(0, data.commissionPercentSelf);
  if (data.platformMinOrderKg !== undefined)
    s.platformMinOrderKg = Math.max(0, data.platformMinOrderKg);
  if (data.platformCities !== undefined) s.platformCities = data.platformCities;
  await s.save();
  return getPlatformConfig();
}

async function creditWallet(
  userId: string,
  amount: number,
  type: 'commission_sale' | 'commission_order' | 'adjust',
  description: string,
  referenceId?: string,
  referenceModel?: string
) {
  if (amount <= 0) return null;
  const user = await User.findById(userId);
  if (!user) throw new Error('کاربر یافت نشد');
  user.walletBalance = (user.walletBalance || 0) + amount;
  await user.save();
  return WalletTransaction.create({
    userId: user._id,
    type,
    amount,
    direction: 'in',
    balanceAfter: user.walletBalance,
    description,
    referenceId,
    referenceModel,
  });
}

export async function payPartnerWallet(data: {
  userId: string;
  amount: number;
  notes?: string;
}) {
  const amount = Math.round(data.amount || 0);
  if (amount <= 0) throw new Error('مبلغ نامعتبر');
  const user = await User.findById(data.userId);
  if (!user) throw new Error('کاربر یافت نشد');
  const wallet = user.walletBalance || 0;
  if (wallet + 1 < amount) throw new Error('موجودی کیف پول کافی نیست');
  user.walletBalance = Math.max(0, wallet - amount);
  await user.save();
  await WalletTransaction.create({
    userId: user._id,
    type: 'payout',
    amount,
    direction: 'out',
    balanceAfter: user.walletBalance,
    description: `تسویه کیف پول ${user.name}${data.notes ? ` · ${data.notes}` : ''}`,
  });
  await createExpense({
    type: 'salary',
    amount,
    description: `پرداخت پورسانت همکار ${user.name}`,
    notes: `کارت: ${user.cardNumber || '—'} · ${data.notes || ''}`,
    affectsCash: true,
  });
  return {
    userId: user._id.toString(),
    name: user.name,
    cardNumber: user.cardNumber,
    paid: amount,
    walletBalance: user.walletBalance,
  };
}

export async function getWallet(userId: string) {
  const user = await User.findById(userId).select('name walletBalance cardNumber city role');
  if (!user) throw new Error('کاربر یافت نشد');
  const txs = await WalletTransaction.find({ userId }).sort({ createdAt: -1 }).limit(50);
  return {
    balance: user.walletBalance || 0,
    cardNumber: user.cardNumber || '',
    name: user.name,
    city: user.city,
    transactions: txs,
  };
}

function resolveCommissionPercent(
  user: { commissionPercentCompany?: number; commissionPercentSelf?: number },
  mode: 'company' | 'self',
  cfg: { commissionPercentCompany: number; commissionPercentSelf: number }
) {
  if (mode === 'self') {
    return user.commissionPercentSelf ?? cfg.commissionPercentSelf;
  }
  return user.commissionPercentCompany ?? cfg.commissionPercentCompany;
}

export async function createVolumeOrder(input: {
  marketerId: string;
  city: string;
  customerName?: string;
  customerPhone?: string;
  address?: string;
  deliveryMode: 'company' | 'self';
  priceTier: 'supermarket' | 'wholesale';
  notes?: string;
  items: Array<{
    productId: string;
    unit?: 'kg' | 'package';
    qtyInput: number;
  }>;
}) {
  const cfg = await getPlatformConfig();
  if (!cfg.platformEnabled) throw new Error('پلتفرم غیرفعال است');

  const marketer = await User.findById(input.marketerId);
  if (!marketer || marketer.role !== 'marketer') throw new Error('بازاریاب معتبر نیست');
  if (marketer.approvalStatus !== 'approved' || !marketer.active) {
    throw new Error('حساب شما هنوز تأیید نشده');
  }
  if (input.deliveryMode === 'self' && marketer.canSelfDeliver === false) {
    throw new Error('پخش شخصی برای شما فعال نیست');
  }
  if (!input.items?.length) throw new Error('اقلام خالی است');

  const built = [];
  let totalKg = 0;
  let totalAmount = 0;
  for (const it of input.items) {
    const product = await Product.findById(it.productId);
    if (!product) throw new Error('محصول یافت نشد');
    const unit = it.unit || 'package';
    const kgPer = product.kgPerPackage || 5;
    const { qtyKg } = resolveQty({ unit, qtyInput: it.qtyInput, kgPerPackage: kgPer });
    const pricing = await calculateSalePrice(product._id.toString(), undefined, input.priceTier);
    const lineAmount = Math.round(pricing.salePricePerKg * qtyKg);
    built.push({
      productId: product._id,
      productName: product.name,
      unit,
      qtyInput: it.qtyInput,
      qtyKg,
      unitPricePerKg: pricing.salePricePerKg,
      lineAmount,
      kgPerPackage: kgPer,
    });
    totalKg += qtyKg;
    totalAmount += lineAmount;
  }

  if (totalKg + 1e-6 < cfg.platformMinOrderKg) {
    throw new Error(`حداقل سفارش ${cfg.platformMinOrderKg} کیلو است`);
  }

  const percent = resolveCommissionPercent(marketer, input.deliveryMode, cfg);
  const commissionAmount = Math.round((totalAmount * percent) / 100);
  const count = await PlatformOrder.countDocuments();
  const orderNumber = `VOL-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${String(count + 1).padStart(4, '0')}`;

  return PlatformOrder.create({
    orderNumber,
    marketerId: marketer._id,
    marketerName: marketer.name,
    city: input.city.trim() || marketer.city || '—',
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    address: input.address,
    items: built,
    priceTier: input.priceTier,
    totalKg,
    totalAmount,
    deliveryMode: input.deliveryMode,
    status: 'pending',
    commissionPercent: percent,
    commissionAmount,
    commissionCredited: false,
    notes: input.notes,
    paidAmount: 0,
  });
}

export async function listVolumeOrders(opts?: {
  marketerId?: string;
  status?: string;
}) {
  const filter: Record<string, unknown> = {};
  if (opts?.marketerId) filter.marketerId = opts.marketerId;
  if (opts?.status) filter.status = opts.status;
  return PlatformOrder.find(filter).sort({ createdAt: -1 }).limit(100);
}

export async function updateVolumeOrderStatus(
  orderId: string,
  status: 'approved' | 'shipping' | 'delivered' | 'cancelled',
  adminId?: string
) {
  const order = await PlatformOrder.findById(orderId);
  if (!order) throw new Error('سفارش یافت نشد');
  order.status = status;
  if (status === 'delivered') {
    order.deliveredAt = new Date();
    if (!order.commissionCredited && order.commissionAmount > 0) {
      await creditWallet(
        order.marketerId.toString(),
        order.commissionAmount,
        'commission_order',
        `پورسانت سفارش ${order.orderNumber} (${order.commissionPercent}٪ · ${
          order.deliveryMode === 'self' ? 'پخش شخصی' : 'پخش شرکت'
        })`,
        order._id.toString(),
        'PlatformOrder'
      );
      order.commissionCredited = true;
    }
  }
  await order.save();
  return order;
}

/** برگشت پورسانت فاکتور فروش حذف‌شده */
export async function reverseSaleCommission(saleId: string) {
  const txs = await WalletTransaction.find({
    referenceId: saleId,
    referenceModel: 'SaleInvoice',
    direction: 'in',
  });
  for (const tx of txs) {
    const user = await User.findById(tx.userId);
    if (user) {
      user.walletBalance = Math.max(0, (user.walletBalance || 0) - tx.amount);
      await user.save();
    }
    await tx.deleteOne();
  }
  return { ok: true, reversed: txs.length };
}

/** پورسانت روی فاکتور فروش عادی وقتی کار روشن است */
export async function creditSaleCommission(input: {
  marketerId: string;
  saleId: string;
  invoiceNumber: string;
  totalAmount: number;
  deliveryMode?: 'company' | 'self';
}) {
  const marketer = await User.findById(input.marketerId);
  if (!marketer || marketer.role !== 'marketer') return null;
  if (!marketer.workActive) return null;
  if (marketer.approvalStatus !== 'approved') return null;

  const cfg = await getPlatformConfig();
  if (!cfg.platformEnabled) return null;
  const mode = input.deliveryMode || 'company';
  const percent = resolveCommissionPercent(marketer, mode, cfg);
  const amount = Math.round((input.totalAmount * percent) / 100);
  if (amount <= 0) return null;

  return creditWallet(
    marketer._id.toString(),
    amount,
    'commission_sale',
    `پورسانت فروش ${input.invoiceNumber} (${percent}٪)`,
    input.saleId,
    'SaleInvoice'
  );
}
