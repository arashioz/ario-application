import { CompanyPayment, SupplierDebt, CashTransaction } from '../models';
import { updateBalances, validateTransactionDate } from './productService';

export async function createCompanyPayment(data: {
  supplier?: string;
  amount: number;
  method: 'cash' | 'card' | 'card_to_card';
  date?: Date;
  notes?: string;
  supplierDebtId?: string;
  createdBy?: string;
}) {
  const date = data.date ? new Date(data.date) : new Date();
  validateTransactionDate(date);

  let supplier = data.supplier || 'شرکت';
  let debtId = data.supplierDebtId;

  if (debtId) {
    const debt = await SupplierDebt.findById(debtId);
    if (!debt) throw new Error('بدهی شرکت یافت نشد');
    const remaining = debt.amount - debt.paidAmount;
    if (data.amount > remaining) throw new Error(`مبلغ بیشتر از مانده بدهی (${remaining}) است`);
    debt.paidAmount += data.amount;
    if (debt.paidAmount >= debt.amount) debt.isSettled = true;
    await debt.save();
    supplier = debt.supplier;
  } else {
    // اول همین تأمین‌کننده، بعد هر بدهی باز (FIFO) تا مبلغ کامل کم شود
    let left = data.amount;
    const name = supplier.trim() || 'شرکت';
    const same = await SupplierDebt.find({
      supplier: { $regex: name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' },
      isSettled: false,
    }).sort({ date: 1 });
    const others = await SupplierDebt.find({
      isSettled: false,
      _id: { $nin: same.map((d) => d._id) },
    }).sort({ date: 1 });
    for (const debt of [...same, ...others]) {
      if (left <= 0) break;
      const rem = debt.amount - debt.paidAmount;
      if (rem <= 0) continue;
      const pay = Math.min(rem, left);
      debt.paidAmount += pay;
      if (debt.paidAmount >= debt.amount) debt.isSettled = true;
      await debt.save();
      left -= pay;
      debtId = debt._id.toString();
      supplier = debt.supplier;
    }
  }

  const useCard = data.method === 'card' || data.method === 'card_to_card';
  const methodLabel =
    data.method === 'cash' ? 'نقد' : data.method === 'card_to_card' ? 'کارت به کارت' : 'کارت';

  const payment = await CompanyPayment.create({
    supplier,
    amount: data.amount,
    method: data.method,
    date,
    notes: data.notes,
    supplierDebtId: debtId,
    createdBy: data.createdBy,
  });

  await CashTransaction.create({
    type: 'purchase',
    amount: data.amount,
    direction: 'out',
    description: `پرداخت به شرکت ${supplier} (${methodLabel})`,
    referenceId: payment._id.toString(),
    referenceModel: 'CompanyPayment',
    paymentMethod: data.method,
    date,
  });

  await updateBalances(useCard ? 0 : -data.amount, useCard ? -data.amount : 0);

  return payment;
}

export async function listCompanyPayments(from?: Date, to?: Date) {
  const filter: Record<string, unknown> = {};
  if (from || to) {
    filter.date = {};
    if (from) (filter.date as Record<string, Date>).$gte = from;
    if (to) (filter.date as Record<string, Date>).$lte = to;
  }
  return CompanyPayment.find(filter).sort({ date: -1 });
}

export async function listSupplierDebts(settled?: boolean) {
  const filter: Record<string, unknown> = {};
  if (settled !== undefined) filter.isSettled = settled;
  return SupplierDebt.find(filter).sort({ date: -1 });
}

export async function getCompanyDebtSummary() {
  const [open, allDebts, paymentsAgg, payments] = await Promise.all([
    SupplierDebt.find({ isSettled: false }),
    SupplierDebt.find(),
    CompanyPayment.aggregate<{ total: number }>([{ $group: { _id: null, total: { $sum: '$amount' } } }]),
    CompanyPayment.find().sort({ date: -1 }).limit(40),
  ]);
  const totalDebtAmount = allDebts.reduce((s, d) => s + (d.amount || 0), 0);
  const totalPaidOnDebts = allDebts.reduce((s, d) => s + (d.paidAmount || 0), 0);
  const totalPaidToCompany = paymentsAgg[0]?.total || 0;
  /** مانده باز روی رکوردهای بدهی (اگر پرداخت‌ها درست تخصیص شده باشند) */
  const remainingFromRecords = open.reduce((s, d) => s + Math.max(0, d.amount - (d.paidAmount || 0)), 0);
  /**
   * نمایش درست برای کاربر: کل بدهی − همه پرداخت‌های ثبت‌شده به شرکت.
   * اگر بعضی پرداخت‌ها روی `paidAmount` ننشسته باشند، هنوز از بدهی کم می‌شوند.
   */
  const remainingDebt = Math.max(0, totalDebtAmount - totalPaidToCompany);

  return {
    /** مانده بدهی به شرکت (کل − پرداخت‌ها) */
    totalDebt: remainingDebt,
    remainingDebt,
    remainingFromRecords,
    /** کل بدهی ثبت‌شده (اصل خرید نسیه) */
    totalDebtAmount,
    /** جمع paidAmount روی بدهی‌ها */
    totalPaidOnDebts,
    /** جمع همه پرداخت‌های ثبت‌شده به شرکت */
    totalPaidToCompany,
    openCount: open.length,
    debts: open.map((d) => ({
      id: d._id,
      supplier: d.supplier,
      remaining: Math.max(0, d.amount - (d.paidAmount || 0)),
      amount: d.amount,
      paidAmount: d.paidAmount || 0,
      date: d.date,
    })),
    recentPayments: payments,
  };
}
