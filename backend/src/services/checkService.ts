import { CheckReminder, CheckStatus } from '../models/CheckReminder';
import { startOfDay, endOfDay } from '../utils/persian';

export async function createCheckReminder(data: {
  payerName: string;
  customerId?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  amount: number;
  checkNumber?: string;
  bankName?: string;
  dueDate: Date;
  followUpDate?: Date;
  notes?: string;
  createdBy?: string;
}) {
  if (!data.payerName?.trim()) throw new Error('نام پرداخت‌کننده الزامی است');
  if (!data.amount || data.amount <= 0) throw new Error('مبلغ چک نامعتبر است');
  if (!data.dueDate) throw new Error('تاریخ سررسید الزامی است');

  const due = new Date(data.dueDate);
  const follow = data.followUpDate ? new Date(data.followUpDate) : due;

  return CheckReminder.create({
    payerName: data.payerName.trim(),
    customerId: data.customerId,
    invoiceId: data.invoiceId,
    invoiceNumber: data.invoiceNumber?.trim(),
    amount: data.amount,
    checkNumber: data.checkNumber?.trim(),
    bankName: data.bankName?.trim(),
    dueDate: due,
    followUpDate: follow,
    notes: data.notes,
    createdBy: data.createdBy,
  });
}

export async function listCheckReminders(opts?: {
  status?: CheckStatus | 'all';
  dueSoon?: boolean;
}) {
  const filter: Record<string, unknown> = {};
  if (opts?.status && opts.status !== 'all') {
    filter.status = opts.status;
  }
  if (opts?.dueSoon) {
    const today = startOfDay(new Date());
    const in7 = endOfDay(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    filter.status = 'pending';
    filter.followUpDate = { $lte: in7 };
  }
  return CheckReminder.find(filter).sort({ followUpDate: 1, dueDate: 1 }).limit(200);
}

export async function updateCheckReminder(
  id: string,
  data: Partial<{
    payerName: string;
    amount: number;
    checkNumber: string;
    bankName: string;
    dueDate: Date;
    followUpDate: Date;
    notes: string;
    status: CheckStatus;
    invoiceNumber: string;
  }>
) {
  const row = await CheckReminder.findById(id);
  if (!row) throw new Error('چک یافت نشد');
  if (data.payerName !== undefined) row.payerName = data.payerName;
  if (data.amount !== undefined) row.amount = data.amount;
  if (data.checkNumber !== undefined) row.checkNumber = data.checkNumber;
  if (data.bankName !== undefined) row.bankName = data.bankName;
  if (data.dueDate !== undefined) row.dueDate = new Date(data.dueDate);
  if (data.followUpDate !== undefined) row.followUpDate = new Date(data.followUpDate);
  if (data.notes !== undefined) row.notes = data.notes;
  if (data.status !== undefined) row.status = data.status;
  if (data.invoiceNumber !== undefined) row.invoiceNumber = data.invoiceNumber;
  await row.save();
  return row;
}

export async function deleteCheckReminder(id: string) {
  const row = await CheckReminder.findByIdAndDelete(id);
  if (!row) throw new Error('چک یافت نشد');
  return { ok: true };
}

export async function getDueChecksSummary() {
  const today = endOfDay(new Date());
  const pending = await CheckReminder.find({ status: 'pending' }).sort({ followUpDate: 1 });
  const overdue = pending.filter((c) => c.followUpDate <= today);
  const upcoming = pending.filter((c) => c.followUpDate > today).slice(0, 5);
  return {
    pendingCount: pending.length,
    overdueCount: overdue.length,
    overdue,
    upcoming,
  };
}
