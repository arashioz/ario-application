import fs from 'fs';
import path from 'path';
import { once } from 'events';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import {
  CompanyPayment,
  SupplierDebt,
  PurchaseInvoice,
  CashTransaction,
  Expense,
  EXPENSE_TYPE_LABELS,
} from '../models';
import { getOrCreateSettings } from './productService';
import { getCompanyDebtSummary } from './companyService';

const { EJSON } = mongoose.mongo.BSON;

export const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(process.cwd(), 'backups'));

/** توکن‌های لاگین نباید داخل فایل بکاپ بروند */
const EXCLUDED_COLLECTIONS = new Set(['sessions']);

const BACKUP_NAME_RE = /^ario-(manual|auto)-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/;
const COLLECTION_NAME_RE = /^[A-Za-z0-9_.-]+$/;

function db() {
  const d = mongoose.connection.db;
  if (!d) throw new Error('اتصال دیتابیس برقرار نیست');
  return d;
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

async function writeChunk(out: fs.WriteStream, chunk: string) {
  if (!out.write(chunk)) await once(out, 'drain');
}

export async function listDbCollections() {
  const cols = await db().listCollections({}, { nameOnly: true }).toArray();
  const rows = await Promise.all(
    cols
      .map((c) => c.name)
      .filter((n) => !n.startsWith('system.') && !EXCLUDED_COLLECTIONS.has(n))
      .map(async (name) => ({ name, count: await db().collection(name).estimatedDocumentCount() }))
  );
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

async function assertCollection(name: string) {
  if (!COLLECTION_NAME_RE.test(name) || EXCLUDED_COLLECTIONS.has(name)) {
    throw new Error('نام جدول نامعتبر است');
  }
  const exists = await db().listCollections({ name }, { nameOnly: true }).hasNext();
  if (!exists) throw new Error('جدول یافت نشد');
}

/**
 * خروجی یک جدول به صورت آرایهٔ JSON (Extended JSON نسخهٔ relaxed)
 * — مستقیم با `mongoimport --jsonArray` قابل بازگردانی است.
 */
export async function streamCollectionJson(name: string, out: NodeJS.WritableStream) {
  await assertCollection(name);
  const cursor = db().collection(name).find({});
  out.write('[\n');
  let first = true;
  for await (const doc of cursor) {
    const chunk = (first ? '' : ',\n') + EJSON.stringify(doc, { relaxed: true });
    first = false;
    if (!out.write(chunk)) await once(out as unknown as fs.WriteStream, 'drain');
  }
  out.write('\n]\n');
}

export type BackupInfo = {
  file: string;
  kind: 'manual' | 'auto';
  size: number;
  createdAt: string;
  collections?: Array<{ name: string; count: number }>;
  totalDocuments?: number;
};

/** بکاپ کامل همهٔ جدول‌ها داخل یک فایل JSON روی سرور */
export async function createFullBackup(kind: 'manual' | 'auto' = 'manual', createdBy?: string): Promise<BackupInfo> {
  await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
  const createdAt = new Date();
  const file = `ario-${kind}-${stamp(createdAt)}.json`;
  const finalPath = path.join(BACKUP_DIR, file);
  const tmpPath = `${finalPath}.tmp`;
  const collections = await listDbCollections();

  const out = fs.createWriteStream(tmpPath, { encoding: 'utf8' });
  const summary: Array<{ name: string; count: number }> = [];
  try {
    const meta = {
      app: 'ario',
      format: 'ario-full-backup/1',
      database: mongoose.connection.name,
      createdAt: createdAt.toISOString(),
      kind,
      createdBy: createdBy || null,
      encoding: 'MongoDB Extended JSON (relaxed)',
    };
    await writeChunk(out, `{\n"meta": ${JSON.stringify(meta)},\n"collections": {\n`);
    for (let i = 0; i < collections.length; i++) {
      const { name } = collections[i];
      await writeChunk(out, `${i ? ',\n' : ''}${JSON.stringify(name)}: [\n`);
      let count = 0;
      for await (const doc of db().collection(name).find({})) {
        await writeChunk(out, (count ? ',\n' : '') + EJSON.stringify(doc, { relaxed: true }));
        count++;
      }
      await writeChunk(out, '\n]');
      summary.push({ name, count });
    }
    const totalDocuments = summary.reduce((s, c) => s + c.count, 0);
    await writeChunk(out, `\n},\n"summary": ${JSON.stringify({ collections: summary, totalDocuments })}\n}\n`);
    out.end();
    await once(out, 'finish');
    await fs.promises.rename(tmpPath, finalPath);
  } catch (e) {
    out.destroy();
    await fs.promises.rm(tmpPath, { force: true });
    throw e;
  }

  await fs.promises.writeFile(
    `${finalPath}.meta`,
    JSON.stringify({ collections: summary, totalDocuments: summary.reduce((s, c) => s + c.count, 0) })
  );
  const stat = await fs.promises.stat(finalPath);
  return {
    file,
    kind,
    size: stat.size,
    createdAt: createdAt.toISOString(),
    collections: summary,
    totalDocuments: summary.reduce((s, c) => s + c.count, 0),
  };
}

export async function listBackups(): Promise<BackupInfo[]> {
  await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
  const names = (await fs.promises.readdir(BACKUP_DIR)).filter((n) => BACKUP_NAME_RE.test(n));
  const rows = await Promise.all(
    names.map(async (file) => {
      const full = path.join(BACKUP_DIR, file);
      const stat = await fs.promises.stat(full);
      let extra: Pick<BackupInfo, 'collections' | 'totalDocuments'> = {};
      try {
        extra = JSON.parse(await fs.promises.readFile(`${full}.meta`, 'utf8'));
      } catch {
        /* فایل‌های قدیمی بدون meta */
      }
      return {
        file,
        kind: file.includes('-auto-') ? 'auto' : 'manual',
        size: stat.size,
        createdAt: stat.mtime.toISOString(),
        ...extra,
      } as BackupInfo;
    })
  );
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function resolveBackupPath(file: string): string {
  if (!BACKUP_NAME_RE.test(file)) throw new Error('نام فایل بکاپ نامعتبر است');
  const full = path.join(BACKUP_DIR, file);
  if (!fs.existsSync(full)) throw new Error('فایل بکاپ یافت نشد');
  return full;
}

export async function deleteBackup(file: string) {
  const full = resolveBackupPath(file);
  await fs.promises.rm(full, { force: true });
  await fs.promises.rm(`${full}.meta`, { force: true });
}

async function pruneAutoBackups(keep: number) {
  const autos = (await listBackups()).filter((b) => b.kind === 'auto');
  for (const b of autos.slice(keep)) await deleteBackup(b.file).catch(() => undefined);
}

/** بکاپ خودکار دوره‌ای — فقط N بکاپ خودکار آخر نگه داشته می‌شود؛ بکاپ‌های دستی دست نمی‌خورند */
export function scheduleAutoBackups() {
  const hours = Number(process.env.BACKUP_AUTO_HOURS ?? 24);
  const keep = Math.max(1, Number(process.env.BACKUP_KEEP ?? 14));
  if (!hours || hours <= 0) return;

  const run = async () => {
    try {
      const info = await createFullBackup('auto');
      await pruneAutoBackups(keep);
      console.log(`💾 Auto backup: ${info.file} (${info.totalDocuments} docs)`);
    } catch (e) {
      console.error('Auto backup failed:', e);
    }
  };

  void (async () => {
    const last = (await listBackups().catch(() => [])).find((b) => b.kind === 'auto');
    const due = !last || Date.now() - new Date(last.createdAt).getTime() >= hours * 3600_000;
    if (due) await run();
  })();
  setInterval(() => void run(), hours * 3600_000).unref();
}

// ─── خروجی مالی: پرداخت به شرکت + صندوق ───

const METHOD_LABEL: Record<string, string> = { cash: 'نقد', card: 'کارت / پوز', card_to_card: 'کارت به کارت' };

const CASH_TYPE_LABEL: Record<string, string> = {
  sale_cash: 'فروش نقد',
  sale_card: 'فروش کارتی',
  sale_credit: 'فروش نسیه',
  purchase: 'خرید / پرداخت به شرکت',
  expense: 'هزینه',
  debt_payment: 'وصول نسیه',
  card_deposit: 'واریز به کارت',
  adjustment: 'اصلاح موجودی',
};

function faDate(d?: Date | string | null): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString('fa-IR-u-nu-latn', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function dateRange(from?: Date, to?: Date) {
  if (!from && !to) return undefined;
  const r: Record<string, Date> = {};
  if (from) r.$gte = from;
  if (to) r.$lte = to;
  return r;
}

export async function buildFinanceExport(from?: Date, to?: Date) {
  const date = dateRange(from, to);
  const byDate = date ? { date } : {};
  const [settings, company, payments, debts, purchases, cashTxs, withdrawals] = await Promise.all([
    getOrCreateSettings(),
    getCompanyDebtSummary(),
    CompanyPayment.find(byDate).sort({ date: 1 }).lean(),
    SupplierDebt.find(byDate).populate('purchaseInvoiceId', 'invoiceNumber totalKg').sort({ date: 1 }).lean(),
    PurchaseInvoice.find(byDate).sort({ date: 1 }).lean(),
    CashTransaction.find(byDate).sort({ date: 1 }).lean(),
    Expense.find({ ...byDate, type: 'withdrawal' }).sort({ date: 1 }).lean(),
  ]);

  const cashIn = cashTxs.filter((t) => t.direction === 'in').reduce((s, t) => s + (t.amount || 0), 0);
  const cashOut = cashTxs.filter((t) => t.direction === 'out').reduce((s, t) => s + (t.amount || 0), 0);
  const paidInRange = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const withdrawalTotal = withdrawals.reduce((s, w) => s + (w.amount || 0), 0);

  return {
    meta: {
      exportedAt: new Date().toISOString(),
      from: from?.toISOString() || null,
      to: to?.toISOString() || null,
      currency: 'تومان',
    },
    summary: {
      cashBalance: settings.cashBalance || 0,
      cardBalance: settings.cardBalance || 0,
      companyTotalDebt: company.totalDebtAmount,
      companyTotalPaid: company.totalPaidToCompany,
      companyRemainingDebt: company.remainingDebt,
      companyPaymentsInRange: paidInRange,
      companyPaymentsCount: payments.length,
      purchasesInRange: purchases.reduce((s, p) => s + (p.totalAmount || 0), 0),
      purchasesCount: purchases.length,
      cashIn,
      cashOut,
      cashNet: cashIn - cashOut,
      withdrawalsInRange: withdrawalTotal,
    },
    companyPayments: payments.map((p) => ({
      id: String(p._id),
      date: p.date,
      dateFa: faDate(p.date),
      supplier: p.supplier,
      amount: p.amount,
      method: p.method,
      methodLabel: METHOD_LABEL[p.method] || p.method,
      notes: p.notes || '',
      supplierDebtId: p.supplierDebtId ? String(p.supplierDebtId) : null,
    })),
    supplierDebts: debts.map((d) => {
      const inv = d.purchaseInvoiceId as unknown as { invoiceNumber?: string; totalKg?: number } | null;
      return {
        id: String(d._id),
        date: d.date,
        dateFa: faDate(d.date),
        supplier: d.supplier,
        invoiceNumber: inv?.invoiceNumber || '',
        kg: inv?.totalKg || 0,
        amount: d.amount,
        paidAmount: d.paidAmount || 0,
        remaining: Math.max(0, d.amount - (d.paidAmount || 0)),
        isSettled: d.isSettled,
        notes: d.notes || '',
      };
    }),
    purchases: purchases.map((p) => ({
      id: String(p._id),
      date: p.date,
      dateFa: faDate(p.date),
      invoiceNumber: p.invoiceNumber,
      supplier: p.supplier || '',
      totalKg: p.totalKg || 0,
      totalAmount: p.totalAmount,
      paidNow: !!p.paidNow,
      items: (p.items || []).map((it) => ({
        productName: it.productName,
        qtyKg: it.qtyKg,
        unitPricePerKg: it.unitPricePerKg,
        totalPrice: it.totalPrice,
      })),
      notes: p.notes || '',
    })),
    cashTransactions: cashTxs.map((t) => ({
      id: String(t._id),
      date: t.date,
      dateFa: faDate(t.date),
      type: t.type,
      typeLabel: CASH_TYPE_LABEL[t.type] || t.type,
      direction: t.direction,
      amount: t.amount,
      paymentMethod: t.paymentMethod || '',
      methodLabel: t.paymentMethod ? METHOD_LABEL[t.paymentMethod] || t.paymentMethod : '',
      description: t.description,
      referenceModel: t.referenceModel || '',
      referenceId: t.referenceId || '',
    })),
    withdrawals: withdrawals.map((w) => ({
      id: String(w._id),
      date: w.date,
      dateFa: faDate(w.date),
      amount: w.amount,
      paymentMethod: w.paymentMethod || '',
      description: w.description,
      typeLabel: EXPENSE_TYPE_LABELS[w.type] || w.type,
    })),
  };
}

type FinanceExport = Awaited<ReturnType<typeof buildFinanceExport>>;

function addSheet(
  wb: ExcelJS.Workbook,
  title: string,
  columns: Array<{ header: string; key: string; width?: number; money?: boolean }>,
  rows: Array<Record<string, unknown>>
) {
  const ws = wb.addWorksheet(title, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 16 }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  rows.forEach((r) => ws.addRow(r));
  columns.forEach((c) => {
    if (c.money) ws.getColumn(c.key).numFmt = '#,##0';
  });
  return ws;
}

export async function buildFinanceWorkbook(data: FinanceExport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Ario';
  wb.created = new Date();
  const s = data.summary;

  addSheet(
    wb,
    'خلاصه',
    [
      { header: 'شرح', key: 'label', width: 34 },
      { header: 'مبلغ (تومان)', key: 'value', width: 20, money: true },
    ],
    [
      { label: 'موجودی نقد صندوق (فعلی)', value: s.cashBalance },
      { label: 'موجودی کارت (فعلی)', value: s.cardBalance },
      { label: 'کل بدهی ثبت‌شده به شرکت', value: s.companyTotalDebt },
      { label: 'کل پرداختی به شرکت', value: s.companyTotalPaid },
      { label: 'مانده بدهی به شرکت', value: s.companyRemainingDebt },
      { label: 'پرداخت به شرکت در بازه', value: s.companyPaymentsInRange },
      { label: 'خرید از شرکت در بازه', value: s.purchasesInRange },
      { label: 'ورودی صندوق در بازه', value: s.cashIn },
      { label: 'خروجی صندوق در بازه', value: s.cashOut },
      { label: 'خالص گردش صندوق', value: s.cashNet },
      { label: 'برداشت شخصی در بازه', value: s.withdrawalsInRange },
    ]
  );

  addSheet(
    wb,
    'پرداخت به شرکت',
    [
      { header: 'تاریخ', key: 'dateFa', width: 14 },
      { header: 'شرکت', key: 'supplier', width: 22 },
      { header: 'مبلغ', key: 'amount', width: 18, money: true },
      { header: 'روش', key: 'methodLabel', width: 16 },
      { header: 'توضیحات', key: 'notes', width: 36 },
    ],
    data.companyPayments
  );

  addSheet(
    wb,
    'بدهی شرکت',
    [
      { header: 'تاریخ', key: 'dateFa', width: 14 },
      { header: 'شرکت', key: 'supplier', width: 22 },
      { header: 'شماره فاکتور خرید', key: 'invoiceNumber', width: 18 },
      { header: 'کیلو', key: 'kg', width: 12 },
      { header: 'مبلغ بدهی', key: 'amount', width: 18, money: true },
      { header: 'پرداخت‌شده', key: 'paidAmount', width: 18, money: true },
      { header: 'مانده', key: 'remaining', width: 18, money: true },
      { header: 'تسویه', key: 'settledLabel', width: 10 },
    ],
    data.supplierDebts.map((d) => ({ ...d, settledLabel: d.isSettled ? 'بله' : 'خیر' }))
  );

  addSheet(
    wb,
    'خریدها',
    [
      { header: 'تاریخ', key: 'dateFa', width: 14 },
      { header: 'شماره فاکتور', key: 'invoiceNumber', width: 18 },
      { header: 'شرکت', key: 'supplier', width: 22 },
      { header: 'کیلو', key: 'totalKg', width: 12 },
      { header: 'مبلغ', key: 'totalAmount', width: 18, money: true },
      { header: 'پرداخت نقد همان روز', key: 'paidLabel', width: 18 },
      { header: 'اقلام', key: 'itemsText', width: 50 },
    ],
    data.purchases.map((p) => ({
      ...p,
      paidLabel: p.paidNow ? 'بله' : 'خیر',
      itemsText: p.items.map((i) => `${i.productName} ${i.qtyKg}kg`).join('، '),
    }))
  );

  addSheet(
    wb,
    'گردش صندوق',
    [
      { header: 'تاریخ', key: 'dateFa', width: 14 },
      { header: 'نوع', key: 'typeLabel', width: 22 },
      { header: 'ورود / خروج', key: 'dirLabel', width: 12 },
      { header: 'مبلغ', key: 'amount', width: 18, money: true },
      { header: 'روش', key: 'methodLabel', width: 16 },
      { header: 'شرح', key: 'description', width: 44 },
    ],
    data.cashTransactions.map((t) => ({ ...t, dirLabel: t.direction === 'in' ? 'ورودی' : 'خروجی' }))
  );

  addSheet(
    wb,
    'برداشت شخصی',
    [
      { header: 'تاریخ', key: 'dateFa', width: 14 },
      { header: 'مبلغ', key: 'amount', width: 18, money: true },
      { header: 'شرح', key: 'description', width: 44 },
    ],
    data.withdrawals
  );

  return Buffer.from(await wb.xlsx.writeBuffer());
}
