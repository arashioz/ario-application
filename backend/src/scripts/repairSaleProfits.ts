/**
 * اصلاح سود فاکتورهای فروش از روی snapshot هزینهٔ اقلام (unitCostPerKg / unitCost)
 *
 * دامنه پیش‌فرض: ارسال‌شده/تحویل‌شده + پرداخت‌شده (isPaid)
 *
 * اجرا روی سرور (از پوشه backend):
 *
 *   # فقط گزارش (چیزی ذخیره نمی‌کند)
 *   npx tsx src/scripts/repairSaleProfits.ts
 *
 *   # اعمال تغییرات
 *   npx tsx src/scripts/repairSaleProfits.ts --apply
 *
 *   # فقط منفی‌ها
 *   npx tsx src/scripts/repairSaleProfits.ts --apply --only-negative
 *
 *   # همه وضعیت‌ها (نه فقط ارسال‌شدهٔ پرداخت‌شده)
 *   npx tsx src/scripts/repairSaleProfits.ts --apply --all
 *
 * نیاز: MONGODB_URI در .env یا محیط
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { SaleInvoice } from '../models';

const APPLY = process.argv.includes('--apply');
const ONLY_NEGATIVE = process.argv.includes('--only-negative');
const ALL = process.argv.includes('--all');

function lineCostPerKg(it: {
  unitCostPerKg?: number;
  unitCost?: number;
}): number {
  const a = Number(it.unitCostPerKg);
  const b = Number(it.unitCost);
  if (Number.isFinite(a) && a > 0) return a;
  if (Number.isFinite(b) && b > 0) return b;
  return Math.max(0, Number.isFinite(a) ? a : 0) || Math.max(0, Number.isFinite(b) ? b : 0);
}

function lineQtyKg(it: { qtyKg?: number; quantity?: number }): number {
  const q = Number(it.qtyKg);
  if (Number.isFinite(q) && q > 0) return q;
  const alt = Number(it.quantity);
  return Number.isFinite(alt) && alt > 0 ? alt : 0;
}

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ario-shop';
  console.log('Mongo:', uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@'));
  console.log(
    APPLY ? 'MODE: APPLY (نوشتن در دیتابیس)' : 'MODE: DRY-RUN (فقط گزارش — برای ذخیره --apply بزنید)'
  );
  console.log(
    ALL
      ? 'SCOPE: همه فاکتورها (به‌جز cancelled/inactive)'
      : 'SCOPE: shipped/delivered + isPaid'
  );
  if (ONLY_NEGATIVE) console.log('FILTER: فقط totalProfit < 0');

  await mongoose.connect(uri);

  const filter: Record<string, unknown> = ALL
    ? { status: { $nin: ['cancelled', 'inactive'] } }
    : { status: { $in: ['shipped', 'delivered'] }, isPaid: true };

  if (ONLY_NEGATIVE) filter.totalProfit = { $lt: 0 };

  const invoices = await SaleInvoice.find(filter).sort({ date: -1 });
  console.log(`فاکتورهای کاندید: ${invoices.length}`);

  let checked = 0;
  let wouldChange = 0;
  let changed = 0;
  let skippedNoCost = 0;
  let profitDelta = 0;
  const samples: Array<{
    no: string;
    before: number;
    after: number;
    costBefore: number;
    costAfter: number;
  }> = [];

  for (const inv of invoices) {
    checked += 1;
    const items = inv.items || [];
    if (!items.length) continue;

    let missingCost = 0;
    let newTotalCost = 0;
    for (const it of items) {
      const qtyKg = lineQtyKg(it);
      const perKg = lineCostPerKg(it);
      if (perKg <= 0 && qtyKg > 0) missingCost += 1;
      const lineCost = Math.round(perKg * qtyKg);
      newTotalCost += lineCost;
      const linePrice = Math.round(Number(it.totalPrice) || 0);
      it.unitCostPerKg = perKg;
      it.unitCost = perKg;
      it.profit = linePrice - lineCost;
    }

    if (missingCost === items.length) {
      skippedNoCost += 1;
      continue;
    }

    const amount = Math.round(Number(inv.totalAmount) || 0);
    const newTotalProfit = amount - newTotalCost;
    const oldCost = Math.round(Number(inv.totalCost) || 0);
    const oldProfit = Math.round(Number(inv.totalProfit) || 0);

    if (oldCost === newTotalCost && oldProfit === newTotalProfit) continue;

    wouldChange += 1;
    profitDelta += newTotalProfit - oldProfit;
    if (samples.length < 25) {
      samples.push({
        no: inv.invoiceNumber,
        before: oldProfit,
        after: newTotalProfit,
        costBefore: oldCost,
        costAfter: newTotalCost,
      });
    }

    if (APPLY) {
      inv.totalCost = newTotalCost;
      inv.totalProfit = newTotalProfit;
      inv.markModified('items');
      await inv.save();
      changed += 1;
    }
  }

  console.log('\n--- خلاصه ---');
  console.log('بررسی‌شده:', checked);
  console.log(APPLY ? 'اصلاح‌شده:' : 'نیاز به اصلاح:', APPLY ? changed : wouldChange);
  console.log('رد شده (بدون هزینه snapshot):', skippedNoCost);
  console.log(
    'جمع تغییر سود:',
    profitDelta.toLocaleString('fa-IR'),
    'تومان',
    profitDelta >= 0 ? '(افزایش)' : '(کاهش)'
  );

  if (samples.length) {
    console.log('\nنمونه تغییرات:');
    for (const s of samples) {
      console.log(
        `  ${s.no}: سود ${s.before.toLocaleString('fa-IR')} → ${s.after.toLocaleString('fa-IR')} | هزینه ${s.costBefore.toLocaleString('fa-IR')} → ${s.costAfter.toLocaleString('fa-IR')}`
      );
    }
  }

  if (!APPLY && wouldChange > 0) {
    console.log('\nبرای اعمال واقعی دوباره با --apply اجرا کنید.');
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
