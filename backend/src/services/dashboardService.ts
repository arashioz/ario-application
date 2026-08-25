import { SaleInvoice, Expense, Debtor, CashTransaction, Product, PurchaseInvoice } from '../models';
import { startOfDay, endOfDay } from '../utils/persian';
import { getOrCreateSettings } from './productService';
import { getCompanyDebtSummary } from './companyService';
import { getTargetProgress } from './targetService';
import { getDueChecksSummary } from './checkService';
import { getCustomerCrmInsights, normalizePhoneDigits } from './customerService';

/** فقط بار ارسال/تحویل‌شده در فروش و سود روز می‌آید (ثبت‌شدهٔ ارسال‌نشده نه) */
const REVENUE_STATUSES = { $in: ['shipped', 'delivered'] as const };

/** این‌ها روی صندوق اثر دارند ولی هزینهٔ عملیاتی نیستند — نباید از سود کم شوند */
const NON_OPERATING_EXPENSE_TYPES = new Set(['loan_received', 'loan_given', 'withdrawal']);

function operatingExpenseAmount(type: string | undefined, amount: number): number {
  if (type && NON_OPERATING_EXPENSE_TYPES.has(type)) return 0;
  return amount || 0;
}

/**
 * سهم پرداخت‌شدهٔ فعلی فاکتور (نقد+کارت بعد از تسویه‌ها).
 * برای صندوق لحظه‌ای است؛ فروش روز را با originalInvoiceSplit / dayLedger بسنج.
 */
export function recognizedSaleMetrics(inv: {
  totalAmount?: number;
  totalProfit?: number;
  totalCost?: number;
  totalKg?: number;
  payment?: { cash?: number; card?: number; credit?: number } | null;
}) {
  const total = Math.max(0, Math.round(inv.totalAmount || 0));
  const credit = Math.max(0, Math.round(inv.payment?.credit || 0));
  const cash = Math.max(0, Math.round(inv.payment?.cash || 0));
  const card = Math.max(0, Math.round(inv.payment?.card || 0));
  let recognized = cash + card;
  // محافظت اگر payment ناقص باشد ولی اعتبار مانده باشد
  if (recognized <= 0 && credit > 0 && credit < total) {
    recognized = Math.max(0, total - credit);
  } else if (recognized <= 0 && credit <= 0) {
    recognized = total;
  } else if (recognized > total) {
    recognized = total;
  }
  const ratio = total > 0 ? Math.min(1, recognized / total) : 0;
  return {
    amount: Math.round(recognized),
    profit: Math.round((inv.totalProfit || 0) * ratio),
    cost: Math.round((inv.totalCost || 0) * ratio),
    kg: Math.round((inv.totalKg || 0) * ratio * 100) / 100,
    creditOpen: credit,
    cash,
    card,
  };
}

/** تفکیک بار ارسال‌شده: بخش پرداخت‌شده در برابر نسیهٔ باز */
export function splitSaleMetrics(inv: {
  totalAmount?: number;
  totalProfit?: number;
  totalCost?: number;
  totalKg?: number;
  payment?: { cash?: number; card?: number; credit?: number } | null;
}) {
  const paid = recognizedSaleMetrics(inv);
  const total = Math.max(0, Math.round(inv.totalAmount || 0));
  const credit = Math.max(0, Math.round(inv.payment?.credit || 0));
  const cRatio = total > 0 ? Math.min(1, credit / total) : 0;
  return {
    paid: {
      amount: paid.amount,
      profit: paid.profit,
      cost: paid.cost,
      kg: paid.kg,
      cash: paid.cash,
      card: paid.card,
    },
    credit: {
      amount: credit,
      profit: Math.round((inv.totalProfit || 0) * cRatio),
      cost: Math.round((inv.totalCost || 0) * cRatio),
      kg: Math.round((inv.totalKg || 0) * cRatio * 100) / 100,
    },
  };
}

export type ShippedBucket = {
  sales: number;
  profit: number;
  cost: number;
  kg: number;
  invoiceCount: number;
};

function emptyShippedBucket(): ShippedBucket {
  return { sales: 0, profit: 0, cost: 0, kg: 0, invoiceCount: 0 };
}

type PaymentEventLike = {
  amount?: number;
  method?: string;
  date?: Date | string;
  kind?: string;
  note?: string;
};

/**
 * پرداخت هنگام ثبت فاکتور در برابر نسیهٔ همان فاکتور — بدون اینکه تسویهٔ بعدی
 * فروشِ روز فاکتور را بالا ببرد. تسویه روی روز پرداخت جدا حساب می‌شود.
 */
export function originalInvoiceSplit(inv: {
  totalAmount?: number;
  totalProfit?: number;
  totalCost?: number;
  totalKg?: number;
  payment?: { cash?: number; card?: number; credit?: number } | null;
  paymentEvents?: PaymentEventLike[] | null;
  extraSettled?: number;
}) {
  const total = Math.max(0, Math.round(inv.totalAmount || 0));
  const currentCredit = Math.max(0, Math.round(inv.payment?.credit || 0));
  const events = Array.isArray(inv.paymentEvents) ? inv.paymentEvents : [];
  const settledFromEvents = events
    .filter((e) => e.kind === 'credit_settle')
    .reduce((s, e) => s + Math.max(0, Math.round(e.amount || 0)), 0);
  const settled =
    settledFromEvents > 0 ? settledFromEvents : Math.max(0, Math.round(inv.extraSettled || 0));
  const originalCredit = Math.min(total, currentCredit + settled);
  const invoicePaid = events
    .filter((e) => e.kind === 'invoice')
    .reduce((s, e) => s + Math.max(0, Math.round(e.amount || 0)), 0);
  const originalPaid =
    invoicePaid > 0 ? Math.min(total, invoicePaid) : Math.max(0, total - originalCredit);

  const pRatio = total > 0 ? originalPaid / total : 0;
  const cRatio = total > 0 ? originalCredit / total : 0;

  let cash = 0;
  let card = 0;
  const invoiceEv = events.filter((e) => e.kind === 'invoice');
  if (invoiceEv.length) {
    for (const e of invoiceEv) {
      if (e.method === 'cash') cash += Math.round(e.amount || 0);
      else card += Math.round(e.amount || 0);
    }
  } else {
    cash = Math.max(0, Math.round(inv.payment?.cash || 0));
    card = Math.max(0, Math.round(inv.payment?.card || 0));
    const sum = cash + card;
    if (sum > originalPaid && sum > 0) {
      cash = Math.round((cash / sum) * originalPaid);
      card = originalPaid - cash;
    }
  }

  return {
    sold: total,
    paid: originalPaid,
    credit: originalCredit,
    cash,
    card,
    profit: Math.round(inv.totalProfit || 0),
    paidProfit: Math.round((inv.totalProfit || 0) * pRatio),
    creditProfit: Math.round((inv.totalProfit || 0) * cRatio),
    cost: Math.round(inv.totalCost || 0),
    paidCost: Math.round((inv.totalCost || 0) * pRatio),
    creditCost: Math.round((inv.totalCost || 0) * cRatio),
    kg: Math.round((inv.totalKg || 0) * 100) / 100,
    paidKg: Math.round((inv.totalKg || 0) * pRatio * 100) / 100,
    creditKg: Math.round((inv.totalKg || 0) * cRatio * 100) / 100,
  };
}

export type DayCollectionItem = {
  invoiceId?: string;
  invoiceNumber?: string;
  customerName: string;
  amount: number;
  method: 'cash' | 'card' | 'card_to_card';
  date: string;
  invoiceDate?: string;
  isPriorCredit: boolean;
  note?: string;
};

export type DaySoldItem = {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  totalAmount: number;
  totalKg: number;
  paid: number;
  credit: number;
  date: string;
};

export type DayLedgerBucket = {
  date: string;
  soldGross: number;
  soldKg: number;
  soldProfit: number;
  soldCost: number;
  soldCount: number;
  soldPaid: number;
  soldCredit: number;
  collectionsTotal: number;
  priorCreditCollected: number;
};

export type DayLedger = {
  soldGross: number;
  soldKg: number;
  soldProfit: number;
  soldCost: number;
  soldCount: number;
  soldPaid: number;
  soldCredit: number;
    soldCash: number;
    soldCard: number;
    soldPaidProfit: number;
    soldCreditProfit: number;
    collectionsTotal: number;
  priorCreditCollected: number;
  sameDayCreditCollected: number;
  collections: DayCollectionItem[];
  soldInvoices: DaySoldItem[];
  daily: DayLedgerBucket[];
};

function emptyLedgerBucket(date: string): DayLedgerBucket {
  return {
    date,
    soldGross: 0,
    soldKg: 0,
    soldProfit: 0,
    soldCost: 0,
    soldCount: 0,
    soldPaid: 0,
    soldCredit: 0,
    collectionsTotal: 0,
    priorCreditCollected: 0,
  };
}

function dayKeyOf(d: Date | string): string {
  return startOfDay(new Date(d)).toISOString().split('T')[0];
}

function inDayRange(d: Date | string | undefined, from: Date, to: Date): boolean {
  if (!d) return false;
  const t = new Date(d).getTime();
  return t >= from.getTime() && t <= to.getTime();
}

function normalizePayMethod(m?: string): 'cash' | 'card' | 'card_to_card' {
  if (m === 'card_to_card' || m === 'card' || m === 'cash') return m;
  return 'cash';
}

export async function buildDayLedger(
  rangeStart: Date,
  rangeEnd: Date,
  marketerId?: string
): Promise<DayLedger> {
  const saleFilter: Record<string, unknown> = {
    date: { $gte: rangeStart, $lte: rangeEnd },
    status: REVENUE_STATUSES,
  };
  if (marketerId) saleFilter.marketerId = marketerId;

  const collectFilter: Record<string, unknown> = {
    paymentEvents: {
      $elemMatch: { kind: 'credit_settle', date: { $gte: rangeStart, $lte: rangeEnd } },
    },
  };
  if (marketerId) collectFilter.marketerId = marketerId;

  const soldInvs = await SaleInvoice.find(saleFilter).select(
    'invoiceNumber customerName totalAmount totalProfit totalCost totalKg payment paymentEvents date'
  );

  const [collectInvs, debtors] = await Promise.all([
    SaleInvoice.find(collectFilter).select('invoiceNumber customerName paymentEvents date marketerId'),
    Debtor.find({
      $or: [
        { 'payments.date': { $gte: rangeStart, $lte: rangeEnd } },
        { saleInvoiceId: { $in: soldInvs.map((s) => s._id) } },
      ],
    }).select('name saleInvoiceId payments'),
  ]);

  const extraSettled = new Map<string, number>();
  for (const d of debtors) {
    const id = d.saleInvoiceId ? String(d.saleInvoiceId) : '';
    if (!id) continue;
    const sum = (d.payments || []).reduce((s, p) => s + Math.max(0, Math.round(p.amount || 0)), 0);
    extraSettled.set(id, (extraSettled.get(id) || 0) + sum);
  }

  const byDay = new Map<string, DayLedgerBucket>();
  const bucket = (date: Date | string) => {
    const key = dayKeyOf(date);
    let b = byDay.get(key);
    if (!b) {
      b = emptyLedgerBucket(key);
      byDay.set(key, b);
    }
    return b;
  };

  const soldInvoices: DaySoldItem[] = [];
  let soldGross = 0;
  let soldKg = 0;
  let soldProfit = 0;
  let soldCost = 0;
  let soldPaid = 0;
  let soldCredit = 0;
  let soldCash = 0;
  let soldCard = 0;
  let soldPaidProfit = 0;
  let soldCreditProfit = 0;

  for (const inv of soldInvs) {
    const orig = originalInvoiceSplit({
      totalAmount: inv.totalAmount,
      totalProfit: inv.totalProfit,
      totalCost: inv.totalCost,
      totalKg: inv.totalKg,
      payment: inv.payment,
      paymentEvents: inv.paymentEvents,
      extraSettled: extraSettled.get(String(inv._id)),
    });
    soldGross += orig.sold;
    soldKg += orig.kg;
    soldProfit += orig.profit;
    soldCost += orig.cost;
    soldPaid += orig.paid;
    soldCredit += orig.credit;
    soldCash += orig.cash;
    soldCard += orig.card;
    soldPaidProfit += orig.paidProfit;
    soldCreditProfit += orig.creditProfit;
    const day = bucket(inv.date);
    day.soldGross += orig.sold;
    day.soldKg += orig.kg;
    day.soldProfit += orig.profit;
    day.soldCost += orig.cost;
    day.soldCount += 1;
    day.soldPaid += orig.paid;
    day.soldCredit += orig.credit;
    soldInvoices.push({
      invoiceId: String(inv._id),
      invoiceNumber: inv.invoiceNumber,
      customerName: inv.customerName || 'بدون نام',
      totalAmount: orig.sold,
      totalKg: orig.kg,
      paid: orig.paid,
      credit: orig.credit,
      date: new Date(inv.date).toISOString(),
    });
  }

  const collections: DayCollectionItem[] = [];
  const usedInvoicePayKeys = new Set<string>();

  const pushCollection = (item: DayCollectionItem) => {
    if (item.amount <= 0) return;
    collections.push(item);
    const day = bucket(item.date);
    day.collectionsTotal += item.amount;
    if (item.isPriorCredit) day.priorCreditCollected += item.amount;
  };

  for (const inv of collectInvs) {
    const invDay = dayKeyOf(inv.date);
    for (const ev of inv.paymentEvents || []) {
      if (ev.kind !== 'credit_settle' || !inDayRange(ev.date, rangeStart, rangeEnd)) continue;
      const payDay = dayKeyOf(ev.date);
      const amount = Math.max(0, Math.round(ev.amount || 0));
      pushCollection({
        invoiceId: String(inv._id),
        invoiceNumber: inv.invoiceNumber,
        customerName: inv.customerName || 'بدون نام',
        amount,
        method: normalizePayMethod(ev.method),
        date: new Date(ev.date).toISOString(),
        invoiceDate: new Date(inv.date).toISOString(),
        isPriorCredit: payDay !== invDay,
        note: ev.note,
      });
      usedInvoicePayKeys.add(`${String(inv._id)}:${payDay}:${amount}`);
    }
  }

  const collectInvIds = new Set(collectInvs.map((i) => String(i._id)));
  const missingInvIds = [
    ...new Set(
      debtors
        .filter((d) => d.saleInvoiceId && !collectInvIds.has(String(d.saleInvoiceId)))
        .map((d) => String(d.saleInvoiceId))
    ),
  ];
  const fallbackInvs =
    missingInvIds.length > 0
      ? await SaleInvoice.find({ _id: { $in: missingInvIds } }).select(
          'invoiceNumber customerName date marketerId paymentEvents'
        )
      : [];
  const fallbackById = new Map(fallbackInvs.map((i) => [String(i._id), i]));

  for (const d of debtors) {
    const invId = d.saleInvoiceId ? String(d.saleInvoiceId) : '';
    const inv = invId
      ? collectInvs.find((i) => String(i._id) === invId) || fallbackById.get(invId)
      : undefined;
    if (inv && (inv.paymentEvents || []).some((e) => e.kind === 'credit_settle')) continue;
    if (marketerId && inv && String(inv.marketerId || '') !== String(marketerId)) continue;
    for (const p of d.payments || []) {
      if (!inDayRange(p.date, rangeStart, rangeEnd)) continue;
      const amount = Math.max(0, Math.round(p.amount || 0));
      const payDay = dayKeyOf(p.date);
      const key = invId ? `${invId}:${payDay}:${amount}` : '';
      if (key && usedInvoicePayKeys.has(key)) continue;
      const invDay = inv ? dayKeyOf(inv.date) : '';
      pushCollection({
        invoiceId: invId || undefined,
        invoiceNumber: inv?.invoiceNumber,
        customerName: inv?.customerName || d.name || 'بدون نام',
        amount,
        method: normalizePayMethod(p.method),
        date: new Date(p.date).toISOString(),
        invoiceDate: inv ? new Date(inv.date).toISOString() : undefined,
        isPriorCredit: !inv || payDay !== invDay,
        note: p.note,
      });
    }
  }

  collections.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  soldInvoices.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const priorCreditCollected = collections
    .filter((c) => c.isPriorCredit)
    .reduce((s, c) => s + c.amount, 0);
  const collectionsTotal = collections.reduce((s, c) => s + c.amount, 0);

  return {
    soldGross: Math.round(soldGross),
    soldKg: Math.round(soldKg * 100) / 100,
    soldProfit: Math.round(soldProfit),
    soldCost: Math.round(soldCost),
    soldCount: soldInvs.length,
    soldPaid: Math.round(soldPaid),
    soldCredit: Math.round(soldCredit),
    soldCash: Math.round(soldCash),
    soldCard: Math.round(soldCard),
    soldPaidProfit: Math.round(soldPaidProfit),
    soldCreditProfit: Math.round(soldCreditProfit),
    collectionsTotal: Math.round(collectionsTotal),
    priorCreditCollected: Math.round(priorCreditCollected),
    sameDayCreditCollected: Math.round(collectionsTotal - priorCreditCollected),
    collections,
    soldInvoices,
    daily: Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export function aggregateShippedSplit(
  sales: Array<{
    totalAmount?: number;
    totalProfit?: number;
    totalCost?: number;
    totalKg?: number;
    payment?: { cash?: number; card?: number; credit?: number } | null;
    paymentEvents?: PaymentEventLike[] | null;
    extraSettled?: number;
  }>
): { paid: ShippedBucket; credit: ShippedBucket } {
  const paid = emptyShippedBucket();
  const credit = emptyShippedBucket();
  for (const sale of sales) {
    const s = originalInvoiceSplit(sale);
    if (s.paid > 0) {
      paid.sales += s.paid;
      paid.profit += s.paidProfit;
      paid.cost += s.paidCost;
      paid.kg += s.paidKg;
      paid.invoiceCount += 1;
    }
    if (s.credit > 0) {
      credit.sales += s.credit;
      credit.profit += s.creditProfit;
      credit.cost += s.creditCost;
      credit.kg += s.creditKg;
      credit.invoiceCount += 1;
    }
  }
  return {
    paid: {
      sales: Math.round(paid.sales),
      profit: Math.round(paid.profit),
      cost: Math.round(paid.cost),
      kg: Math.round(paid.kg * 100) / 100,
      invoiceCount: paid.invoiceCount,
    },
    credit: {
      sales: Math.round(credit.sales),
      profit: Math.round(credit.profit),
      cost: Math.round(credit.cost),
      kg: Math.round(credit.kg * 100) / 100,
      invoiceCount: credit.invoiceCount,
    },
  };
}


type ProfitAvgBucket = {
  invoiceCount: number;
  totalSales: number;
  totalProfit: number;
  totalKg: number;
  avgProfitPerInvoice: number;
  avgMarkupPercent: number;
  avgMarginPercent: number;
};

function emptyProfitBucket(): ProfitAvgBucket {
  return {
    invoiceCount: 0,
    totalSales: 0,
    totalProfit: 0,
    totalKg: 0,
    avgProfitPerInvoice: 0,
    avgMarkupPercent: 0,
    avgMarginPercent: 0,
  };
}

function summarizeProfitBucket(
  sales: Array<{
    totalAmount?: number;
    totalProfit?: number;
    totalCost?: number;
    totalKg?: number;
    payment?: { cash?: number; card?: number; credit?: number } | null;
  }>
): ProfitAvgBucket {
  let totalSales = 0;
  let totalProfit = 0;
  let totalKg = 0;
  let markupSum = 0;
  let markupN = 0;
  let marginSum = 0;
  let marginN = 0;
  let invoiceCount = 0;
  for (const sale of sales) {
    const orig = originalInvoiceSplit(sale);
    if (orig.sold <= 0) continue;
    invoiceCount += 1;
    totalSales += orig.sold;
    totalProfit += orig.profit;
    totalKg += orig.kg;
    if (orig.cost > 0) {
      markupSum += (orig.profit / orig.cost) * 100;
      markupN += 1;
    }
    marginSum += (orig.profit / orig.sold) * 100;
    marginN += 1;
  }
  return {
    invoiceCount,
    totalSales: Math.round(totalSales),
    totalProfit: Math.round(totalProfit),
    totalKg: Math.round(totalKg * 100) / 100,
    avgProfitPerInvoice: invoiceCount > 0 ? Math.round(totalProfit / invoiceCount) : 0,
    avgMarkupPercent: markupN > 0 ? Math.round((markupSum / markupN) * 10) / 10 : 0,
    avgMarginPercent: marginN > 0 ? Math.round((marginSum / marginN) * 10) / 10 : 0,
  };
}

/** میانگین سود فاکتورهای ارسال/تحویل‌شده — هفته / ماه / سال / کلی */
export async function getProfitAverages(refDate?: Date) {
  const now = refDate ? new Date(refDate) : new Date();
  const dayEnd = endOfDay(now);
  const weekFrom = startOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
  const monthFrom = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
  const yearFrom = startOfDay(new Date(now.getFullYear(), 0, 1));

  const sales = await SaleInvoice.find({
    status: REVENUE_STATUSES,
    date: { $lte: dayEnd },
  }).select('date totalAmount totalProfit totalCost totalKg payment');

  const inRange = (from: Date) => sales.filter((s) => new Date(s.date) >= from && new Date(s.date) <= dayEnd);

  return {
    week: summarizeProfitBucket(inRange(weekFrom)),
    month: summarizeProfitBucket(inRange(monthFrom)),
    year: summarizeProfitBucket(inRange(yearFrom)),
    all: summarizeProfitBucket(sales),
  };
}
async function getInventorySnapshot() {
  const [products, purchaseTotals, saleTotals] = await Promise.all([
    Product.find().sort({ stockKg: -1 }).select('name stockKg stock kgPerPackage avgCostPerKg'),
    PurchaseInvoice.aggregate<{ kg?: number }>([
      { $unwind: '$items' },
      { $group: { _id: null, kg: { $sum: { $ifNull: ['$items.qtyKg', '$items.quantity'] } } } },
    ]),
    SaleInvoice.aggregate<{ kg?: number }>([
      { $match: { stockApplied: true, status: { $nin: ['cancelled', 'inactive'] } } },
      { $unwind: '$items' },
      { $group: { _id: null, kg: { $sum: { $ifNull: ['$items.qtyKg', '$items.quantity'] } } } },
    ]),
  ]);
  const normalized = products.map((p) => {
    const stockKg = Number(p.stockKg ?? p.stock ?? 0) || 0;
    const kgPer = p.kgPerPackage || 5;
    return {
      id: p._id.toString(),
      name: p.name,
      stockKg,
      kgPerPackage: kgPer,
      packages: kgPer > 0 ? Math.round((stockKg / kgPer) * 10) / 10 : 0,
      avgCostPerKg: p.avgCostPerKg || 0,
    };
  });

  // ادغام نام‌های تکراری برای نمایش داشبورد
  const byName = new Map<
    string,
    { id: string; name: string; stockKg: number; packages: number; kgPerPackage: number; avgCostPerKg: number }
  >();
  for (const p of normalized) {
    const key = p.name.trim();
    const prev = byName.get(key);
    if (!prev) byName.set(key, { ...p });
    else {
      const oldKg = prev.stockKg;
      const newKg = oldKg + p.stockKg;
      prev.avgCostPerKg =
        newKg > 0 ? (prev.avgCostPerKg * oldKg + p.avgCostPerKg * p.stockKg) / newKg : prev.avgCostPerKg;
      prev.stockKg = newKg;
      prev.packages += p.packages;
    }
  }
  const merged = Array.from(byName.values());
  const totalKg = merged.reduce((s, p) => s + p.stockKg, 0);
  const totalValue = merged.reduce((s, p) => s + p.stockKg * (p.avgCostPerKg || 0), 0);
  const totalPackages = merged.reduce((s, p) => s + p.packages, 0);
  const lowStock = merged
    .filter((p) => p.stockKg > 0 && p.stockKg < 200)
    .sort((a, b) => a.stockKg - b.stockKg)
    .slice(0, 6);
  const empty = merged.filter((p) => p.stockKg <= 0).length;
  const allProducts = [...merged].sort((a, b) => b.stockKg - a.stockKg);

  return {
    /** مجموع خریدهای ثبت‌شده؛ اصلاح دستی موجودی در آن نیست */
    purchasedKg: Math.round(((purchaseTotals[0]?.kg || 0) * 100)) / 100,
    /** فقط فروش‌هایی که واقعاً از انبار کم شده‌اند */
    soldKg: Math.round(((saleTotals[0]?.kg || 0) * 100)) / 100,
    totalKg: Math.round(totalKg * 100) / 100,
    totalTons: Math.round((totalKg / 1000) * 1000) / 1000,
    totalPackages: Math.round(totalPackages),
    totalValue: Math.round(totalValue),
    productCount: merged.length,
    emptyCount: empty,
    lowStock,
    products: allProducts,
  };
}

export async function getDashboard(
  date?: Date,
  marketerId?: string,
  period: 'today' | 'week' | 'month' = 'today'
) {
  const targetDate = date ? new Date(date) : new Date();
  const dayEnd = endOfDay(targetDate);
  let rangeStart = startOfDay(targetDate);
  if (period === 'week') {
    rangeStart = startOfDay(new Date(targetDate.getTime() - 6 * 24 * 60 * 60 * 1000));
  } else if (period === 'month') {
    rangeStart = startOfDay(new Date(targetDate.getFullYear(), targetDate.getMonth(), 1));
  }

  const monthStart = startOfDay(new Date(targetDate.getFullYear(), targetDate.getMonth(), 1));
  const monthEnd = endOfDay(new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0));

  const saleFilterRange: Record<string, unknown> = { date: { $gte: rangeStart, $lte: dayEnd } };
  const saleFilterMonth: Record<string, unknown> = { date: { $gte: monthStart, $lte: monthEnd } };
  if (marketerId) {
    saleFilterRange.marketerId = marketerId;
    saleFilterMonth.marketerId = marketerId;
  }

  const ACTIVE = REVENUE_STATUSES;

  const [sales, monthSales, expenses, settings, debtors, cardDeposits, company, checks, crm, readyShip, pendingCount, inventory, profitAverages, dayLedger] =
    await Promise.all([
      SaleInvoice.find({ ...saleFilterRange, status: ACTIVE }),
      SaleInvoice.find({ ...saleFilterMonth, status: ACTIVE }),
      Expense.find({ date: { $gte: rangeStart, $lte: dayEnd } }),
      getOrCreateSettings(),
      Debtor.find({ isSettled: false }).sort({ dueDate: 1 }),
      CashTransaction.find({
        type: 'card_deposit',
        date: { $gte: rangeStart, $lte: dayEnd },
      }),
      getCompanyDebtSummary(),
      getDueChecksSummary(),
      getCustomerCrmInsights(targetDate),
      SaleInvoice.find({
        status: 'approved',
        priceTier: { $in: ['supermarket', 'wholesale'] },
      })
        .sort({ approvedAt: -1 })
        .limit(12)
        .select('invoiceNumber customerName customerAddress totalKg totalAmount driverId shippingNotes date'),
      SaleInvoice.countDocuments({ status: 'pending' }),
      getInventorySnapshot(),
      getProfitAverages(targetDate),
      buildDayLedger(rangeStart, dayEnd, marketerId),
    ]);

  const totalSales = dayLedger.soldGross;
  const soldKg = dayLedger.soldKg;
  const totalProfit = dayLedger.soldProfit;
  const totalCost = dayLedger.soldCost;
  const shippedSplit = aggregateShippedSplit(sales);

  const expenseByType: Record<string, number> = {};
  let totalExpenses = 0;
  let excludedExpenses = 0;
  for (const e of expenses) {
    const amt = e.amount || 0;
    const op = operatingExpenseAmount(e.type, amt);
    if (op <= 0) {
      if (amt > 0) excludedExpenses += amt;
      continue;
    }
    totalExpenses += op;
    const key = e.type || 'other';
    expenseByType[key] = (expenseByType[key] || 0) + op;
  }
  const netProfit = totalProfit - totalExpenses;

  const monthSalesAmount = monthSales.reduce((s, inv) => s + originalInvoiceSplit(inv).sold, 0);
  const monthSoldKg = monthSales.reduce((s, inv) => s + originalInvoiceSplit(inv).kg, 0);
  const monthProfit = monthSales.reduce((s, inv) => s + originalInvoiceSplit(inv).profit, 0);

  const cashSales = dayLedger.soldCash;
  const cardSales = dayLedger.soldCard;
  const creditSales = dayLedger.soldCredit;
  const cardDepositTotal = cardDeposits.reduce((s, t) => s + t.amount, 0);

  const overdueDebtors = debtors.filter((d) => new Date(d.dueDate) < new Date());
  const upcomingDebtors = debtors.filter((d) => new Date(d.dueDate) >= new Date());

  let target: unknown = null;
  if (marketerId) {
    target = await getTargetProgress(
      marketerId,
      targetDate.getFullYear(),
      targetDate.getMonth() + 1
    );
  }

  const periodLabel = period === 'week' ? '۷ روز' : period === 'month' ? 'این ماه' : 'امروز';

  return {
    date: targetDate.toISOString(),
    period,
    periodLabel,
    periodFrom: rangeStart.toISOString(),
    periodTo: dayEnd.toISOString(),
    totalSales,
    /** مبالغ سیستم به تومان است */
    totalSalesToman: totalSales,
    soldKg,
    soldTons: Math.round((soldKg / 1000) * 1000) / 1000,
    totalCost,
    totalProfit,
    totalExpenses,
    excludedExpenses,
    netProfit,
    expenseByType,
    cashSales,
    cardSales,
    creditSales,
    cardDepositTotal,
    cashBalance: settings.cashBalance,
    cardBalance: settings.cardBalance,
    salesCount: dayLedger.soldCount,
    /** دو ستون خلاصه روز: پرداخت‌شده هنگام فاکتور | نسیه همان فاکتورها */
    shippedSplit,
    dayLedger: {
      soldGross: dayLedger.soldGross,
      soldKg: dayLedger.soldKg,
      soldProfit: dayLedger.soldProfit,
      soldCount: dayLedger.soldCount,
      soldPaid: dayLedger.soldPaid,
      soldCredit: dayLedger.soldCredit,
      collectionsTotal: dayLedger.collectionsTotal,
      priorCreditCollected: dayLedger.priorCreditCollected,
      sameDayCreditCollected: dayLedger.sameDayCreditCollected,
      collections: dayLedger.collections.slice(0, 40),
      soldInvoices: dayLedger.soldInvoices.slice(0, 200),
    },
    expenseCount: expenses.filter((e) => operatingExpenseAmount(e.type, e.amount) > 0).length,
    inventory,
    month: {
      totalSales: monthSalesAmount,
      totalSalesToman: monthSalesAmount,
      soldKg: monthSoldKg,
      soldTons: Math.round((monthSoldKg / 1000) * 1000) / 1000,
      totalProfit: monthProfit,
      salesCount: monthSales.length,
    },
    companyDebt: {
      total: company.totalDebt,
      count: company.openCount,
      debts: company.debts,
      applyOrderHint: company.applyOrderHint,
    },
    profitAverages,
    target,
    checks: {
      pendingCount: checks.pendingCount,
      overdueCount: checks.overdueCount,
      overdue: checks.overdue.slice(0, 5).map((c) => ({
        id: c._id,
        payerName: c.payerName,
        amount: c.amount,
        invoiceNumber: c.invoiceNumber,
        dueDate: c.dueDate,
        followUpDate: c.followUpDate,
      })),
      upcoming: checks.upcoming.slice(0, 5).map((c) => ({
        id: c._id,
        payerName: c.payerName,
        amount: c.amount,
        invoiceNumber: c.invoiceNumber,
        dueDate: c.dueDate,
        followUpDate: c.followUpDate,
      })),
    },
    crm: {
      weekly: crm.weekly.slice(0, 8),
      monthly: crm.monthly.slice(0, 8),
      followUpSameDayLastMonth: crm.followUpSameDayLastMonth.slice(0, 10),
      followUpDue: (crm.followUpDue || []).slice(0, 10),
    },
    shipping: {
      ready: readyShip.map((s) => ({
        id: s._id,
        invoiceNumber: s.invoiceNumber,
        customerName: s.customerName,
        customerAddress: s.customerAddress,
        totalKg: s.totalKg,
        totalAmount: s.totalAmount,
        driverId: s.driverId,
        date: s.date,
      })),
      count: readyShip.length,
    },
    pendingApprovals: pendingCount,
    debtors: {
      total: debtors.reduce((s, d) => s + (d.amount - d.paidAmount), 0),
      count: debtors.length,
      overdue: overdueDebtors.map((d) => ({
        id: d._id,
        name: d.name,
        phone: d.phone,
        remaining: d.amount - d.paidAmount,
        dueDate: d.dueDate,
      })),
      upcoming: upcomingDebtors.map((d) => ({
        id: d._id,
        name: d.name,
        phone: d.phone,
        remaining: d.amount - d.paidAmount,
        dueDate: d.dueDate,
      })),
    },
  };
}

export async function getPeriodSummary(from: Date, to: Date, marketerId?: string) {
  const rangeFrom = startOfDay(from);
  const rangeTo = endOfDay(to);
  const saleFilter: Record<string, unknown> = { date: { $gte: rangeFrom, $lte: rangeTo } };
  if (marketerId) saleFilter.marketerId = marketerId;

  const activeStatuses = REVENUE_STATUSES;
  const [sales, expenses, settings, dayLedger] = await Promise.all([
    SaleInvoice.find({ ...saleFilter, status: activeStatuses }),
    Expense.find({ date: { $gte: rangeFrom, $lte: rangeTo } }),
    getOrCreateSettings(),
    buildDayLedger(rangeFrom, rangeTo, marketerId),
  ]);

  const dailyMap = new Map<
    string,
    {
      sales: number;
      profit: number;
      expenses: number;
      soldKg: number;
      creditCollected: number;
      priorCreditCollected: number;
    }
  >();

  let cashSales = 0;
  let cardSales = 0;
  let creditSales = 0;
  let goldenCount = 0;
  let goldenAmount = 0;
  let goldenKg = 0;
  let invoiceCount = sales.length;

  for (const sale of sales) {
    const key = startOfDay(sale.date).toISOString().split('T')[0];
    const entry = dailyMap.get(key) || {
      sales: 0,
      profit: 0,
      expenses: 0,
      soldKg: 0,
      creditCollected: 0,
      priorCreditCollected: 0,
    };
    const orig = originalInvoiceSplit(sale);
    entry.sales += orig.sold;
    entry.profit += orig.profit;
    entry.soldKg += orig.kg;
    dailyMap.set(key, entry);

    cashSales += orig.cash;
    cardSales += orig.card;
    creditSales += orig.credit;
    if (sale.isGolden) {
      goldenCount += 1;
      goldenAmount += orig.sold;
      goldenKg += orig.kg;
    }
  }

  for (const d of dayLedger.daily) {
    const entry = dailyMap.get(d.date) || {
      sales: 0,
      profit: 0,
      expenses: 0,
      soldKg: 0,
      creditCollected: 0,
      priorCreditCollected: 0,
    };
    entry.creditCollected = d.collectionsTotal;
    entry.priorCreditCollected = d.priorCreditCollected;
    if (entry.sales === 0 && d.soldGross > 0) {
      entry.sales = d.soldGross;
      entry.profit = d.soldProfit;
      entry.soldKg = d.soldKg;
    }
    dailyMap.set(d.date, entry);
  }

  for (const expense of expenses) {
    const key = startOfDay(expense.date).toISOString().split('T')[0];
    const entry = dailyMap.get(key) || {
      sales: 0,
      profit: 0,
      expenses: 0,
      soldKg: 0,
      creditCollected: 0,
      priorCreditCollected: 0,
    };
    entry.expenses += operatingExpenseAmount(expense.type, expense.amount);
    dailyMap.set(key, entry);
  }

  const daily = Array.from(dailyMap.entries())
    .map(([date, data]) => ({
      date,
      ...data,
      salesToman: data.sales,
      netProfit: data.profit - data.expenses,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const totalSales = dayLedger.soldGross;
  const soldKg = dayLedger.soldKg;
  const totalProfit = dayLedger.soldProfit;
  const totalCost = dayLedger.soldCost;
  const shippedSplit = aggregateShippedSplit(sales);
  const expenseByType: Record<string, number> = {};
  let totalExpenses = 0;
  let excludedExpenses = 0;
  for (const e of expenses) {
    const amt = e.amount || 0;
    const op = operatingExpenseAmount(e.type, amt);
    if (op <= 0) {
      if (amt > 0) excludedExpenses += amt;
      continue;
    }
    totalExpenses += op;
    const key = e.type || 'other';
    expenseByType[key] = (expenseByType[key] || 0) + op;
  }

  const products = await Product.find().sort({ stockKg: -1 });
  const inventory = {
    totalKg: products.reduce((s, p) => s + (p.stockKg || 0), 0),
    totalValue: products.reduce(
      (s, p) => s + (p.stockKg || 0) * (p.avgCostPerKg || p.purchasePrice || 0),
      0
    ),
    productCount: products.length,
    items: products.map((p) => ({
      id: p._id.toString(),
      name: p.name,
      stockKg: p.stockKg || 0,
      avgCostPerKg: p.avgCostPerKg || p.purchasePrice || 0,
    })),
  };

  /** فروش انبار در بازه — به تفکیک محصول روی تاریخ فاکتور (کل بار فروخته‌شده) */
  const soldMap = new Map<
    string,
    { productId: string; name: string; soldKg: number; soldPackages: number; revenue: number }
  >();
  for (const sale of sales) {
    for (const it of sale.items || []) {
      const pid = it.productId ? String(it.productId) : it.productName || 'unknown';
      const cur = soldMap.get(pid) || {
        productId: pid,
        name: it.productName || '—',
        soldKg: 0,
        soldPackages: 0,
        revenue: 0,
      };
      cur.soldKg += it.qtyKg || 0;
      cur.soldPackages += it.qtyPackages || 0;
      cur.revenue += it.totalPrice || 0;
      if (it.productName) cur.name = it.productName;
      soldMap.set(pid, cur);
    }
  }
  const soldByProduct = Array.from(soldMap.values())
    .map((x) => ({
      ...x,
      soldKg: Math.round(x.soldKg * 100) / 100,
      soldPackages: Math.round(x.soldPackages * 10) / 10,
      revenue: Math.round(x.revenue),
    }))
    .sort((a, b) => b.soldKg - a.soldKg);

  /** بدهکاران باز — تجمیع به تفکیک نفر */
  const openDebtors = await Debtor.find({ isSettled: false }).sort({ dueDate: 1 });
  const debtorByPerson = new Map<
    string,
    {
      key: string;
      name: string;
      phone?: string;
      remaining: number;
      count: number;
      overdue: boolean;
      nearestDue: Date;
    }
  >();
  const now = new Date();
  for (const d of openDebtors) {
    const remaining = Math.max(0, (d.amount || 0) - (d.paidAmount || 0));
    if (remaining <= 0) continue;
    const key = d.customerId
      ? `c:${d.customerId}`
      : `n:${(d.name || '').trim()}|${(d.phone || '').trim()}`;
    const prev = debtorByPerson.get(key);
    const overdue = new Date(d.dueDate) < now;
    if (!prev) {
      debtorByPerson.set(key, {
        key,
        name: d.name || 'بدون نام',
        phone: d.phone,
        remaining,
        count: 1,
        overdue,
        nearestDue: d.dueDate,
      });
    } else {
      prev.remaining += remaining;
      prev.count += 1;
      prev.overdue = prev.overdue || overdue;
      if (new Date(d.dueDate) < new Date(prev.nearestDue)) prev.nearestDue = d.dueDate;
      if (!prev.phone && d.phone) prev.phone = d.phone;
    }
  }
  const debtorsByPerson = Array.from(debtorByPerson.values())
    .map((d) => ({
      name: d.name,
      phone: d.phone,
      remaining: Math.round(d.remaining),
      invoiceCount: d.count,
      overdue: d.overdue,
      dueDate: d.nearestDue,
    }))
    .sort((a, b) => b.remaining - a.remaining);

  /** نسیه ثبت‌شده در همین بازه گزارش — به تفکیک مشتری */
  const creditInPeriodMap = new Map<
    string,
    { name: string; phone?: string; credit: number; kg: number; invoices: number }
  >();
  for (const sale of sales) {
    const credit = originalInvoiceSplit(sale).credit;
    if (credit <= 0) continue;
    const key = sale.customerId
      ? `c:${sale.customerId}`
      : `n:${(sale.customerName || '').trim()}|${(sale.customerPhone || '').trim()}`;
    const prev = creditInPeriodMap.get(key) || {
      name: sale.customerName || 'بدون نام',
      phone: sale.customerPhone,
      credit: 0,
      kg: 0,
      invoices: 0,
    };
    prev.credit += credit;
    prev.kg += sale.totalKg || 0;
    prev.invoices += 1;
    if (!prev.phone && sale.customerPhone) prev.phone = sale.customerPhone;
    creditInPeriodMap.set(key, prev);
  }
  const creditByCustomer = Array.from(creditInPeriodMap.values())
    .map((c) => ({
      name: c.name,
      phone: c.phone,
      credit: Math.round(c.credit),
      kg: c.kg,
      invoices: c.invoices,
    }))
    .sort((a, b) => b.credit - a.credit);

  // خرید از شرکت در بازه + برداشت شخصی + درصد میانگین روی فاکتورها
  const [purchases, allWithdrawals] = await Promise.all([
    PurchaseInvoice.find({ date: { $gte: rangeFrom, $lte: rangeTo } }),
    Expense.find({ type: 'withdrawal' }).select('amount date'),
  ]);
  const purchaseTotal = purchases.reduce((s, p) => s + (p.totalAmount || 0), 0);
  const purchaseKg = purchases.reduce((s, p) => s + (p.totalKg || 0), 0);
  const purchaseCount = purchases.length;

  let markupSum = 0;
  let markupN = 0;
  let marginSum = 0;
  let marginN = 0;
  for (const sale of sales) {
    const orig = originalInvoiceSplit(sale);
    if (orig.sold <= 0) continue;
    if (orig.cost > 0) {
      markupSum += (orig.profit / orig.cost) * 100;
      markupN += 1;
    }
    marginSum += (orig.profit / orig.sold) * 100;
    marginN += 1;
  }
  const avgMarkupPercent = markupN > 0 ? Math.round((markupSum / markupN) * 10) / 10 : 0;
  const avgMarginPercent = marginN > 0 ? Math.round((marginSum / marginN) * 10) / 10 : 0;

  let withdrawalPeriod = 0;
  let withdrawalAllTime = 0;
  for (const w of allWithdrawals) {
    const amt = Math.round(w.amount || 0);
    withdrawalAllTime += amt;
    const d = new Date(w.date);
    if (d >= rangeFrom && d <= rangeTo) withdrawalPeriod += amt;
  }

  const company = await getCompanyDebtSummary();
  const purchaseDebtOpen = Math.round(company.remainingDebt || 0);
  const myDebtToCompany = purchaseDebtOpen + withdrawalAllTime;
  const profitAverages = await getProfitAverages(rangeTo);

  return {
    from: rangeFrom.toISOString(),
    to: rangeTo.toISOString(),
    totalSales,
    totalSalesToman: totalSales,
    soldKg,
    soldTons: Math.round((soldKg / 1000) * 1000) / 1000,
    totalCost,
    totalProfit,
    totalExpenses,
    excludedExpenses,
    expenseByType,
    netProfit: totalProfit - totalExpenses,
    invoiceCount,
    payment: { cash: cashSales, card: cardSales, credit: creditSales },
    shippedSplit,
    golden: { count: goldenCount, amount: goldenAmount, kg: goldenKg },
    balances: {
      cashBalance: settings.cashBalance || 0,
      cardBalance: settings.cardBalance || 0,
      shopName: settings.shopName,
    },
    inventory,
    soldByProduct,
    debtors: {
      total: debtorsByPerson.reduce((s, d) => s + d.remaining, 0),
      count: debtorsByPerson.length,
      byPerson: debtorsByPerson,
    },
    creditByCustomer,
    profitAverages,
    companyBox: {
      purchaseTotal: Math.round(purchaseTotal),
      purchaseKg: Math.round(purchaseKg * 100) / 100,
      purchaseCount,
      salesTotal: totalSales,
      salesProfit: totalProfit,
      avgMarkupPercent,
      avgMarginPercent,
      withdrawalPeriod: Math.round(withdrawalPeriod),
      withdrawalAllTime: Math.round(withdrawalAllTime),
      purchaseDebtOpen,
      myDebtToCompany: Math.round(myDebtToCompany),
      paidToCompany: Math.round(company.totalPaidToCompany || 0),
    },
    daily,
    dayLedger: {
      soldGross: dayLedger.soldGross,
      soldKg: dayLedger.soldKg,
      soldProfit: dayLedger.soldProfit,
      soldCount: dayLedger.soldCount,
      soldPaid: dayLedger.soldPaid,
      soldCredit: dayLedger.soldCredit,
      collectionsTotal: dayLedger.collectionsTotal,
      priorCreditCollected: dayLedger.priorCreditCollected,
      sameDayCreditCollected: dayLedger.sameDayCreditCollected,
      collections: dayLedger.collections.slice(0, 80),
      soldInvoices: dayLedger.soldInvoices.slice(0, 80),
    },
  };
}

export async function updateShopSettings(data: {
  shopName?: string;
  openingDate?: Date;
  cashBalance?: number;
  cardBalance?: number;
  catalogEnabled?: boolean;
  catalogTitle?: string;
  catalogPhone?: string;
  catalogNote?: string;
  catalogSupermarketMinKg?: number;
  catalogWholesaleMinKg?: number;
  brandName?: string;
  brandTagline?: string;
  brandPrimaryColor?: string;
  brandLogoUrl?: string;
  platformEnabled?: boolean;
  driverPanelEnabled?: boolean;
  marketerPanelEnabled?: boolean;
  commissionPercentCompany?: number;
  commissionPercentSelf?: number;
  platformMinOrderKg?: number;
  platformCities?: string;
  costBasis?: 'weighted' | 'last';
  mongoCompassUri?: string;
  bankCards?: Array<{
    label: string;
    cardNumber: string;
    accountHolder?: string;
    bankName?: string;
    isDefault?: boolean;
  }>;
  goldenAutoEnabled?: boolean;
  goldenMinKg?: number;
  goldenSuggestGiftName?: string;
  goldenSuggestGiftQty?: number;
  goldenSuggestDiscountPercent?: number;
  actionPassword?: string;
  wipePassword?: string;
}) {
  const settings = await getOrCreateSettings();
  if (data.shopName) settings.shopName = data.shopName;
  if (data.openingDate) settings.openingDate = new Date(data.openingDate);
  if (data.cashBalance !== undefined) settings.cashBalance = data.cashBalance;
  if (data.cardBalance !== undefined) settings.cardBalance = data.cardBalance;
  if (data.catalogEnabled !== undefined) settings.catalogEnabled = data.catalogEnabled;
  if (data.catalogTitle !== undefined) settings.catalogTitle = data.catalogTitle;
  if (data.catalogPhone !== undefined)
    settings.catalogPhone = data.catalogPhone
      ? normalizePhoneDigits(data.catalogPhone) || data.catalogPhone
      : data.catalogPhone;
  if (data.catalogNote !== undefined) settings.catalogNote = data.catalogNote;
  if (data.catalogSupermarketMinKg !== undefined)
    settings.catalogSupermarketMinKg = Math.max(0, data.catalogSupermarketMinKg);
  if (data.catalogWholesaleMinKg !== undefined)
    settings.catalogWholesaleMinKg = Math.max(0, data.catalogWholesaleMinKg);
  if (data.brandName !== undefined) settings.brandName = data.brandName;
  if (data.brandTagline !== undefined) settings.brandTagline = data.brandTagline;
  if (data.brandPrimaryColor !== undefined) settings.brandPrimaryColor = data.brandPrimaryColor;
  if (data.brandLogoUrl !== undefined) settings.brandLogoUrl = data.brandLogoUrl;
  if (data.platformEnabled !== undefined) settings.platformEnabled = data.platformEnabled;
  if (data.driverPanelEnabled !== undefined) settings.driverPanelEnabled = data.driverPanelEnabled;
  if (data.marketerPanelEnabled !== undefined)
    settings.marketerPanelEnabled = data.marketerPanelEnabled;
  if (data.commissionPercentCompany !== undefined)
    settings.commissionPercentCompany = data.commissionPercentCompany;
  if (data.commissionPercentSelf !== undefined)
    settings.commissionPercentSelf = data.commissionPercentSelf;
  if (data.platformMinOrderKg !== undefined) settings.platformMinOrderKg = data.platformMinOrderKg;
  if (data.platformCities !== undefined) settings.platformCities = data.platformCities;
  if (data.costBasis === 'weighted' || data.costBasis === 'last') settings.costBasis = data.costBasis;
  if (data.mongoCompassUri !== undefined) settings.mongoCompassUri = data.mongoCompassUri;
  if (data.bankCards !== undefined) {
    const cleaned = data.bankCards
      .filter((c) => c.label?.trim() && c.cardNumber?.trim())
      .map((c) => ({
        label: c.label.trim(),
        cardNumber: c.cardNumber.replace(/\s+/g, '').trim(),
        accountHolder: c.accountHolder?.trim() || undefined,
        bankName: c.bankName?.trim() || undefined,
        isDefault: !!c.isDefault,
      }));
    // دقیقاً یک پیش‌فرض؛ اگر هیچ‌کدام نبود اولی پیش‌فرض می‌شود
    const defaultIdx = cleaned.findIndex((c) => c.isDefault);
    settings.bankCards = cleaned.map((c, i) => ({
      ...c,
      isDefault: defaultIdx >= 0 ? i === defaultIdx : i === 0,
    }));
  }
  if (data.goldenAutoEnabled !== undefined) settings.goldenAutoEnabled = data.goldenAutoEnabled;
  if (data.goldenMinKg !== undefined) settings.goldenMinKg = Math.max(0, data.goldenMinKg);
  if (data.goldenSuggestGiftName !== undefined)
    settings.goldenSuggestGiftName = data.goldenSuggestGiftName.trim() || 'کارتن';
  if (data.goldenSuggestGiftQty !== undefined)
    settings.goldenSuggestGiftQty = Math.max(0, data.goldenSuggestGiftQty);
  if (data.goldenSuggestDiscountPercent !== undefined)
    settings.goldenSuggestDiscountPercent = Math.max(0, Math.min(50, data.goldenSuggestDiscountPercent));
  if (data.actionPassword !== undefined) {
    const pw = String(data.actionPassword).trim();
    if (pw.length < 4) throw new Error('رمز عملیات حداقل ۴ کاراکتر');
    settings.actionPassword = pw;
  }
  if (data.wipePassword !== undefined) {
    const pw = String(data.wipePassword).trim();
    if (pw.length < 4) throw new Error('رمز پاک‌سازی حداقل ۴ کاراکتر');
    settings.wipePassword = pw;
  }
  await settings.save();
  return settings;
}

export async function listDebtors(settled?: boolean) {
  const filter: Record<string, unknown> = {};
  if (settled !== undefined) filter.isSettled = settled;
  const rows = await Debtor.find(filter)
    .populate(
      'saleInvoiceId',
      'invoiceNumber totalAmount totalKg date paymentMethod status items discount customerName customerPhone shippedAt paidAt lastPaymentAt isPaid payment dueDate'
    )
    .populate('customerId', 'name phone address totalCredit')
    .sort({ dueDate: 1 })
    .lean();

  return rows.map((d) => {
    const inv = d.saleInvoiceId as
      | {
          _id?: unknown;
          invoiceNumber?: string;
          totalAmount?: number;
          totalKg?: number;
          date?: Date;
          paymentMethod?: string;
          status?: string;
          shippedAt?: Date;
          paidAt?: Date;
          lastPaymentAt?: Date;
          isPaid?: boolean;
          items?: Array<{
            productId?: unknown;
            productName: string;
            qtyKg: number;
            totalPrice: number;
            unit?: string;
            qtyInput?: number;
            unitPrice?: number;
            unitPricePerKg?: number;
            discount?: number;
            kgPerPackage?: number;
          }>;
          discount?: number;
        }
      | null
      | undefined;
    const cust = d.customerId as
      | { _id?: unknown; name?: string; phone?: string; address?: string; totalCredit?: number }
      | null
      | undefined;
    const remaining = Math.max(0, (d.amount || 0) - (d.paidAmount || 0));
    return {
      _id: String(d._id),
      name: d.name,
      phone: d.phone,
      amount: d.amount,
      paidAmount: d.paidAmount || 0,
      remaining,
      dueDate: d.dueDate,
      description: d.description,
      isSettled: d.isSettled,
      customerId: cust?._id
        ? String(cust._id)
        : d.customerId
          ? String(d.customerId)
          : undefined,
      customerName: cust?.name || d.name,
      customerPhone: cust?.phone || d.phone,
      customerAddress: cust?.address,
      customerTotalCredit: cust?.totalCredit,
      saleInvoiceId: inv?._id
        ? String(inv._id)
        : d.saleInvoiceId
          ? String(d.saleInvoiceId)
          : undefined,
      invoiceNumber: inv?.invoiceNumber,
      invoiceTotal: inv?.totalAmount,
      invoiceKg: inv?.totalKg,
      invoiceDate: inv?.date,
      invoiceStatus: inv?.status,
      invoiceShippedAt: inv?.shippedAt,
      invoicePaidAt: inv?.paidAt,
      invoiceLastPaymentAt: inv?.lastPaymentAt,
      invoiceIsPaid: inv?.isPaid,
      invoiceItems: inv?.items?.map((it) => ({
        productId: it.productId ? String(it.productId) : undefined,
        productName: it.productName,
        qtyKg: it.qtyKg,
        totalPrice: it.totalPrice,
        unit: it.unit,
        qtyInput: it.qtyInput,
        unitPrice: it.unitPrice,
        unitPricePerKg: it.unitPricePerKg,
        discount: it.discount,
        kgPerPackage: it.kgPerPackage,
      })),
    };
  });
}

/** آنالیز فروش یک محصول — کلی + بازه‌ها + برترین مشتریان */
export async function getProductAnalytics(productId: string, opts?: { from?: Date; to?: Date }) {
  if (!productId) throw new Error('شناسه محصول الزامی است');
  const product = await Product.findById(productId).populate('categoryId');
  if (!product) throw new Error('محصول یافت نشد');

  const oid = product._id;
  const nameKey = (product.name || '').trim();
  const sameName = nameKey
    ? await Product.find({ name: nameKey }).select('_id')
    : [];
  const ids = sameName.length ? sameName.map((p) => p._id) : [oid];

  const now = new Date();
  const dayStart = startOfDay(now);
  const monthStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
  const yearStart = startOfDay(new Date(now.getFullYear(), 0, 1));

  const matchBase: Record<string, unknown> = {
    status: { $in: ['approved', 'shipped', 'delivered'] },
    'items.productId': { $in: ids },
  };
  if (opts?.from || opts?.to) {
    matchBase.date = {};
    if (opts.from) (matchBase.date as Record<string, Date>).$gte = opts.from;
    if (opts.to) (matchBase.date as Record<string, Date>).$lte = opts.to;
  }

  const [agg] = await SaleInvoice.aggregate([
    { $match: matchBase },
    { $unwind: '$items' },
    { $match: { 'items.productId': { $in: ids } } },
    {
      $group: {
        _id: null,
        soldKg: { $sum: '$items.qtyKg' },
        soldPackages: { $sum: '$items.qtyPackages' },
        revenue: { $sum: '$items.totalPrice' },
        cost: {
          $sum: {
            $multiply: [{ $ifNull: ['$items.unitCostPerKg', 0] }, { $ifNull: ['$items.qtyKg', 0] }],
          },
        },
        profit: { $sum: '$items.profit' },
        discount: { $sum: { $ifNull: ['$items.discount', 0] } },
        lineCount: { $sum: 1 },
        invoiceIds: { $addToSet: '$_id' },
      },
    },
  ]);

  const periodBuckets = async (from: Date) => {
    const [row] = await SaleInvoice.aggregate([
      {
        $match: {
          status: { $in: ['approved', 'shipped', 'delivered'] },
          date: { $gte: from },
          'items.productId': { $in: ids },
        },
      },
      { $unwind: '$items' },
      { $match: { 'items.productId': { $in: ids } } },
      {
        $group: {
          _id: null,
          soldKg: { $sum: '$items.qtyKg' },
          revenue: { $sum: '$items.totalPrice' },
          profit: { $sum: '$items.profit' },
          invoiceIds: { $addToSet: '$_id' },
        },
      },
    ]);
    return {
      soldKg: Math.round((row?.soldKg || 0) * 100) / 100,
      revenue: Math.round(row?.revenue || 0),
      profit: Math.round(row?.profit || 0),
      invoiceCount: (row?.invoiceIds || []).length,
    };
  };

  const [today, month, year] = await Promise.all([
    periodBuckets(dayStart),
    periodBuckets(monthStart),
    periodBuckets(yearStart),
  ]);

  const topCustomers = await SaleInvoice.aggregate([
    {
      $match: {
        status: { $in: ['approved', 'shipped', 'delivered'] },
        'items.productId': { $in: ids },
      },
    },
    { $unwind: '$items' },
    { $match: { 'items.productId': { $in: ids } } },
    {
      $group: {
        _id: {
          customerId: '$customerId',
          customerName: '$customerName',
        },
        soldKg: { $sum: '$items.qtyKg' },
        revenue: { $sum: '$items.totalPrice' },
        profit: { $sum: '$items.profit' },
        times: { $sum: 1 },
        lastDate: { $max: '$date' },
      },
    },
    { $sort: { revenue: -1 } },
    { $limit: 8 },
  ]);

  const recent = await SaleInvoice.aggregate([
    {
      $match: {
        status: { $in: ['approved', 'shipped', 'delivered'] },
        'items.productId': { $in: ids },
      },
    },
    { $unwind: '$items' },
    { $match: { 'items.productId': { $in: ids } } },
    { $sort: { date: -1 } },
    { $limit: 12 },
    {
      $project: {
        invoiceId: '$_id',
        invoiceNumber: 1,
        date: 1,
        customerName: 1,
        isGolden: 1,
        qtyKg: '$items.qtyKg',
        qtyPackages: '$items.qtyPackages',
        revenue: '$items.totalPrice',
        profit: '$items.profit',
        unitPricePerKg: '$items.unitPricePerKg',
        priceTier: '$items.priceTier',
      },
    },
  ]);

  const byTier = await SaleInvoice.aggregate([
    {
      $match: {
        status: { $in: ['approved', 'shipped', 'delivered'] },
        'items.productId': { $in: ids },
      },
    },
    { $unwind: '$items' },
    { $match: { 'items.productId': { $in: ids } } },
    {
      $group: {
        _id: { $ifNull: ['$items.priceTier', '$priceTier'] },
        soldKg: { $sum: '$items.qtyKg' },
        revenue: { $sum: '$items.totalPrice' },
        profit: { $sum: '$items.profit' },
      },
    },
  ]);

  const monthlyTrend = await SaleInvoice.aggregate([
    {
      $match: {
        status: { $in: ['approved', 'shipped', 'delivered'] },
        date: { $gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) },
        'items.productId': { $in: ids },
      },
    },
    { $unwind: '$items' },
    { $match: { 'items.productId': { $in: ids } } },
    {
      $group: {
        _id: {
          y: { $year: '$date' },
          m: { $month: '$date' },
        },
        soldKg: { $sum: '$items.qtyKg' },
        revenue: { $sum: '$items.totalPrice' },
        profit: { $sum: '$items.profit' },
      },
    },
    { $sort: { '_id.y': 1, '_id.m': 1 } },
  ]);

  const soldKg = agg?.soldKg || 0;
  const revenue = agg?.revenue || 0;
  const profit = agg?.profit || 0;
  const cost = agg?.cost || Math.max(0, revenue - profit);
  const stockKg = Number(product.stockKg ?? product.stock ?? 0) || 0;
  const kgPer = product.kgPerPackage || 5;
  const cat = product.categoryId as { name?: string } | null;

  return {
    product: {
      id: product._id.toString(),
      name: product.name,
      stockKg,
      packages: kgPer > 0 ? Math.round((stockKg / kgPer) * 10) / 10 : 0,
      kgPerPackage: kgPer,
      avgCostPerKg: product.avgCostPerKg || 0,
      lastPurchasePricePerKg: product.lastPurchasePricePerKg || 0,
      imageUrl: product.imageUrl,
      categoryName: cat?.name || '—',
      profitRetail: product.profitRetail ?? product.profitPercent,
      profitSupermarket: product.profitSupermarket,
      profitWholesale: product.profitWholesale,
    },
    overall: {
      soldKg: Math.round(soldKg * 100) / 100,
      soldPackages: Math.round((agg?.soldPackages || 0) * 10) / 10,
      revenue: Math.round(revenue),
      cost: Math.round(cost),
      profit: Math.round(profit),
      marginPercent: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0,
      discount: Math.round(agg?.discount || 0),
      invoiceCount: (agg?.invoiceIds || []).length,
      lineCount: agg?.lineCount || 0,
      avgPricePerKg: soldKg > 0 ? Math.round(revenue / soldKg) : 0,
      avgProfitPerKg: soldKg > 0 ? Math.round(profit / soldKg) : 0,
    },
    periods: { today, month, year },
    byTier: byTier.map((t) => ({
      tier: t._id || 'retail',
      soldKg: Math.round((t.soldKg || 0) * 100) / 100,
      revenue: Math.round(t.revenue || 0),
      profit: Math.round(t.profit || 0),
    })),
    monthlyTrend: monthlyTrend.map((t) => ({
      year: t._id.y,
      month: t._id.m,
      soldKg: Math.round((t.soldKg || 0) * 100) / 100,
      revenue: Math.round(t.revenue || 0),
      profit: Math.round(t.profit || 0),
    })),
    topCustomers: topCustomers.map((c) => ({
      customerId: c._id?.customerId?.toString?.() || null,
      name: c._id?.customerName || 'بدون نام',
      soldKg: Math.round((c.soldKg || 0) * 100) / 100,
      revenue: Math.round(c.revenue || 0),
      profit: Math.round(c.profit || 0),
      times: c.times || 0,
      lastDate: c.lastDate,
    })),
    recent: recent.map((r) => ({
      invoiceId: r.invoiceId?.toString?.() || r._id?.toString?.(),
      invoiceNumber: r.invoiceNumber,
      date: r.date,
      customerName: r.customerName || '—',
      isGolden: !!r.isGolden,
      qtyKg: Math.round((r.qtyKg || 0) * 100) / 100,
      qtyPackages: Math.round((r.qtyPackages || 0) * 10) / 10,
      revenue: Math.round(r.revenue || 0),
      profit: Math.round(r.profit || 0),
      unitPricePerKg: Math.round(r.unitPricePerKg || 0),
      priceTier: r.priceTier,
    })),
  };
}
