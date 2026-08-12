/**
 * هم‌خوان کردن نسیه فاکتور ↔ بدهکار ↔ مانده مشتری
 *
 * مشکل: اگر نسیه حتی یک پرداخت داشته (یا کامل صاف شده)، ویرایش فاکتور
 * با خطای «بدهی این فاکتور پرداخت جزئی دارد» قفل می‌شد.
 * کد ویرایش اصلاح شده؛ این اسکریپت داده‌های ناهم‌خوان سرور را درست می‌کند.
 *
 * از پوشه backend روی سرور:
 *
 *   # فقط گزارش
 *   npx tsx src/scripts/repairCreditInvoiceEdit.ts
 *
 *   # اعمال
 *   npx tsx src/scripts/repairCreditInvoiceEdit.ts --apply
 *
 * نیاز: MONGODB_URI در .env یا محیط
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { Customer, Debtor, SaleInvoice } from '../models';

const APPLY = process.argv.includes('--apply');

function remainingOf(d: { amount?: number; paidAmount?: number }): number {
  return Math.max(0, Math.round(d.amount || 0) - Math.round(d.paidAmount || 0));
}

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ario-shop';
  console.log('Mongo:', uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@'));
  console.log(
    APPLY ? 'MODE: APPLY (نوشتن در دیتابیس)' : 'MODE: DRY-RUN (فقط گزارش — برای ذخیره --apply بزنید)'
  );

  await mongoose.connect(uri);

  const debtors = await Debtor.find({});
  const invoices = await SaleInvoice.find({
    status: { $nin: ['cancelled', 'inactive'] },
  });

  const debtByInv = new Map<string, typeof debtors>();
  for (const d of debtors) {
    const id = d.saleInvoiceId ? String(d.saleInvoiceId) : '';
    if (!id) continue;
    const list = debtByInv.get(id) || [];
    list.push(d);
    debtByInv.set(id, list);
  }

  let invFixed = 0;
  let debtorFixed = 0;
  let blockedWouldHaveBeen = 0;
  const samples: string[] = [];

  for (const inv of invoices) {
    const id = inv._id.toString();
    const linked = debtByInv.get(id) || [];
    const openRem = linked.reduce((s, d) => s + remainingOf(d), 0);
    const hadPartialPay = linked.some((d) => (d.paidAmount || 0) > 0);
    if (hadPartialPay) blockedWouldHaveBeen += 1;

    const pay = {
      cash: Math.round(inv.payment?.cash || 0),
      card: Math.round(inv.payment?.card || 0),
      credit: Math.round(inv.payment?.credit || 0),
    };
    const nextCredit = openRem;
    const nextPaid = nextCredit <= 0;
    const creditChanged = pay.credit !== nextCredit;
    const paidChanged = !!inv.isPaid !== nextPaid;

    if (hadPartialPay || creditChanged || paidChanged) {
      if (samples.length < 40) {
        samples.push(
          `${inv.invoiceNumber} · نسیه فاکتور ${pay.credit.toLocaleString('fa-IR')} → ${nextCredit.toLocaleString('fa-IR')} · بدهکار ${linked.length} · پرداخت‌شده روی بدهی ${hadPartialPay ? 'بله' : 'خیر'}`
        );
      }
    }

    if (!creditChanged && !paidChanged) continue;
    invFixed += 1;
    if (!APPLY) continue;

    pay.credit = nextCredit;
    inv.payment = pay as never;
    inv.isPaid = nextPaid;
    if (nextPaid && !inv.paidAt) inv.paidAt = inv.lastPaymentAt || inv.date || new Date();
    if (nextCredit === 0) {
      if (pay.cash > 0 && pay.card > 0) inv.paymentMethod = 'mixed';
      else if (pay.cash > 0) inv.paymentMethod = 'cash';
      else if (pay.card > 0) inv.paymentMethod = inv.paymentMethod === 'card_to_card' ? 'card_to_card' : 'card';
    } else if (pay.cash > 0 || pay.card > 0) {
      inv.paymentMethod = 'mixed';
    } else {
      inv.paymentMethod = 'credit';
    }
    await inv.save();
  }

  for (const d of debtors) {
    const rem = remainingOf(d);
    const shouldSettle = rem <= 0;
    const paid = Math.min(Math.round(d.paidAmount || 0), Math.round(d.amount || 0));
    let dirty = false;
    if (d.isSettled !== shouldSettle) {
      d.isSettled = shouldSettle;
      dirty = true;
    }
    if ((d.paidAmount || 0) !== paid) {
      d.paidAmount = paid;
      dirty = true;
    }
    if (!dirty) continue;
    debtorFixed += 1;
    if (APPLY) await d.save();
  }

  const customers = await Customer.find({});
  let creditFixed = 0;
  for (const c of customers) {
    const open = debtors.filter(
      (d) => d.customerId && String(d.customerId) === c._id.toString()
    );
    const sum = open.reduce((s, d) => s + remainingOf(d), 0);
    const cur = Math.round(c.totalCredit || 0);
    if (cur === sum) continue;
    creditFixed += 1;
    if (samples.length < 50) {
      samples.push(
        `مشتری ${c.name}: totalCredit ${cur.toLocaleString('fa-IR')} → ${sum.toLocaleString('fa-IR')}`
      );
    }
    if (APPLY) {
      c.totalCredit = sum;
      await c.save();
    }
  }

  console.log('---');
  console.log(`فاکتور فعال: ${invoices.length}`);
  console.log(`بدهکار: ${debtors.length}`);
  console.log(`قبلاً ویرایش‌شان قفل بود (پرداخت روی نسیه): ${blockedWouldHaveBeen}`);
  console.log(`فاکتور نیازمند هم‌خوانی نسیه: ${invFixed}`);
  console.log(`بدهکار نیازمند isSettled/paidAmount: ${debtorFixed}`);
  console.log(`مشتری نیازمند totalCredit: ${creditFixed}`);
  if (samples.length) {
    console.log('نمونه:');
    for (const s of samples) console.log('  •', s);
  }
  if (!APPLY && (invFixed || debtorFixed || creditFixed)) {
    console.log('\nبرای ذخیره: npx tsx src/scripts/repairCreditInvoiceEdit.ts --apply');
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
