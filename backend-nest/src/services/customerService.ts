import { Customer, SaleInvoice, Debtor } from '../models';
import { calculateSalePrice } from './productService';
import { startOfDay, endOfDay, roundToman } from '../utils/persian';

/** نرمال‌سازی شماره برای جستجو (۰۹۱۲… / +98 / فاصله) */
export function normalizePhoneDigits(raw?: string): string {
  if (!raw) return '';
  const fa = '۰۱۲۳۴۵۶۷۸۹';
  const ar = '٠١٢٣٤٥٦٧٨٩';
  let s = String(raw).trim();
  s = s.replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)));
  s = s.replace(/[٠-٩]/g, (d) => String(ar.indexOf(d)));
  s = s.replace(/[^\d+]/g, '');
  if (s.startsWith('+98')) s = '0' + s.slice(3);
  if (s.startsWith('98') && s.length >= 12) s = '0' + s.slice(2);
  return s;
}

/** هر رقم انگلیسی یا فارسی/عربی معادل — برای پیدا کردن شماره تکراری */
export function phoneDigitFlexRegex(englishDigits: string): string {
  const fa = '۰۱۲۳۴۵۶۷۸۹';
  const ar = '٠١٢٣٤٥٦٧٨٩';
  return String(englishDigits)
    .split('')
    .map((ch) => {
      if (!/^\d$/.test(ch)) return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const n = Number(ch);
      return `[${ch}${fa[n]}${ar[n]}]`;
    })
    .join('');
}

function toPersianDigits(englishDigits: string): string {
  const fa = '۰۱۲۳۴۵۶۷۸۹';
  return englishDigits.replace(/\d/g, (d) => fa[Number(d)] ?? d);
}

function phoneSearchVariants(q: string): string[] {
  const digits = normalizePhoneDigits(q);
  if (!digits) return [];
  const variants = new Set<string>([digits, toPersianDigits(digits)]);
  if (digits.length >= 10) {
    const last10 = digits.slice(-10);
    variants.add(last10);
    variants.add(toPersianDigits(last10));
  }
  if (digits.length >= 11) {
    const last11 = digits.slice(-11);
    variants.add(last11);
    variants.add(toPersianDigits(last11));
  }
  return Array.from(variants);
}

export async function findCustomerByPhone(raw?: string) {
  const phone = normalizePhoneDigits(raw);
  if (!phone) return null;
  const last10 = phone.length >= 10 ? phone.slice(-10) : phone;
  const flex = phoneDigitFlexRegex(last10);
  const found = await Customer.findOne({
    $or: [
      { phone },
      { phone: { $regex: flex + '$' } },
      { phone: { $regex: flex } },
    ],
  });
  // شماره‌های قدیمی با رقم فارسی را به انگلیسی یکدست کن
  if (found?.phone && normalizePhoneDigits(found.phone) !== found.phone) {
    found.phone = normalizePhoneDigits(found.phone);
    await found.save().catch(() => undefined);
  }
  return found;
}

export async function createCustomer(data: {
  name: string;
  phone?: string;
  address?: string;
  lat?: number;
  lng?: number;
  notes?: string;
}) {
  if (data.phone) {
    const phone = normalizePhoneDigits(data.phone) || data.phone.trim();
    const existing = await findCustomerByPhone(phone);
    if (existing) {
      existing.name = data.name || existing.name;
      existing.phone = phone || existing.phone;
      if (data.notes) existing.notes = data.notes;
      if (data.address) existing.address = data.address;
      if (data.lat != null) existing.lat = data.lat;
      if (data.lng != null) existing.lng = data.lng;
      await existing.save();
      return existing;
    }
  }
  return Customer.create({
    name: data.name.trim(),
    phone: data.phone ? normalizePhoneDigits(data.phone) || undefined : undefined,
    address: data.address?.trim(),
    lat: data.lat,
    lng: data.lng,
    notes: data.notes,
  });
}

export async function updateCustomer(
  id: string,
  data: {
    name?: string;
    phone?: string;
    address?: string;
    lat?: number;
    lng?: number;
    notes?: string;
  }
) {
  const c = await Customer.findById(id);
  if (!c) throw new Error('مشتری یافت نشد');
  if (data.name !== undefined) c.name = data.name;
  if (data.phone !== undefined) {
    c.phone = data.phone ? normalizePhoneDigits(data.phone) || undefined : undefined;
  }
  if (data.address !== undefined) c.address = data.address;
  if (data.lat !== undefined) c.lat = data.lat;
  if (data.lng !== undefined) c.lng = data.lng;
  if (data.notes !== undefined) c.notes = data.notes;
  await c.save();
  return c;
}

export async function listCustomers(
  search?: string,
  opts?: { limit?: number; all?: boolean }
) {
  const q = search?.trim();
  if (q) {
    const digits = normalizePhoneDigits(q);
    const phoneVars = phoneSearchVariants(q);
    const or: Record<string, unknown>[] = [
      { name: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      { phone: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      { address: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
    ];
    for (const ph of phoneVars) {
      or.push({ phone: { $regex: ph.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') } });
    }
    if (digits.length >= 8) {
      const last = digits.slice(-10);
      or.push({ phone: { $regex: phoneDigitFlexRegex(last) + '$' } });
    }
    return Customer.find({ $or: or })
      .sort({ name: 1 })
      .limit(Math.min(opts?.limit || 20, 50));
  }

  // لیست کامل فقط وقتی صریحاً خواسته شود (صفحه مشتریان)
  if (opts?.all || (opts?.limit != null && opts.limit > 0)) {
    return Customer.find()
      .sort({ name: 1 })
      .limit(Math.min(opts?.limit || 300, 500));
  }

  // فاکتور فروش: بدون جستجو کسی را نشان نده
  return [];
}

/** جستجوی سریع مشتری با نام/موبایل یا شماره فاکتور */
export async function quickFindCustomer(query: string) {
  const q = query.trim();
  if (!q) return { customers: [], fromInvoice: null, exactPhone: null };

  const customers = await listCustomers(q, { limit: 12 });
  const phoneVars = phoneSearchVariants(q);

  // تطبیق دقیق‌تر موبایل
  let exactPhone: (typeof customers)[0] | null = null;
  if (phoneVars.length) {
    const last10 = phoneVars.find((p) => p.length >= 10)?.slice(-10);
    if (last10) {
      exactPhone =
        customers.find((c) => normalizePhoneDigits(c.phone || '').endsWith(last10)) || null;
      if (!exactPhone) {
        exactPhone = await findCustomerByPhone(q);
      }
    }
  }

  // شماره فاکتور
  const invoice = await SaleInvoice.findOne({
    invoiceNumber: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' },
    status: { $ne: 'cancelled' },
  }).sort({ date: -1 });

  let fromInvoice = null;
  if (invoice) {
    let customer = invoice.customerId ? await Customer.findById(invoice.customerId) : null;
    if (!customer && (invoice.customerName || invoice.customerPhone)) {
      customer = {
        _id: invoice.customerId,
        name: invoice.customerName,
        phone: invoice.customerPhone,
        address: invoice.customerAddress,
      } as never;
    }
    fromInvoice = { invoice, customer };
  }

  // اگر موبایل دقیق پیدا شد، اول لیست بگذار
  const list = exactPhone
    ? [exactPhone, ...customers.filter((c) => String(c._id) !== String(exactPhone!._id))]
    : customers;

  return {
    customers: list,
    fromInvoice,
    exactPhone: exactPhone
      ? {
          _id: exactPhone._id,
          name: exactPhone.name,
          phone: exactPhone.phone,
          address: exactPhone.address,
          lat: exactPhone.lat,
          lng: exactPhone.lng,
        }
      : null,
  };
}

export async function getCustomer(id: string) {
  const customer = await Customer.findById(id);
  if (!customer) throw new Error('مشتری یافت نشد');
  return customer;
}

export async function getCustomerInvoices(customerId: string) {
  const invoices = await SaleInvoice.find({ customerId, status: { $ne: 'cancelled' } })
    .sort({ date: -1 })
    .limit(50);

  // هم‌خوان کردن برچسب پرداخت با مانده نسیه واقعی
  for (const inv of invoices) {
    const credit = Math.round(inv.payment?.credit || 0);
    const cash = Math.round(inv.payment?.cash || 0);
    const card = Math.round(inv.payment?.card || 0);
    if (credit <= 0 && inv.paymentMethod === 'credit') {
      if (cash > 0 && card > 0) inv.paymentMethod = 'mixed';
      else if (cash > 0) inv.paymentMethod = 'cash';
      else if (card > 0) inv.paymentMethod = 'card';
      else inv.paymentMethod = 'cash';
      inv.isPaid = true;
      if (!inv.paidAt) inv.paidAt = inv.lastPaymentAt || inv.shippedAt || inv.date;
      await inv.save();
    } else if (credit > 0 && inv.paymentMethod === 'credit' && (cash > 0 || card > 0)) {
      inv.paymentMethod = 'mixed';
      await inv.save();
    }
  }

  return invoices;
}

/** تاریخچه دریافت نسیه مشتری */
export async function getCustomerCreditPayments(customerId: string) {
  const debts = await Debtor.find({ customerId }).sort({ updatedAt: -1 }).limit(80);
  const rows: Array<{
    id: string;
    debtorId: string;
    invoiceNumber?: string;
    amount: number;
    method: string;
    date: Date;
    note?: string;
    debtAmount: number;
    debtPaid: number;
    settled: boolean;
  }> = [];

  const invIds = debts.map((d) => d.saleInvoiceId).filter(Boolean);
  const invs = invIds.length
    ? await SaleInvoice.find({ _id: { $in: invIds } }).select('_id invoiceNumber')
    : [];
  const invMap = new Map(invs.map((i) => [i._id.toString(), i.invoiceNumber]));

  for (const d of debts) {
    const invNo = d.saleInvoiceId ? invMap.get(d.saleInvoiceId.toString()) : undefined;
    const pays = Array.isArray(d.payments) ? d.payments : [];
    if (pays.length) {
      for (const p of pays) {
        rows.push({
          id: `${d._id}-${new Date(p.date).getTime()}-${p.amount}`,
          debtorId: d._id.toString(),
          invoiceNumber: invNo,
          amount: p.amount,
          method: p.method,
          date: p.date,
          note: p.note,
          debtAmount: d.amount,
          debtPaid: d.paidAmount,
          settled: d.isSettled,
        });
      }
    } else if ((d.paidAmount || 0) > 0) {
      // سوابق قدیمی بدون آرایه payments
      rows.push({
        id: `${d._id}-legacy`,
        debtorId: d._id.toString(),
        invoiceNumber: invNo,
        amount: d.paidAmount,
        method: 'cash',
        date: d.updatedAt || d.createdAt,
        note: 'پرداخت قبلی (بدون ریز)',
        debtAmount: d.amount,
        debtPaid: d.paidAmount,
        settled: d.isSettled,
      });
    }
  }

  rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return rows;
}

export async function deleteCustomer(id: string, password?: string) {
  const { assertDeletePassword } = await import('./expenseService');
  await assertDeletePassword(password);

  const customer = await Customer.findById(id);
  if (!customer) throw new Error('مشتری یافت نشد');

  const { Product, CashTransaction } = await import('../models');
  const { updateBalances } = await import('./productService');

  const invoices = await SaleInvoice.find({ customerId: id });
  const warnings: string[] = [];
  let deletedInvoices = 0;

  for (const invoice of invoices) {
    if (invoice.driverPaid) {
      warnings.push(`${invoice.invoiceNumber}: به راننده پرداخت شده — رد شد`);
      continue;
    }

    try {
      const debtors = await Debtor.find({ saleInvoiceId: invoice._id });

      // برگشت دریافت‌های نسیه این فاکتور
      for (const d of debtors) {
        const debtPays = await CashTransaction.find({
          type: 'debt_payment',
          referenceId: d._id.toString(),
          referenceModel: 'Debtor',
        });
        let cashDelta = 0;
        let cardDelta = 0;
        for (const tx of debtPays) {
          if (tx.direction === 'in') {
            // دریافت قبلی را از صندوق کم کن
            const desc = String(tx.description || '');
            if (desc.includes('پوز') || desc.includes('کارت')) cardDelta -= tx.amount;
            else cashDelta -= tx.amount;
          }
          await tx.deleteOne();
        }
        if (cashDelta !== 0 || cardDelta !== 0) {
          await updateBalances(cashDelta, cardDelta);
        }
        await d.deleteOne();
      }

      if (invoice.stockApplied) {
        for (const item of invoice.items) {
          const product = await Product.findById(item.productId);
          if (!product) continue;
          const stockKg = product.stockKg ?? product.stock ?? 0;
          product.stockKg = stockKg + (item.qtyKg || 0);
          product.stock = product.stockKg;
          await product.save();
        }

        const txs = await CashTransaction.find({
          referenceId: invoice._id.toString(),
          referenceModel: 'SaleInvoice',
        });
        let cashDelta = 0;
        let cardDelta = 0;
        for (const tx of txs) {
          if (tx.type === 'sale_cash') cashDelta -= tx.amount;
          else if (tx.type === 'sale_card') cardDelta -= tx.amount;
          else if (tx.direction === 'in') cashDelta -= tx.amount;
          else cashDelta += tx.amount;
          await tx.deleteOne();
        }
        if (cashDelta !== 0 || cardDelta !== 0) {
          await updateBalances(cashDelta, cardDelta);
        }
      }

      try {
        const { reverseSaleCommission } = await import('./platformService');
        await reverseSaleCommission(invoice._id.toString());
      } catch (e) {
        console.warn('reverse commission on customer delete failed', e);
      }

      if (invoice.shippingExpenseId) {
        try {
          const { deleteExpense } = await import('./expenseService');
          await deleteExpense(invoice.shippingExpenseId.toString(), password);
        } catch {
          /* ignore */
        }
      }

      await invoice.deleteOne();
      deletedInvoices += 1;
    } catch (e) {
      warnings.push(
        `${invoice.invoiceNumber}: ${e instanceof Error ? e.message : 'حذف نشد'}`
      );
    }
  }

  // بدهکاری‌های مانده بدون فاکتور / ردشده‌ها
  const leftoverDebts = await Debtor.find({ customerId: id });
  for (const d of leftoverDebts) {
    const debtPays = await CashTransaction.find({
      type: 'debt_payment',
      referenceId: d._id.toString(),
      referenceModel: 'Debtor',
    });
    let cashDelta = 0;
    let cardDelta = 0;
    for (const tx of debtPays) {
      if (tx.direction === 'in') {
        const desc = String(tx.description || '');
        if (desc.includes('پوز') || desc.includes('کارت')) cardDelta -= tx.amount;
        else cashDelta -= tx.amount;
      }
      await tx.deleteOne();
    }
    if (cashDelta !== 0 || cardDelta !== 0) {
      await updateBalances(cashDelta, cardDelta);
    }
    await d.deleteOne();
  }

  const blocked = invoices.length - deletedInvoices;
  if (blocked > 0 && deletedInvoices === 0 && invoices.length > 0) {
    throw new Error(
      `حذف ممکن نیست: ${warnings.slice(0, 3).join(' · ') || 'فاکتورها قفل‌اند'}`
    );
  }

  // فاکتورهای قفل‌مانده را از مشتری جدا کن تا سند یتیم نماند
  await SaleInvoice.updateMany({ customerId: id }, { $unset: { customerId: 1 } });

  const name = customer.name;
  await customer.deleteOne();

  return {
    id,
    deleted: true,
    name,
    deletedInvoices,
    blockedInvoices: blocked,
    warnings,
  };
}

function suggestDiscountAmount(
  invoices: Array<{
    discount?: number;
    totalAmount: number;
    totalKg?: number;
    totalCost?: number;
    totalProfit?: number;
    date: Date;
  }>
) {
  if (!invoices.length) {
    return {
      suggestedDiscount: 0,
      reason: 'مشتری جدید — بدون آفر ویژه',
      avgOrder: 0,
      count30: 0,
      daysSince: null as number | null,
      power: 'new' as const,
      timing: 'new' as const,
      offers: [] as Array<{ key: string; label: string; amount: number; reason: string }>,
      maxSafeByHistory: 0,
    };
  }
  const last = invoices[0];
  const avg = invoices.reduce((s, i) => s + i.totalAmount, 0) / invoices.length;
  const avgKg = invoices.reduce((s, i) => s + (i.totalKg || 0), 0) / invoices.length;
  const avgProfit =
    invoices.reduce((s, i) => s + (i.totalProfit || 0), 0) / Math.max(invoices.length, 1);
  const lastDisc = last.discount || 0;
  const daysSince =
    (Date.now() - new Date(last.date).getTime()) / (1000 * 60 * 60 * 24);
  const count30 = invoices.filter(
    (i) => Date.now() - new Date(i.date).getTime() < 30 * 24 * 60 * 60 * 1000
  ).length;
  const monthAmount = invoices
    .filter((i) => Date.now() - new Date(i.date).getTime() < 30 * 24 * 60 * 60 * 1000)
    .reduce((s, i) => s + i.totalAmount, 0);

  // قدرت خرید
  let power: 'low' | 'mid' | 'high' | 'vip' = 'low';
  if (monthAmount >= 80_000_000 || avgKg >= 2000) power = 'vip';
  else if (monthAmount >= 30_000_000 || avg >= 15_000_000 || count30 >= 4) power = 'high';
  else if (monthAmount >= 8_000_000 || avg >= 4_000_000 || count30 >= 2) power = 'mid';

  // تایمینگ خرید
  let timing: 'hot' | 'followup' | 'dormant' | 'active' = 'active';
  if (daysSince <= 7) timing = 'hot';
  else if (daysSince > 25 && daysSince <= 40) timing = 'followup';
  else if (daysSince > 40) timing = 'dormant';

  // سقف امن تاریخی: حداکثر نیمی از میانگین سود فاکتورهای قبلی
  const maxSafeByHistory = Math.max(0, Math.floor(avgProfit * 0.5));

  const pct = (p: number) => roundToman(avg * p);
  const offers: Array<{ key: string; label: string; amount: number; reason: string }> = [];

  const mild = roundToman(
    Math.min(Math.max(lastDisc, pct(0.005)), maxSafeByHistory || pct(0.01))
  );
  const goodBase =
    power === 'vip'
      ? 0.025
      : power === 'high'
        ? 0.02
        : power === 'mid'
          ? 0.012
          : 0.008;
  const timingBoost =
    timing === 'followup' ? 0.005 : timing === 'dormant' ? 0.008 : timing === 'hot' ? -0.003 : 0;
  const good = roundToman(
    Math.min(Math.max(lastDisc, pct(goodBase + timingBoost)), maxSafeByHistory || pct(0.02))
  );
  const maxSafe = roundToman(
    Math.min(
      Math.max(good, pct(goodBase + timingBoost + 0.005)),
      maxSafeByHistory || pct(0.025)
    )
  );

  offers.push({
    key: 'mild',
    label: 'آفر ملایم',
    amount: mild,
    reason: 'بدون فشار روی سود',
  });
  offers.push({
    key: 'special',
    label: 'آفر ویژه',
    amount: good,
    reason:
      timing === 'followup'
        ? 'فالوآپ ماهانه + قدرت خرید'
        : timing === 'dormant'
          ? 'بازگردانی مشتری خوابیده'
          : power === 'vip' || power === 'high'
            ? 'قدرت خرید بالا — وفاداری'
            : 'پیشنهاد متعادل',
  });
  offers.push({
    key: 'max_safe',
    label: 'حداکثر امن',
    amount: maxSafe,
    reason: 'سقف قبل از ضرر (≈۵۰٪ میانگین سود قبلی)',
  });

  let suggested = good;
  let reason = offers[1].reason;
  if (timing === 'followup') {
    suggested = good;
    reason = 'فالوآپ همین موقع ماه قبل — آفر ویژه برگشت';
  } else if (power === 'vip') {
    suggested = maxSafe;
    reason = 'مشتری VIP — حداکثر آفر امن';
  } else if (count30 >= 4) {
    suggested = good;
    reason = 'مشتری پرخرید ماهانه';
  }

  return {
    suggestedDiscount: roundToman(suggested),
    reason,
    avgOrder: Math.round(avg),
    count30,
    daysSince: Math.round(daysSince),
    power,
    timing,
    offers,
    maxSafeByHistory,
    monthAmount: Math.round(monthAmount),
    avgKg: Math.round(avgKg),
  };
}

/** نوع غالب مشتری از تاریخچه فاکتورها (برای قانون عمده ≠ تکی) */
export async function getCustomerPreferredTier(
  customerId: string
): Promise<'retail' | 'supermarket' | 'wholesale' | null> {
  const invoices = await SaleInvoice.find({
    customerId,
    status: { $nin: ['cancelled'] },
  })
    .sort({ date: -1 })
    .limit(20)
    .select('priceTier')
    .lean();

  if (!invoices.length) return null;

  const tierCount: Record<string, number> = {};
  for (const inv of invoices) {
    const t = inv.priceTier || 'retail';
    tierCount[t] = (tierCount[t] || 0) + 1;
  }
  return (Object.entries(tierCount).sort((a, b) => b[1] - a[1])[0]?.[0] ||
    invoices[0].priceTier ||
    'retail') as 'retail' | 'supermarket' | 'wholesale';
}

/** پیشنهاد قیمت بر اساس آخرین فاکتور مشتری یا قیمت دسته */
export async function getCustomerSuggestedPricing(customerId: string, productId?: string) {
  const invoices = await SaleInvoice.find({
    customerId,
    status: { $in: ['approved', 'shipped'] },
  })
    .sort({ date: -1 })
    .limit(20);

  let lastDiscount = 0;
  let lastTier: 'retail' | 'supermarket' | 'wholesale' = 'retail';
  if (invoices[0]) {
    lastDiscount = invoices[0].discount || 0;
    lastTier = (invoices[0].priceTier as typeof lastTier) || 'retail';
  }

  // پرتکرارترین tier
  const tierCount: Record<string, number> = {};
  for (const inv of invoices) {
    const t = inv.priceTier || 'retail';
    tierCount[t] = (tierCount[t] || 0) + 1;
  }
  const preferredTier = (Object.entries(tierCount).sort((a, b) => b[1] - a[1])[0]?.[0] ||
    lastTier) as typeof lastTier;

  let productPrice = null;
  if (productId) {
    productPrice = await calculateSalePrice(productId, undefined, preferredTier);
    for (const inv of invoices) {
      const hit = inv.items.find((i) => i.productId.toString() === productId);
      if (hit) {
        productPrice = {
          ...productPrice,
          salePricePerKg: hit.unitPricePerKg,
          suggestedFromHistory: true,
        };
        break;
      }
    }
  }

  const disc = suggestDiscountAmount(invoices);
  const lastInvoice = invoices[0]
    ? {
        id: invoices[0]._id,
        invoiceNumber: invoices[0].invoiceNumber,
        items: invoices[0].items.map((i) => ({
          productId: i.productId,
          productName: i.productName,
          unit: i.unit,
          qtyInput: i.qtyInput,
          qtyKg: i.qtyKg,
          unitPricePerKg: i.unitPricePerKg,
          kgPerPackage: i.kgPerPackage,
        })),
        totalAmount: invoices[0].totalAmount,
        discount: invoices[0].discount,
        priceTier: invoices[0].priceTier,
        date: invoices[0].date,
      }
    : null;

  return {
    lastDiscount,
    lastTier,
    preferredTier,
    suggestedDiscount: disc.suggestedDiscount,
    suggestReason: disc.reason,
    avgOrder: disc.avgOrder || 0,
    invoiceCount: invoices.length,
    productPrice,
    lastInvoice,
    power: disc.power,
    timing: disc.timing,
    daysSince: disc.daysSince,
    monthAmount: disc.monthAmount,
    avgKg: disc.avgKg,
    maxSafeByHistory: disc.maxSafeByHistory,
    offers: disc.offers,
    recentInvoices: invoices.slice(0, 8).map((i) => ({
      id: i._id,
      invoiceNumber: i.invoiceNumber,
      totalAmount: i.totalAmount,
      totalKg: i.totalKg,
      discount: i.discount,
      priceTier: i.priceTier,
      date: i.date,
      status: i.status,
      itemCount: i.items.length,
      items: i.items.map((it) => ({
        productId: it.productId,
        productName: it.productName,
        unit: it.unit,
        qtyInput: it.qtyInput,
        qtyKg: it.qtyKg,
        unitPricePerKg: it.unitPricePerKg,
        kgPerPackage: it.kgPerPackage,
      })),
    })),
  };
}

export async function getCustomerCrmInsights(refDate?: Date) {
  const now = refDate ? new Date(refDate) : new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const activeStatuses = { $in: ['approved', 'shipped', 'delivered'] };

  // همان روز ماه قبل — بدون overflow (۳۱ → آخر ماه قبل)
  const prevMonthLastDay = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  const safeDay = Math.min(now.getDate(), prevMonthLastDay);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, safeDay);
  const lastMonthStart = startOfDay(lastMonth);
  const lastMonthEnd = endOfDay(lastMonth);
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  const [weekSales, monthSales, sameDaySales, todaySales, recentForDue] = await Promise.all([
    SaleInvoice.find({
      date: { $gte: weekAgo, $lte: now },
      status: activeStatuses,
      customerId: { $ne: null },
    }),
    SaleInvoice.find({
      date: { $gte: monthAgo, $lte: now },
      status: activeStatuses,
      customerId: { $ne: null },
    }),
    SaleInvoice.find({
      date: { $gte: lastMonthStart, $lte: lastMonthEnd },
      status: activeStatuses,
      customerId: { $ne: null },
    }),
    SaleInvoice.find({
      date: { $gte: todayStart, $lte: todayEnd },
      status: { $in: ['approved', 'shipped', 'delivered', 'pending'] },
      customerId: { $ne: null },
    }).select('customerId'),
    SaleInvoice.find({
      date: { $gte: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000), $lte: now },
      status: activeStatuses,
      customerId: { $ne: null },
    })
      .sort({ date: -1 })
      .limit(400),
  ]);

  const boughtToday = new Set(
    todaySales.map((i) => i.customerId!.toString()).filter(Boolean)
  );

  const countByCustomer = (invoices: typeof weekSales) => {
    const map = new Map<string, { count: number; total: number; last: Date; name?: string; phone?: string }>();
    for (const inv of invoices) {
      const id = inv.customerId!.toString();
      const cur = map.get(id) || {
        count: 0,
        total: 0,
        last: inv.date,
        name: inv.customerName,
        phone: inv.customerPhone,
      };
      cur.count += 1;
      cur.total += inv.totalAmount;
      if (inv.date > cur.last) cur.last = inv.date;
      cur.name = inv.customerName || cur.name;
      cur.phone = inv.customerPhone || cur.phone;
      map.set(id, cur);
    }
    return map;
  };

  const weekMap = countByCustomer(weekSales);
  const monthMap = countByCustomer(monthSales);

  const weekly = Array.from(weekMap.entries())
    .filter(([, v]) => v.count >= 1)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 12)
    .map(([id, v]) => ({
      customerId: id,
      name: v.name || '—',
      phone: v.phone,
      invoiceCount: v.count,
      totalAmount: v.total,
      segment: v.count >= 2 ? 'weekly' : 'active_week',
    }));

  const monthly = Array.from(monthMap.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 15)
    .map(([id, v]) => ({
      customerId: id,
      name: v.name || '—',
      phone: v.phone,
      invoiceCount: v.count,
      totalAmount: v.total,
      segment: weekMap.has(id) && (weekMap.get(id)?.count || 0) >= 2 ? 'weekly' : 'monthly',
    }));

  // فالوآپ: همان روز ماه قبل (اگر امروز هنوز نخریده)
  const followUp = [];
  const seen = new Set<string>();
  for (const inv of sameDaySales) {
    const id = inv.customerId!.toString();
    if (seen.has(id) || boughtToday.has(id)) continue;
    seen.add(id);
    const suggest = await getCustomerSuggestedPricing(id);
    followUp.push({
      customerId: id,
      name: inv.customerName || '—',
      phone: inv.customerPhone,
      lastInvoiceNumber: inv.invoiceNumber,
      lastAmount: inv.totalAmount,
      lastKg: inv.totalKg,
      lastDate: inv.date,
      preferredTier: suggest.preferredTier,
      suggestedDiscount: suggest.suggestedDiscount,
      suggestReason: suggest.suggestReason || 'همین روز ماه قبل خرید کرده بود',
      avgOrder: suggest.avgOrder,
      lastInvoice: suggest.lastInvoice,
      kind: 'same_day' as const,
    });
  }

  // فالوآپ موعد: ۲۵ تا ۴۰ روز از آخرین خرید
  const lastByCustomer = new Map<
    string,
    { inv: (typeof recentForDue)[0]; days: number }
  >();
  for (const inv of recentForDue) {
    const id = inv.customerId!.toString();
    if (!lastByCustomer.has(id)) {
      const days = (now.getTime() - new Date(inv.date).getTime()) / (1000 * 60 * 60 * 24);
      lastByCustomer.set(id, { inv, days });
    }
  }
  const dueFollowUp = [];
  for (const [id, { inv, days }] of lastByCustomer) {
    if (boughtToday.has(id) || seen.has(id)) continue;
    if (days < 25 || days > 40) continue;
    seen.add(id);
    const suggest = await getCustomerSuggestedPricing(id);
    dueFollowUp.push({
      customerId: id,
      name: inv.customerName || '—',
      phone: inv.customerPhone,
      lastInvoiceNumber: inv.invoiceNumber,
      lastAmount: inv.totalAmount,
      lastKg: inv.totalKg,
      lastDate: inv.date,
      preferredTier: suggest.preferredTier,
      suggestedDiscount: suggest.suggestedDiscount,
      suggestReason: suggest.suggestReason || `حدود ${Math.round(days)} روز از آخرین خرید`,
      avgOrder: suggest.avgOrder,
      lastInvoice: suggest.lastInvoice,
      kind: 'due' as const,
      daysSince: Math.round(days),
    });
  }

  return {
    weekly,
    monthly,
    followUpSameDayLastMonth: followUp.slice(0, 20),
    followUpDue: dueFollowUp.slice(0, 20),
  };
}

export type CustomerLoyaltyTier = 'gold' | 'silver' | 'bronze' | 'new';

/** لیست مشتریان با دسته‌بندی خودکار بر اساس خرید ماهانه (کیلو) */
export async function listCustomerDirectory(search?: string) {
  const now = new Date();
  const monthStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
  const customers = await listCustomers(search, { all: true, limit: 400 });
  const [sales, openDebts, lastTiers] = await Promise.all([
    SaleInvoice.find({
      date: { $gte: monthStart, $lte: now },
      status: { $in: ['approved', 'shipped', 'delivered'] },
      customerId: { $ne: null },
    }),
    Debtor.find({ isSettled: false }).select('customerId amount paidAmount dueDate'),
    SaleInvoice.aggregate([
      {
        $match: {
          customerId: { $ne: null },
          status: { $nin: ['cancelled', 'inactive'] },
        },
      },
      { $sort: { date: -1 } },
      {
        $group: {
          _id: '$customerId',
          lastTier: { $first: '$priceTier' },
          retail: { $sum: { $cond: [{ $eq: ['$priceTier', 'retail'] }, 1, 0] } },
          supermarket: { $sum: { $cond: [{ $eq: ['$priceTier', 'supermarket'] }, 1, 0] } },
          wholesale: { $sum: { $cond: [{ $eq: ['$priceTier', 'wholesale'] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const priceTierByCustomer = new Map<string, 'retail' | 'supermarket' | 'wholesale'>();
  for (const row of lastTiers as Array<{
    _id: unknown;
    lastTier?: string;
    retail: number;
    supermarket: number;
    wholesale: number;
  }>) {
    const counts: Array<['retail' | 'supermarket' | 'wholesale', number]> = [
      ['retail', row.retail || 0],
      ['supermarket', row.supermarket || 0],
      ['wholesale', row.wholesale || 0],
    ];
    counts.sort((a, b) => b[1] - a[1]);
    const preferred =
      counts[0][1] > 0
        ? counts[0][0]
        : row.lastTier === 'supermarket' || row.lastTier === 'wholesale'
          ? row.lastTier
          : 'retail';
    priceTierByCustomer.set(String(row._id), preferred);
  }

  const stats = new Map<
    string,
    { kg: number; amount: number; collected: number; count: number }
  >();
  for (const inv of sales) {
    const id = inv.customerId!.toString();
    const cur = stats.get(id) || { kg: 0, amount: 0, collected: 0, count: 0 };
    const total = Math.round(inv.totalAmount || 0);
    const cash = Math.round(inv.payment?.cash || 0);
    const card = Math.round(inv.payment?.card || 0);
    const credit = Math.round(inv.payment?.credit || 0);
    let recognized = cash + card;
    if (recognized <= 0 && credit <= 0) recognized = total;
    else if (recognized <= 0 && credit < total) recognized = Math.max(0, total - credit);
    // فروش ماه = مبلغ کل فاکتور؛ وصول = نقد/کارت
    cur.kg += inv.totalKg || 0;
    cur.amount += total;
    cur.collected += recognized;
    cur.count += 1;
    stats.set(id, cur);
  }

  const debtByCustomer = new Map<string, { open: number; overdue: number }>();
  for (const d of openDebts) {
    if (!d.customerId) continue;
    const id = d.customerId.toString();
    const rem = Math.max(0, (d.amount || 0) - (d.paidAmount || 0));
    if (rem <= 0) continue;
    const cur = debtByCustomer.get(id) || { open: 0, overdue: 0 };
    cur.open += rem;
    if (new Date(d.dueDate) < now) cur.overdue += rem;
    debtByCustomer.set(id, cur);
  }

  const rows = customers.map((c) => {
    const id = c._id.toString();
    const s = stats.get(id) || { kg: 0, amount: 0, collected: 0, count: 0 };
    const debt = debtByCustomer.get(id) || { open: 0, overdue: 0 };
    const openCredit = Math.max(debt.open, c.totalCredit || 0);
    const salesBase = Math.max(s.collected, 1);
    const ratio = openCredit / (salesBase + openCredit);
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (debt.overdue > 0 && ratio >= 0.35) riskLevel = 'critical';
    else if (debt.overdue > 0 || ratio >= 0.45) riskLevel = 'high';
    else if (ratio >= 0.2 || openCredit > 0) riskLevel = 'medium';
    const riskScore = Math.min(
      100,
      Math.round(ratio * 70 + (debt.overdue > 0 ? 30 : 0) + (debt.overdue / Math.max(openCredit, 1)) * 20)
    );

    let loyaltyTier: CustomerLoyaltyTier = 'new';
    if (s.kg >= 5000) loyaltyTier = 'gold';
    else if (s.kg >= 2000) loyaltyTier = 'silver';
    else if (s.count > 0) loyaltyTier = 'bronze';
    const priceTier = priceTierByCustomer.get(id) || 'none';
    const priceTierLabel =
      priceTier === 'wholesale'
        ? 'عمده'
        : priceTier === 'supermarket'
          ? 'سوپرمارکت'
          : priceTier === 'retail'
            ? 'تکی'
            : 'بدون سابقه';
    return {
      ...c.toObject(),
      monthKg: Math.round(s.kg * 100) / 100,
      monthAmount: s.amount,
      monthCollected: s.collected,
      monthInvoices: s.count,
      openCredit,
      overdueCredit: debt.overdue,
      riskScore,
      riskLevel,
      riskLabel:
        riskLevel === 'critical'
          ? 'ریسک خیلی بالا'
          : riskLevel === 'high'
            ? 'ریسک بالا'
            : riskLevel === 'medium'
              ? 'ریسک متوسط'
              : 'ریسک کم',
      loyaltyTier,
      tierLabel:
        loyaltyTier === 'gold'
          ? 'طلایی'
          : loyaltyTier === 'silver'
            ? 'نقره‌ای'
            : loyaltyTier === 'bronze'
              ? 'برنزی'
              : 'جدید',
      priceTier,
      priceTierLabel,
    };
  });

  rows.sort((a, b) => {
    const order: Record<string, number> = { wholesale: 0, supermarket: 1, retail: 2, none: 3 };
    const d = (order[a.priceTier] ?? 3) - (order[b.priceTier] ?? 3);
    if (d !== 0) return d;
    return b.monthKg - a.monthKg;
  });

  return {
    customers: rows,
    summary: {
      gold: rows.filter((r) => r.loyaltyTier === 'gold').length,
      silver: rows.filter((r) => r.loyaltyTier === 'silver').length,
      bronze: rows.filter((r) => r.loyaltyTier === 'bronze').length,
      new: rows.filter((r) => r.loyaltyTier === 'new').length,
      retail: rows.filter((r) => r.priceTier === 'retail').length,
      supermarket: rows.filter((r) => r.priceTier === 'supermarket').length,
      wholesale: rows.filter((r) => r.priceTier === 'wholesale').length,
      none: rows.filter((r) => r.priceTier === 'none').length,
    },
  };
}

/** مشتریان دارای مختصات + آخرین ویزیت/فروش برای نقشه */
export async function getCustomersMap() {
  const customers = await Customer.find({
    lat: { $ne: null, $exists: true },
    lng: { $ne: null, $exists: true },
  })
    .sort({ name: 1 })
    .limit(500);

  const ids = customers.map((c) => c._id);
  const sales = await SaleInvoice.find({
    customerId: { $in: ids },
    status: { $in: ['approved', 'shipped', 'pending'] },
  })
    .sort({ date: -1 })
    .select(
      'customerId invoiceNumber date totalAmount totalKg totalProfit discount status paymentMethod priceTier items customerAddress customerLat customerLng'
    );

  const byCustomer = new Map<
    string,
    {
      lastVisitAt: Date | null;
      lastInvoiceNumber?: string;
      totalKg: number;
      totalAmount: number;
      invoiceCount: number;
      invoices: Array<{
        id: string;
        invoiceNumber: string;
        date: Date;
        totalAmount: number;
        totalKg: number;
        totalProfit?: number;
        discount?: number;
        status: string;
        paymentMethod?: string;
        priceTier?: string;
        itemCount: number;
        items: Array<{
          productName: string;
          qtyKg: number;
          qtyInput: number;
          unit: string;
          unitPricePerKg: number;
          totalPrice: number;
        }>;
      }>;
    }
  >();

  for (const inv of sales) {
    const id = inv.customerId!.toString();
    const cur = byCustomer.get(id) || {
      lastVisitAt: null,
      totalKg: 0,
      totalAmount: 0,
      invoiceCount: 0,
      invoices: [],
    };
    if (!cur.lastVisitAt || new Date(inv.date) > cur.lastVisitAt) {
      cur.lastVisitAt = new Date(inv.date);
      cur.lastInvoiceNumber = inv.invoiceNumber;
    }
    if (inv.status !== 'pending' && inv.status !== 'cancelled') {
      cur.totalKg += inv.totalKg || 0;
      cur.totalAmount += inv.totalAmount || 0;
      cur.invoiceCount += 1;
    }
    if (cur.invoices.length < 12) {
      cur.invoices.push({
        id: inv._id.toString(),
        invoiceNumber: inv.invoiceNumber,
        date: inv.date,
        totalAmount: inv.totalAmount,
        totalKg: inv.totalKg || 0,
        totalProfit: inv.totalProfit,
        discount: inv.discount,
        status: inv.status,
        paymentMethod: inv.paymentMethod,
        priceTier: inv.priceTier,
        itemCount: inv.items?.length || 0,
        items: (inv.items || []).map((it) => ({
          productName: it.productName,
          qtyKg: it.qtyKg,
          qtyInput: it.qtyInput,
          unit: it.unit,
          unitPricePerKg: it.unitPricePerKg,
          totalPrice: it.totalPrice,
        })),
      });
    }
    byCustomer.set(id, cur);
  }

  const markers = customers
    .filter((c) => typeof c.lat === 'number' && typeof c.lng === 'number')
    .map((c) => {
      const id = c._id.toString();
      const s = byCustomer.get(id);
      const daysSince = s?.lastVisitAt
        ? Math.round((Date.now() - s.lastVisitAt.getTime()) / (1000 * 60 * 60 * 24))
        : null;
      let visitStatus: 'hot' | 'ok' | 'due' | 'cold' | 'never' = 'never';
      if (daysSince == null) visitStatus = 'never';
      else if (daysSince <= 7) visitStatus = 'hot';
      else if (daysSince <= 25) visitStatus = 'ok';
      else if (daysSince <= 40) visitStatus = 'due';
      else visitStatus = 'cold';

      return {
        id,
        name: c.name,
        phone: c.phone,
        address: c.address,
        lat: c.lat!,
        lng: c.lng!,
        totalCredit: c.totalCredit || 0,
        lastVisitAt: s?.lastVisitAt || null,
        lastInvoiceNumber: s?.lastInvoiceNumber,
        daysSinceVisit: daysSince,
        visitStatus,
        totalKg: Math.round((s?.totalKg || 0) * 100) / 100,
        totalAmount: s?.totalAmount || 0,
        invoiceCount: s?.invoiceCount || 0,
        invoices: s?.invoices || [],
      };
    });

  return {
    markers,
    count: markers.length,
    withSales: markers.filter((m) => m.invoiceCount > 0).length,
  };
}
