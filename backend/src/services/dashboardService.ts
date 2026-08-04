import { SaleInvoice, Expense, Debtor, CashTransaction, Product } from '../models';
import { startOfDay, endOfDay } from '../utils/persian';
import { getOrCreateSettings } from './productService';
import { getCompanyDebtSummary } from './companyService';
import { getTargetProgress } from './targetService';
import { getDueChecksSummary } from './checkService';
import { getCustomerCrmInsights, normalizePhoneDigits } from './customerService';

/** این‌ها روی صندوق اثر دارند ولی هزینهٔ عملیاتی نیستند — نباید از سود کم شوند */
const NON_OPERATING_EXPENSE_TYPES = new Set(['loan_received', 'loan_given', 'withdrawal']);

function operatingExpenseAmount(type: string | undefined, amount: number): number {
  if (type && NON_OPERATING_EXPENSE_TYPES.has(type)) return 0;
  return amount || 0;
}
async function getInventorySnapshot() {
  const products = await Product.find().sort({ stockKg: -1 }).select('name stockKg stock kgPerPackage avgCostPerKg');
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

export async function getDashboard(date?: Date, marketerId?: string) {
  const targetDate = date ? new Date(date) : new Date();
  const dayStart = startOfDay(targetDate);
  const dayEnd = endOfDay(targetDate);

  const monthStart = startOfDay(new Date(targetDate.getFullYear(), targetDate.getMonth(), 1));
  const monthEnd = endOfDay(new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0));

  const saleFilterDay: Record<string, unknown> = { date: { $gte: dayStart, $lte: dayEnd } };
  const saleFilterMonth: Record<string, unknown> = { date: { $gte: monthStart, $lte: monthEnd } };
  if (marketerId) {
    saleFilterDay.marketerId = marketerId;
    saleFilterMonth.marketerId = marketerId;
  }

  const [sales, monthSales, expenses, settings, debtors, cardDeposits, company, checks, crm, readyShip, pendingCount, inventory] =
    await Promise.all([
      SaleInvoice.find({ ...saleFilterDay, status: { $in: ['approved', 'shipped', 'delivered'] } }),
      SaleInvoice.find({ ...saleFilterMonth, status: { $in: ['approved', 'shipped', 'delivered'] } }),
      Expense.find({ date: { $gte: dayStart, $lte: dayEnd } }),
      getOrCreateSettings(),
      Debtor.find({ isSettled: false }).sort({ dueDate: 1 }),
      CashTransaction.find({
        type: 'card_deposit',
        date: { $gte: dayStart, $lte: dayEnd },
      }),
      getCompanyDebtSummary(),
      getDueChecksSummary(),
      getCustomerCrmInsights(targetDate),
      SaleInvoice.find({ status: 'approved' })
        .sort({ approvedAt: -1 })
        .limit(12)
        .select('invoiceNumber customerName customerAddress totalKg totalAmount driverId shippingNotes date'),
      SaleInvoice.countDocuments({ status: 'pending' }),
      getInventorySnapshot(),
    ]);

  const totalSales = sales.reduce((s, inv) => s + inv.totalAmount, 0);
  const soldKg = sales.reduce((s, inv) => s + (inv.totalKg || 0), 0);
  const totalProfit = sales.reduce((s, inv) => s + (inv.totalProfit || 0), 0);
  const totalExpenses = expenses.reduce(
    (s, e) => s + operatingExpenseAmount(e.type, e.amount),
    0
  );
  const netProfit = totalProfit - totalExpenses;

  const monthSalesAmount = monthSales.reduce((s, inv) => s + inv.totalAmount, 0);
  const monthSoldKg = monthSales.reduce((s, inv) => s + (inv.totalKg || 0), 0);
  const monthProfit = monthSales.reduce((s, inv) => s + inv.totalProfit, 0);

  const cashSales = sales.reduce((s, inv) => s + inv.payment.cash, 0);
  const cardSales = sales.reduce((s, inv) => s + inv.payment.card, 0);
  const creditSales = sales.reduce((s, inv) => s + inv.payment.credit, 0);
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

  return {
    date: targetDate.toISOString(),
    totalSales,
    /** مبالغ سیستم به تومان است */
    totalSalesToman: totalSales,
    soldKg,
    soldTons: Math.round((soldKg / 1000) * 1000) / 1000,
    totalProfit,
    totalExpenses,
    netProfit,
    cashSales,
    cardSales,
    creditSales,
    cardDepositTotal,
    cashBalance: settings.cashBalance,
    cardBalance: settings.cardBalance,
    salesCount: sales.length,
    expenseCount: expenses.length,
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
    },
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
  const saleFilter: Record<string, unknown> = { date: { $gte: from, $lte: to } };
  if (marketerId) saleFilter.marketerId = marketerId;

  const activeStatuses = { $in: ['approved', 'shipped', 'delivered'] };
  const [sales, expenses, settings] = await Promise.all([
    SaleInvoice.find({ ...saleFilter, status: activeStatuses }),
    Expense.find({ date: { $gte: from, $lte: to } }),
    getOrCreateSettings(),
  ]);

  const dailyMap = new Map<
    string,
    { sales: number; profit: number; expenses: number; soldKg: number }
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
    const entry = dailyMap.get(key) || { sales: 0, profit: 0, expenses: 0, soldKg: 0 };
    entry.sales += sale.totalAmount;
    entry.profit += sale.totalProfit;
    entry.soldKg += sale.totalKg || 0;
    dailyMap.set(key, entry);

    cashSales += sale.payment?.cash || 0;
    cardSales += sale.payment?.card || 0;
    creditSales += sale.payment?.credit || 0;
    if (sale.isGolden) {
      goldenCount += 1;
      goldenAmount += sale.totalAmount;
      goldenKg += sale.totalKg || 0;
    }
  }

  for (const expense of expenses) {
    const key = startOfDay(expense.date).toISOString().split('T')[0];
    const entry = dailyMap.get(key) || { sales: 0, profit: 0, expenses: 0, soldKg: 0 };
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

  const totalSales = sales.reduce((s, i) => s + i.totalAmount, 0);
  const soldKg = sales.reduce((s, i) => s + (i.totalKg || 0), 0);
  const totalProfit = sales.reduce((s, i) => s + (i.totalProfit || 0), 0);
  const totalExpenses = expenses.reduce(
    (s, e) => s + operatingExpenseAmount(e.type, e.amount),
    0
  );

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

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    totalSales,
    totalSalesToman: totalSales,
    soldKg,
    soldTons: Math.round((soldKg / 1000) * 1000) / 1000,
    totalProfit,
    totalExpenses,
    netProfit: totalProfit - totalExpenses,
    invoiceCount,
    payment: { cash: cashSales, card: cardSales, credit: creditSales },
    golden: { count: goldenCount, amount: goldenAmount, kg: goldenKg },
    balances: {
      cashBalance: settings.cashBalance || 0,
      cardBalance: settings.cardBalance || 0,
      shopName: settings.shopName,
    },
    inventory,
    daily,
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
  }>;
  goldenAutoEnabled?: boolean;
  goldenMinKg?: number;
  goldenSuggestGiftName?: string;
  goldenSuggestGiftQty?: number;
  goldenSuggestDiscountPercent?: number;
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
    settings.bankCards = data.bankCards
      .filter((c) => c.label?.trim() && c.cardNumber?.trim())
      .map((c) => ({
        label: c.label.trim(),
        cardNumber: c.cardNumber.replace(/\s+/g, '').trim(),
        accountHolder: c.accountHolder?.trim() || undefined,
        bankName: c.bankName?.trim() || undefined,
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
  await settings.save();
  return settings;
}

export async function listDebtors(settled?: boolean) {
  const filter: Record<string, unknown> = {};
  if (settled !== undefined) filter.isSettled = settled;
  return Debtor.find(filter).sort({ dueDate: 1 });
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

