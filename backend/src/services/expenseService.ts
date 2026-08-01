import { Expense, ExpenseType, CashTransaction, Debtor, Customer, CompanyPayment } from '../models';
import { validateTransactionDate, updateBalances } from './productService';

export const DELETE_PASSWORD = 'delete-ario';

export function assertDeletePassword(password?: string) {
  if (password !== DELETE_PASSWORD) {
    throw new Error('رمز حذف اشتباه است');
  }
}

export async function createExpense(data: {
  type: ExpenseType;
  categoryId?: string;
  amount: number;
  description: string;
  date?: Date;
  notes?: string;
  affectsCash?: boolean;
}) {
  const date = data.date ? new Date(data.date) : new Date();
  validateTransactionDate(date);

  const expense = await Expense.create({
    type: data.type,
    categoryId: data.categoryId,
    amount: data.amount,
    description: data.description,
    date,
    notes: data.notes,
  });

  const inflowTypes = ['loan_received'];
  const isInflow = inflowTypes.includes(data.type);

  if (data.affectsCash !== false) {
    if (isInflow) {
      await CashTransaction.create({
        type: 'adjustment',
        amount: data.amount,
        direction: 'in',
        description: data.description,
        referenceId: expense._id.toString(),
        referenceModel: 'Expense',
        date,
      });
      await updateBalances(data.amount, 0);
    } else {
      await CashTransaction.create({
        type: 'expense',
        amount: data.amount,
        direction: 'out',
        description: data.description,
        referenceId: expense._id.toString(),
        referenceModel: 'Expense',
        date,
      });
      await updateBalances(-data.amount, 0);
    }
  }

  return expense;
}

export async function listExpenses(opts?: {
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}) {
  const filter: Record<string, unknown> = {};
  if (opts?.from || opts?.to) {
    filter.date = {};
    if (opts.from) (filter.date as Record<string, Date>).$gte = opts.from;
    if (opts.to) (filter.date as Record<string, Date>).$lte = opts.to;
  }
  const page = Math.max(1, opts?.page || 1);
  const pageSize = Math.min(50, Math.max(5, opts?.pageSize || 15));
  const total = await Expense.countDocuments(filter);
  const items = await Expense.find(filter)
    .sort({ date: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize);
  return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function deleteExpense(id: string, password?: string) {
  assertDeletePassword(password);
  const expense = await Expense.findById(id);
  if (!expense) throw new Error('هزینه یافت نشد');

  const txs = await CashTransaction.find({
    referenceId: expense._id.toString(),
    referenceModel: 'Expense',
  });
  for (const tx of txs) {
    const delta = tx.direction === 'in' ? -tx.amount : tx.amount;
    await updateBalances(delta, 0);
    await tx.deleteOne();
  }
  await expense.deleteOne();
  return { ok: true, id };
}

/** واریز کارت — اختیاری روی بدهی مشتری اعمال می‌شود */
export async function recordCardDeposit(
  amount: number,
  description?: string,
  date?: Date,
  opts?: { customerId?: string; customerName?: string }
) {
  const d = date ? new Date(date) : new Date();
  validateTransactionDate(d);

  let customerName = opts?.customerName?.trim();
  let customerId = opts?.customerId;
  let debtApplied = 0;
  const appliedDebts: Array<{ id: string; name: string; paid: number }> = [];

  if (customerId || customerName) {
    let customer = customerId ? await Customer.findById(customerId) : null;
    if (!customer && customerName) {
      customer = await Customer.findOne({ name: { $regex: `^${customerName}$`, $options: 'i' } });
    }
    if (customer) {
      customerId = customer._id.toString();
      customerName = customer.name;
    }

    const debtorFilter: Record<string, unknown> = { isSettled: false };
    if (customerId) {
      debtorFilter.$or = [
        { customerId },
        ...(customerName ? [{ name: customerName }] : []),
        ...(customer?.phone ? [{ phone: customer.phone }] : []),
      ];
    } else if (customerName) {
      debtorFilter.name = { $regex: customerName, $options: 'i' };
    }

    let left = amount;
    const debtors = await Debtor.find(debtorFilter).sort({ dueDate: 1 });
    for (const debtor of debtors) {
      if (left <= 0) break;
      const rem = debtor.amount - debtor.paidAmount;
      if (rem <= 0) continue;
      const pay = Math.min(rem, left);
      debtor.paidAmount += pay;
      if (debtor.paidAmount >= debtor.amount) debtor.isSettled = true;
      await debtor.save();
      if (debtor.saleInvoiceId && debtor.isSettled) {
        const { SaleInvoice } = await import('../models');
        await SaleInvoice.findByIdAndUpdate(debtor.saleInvoiceId, { isPaid: true });
      }
      left -= pay;
      debtApplied += pay;
      appliedDebts.push({ id: debtor._id.toString(), name: debtor.name, paid: pay });
    }

    if (customerId && debtApplied > 0) {
      await Customer.findByIdAndUpdate(customerId, {
        $inc: { totalCredit: -debtApplied },
      });
    }
  }

  const descParts = [
    description || 'واریز کارت',
    customerName ? `مشتری: ${customerName}` : null,
    debtApplied > 0 ? `اعمال روی بدهی: ${debtApplied.toLocaleString('fa-IR')}` : null,
  ].filter(Boolean);

  const tx = await CashTransaction.create({
    type: 'card_deposit',
    amount,
    direction: 'in',
    description: descParts.join(' · '),
    referenceId: customerId,
    referenceModel: customerId ? 'Customer' : undefined,
    date: d,
  });

  const settings = await updateBalances(0, amount);
  return {
    settings,
    deposit: tx,
    customerId,
    customerName,
    debtApplied,
    appliedDebts,
  };
}

export async function listCardDeposits(opts?: {
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}) {
  const filter: Record<string, unknown> = { type: 'card_deposit' };
  if (opts?.from || opts?.to) {
    filter.date = {};
    if (opts.from) (filter.date as Record<string, Date>).$gte = opts.from;
    if (opts.to) (filter.date as Record<string, Date>).$lte = opts.to;
  }
  const page = Math.max(1, opts?.page || 1);
  const pageSize = Math.min(50, Math.max(5, opts?.pageSize || 15));
  const total = await CashTransaction.countDocuments(filter);
  const items = await CashTransaction.find(filter)
    .sort({ date: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize);
  return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function deleteCardDeposit(id: string, password?: string) {
  assertDeletePassword(password);
  const tx = await CashTransaction.findById(id);
  if (!tx || tx.type !== 'card_deposit') throw new Error('واریز یافت نشد');
  // فقط موجودی کارت را برمی‌گرداند — بدهی‌های قبلاً کم‌شده دستی قابل برگشت نیست در این نسخه
  await updateBalances(0, -tx.amount);
  await tx.deleteOne();
  return { ok: true, id };
}

export async function deleteCompanyPayment(id: string, password?: string) {
  assertDeletePassword(password);
  const payment = await CompanyPayment.findById(id);
  if (!payment) throw new Error('پرداخت یافت نشد');
  const txs = await CashTransaction.find({
    referenceId: payment._id.toString(),
    referenceModel: 'CompanyPayment',
  });
  for (const tx of txs) {
    // پرداخت شرکت خروج بوده → برگشت یعنی افزودن
    if (payment.method === 'cash') await updateBalances(tx.amount, 0);
    else await updateBalances(0, tx.amount);
    await tx.deleteOne();
  }
  await payment.deleteOne();
  return { ok: true, id };
}

/** لیست تراکنش‌های صندوق شرکت */
export async function listCashTransactions(opts?: {
  from?: Date;
  to?: Date;
  limit?: number;
}) {
  const filter: Record<string, unknown> = {};
  if (opts?.from || opts?.to) {
    filter.date = {};
    if (opts.from) (filter.date as Record<string, Date>).$gte = opts.from;
    if (opts.to) (filter.date as Record<string, Date>).$lte = opts.to;
  }
  const limit = Math.min(100, Math.max(10, opts?.limit || 40));
  return CashTransaction.find(filter).sort({ date: -1, createdAt: -1 }).limit(limit);
}
