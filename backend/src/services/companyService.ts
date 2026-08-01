import { CompanyPayment, SupplierDebt, CashTransaction } from '../models';
import { updateBalances, validateTransactionDate } from './productService';

export async function createCompanyPayment(data: {
  supplier?: string;
  amount: number;
  method: 'cash' | 'card';
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
    // اعمال روی قدیمی‌ترین بدهی‌های باز همین تأمین‌کننده
    let left = data.amount;
    const debts = await SupplierDebt.find({
      supplier: { $regex: supplier, $options: 'i' },
      isSettled: false,
    }).sort({ date: 1 });
    for (const debt of debts) {
      if (left <= 0) break;
      const rem = debt.amount - debt.paidAmount;
      const pay = Math.min(rem, left);
      debt.paidAmount += pay;
      if (debt.paidAmount >= debt.amount) debt.isSettled = true;
      await debt.save();
      left -= pay;
      debtId = debt._id.toString();
    }
  }

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
    description: `پرداخت به شرکت ${supplier}`,
    referenceId: payment._id.toString(),
    referenceModel: 'CompanyPayment',
    date,
  });

  await updateBalances(data.method === 'cash' ? -data.amount : 0, data.method === 'card' ? -data.amount : 0);

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
  const open = await SupplierDebt.find({ isSettled: false });
  const total = open.reduce((s, d) => s + (d.amount - d.paidAmount), 0);
  const payments = await CompanyPayment.find().sort({ date: -1 }).limit(20);
  return {
    totalDebt: total,
    openCount: open.length,
    debts: open.map((d) => ({
      id: d._id,
      supplier: d.supplier,
      remaining: d.amount - d.paidAmount,
      amount: d.amount,
      paidAmount: d.paidAmount,
      date: d.date,
    })),
    recentPayments: payments,
  };
}
