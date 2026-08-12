/**
 * تعمیر نسیه از روی فاکتور اصلی − پرداختی‌ها = مانده
 *
 * منطق:
 *   1) مبلغ فاکتور (totalAmount)
 *   2) جمع همه پرداختی‌های واقعی (نقد/کارت فاکتور + وصول نسیه)
 *   3) مانده = max(0, فاکتور − پرداختی)
 *   4) payment فاکتور + یک بدهکار تمیز + totalCredit مشتری
 *
 * Docker:
 *   docker compose --env-file .env.prod exec backend node dist/scripts/repairInvoiceCreditFromPayments.js
 *   docker compose --env-file .env.prod exec backend node dist/scripts/repairInvoiceCreditFromPayments.js --apply
 *
 * لوکال:
 *   npx tsx src/scripts/repairInvoiceCreditFromPayments.ts
 *   npx tsx src/scripts/repairInvoiceCreditFromPayments.ts --apply
 *   npx tsx src/scripts/repairInvoiceCreditFromPayments.ts --apply --customer=دهنو
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { CashTransaction, Customer, Debtor, SaleInvoice } from '../models';

const APPLY = process.argv.includes('--apply');
const customerArg = process.argv.find((a) => a.startsWith('--customer='));
const CUSTOMER_FILTER = customerArg ? customerArg.slice('--customer='.length).trim() : '';

const fa = (n: number) => Math.round(n || 0).toLocaleString('fa-IR');

function moneyMethodFromDesc(
  method?: string | null,
  desc?: string | null
): 'cash' | 'card' {
  if (method === 'card' || method === 'card_to_card') return 'card';
  if (method === 'cash') return 'cash';
  const d = String(desc || '');
  if (d.includes('پوز') || d.includes('کارت')) return 'card';
  return 'cash';
}

type PaidSplit = { cash: number; card: number; total: number };

function addPaid(into: PaidSplit, amount: number, kind: 'cash' | 'card') {
  const n = Math.max(0, Math.round(amount || 0));
  if (n <= 0) return;
  if (kind === 'card') into.card += n;
  else into.cash += n;
  into.total += n;
}

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ario-shop';
  console.log('Mongo:', uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@'));
  console.log(
    APPLY ? 'MODE: APPLY (نوشتن در دیتابیس)' : 'MODE: DRY-RUN (فقط گزارش — برای ذخیره --apply بزنید)'
  );
  if (CUSTOMER_FILTER) console.log('FILTER customer name contains:', CUSTOMER_FILTER);

  await mongoose.connect(uri);

  const customerFilter: Record<string, unknown> = {};
  if (CUSTOMER_FILTER) {
    customerFilter.name = { $regex: CUSTOMER_FILTER, $options: 'i' };
  }
  const customers = await Customer.find(customerFilter);
  const customerIds = new Set(customers.map((c) => c._id.toString()));
  const customerById = new Map(customers.map((c) => [c._id.toString(), c]));

  const invFilter: Record<string, unknown> = {
    status: { $nin: ['cancelled', 'inactive'] },
  };
  if (CUSTOMER_FILTER) {
    invFilter.$or = [
      { customerId: { $in: [...customerIds] } },
      { customerName: { $regex: CUSTOMER_FILTER, $options: 'i' } },
    ];
  }

  const invoices = await SaleInvoice.find(invFilter).sort({ date: 1 });
  const invIds = invoices.map((i) => i._id);
  const invIdStrs = invIds.map((id) => id.toString());

  const allDebtors = await Debtor.find(
    CUSTOMER_FILTER
      ? {
          $or: [
            { saleInvoiceId: { $in: invIds } },
            { customerId: { $in: [...customerIds] } },
            { name: { $regex: CUSTOMER_FILTER, $options: 'i' } },
          ],
        }
      : {}
  );

  const debtorsByInv = new Map<string, typeof allDebtors>();
  for (const d of allDebtors) {
    const id = d.saleInvoiceId ? String(d.saleInvoiceId) : '';
    if (!id) continue;
    const list = debtorsByInv.get(id) || [];
    list.push(d);
    debtorsByInv.set(id, list);
  }

  const saleTxs = await CashTransaction.find({
    referenceModel: 'SaleInvoice',
    referenceId: { $in: invIdStrs },
    type: { $in: ['sale_cash', 'sale_card'] },
  });
  const saleTxByInv = new Map<string, typeof saleTxs>();
  for (const tx of saleTxs) {
    const id = String(tx.referenceId || '');
    const list = saleTxByInv.get(id) || [];
    list.push(tx);
    saleTxByInv.set(id, list);
  }

  const debtorIds = allDebtors.map((d) => d._id.toString());
  const debtPayTxs = debtorIds.length
    ? await CashTransaction.find({
        type: 'debt_payment',
        referenceModel: 'Debtor',
        referenceId: { $in: debtorIds },
      })
    : [];
  const debtPayByDebtor = new Map<string, typeof debtPayTxs>();
  for (const tx of debtPayTxs) {
    const id = String(tx.referenceId || '');
    const list = debtPayByDebtor.get(id) || [];
    list.push(tx);
    debtPayByDebtor.set(id, list);
  }

  let invChanged = 0;
  let debtorDeleted = 0;
  let debtorUpserted = 0;
  let orphanDeleted = 0;
  const samples: string[] = [];
  /** ماندهٔ نهایی هر مشتری بعد از تعمیر فاکتورها */
  const remainingByCustomer = new Map<string, number>();

  for (const inv of invoices) {
    const id = inv._id.toString();
    const total = Math.max(0, Math.round(inv.totalAmount || 0));
    if (total <= 0) continue;

    const linked = debtorsByInv.get(id) || [];
    const paid: PaidSplit = { cash: 0, card: 0, total: 0 };

    // 1) تراکنش‌های نقد/کارت روی خود فاکتور (ثبت اولیه + تسویه هنگام ارسال)
    for (const tx of saleTxByInv.get(id) || []) {
      const kind = tx.type === 'sale_card' ? 'card' : 'cash';
      addPaid(paid, tx.amount, kind);
    }

    // 2) وصول نسیه از مسیر بدهکار (debt_payment)
    const seenDebtPayTx = new Set<string>();
    for (const d of linked) {
      for (const tx of debtPayByDebtor.get(d._id.toString()) || []) {
        const key = tx._id.toString();
        if (seenDebtPayTx.has(key)) continue;
        seenDebtPayTx.add(key);
        addPaid(paid, tx.amount, moneyMethodFromDesc(tx.paymentMethod, tx.description));
      }
    }

    // 3) fallback بدهکار.payments فقط وقتی تراکنش debt_payment نیست
    //    و با sale_cash/sale_card فاکتور دوباره شمرده نشود (تسویه هنگام ارسال)
    const saleTxSum = (saleTxByInv.get(id) || []).reduce(
      (s, tx) => s + Math.round(tx.amount || 0),
      0
    );
    if (seenDebtPayTx.size === 0) {
      let paymentsSum = 0;
      const payRows: Array<{ amount: number; kind: 'cash' | 'card' }> = [];
      for (const d of linked) {
        for (const p of d.payments || []) {
          const amount = Math.max(0, Math.round(p.amount || 0));
          if (amount <= 0) continue;
          paymentsSum += amount;
          payRows.push({ amount, kind: moneyMethodFromDesc(p.method, p.note) });
        }
      }
      if (saleTxSum <= 0 && paymentsSum > 0) {
        for (const p of payRows) addPaid(paid, p.amount, p.kind);
      } else if (paymentsSum > saleTxSum + 1) {
        let extra = paymentsSum - saleTxSum;
        for (const p of payRows) {
          if (extra <= 0) break;
          const take = Math.min(extra, p.amount);
          addPaid(paid, take, p.kind);
          extra -= take;
        }
      }
    }

    // 4) رویدادهای credit_settle روی فاکتور — فقط اگر بیشتر از وصول بدهکار باشد
    const settleEvents = (inv.paymentEvents || []).filter((e) => e.kind === 'credit_settle');
    const settleSum = settleEvents.reduce((s, e) => s + Math.round(e.amount || 0), 0);
    const debtPaySum = linked.reduce((s, d) => {
      const txs = debtPayByDebtor.get(d._id.toString()) || [];
      if (txs.length) return s + txs.reduce((a, t) => a + Math.round(t.amount || 0), 0);
      return s + (d.payments || []).reduce((a, p) => a + Math.round(p.amount || 0), 0);
    }, 0);
    if (settleSum > debtPaySum + 1) {
      let extra = settleSum - debtPaySum;
      for (const e of settleEvents) {
        if (extra <= 0) break;
        const take = Math.min(extra, Math.round(e.amount || 0));
        addPaid(paid, take, moneyMethodFromDesc(e.method, e.note));
        extra -= take;
      }
    }

    // 5) اگر هیچ تراکنشی نبود، از خود payment فاکتور (نقد+کارت فعلی) به‌عنوان پرداختی استفاده کن
    if (paid.total <= 0) {
      const cash = Math.round(inv.payment?.cash || 0);
      const card = Math.round(inv.payment?.card || 0);
      addPaid(paid, cash, 'cash');
      addPaid(paid, card, 'card');
    }

    // سقف: بیشتر از مبلغ فاکتور نشود
    let paidTotal = Math.min(paid.total, total);
    let cash = paid.cash;
    let card = paid.card;
    if (cash + card > paidTotal) {
      // نسبت را حفظ کن
      const sum = cash + card || 1;
      cash = Math.round((cash / sum) * paidTotal);
      card = paidTotal - cash;
    } else if (cash + card < paidTotal) {
      cash += paidTotal - (cash + card);
    }

    const remaining = Math.max(0, total - paidTotal);
    const old = {
      cash: Math.round(inv.payment?.cash || 0),
      card: Math.round(inv.payment?.card || 0),
      credit: Math.round(inv.payment?.credit || 0),
      isPaid: !!inv.isPaid,
    };

    const debtorRemBefore = linked.reduce(
      (s, d) => s + Math.max(0, Math.round(d.amount || 0) - Math.round(d.paidAmount || 0)),
      0
    );

    const needsInvChange =
      old.cash !== cash ||
      old.card !== card ||
      old.credit !== remaining ||
      old.isPaid !== remaining <= 0;

    const needsDebtorChange =
      remaining > 0
        ? linked.length !== 1 ||
          Math.round(linked[0]?.amount || 0) !== remaining ||
          Math.round(linked[0]?.paidAmount || 0) !== 0 ||
          !!linked[0]?.isSettled
        : linked.some((d) => Math.max(0, Math.round(d.amount || 0) - Math.round(d.paidAmount || 0)) > 0);

    if (!needsInvChange && !needsDebtorChange) {
      if (remaining > 0 && inv.customerId) {
        const cid = inv.customerId.toString();
        remainingByCustomer.set(cid, (remainingByCustomer.get(cid) || 0) + remaining);
      }
      continue;
    }

    invChanged += 1;
    const custName =
      inv.customerName ||
      (inv.customerId ? customerById.get(inv.customerId.toString())?.name : '') ||
      '—';

    if (samples.length < 60) {
      samples.push(
        `${inv.invoiceNumber} (${custName}) · فاکتور ${fa(total)} · پرداختی ${fa(paidTotal)} (نقد ${fa(cash)} / کارت ${fa(card)}) · مانده ${fa(old.credit)}→${fa(remaining)} · بدهکارقبل ${fa(debtorRemBefore)} · بدهکارها ${linked.length}`
      );
    }

    if (inv.customerId && remaining > 0) {
      const cid = inv.customerId.toString();
      remainingByCustomer.set(cid, (remainingByCustomer.get(cid) || 0) + remaining);
    }

    if (!APPLY) continue;

    inv.payment = { cash, card, credit: remaining } as never;
    inv.isPaid = remaining <= 0;
    if (remaining <= 0) {
      if (!inv.paidAt) inv.paidAt = inv.lastPaymentAt || inv.date || new Date();
      if (cash > 0 && card > 0) inv.paymentMethod = 'mixed';
      else if (cash > 0) inv.paymentMethod = 'cash';
      else if (card > 0) {
        inv.paymentMethod = inv.paymentMethod === 'card_to_card' ? 'card_to_card' : 'card';
      }
    } else if (cash > 0 || card > 0) {
      inv.paymentMethod = 'mixed';
    } else {
      inv.paymentMethod = 'credit';
    }
    await inv.save();

    // بدهکارها را تمیز کن: مانده > 0 → یک رکورد با amount=مانده و paidAmount=0
    // مانده = 0 → همه بدهکارهای این فاکتور حذف شوند (دیتای کثیف نماند)
    if (remaining <= 0) {
      for (const d of linked) {
        await d.deleteOne();
        debtorDeleted += 1;
      }
      debtorsByInv.set(id, []);
    } else {
      const keep = linked[0];
      for (let i = 1; i < linked.length; i++) {
        await linked[i].deleteOne();
        debtorDeleted += 1;
      }
      if (keep) {
        keep.amount = remaining;
        keep.paidAmount = 0;
        keep.isSettled = false;
        keep.payments = [];
        keep.customerId = inv.customerId || keep.customerId;
        keep.name = inv.customerName || keep.name;
        keep.phone = inv.customerPhone || keep.phone;
        keep.description = `بدهی فاکتور ${inv.invoiceNumber}`;
        keep.saleInvoiceId = inv._id;
        await keep.save();
        debtorUpserted += 1;
        debtorsByInv.set(id, [keep]);
      } else {
        const created = await Debtor.create({
          name: inv.customerName || 'مشتری نسیه',
          phone: inv.customerPhone,
          customerId: inv.customerId,
          amount: remaining,
          paidAmount: 0,
          isSettled: false,
          payments: [],
          dueDate: inv.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          saleInvoiceId: inv._id,
          description: `بدهی فاکتور ${inv.invoiceNumber}`,
        });
        debtorUpserted += 1;
        debtorsByInv.set(id, [created]);
      }
    }
  }

  // بدهکار یتیم: بدون فاکتور معتبر، یا فاکتور لغو/غیرفعال
  const validInvIds = new Set(invIdStrs);
  const activeInvAll = CUSTOMER_FILTER
    ? invIdStrs
    : (
        await SaleInvoice.find({ status: { $nin: ['cancelled', 'inactive'] } }).select('_id')
      ).map((i) => i._id.toString());
  const activeSet = new Set(activeInvAll);

  for (const d of allDebtors) {
    const sid = d.saleInvoiceId ? String(d.saleInvoiceId) : '';
    const orphan = !sid || !activeSet.has(sid);
    // اگر فیلتر مشتری داریم فقط یتیم‌های مرتبط را دست بزن
    if (CUSTOMER_FILTER && sid && !validInvIds.has(sid)) {
      // ممکن است فاکتور این مشتری نباشد
      if (!(d.customerId && customerIds.has(String(d.customerId)))) continue;
    }
    if (!orphan) continue;
    orphanDeleted += 1;
    if (samples.length < 80) {
      samples.push(
        `حذف بدهکار یتیم ${d.name} · ${fa(Math.max(0, (d.amount || 0) - (d.paidAmount || 0)))} · saleInvoiceId=${sid || '—'}`
      );
    }
    if (APPLY) await d.deleteOne();
  }

  // totalCredit مشتری = جمع مانده‌های باز بعد از تعمیر
  // اگر فیلتر نداریم، برای همه مشتریان از بدهکارهای باقی‌مانده حساب کن
  let creditFixed = 0;
  const customersToFix = CUSTOMER_FILTER
    ? customers
    : await Customer.find({});

  // بعد از apply، بدهکارهای باز را دوباره بخوان
  const openDebtors = APPLY
    ? await Debtor.find({ isSettled: false })
    : allDebtors.filter((d) => {
        const rem = Math.max(0, Math.round(d.amount || 0) - Math.round(d.paidAmount || 0));
        return rem > 0 && !d.isSettled;
      });

  const openByCustomer = new Map<string, number>();
  if (APPLY) {
    for (const d of openDebtors) {
      if (!d.customerId) continue;
      const rem = Math.max(0, Math.round(d.amount || 0) - Math.round(d.paidAmount || 0));
      if (rem <= 0) continue;
      const cid = d.customerId.toString();
      openByCustomer.set(cid, (openByCustomer.get(cid) || 0) + rem);
    }
  } else {
    // dry-run: از محاسبهٔ همین اجرا
    for (const [cid, rem] of remainingByCustomer) {
      openByCustomer.set(cid, rem);
    }
    // مشتریانی که فاکتور تغییر نکرد ولی بدهکار دارند
    for (const d of allDebtors) {
      if (!d.customerId) continue;
      const cid = d.customerId.toString();
      if (remainingByCustomer.has(cid)) continue;
      const sid = d.saleInvoiceId ? String(d.saleInvoiceId) : '';
      if (sid && !activeSet.has(sid)) continue;
      // اگر فاکتور در لیست تغییرکرده‌ها نیست، مانده فعلی بدهکار را بگیر
      const rem = Math.max(0, Math.round(d.amount || 0) - Math.round(d.paidAmount || 0));
      if (rem <= 0) continue;
      // فقط اگر این فاکتور در حلقه تغییر نکرده (قبلاً به remainingByCustomer اضافه شده)
      // برای سادگی: اگر مشتری در map نیست از بدهکار جمع بزن
      openByCustomer.set(cid, (openByCustomer.get(cid) || 0) + rem);
    }
  }

  for (const c of customersToFix) {
    const cid = c._id.toString();
    const next = Math.max(0, Math.round(openByCustomer.get(cid) || 0));
    const cur = Math.round(c.totalCredit || 0);
    if (cur === next) continue;
    creditFixed += 1;
    if (samples.length < 100) {
      samples.push(`مشتری ${c.name}: totalCredit ${fa(cur)} → ${fa(next)}`);
    }
    if (APPLY) {
      c.totalCredit = next;
      await c.save();
    }
  }

  console.log('---');
  console.log(`فاکتور بررسی‌شده: ${invoices.length}`);
  console.log(`فاکتور اصلاح نسیه: ${invChanged}`);
  console.log(`بدهکار حذف/جایگزین: حذف ${debtorDeleted} · upsert ${debtorUpserted}`);
  console.log(`بدهکار یتیم: ${orphanDeleted}`);
  console.log(`مشتری totalCredit: ${creditFixed}`);
  if (samples.length) {
    console.log('نمونه:');
    for (const s of samples) console.log('  •', s);
  }
  if (!APPLY) {
    console.log('\nبرای ذخیره:');
    console.log('  node dist/scripts/repairInvoiceCreditFromPayments.js --apply');
    console.log('  # یا یک مشتری:');
    console.log('  node dist/scripts/repairInvoiceCreditFromPayments.js --apply --customer=دهنو');
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
