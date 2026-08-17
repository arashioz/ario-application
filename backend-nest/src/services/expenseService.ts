import { Expense, ExpenseType, CashTransaction, Debtor, Customer, CompanyPayment } from '../models';
import { validateTransactionDate, updateBalances, getOrCreateSettings } from './productService';

export const DEFAULT_DELETE_PASSWORD = 'delete-ario';
/** @deprecated استفاده از assertDeletePassword */
export const DELETE_PASSWORD = DEFAULT_DELETE_PASSWORD;

export async function getActionPassword(): Promise<string> {
  const s = await getOrCreateSettings();
  return (s.actionPassword && String(s.actionPassword).trim()) || DEFAULT_DELETE_PASSWORD;
}

export async function assertDeletePassword(password?: string) {
  const expected = await getActionPassword();
  const given = password != null ? String(password) : '';
  if (!given.trim()) {
    throw new Error('رمز حذف الزامی است');
  }
  if (given !== expected) {
    throw new Error('رمز اشتباه است');
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
  paymentMethod?: 'cash' | 'card' | 'card_to_card';
}) {
  const date = data.date ? new Date(data.date) : new Date();
  validateTransactionDate(date);
  const paymentMethod = data.paymentMethod || 'cash';

  const expense = await Expense.create({
    type: data.type,
    categoryId: data.categoryId,
    amount: data.amount,
    description: data.description,
    date,
    notes: data.notes,
    paymentMethod,
  });

  const inflowTypes = ['loan_received'];
  const isInflow = inflowTypes.includes(data.type);
  const useCard = paymentMethod === 'card' || paymentMethod === 'card_to_card';

  if (data.affectsCash !== false) {
    if (isInflow) {
      await CashTransaction.create({
        type: 'adjustment',
        amount: data.amount,
        direction: 'in',
        description: `${data.description} (${paymentMethod === 'cash' ? 'نقد' : paymentMethod === 'card_to_card' ? 'کارت به کارت' : 'کارت'})`,
        referenceId: expense._id.toString(),
        referenceModel: 'Expense',
        paymentMethod,
        date,
      });
      await updateBalances(useCard ? 0 : data.amount, useCard ? data.amount : 0);
    } else {
      await CashTransaction.create({
        type: 'expense',
        amount: data.amount,
        direction: 'out',
        description: `${data.description} (${paymentMethod === 'cash' ? 'نقد' : paymentMethod === 'card_to_card' ? 'کارت به کارت' : 'کارت'})`,
        referenceId: expense._id.toString(),
        referenceModel: 'Expense',
        paymentMethod,
        date,
      });
      await updateBalances(useCard ? 0 : -data.amount, useCard ? -data.amount : 0);
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

function methodToDeltas(
  method: string | undefined,
  amount: number,
  direction: 'in' | 'out'
): { cash: number; card: number } {
  const sign = direction === 'in' ? 1 : -1;
  const useCard = method === 'card' || method === 'card_to_card';
  return {
    cash: useCard ? 0 : sign * amount,
    card: useCard ? sign * amount : 0,
  };
}

export async function deleteExpense(id: string, password?: string) {
  await assertDeletePassword(password);
  const expense = await Expense.findById(id);
  if (!expense) throw new Error('هزینه یافت نشد');

  const txs = await CashTransaction.find({
    referenceId: expense._id.toString(),
    referenceModel: 'Expense',
  });
  if (txs.length) {
    for (const tx of txs) {
      const useCard =
        expense.paymentMethod === 'card' ||
        expense.paymentMethod === 'card_to_card' ||
        /کارت/.test(tx.description || '');
      if (tx.direction === 'in') {
        await updateBalances(useCard ? 0 : -tx.amount, useCard ? -tx.amount : 0);
      } else {
        await updateBalances(useCard ? 0 : tx.amount, useCard ? tx.amount : 0);
      }
      await tx.deleteOne();
    }
  } else {
    // سازگاری با هزینه‌های قدیمی بدون تراکنش
    const inflow = expense.type === 'loan_received';
    const d = methodToDeltas(expense.paymentMethod, expense.amount, inflow ? 'in' : 'out');
    await updateBalances(-d.cash, -d.card);
  }
  await expense.deleteOne();
  return { ok: true, id };
}

/** ویرایش هزینه با رمز — برگشت اثر قبلی و اعمال دوباره */
export async function updateExpense(
  id: string,
  password: string | undefined,
  data: {
    type?: ExpenseType;
    categoryId?: string;
    amount?: number;
    description?: string;
    date?: Date;
    notes?: string;
    paymentMethod?: 'cash' | 'card' | 'card_to_card';
  }
) {
  await assertDeletePassword(password);
  const expense = await Expense.findById(id);
  if (!expense) throw new Error('هزینه یافت نشد');

  // برگشت اثر قبلی
  const oldTxs = await CashTransaction.find({
    referenceId: expense._id.toString(),
    referenceModel: 'Expense',
  });
  for (const tx of oldTxs) {
    const useCard =
      expense.paymentMethod === 'card' ||
      expense.paymentMethod === 'card_to_card' ||
      /کارت/.test(tx.description || '');
    if (tx.direction === 'in') {
      await updateBalances(useCard ? 0 : -tx.amount, useCard ? -tx.amount : 0);
    } else {
      await updateBalances(useCard ? 0 : tx.amount, useCard ? tx.amount : 0);
    }
    await tx.deleteOne();
  }

  if (data.type !== undefined) expense.type = data.type;
  if (data.categoryId !== undefined) expense.categoryId = data.categoryId as never;
  if (data.amount !== undefined) expense.amount = data.amount;
  if (data.description !== undefined) expense.description = data.description;
  if (data.date !== undefined) {
    validateTransactionDate(data.date);
    expense.date = data.date;
  }
  if (data.notes !== undefined) expense.notes = data.notes;
  if (data.paymentMethod !== undefined) expense.paymentMethod = data.paymentMethod;
  await expense.save();

  const paymentMethod = expense.paymentMethod || 'cash';
  const isInflow = expense.type === 'loan_received';
  const useCard = paymentMethod === 'card' || paymentMethod === 'card_to_card';
  const methodLabel =
    paymentMethod === 'cash' ? 'نقد' : paymentMethod === 'card_to_card' ? 'کارت به کارت' : 'کارت';

  await CashTransaction.create({
    type: isInflow ? 'adjustment' : 'expense',
    amount: expense.amount,
    direction: isInflow ? 'in' : 'out',
    description: `${expense.description} (${methodLabel})`,
    referenceId: expense._id.toString(),
    referenceModel: 'Expense',
    date: expense.date,
  });
  if (isInflow) {
    await updateBalances(useCard ? 0 : expense.amount, useCard ? expense.amount : 0);
  } else {
    await updateBalances(useCard ? 0 : -expense.amount, useCard ? -expense.amount : 0);
  }

  return expense;
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
  await assertDeletePassword(password);
  const tx = await CashTransaction.findById(id);
  if (!tx || tx.type !== 'card_deposit') throw new Error('واریز یافت نشد');
  // فقط موجودی کارت را برمی‌گرداند — بدهی‌های قبلاً کم‌شده دستی قابل برگشت نیست در این نسخه
  await updateBalances(0, -tx.amount);
  await tx.deleteOne();
  return { ok: true, id };
}

export async function deleteCompanyPayment(id: string, password?: string) {
  await assertDeletePassword(password);
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

function inferMethodFromTx(tx: {
  paymentMethod?: string;
  description?: string;
  type?: string;
}): 'cash' | 'card' | 'card_to_card' {
  if (tx.paymentMethod === 'cash' || tx.paymentMethod === 'card' || tx.paymentMethod === 'card_to_card') {
    return tx.paymentMethod;
  }
  const d = tx.description || '';
  if (/کارت به کارت|کارت‌به‌کارت|card_to_card/i.test(d)) return 'card_to_card';
  if (/کارت|پوز|کارتخوان|card/i.test(d)) return 'card';
  return 'cash';
}

function useCardMethod(m: 'cash' | 'card' | 'card_to_card') {
  return m === 'card' || m === 'card_to_card';
}

function methodLabelFa(m: 'cash' | 'card' | 'card_to_card') {
  return m === 'cash' ? 'نقد' : m === 'card_to_card' ? 'کارت به کارت' : 'کارت';
}

/**
 * تغییر روش پرداخت یک گردش صندوق (نقد ↔ کارت) و اصلاح موجودی.
 * برای Expense / CompanyPayment هم مدل مرجع را آپدیت می‌کند.
 */
export async function updateCashTransactionPaymentMethod(
  id: string,
  password: string | undefined,
  paymentMethod: 'cash' | 'card' | 'card_to_card'
) {
  await assertDeletePassword(password);
  const tx = await CashTransaction.findById(id);
  if (!tx) throw new Error('تراکنش یافت نشد');
  if (tx.type === 'sale_cash' || tx.type === 'sale_card' || tx.type === 'sale_credit') {
    throw new Error('روش پرداخت فاکتور فروش را از ویرایش فاکتور تغییر دهید');
  }
  if (tx.type === 'card_deposit') {
    throw new Error('واریز کارتخوان همیشه کارتی است');
  }

  const prev = inferMethodFromTx(tx);
  if (prev === paymentMethod) {
    tx.paymentMethod = paymentMethod;
    await tx.save();
    return tx;
  }

  const sign = tx.direction === 'in' ? 1 : -1;
  const prevCard = useCardMethod(prev);
  const nextCard = useCardMethod(paymentMethod);

  // برداشتن اثر قبلی
  await updateBalances(prevCard ? 0 : -sign * tx.amount, prevCard ? -sign * tx.amount : 0);
  // اعمال اثر جدید
  await updateBalances(nextCard ? 0 : sign * tx.amount, nextCard ? sign * tx.amount : 0);

  tx.paymentMethod = paymentMethod;
  // به‌روز کردن برچسب داخل توضیح اگر قبلاً پرانتز روش داشت
  const base = (tx.description || '').replace(/\s*\((نقد|کارت به کارت|کارت)\)\s*$/, '').trim();
  tx.description = `${base} (${methodLabelFa(paymentMethod)})`;
  await tx.save();

  if (tx.referenceModel === 'Expense' && tx.referenceId) {
    await Expense.findByIdAndUpdate(tx.referenceId, { paymentMethod });
  }
  if (tx.referenceModel === 'CompanyPayment' && tx.referenceId) {
    await CompanyPayment.findByIdAndUpdate(tx.referenceId, {
      method: paymentMethod === 'card_to_card' ? 'card_to_card' : paymentMethod,
    });
  }

  return tx;
}
