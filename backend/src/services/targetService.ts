import { SalesTarget, SaleInvoice } from '../models';
import { startOfDay, endOfDay } from '../utils/persian';

export async function upsertTarget(data: {
  marketerId: string;
  year: number;
  month: number;
  targetAmount?: number;
  targetKg?: number;
  notes?: string;
}) {
  return SalesTarget.findOneAndUpdate(
    { marketerId: data.marketerId, year: data.year, month: data.month },
    {
      marketerId: data.marketerId,
      year: data.year,
      month: data.month,
      targetAmount: data.targetAmount || 0,
      targetKg: data.targetKg || 0,
      notes: data.notes,
    },
    { upsert: true, new: true }
  );
}

export async function getTargetProgress(marketerId: string, year: number, month: number) {
  const target = await SalesTarget.findOne({ marketerId, year, month });
  const from = startOfDay(new Date(year, month - 1, 1));
  const to = endOfDay(new Date(year, month, 0));
  const sales = await SaleInvoice.find({
    marketerId,
    date: { $gte: from, $lte: to },
  });
  const achievedAmount = sales.reduce((s, i) => s + i.totalAmount, 0);
  const achievedKg = sales.reduce((s, i) => s + (i.totalKg || 0), 0);
  return {
    target,
    achievedAmount,
    achievedKg,
    amountPercent: target?.targetAmount
      ? Math.min(100, Math.round((achievedAmount / target.targetAmount) * 100))
      : 0,
    kgPercent: target?.targetKg
      ? Math.min(100, Math.round((achievedKg / target.targetKg) * 100))
      : 0,
  };
}

export async function listTargets(year?: number, month?: number) {
  const filter: Record<string, unknown> = {};
  if (year) filter.year = year;
  if (month) filter.month = month;
  return SalesTarget.find(filter).populate('marketerId', 'name username').sort({ year: -1, month: -1 });
}
