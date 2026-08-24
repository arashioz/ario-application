/**
 * هم‌خوان‌سازی کاتالوگ و فاکتورهای فروش
 *
 * این اسکریپت قیمت ثبت‌شدهٔ تاریخی فاکتورها را به قیمت امروز تغییر نمی‌دهد.
 * فقط فیلدهای محاسباتی هر فاکتور را از روی اقلام همان فاکتور بازسازی می‌کند.
 * در صورت --sync-catalog، قیمت دستی کاتالوگ حذف می‌شود تا کاتالوگ و صفحهٔ فروش
 * هر دو از مبنای قیمت تنظیم‌شدهٔ فروشگاه استفاده کنند.
 *
 * اجرا از پوشه backend:
 *   npm run repair:catalog-sales
 *   npm run repair:catalog-sales -- --apply --sync-catalog
 *
 * گزینه‌ها:
 *   --apply          ذخیرهٔ تغییرات (بدون آن فقط گزارش است)
 *   --sync-catalog   حذف catalogPricePerKgهای دستیِ متفاوت با قیمت محاسبه‌شده
 *   --all            فاکتورهای لغوشده/غیرفعال را هم بررسی می‌کند
 *
 * نیاز: MONGODB_URI در .env یا محیط سرور
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { Product, SaleInvoice } from '../models';
import { calculateSalePrice, getOrCreateSettings } from '../services/productService';
import { normalizeProductName } from '../utils/persian';

const APPLY = process.argv.includes('--apply');
const SYNC_CATALOG = process.argv.includes('--sync-catalog');
const ALL = process.argv.includes('--all');

const money = (value: unknown) => Math.max(0, Math.round(Number(value) || 0));
const qty = (value: unknown) => Math.max(0, Number(value) || 0);
const same = (a: unknown, b: unknown) => Math.abs(Number(a || 0) - Number(b || 0)) < 0.01;

function invoiceItemTotals(item: {
  unit?: 'kg' | 'package';
  qtyInput?: number;
  qtyKg?: number;
  qtyPackages?: number;
  quantity?: number;
  kgPerPackage?: number;
  unitPrice?: number;
  unitPricePerKg?: number;
  unitPricePerPackage?: number;
  unitCost?: number;
  unitCostPerKg?: number;
  discount?: number;
}) {
  const kgPerPackage = qty(item.kgPerPackage) || 5;
  const unit = item.unit === 'package' ? 'package' : 'kg';
  const qtyInput = qty(item.qtyInput) || (unit === 'package' ? qty(item.qtyPackages) : qty(item.quantity));
  const qtyKg = unit === 'package' ? qtyInput * kgPerPackage : qtyInput;
  const qtyPackages = unit === 'package' ? qtyInput : qtyKg / kgPerPackage;
  const rawUnitPrice =
    unit === 'package'
      ? money(item.unitPrice || item.unitPricePerPackage)
      : money(item.unitPrice || item.unitPricePerKg);
  const gross = money(rawUnitPrice * qtyInput);
  const discount = Math.min(money(item.discount), gross);
  const totalPrice = gross - discount;
  const unitPricePerKg = unit === 'package' ? money(rawUnitPrice / kgPerPackage) : rawUnitPrice;
  const unitPricePerPackage = unit === 'package' ? rawUnitPrice : money(rawUnitPrice * kgPerPackage);
  const unitCostPerKg = money(item.unitCostPerKg || item.unitCost);
  const cost = money(unitCostPerKg * qtyKg);

  return {
    unit,
    qtyInput,
    qtyKg,
    qtyPackages,
    kgPerPackage,
    unitPrice: rawUnitPrice,
    unitPricePerKg,
    unitPricePerPackage,
    totalPrice,
    unitCostPerKg,
    unitCost: unitCostPerKg,
    profit: totalPrice - cost,
    cost,
  };
}

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ario-shop';
  console.log('Mongo:', uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@'));
  console.log(APPLY ? 'MODE: APPLY (نوشتن در دیتابیس)' : 'MODE: DRY-RUN (فقط گزارش)');
  console.log(`SYNC CATALOG: ${SYNC_CATALOG ? 'بله' : 'خیر'}`);

  await mongoose.connect(uri);
  const settings = await getOrCreateSettings();
  const costBasis = settings.costBasis === 'weighted' ? 'weighted' : 'last';
  console.log(`مبنای قیمت فروش: ${costBasis === 'weighted' ? 'میانگین موزون' : 'آخرین خرید'}`);

  const products = await Product.find({}).sort({ name: 1 });
  let productAliases = 0;
  let catalogDifferences = 0;
  let catalogSynced = 0;
  const catalogSamples: string[] = [];

  for (const product of products) {
    const expectedRetail = (await calculateSalePrice(product._id.toString(), undefined, 'retail', costBasis))
      .salePricePerKg;
    const manualCatalogPrice = money(product.catalogPricePerKg);
    const differsFromFormula = manualCatalogPrice > 0 && !same(manualCatalogPrice, expectedRetail);
    if (product.catalogVisible && differsFromFormula) {
      catalogDifferences += 1;
      if (catalogSamples.length < 20) {
        catalogSamples.push(
          `${product.name}: کاتالوگ ${manualCatalogPrice.toLocaleString('fa-IR')} → فرمول فروش ${expectedRetail.toLocaleString('fa-IR')}`
        );
      }
    }

    let dirty = false;
    const stock = qty(product.stockKg ?? product.stock);
    const avgCost = money(product.avgCostPerKg ?? product.purchasePrice);
    if (!same(product.stock, stock)) {
      product.stock = stock;
      dirty = true;
    }
    if (!same(product.stockKg, stock)) {
      product.stockKg = stock;
      dirty = true;
    }
    if (!same(product.purchasePrice, avgCost)) {
      product.purchasePrice = avgCost;
      dirty = true;
    }
    const normalizedName = normalizeProductName(product.name);
    if (product.normalizedName !== normalizedName) {
      product.normalizedName = normalizedName;
      dirty = true;
    }
    if (SYNC_CATALOG && product.catalogVisible && differsFromFormula) {
      product.catalogPricePerKg = undefined;
      catalogSynced += 1;
      dirty = true;
    }
    if (!dirty) continue;
    productAliases += 1;
    if (APPLY) await product.save();
  }

  const filter = ALL ? {} : { status: { $nin: ['cancelled', 'inactive'] } };
  const invoices = await SaleInvoice.find(filter).sort({ date: -1 });
  let invoicesChanged = 0;
  let itemsChanged = 0;
  let noCostSnapshot = 0;
  let amountDelta = 0;
  let profitDelta = 0;
  const invoiceSamples: string[] = [];

  for (const invoice of invoices) {
    let totalKg = 0;
    let totalCost = 0;
    let rawAmount = 0;
    let changedItems = 0;
    let missingCosts = 0;

    for (const item of invoice.items) {
      const next = invoiceItemTotals(item);
      if (next.qtyKg > 0 && next.unitCostPerKg <= 0) missingCosts += 1;
      const fields: Array<
        'qtyInput' | 'qtyKg' | 'qtyPackages' | 'kgPerPackage' | 'unitPrice' |
        'unitPricePerKg' | 'unitPricePerPackage' | 'totalPrice' | 'unitCostPerKg' |
        'unitCost' | 'profit'
      > = [
        'qtyInput', 'qtyKg', 'qtyPackages', 'kgPerPackage', 'unitPrice',
        'unitPricePerKg', 'unitPricePerPackage', 'totalPrice', 'unitCostPerKg',
        'unitCost', 'profit',
      ];
      const itemChanged = fields.some((field) => !same(item[field], next[field]));
      if (itemChanged) {
        Object.assign(item, next);
        changedItems += 1;
      }
      totalKg += next.qtyKg;
      totalCost += next.cost;
      rawAmount += next.totalPrice;
    }

    const discount = Math.min(money(invoice.discount), rawAmount);
    const totalAmount = rawAmount - discount;
    const totalProfit = totalAmount - totalCost;
    const totalsChanged =
      !same(invoice.totalKg, totalKg) ||
      !same(invoice.totalCost, totalCost) ||
      !same(invoice.totalAmount, totalAmount) ||
      !same(invoice.totalProfit, totalProfit);
    if (!totalsChanged && changedItems === 0) continue;

    invoicesChanged += 1;
    itemsChanged += changedItems;
    if (missingCosts === invoice.items.length && invoice.items.length > 0) noCostSnapshot += 1;
    amountDelta += totalAmount - money(invoice.totalAmount);
    profitDelta += totalProfit - Number(invoice.totalProfit || 0);
    if (invoiceSamples.length < 25) {
      invoiceSamples.push(
        `${invoice.invoiceNumber}: مبلغ ${money(invoice.totalAmount).toLocaleString('fa-IR')} → ${totalAmount.toLocaleString('fa-IR')} | سود ${money(invoice.totalProfit).toLocaleString('fa-IR')} → ${totalProfit.toLocaleString('fa-IR')}`
      );
    }
    if (APPLY) {
      invoice.totalKg = totalKg;
      invoice.totalCost = totalCost;
      invoice.totalAmount = totalAmount;
      invoice.totalProfit = totalProfit;
      invoice.markModified('items');
      await invoice.save();
    }
  }

  console.log('\n--- گزارش ---');
  console.log(`محصول‌ها: ${products.length}`);
  console.log(`${APPLY ? 'اصلاح‌شده' : 'نیازمند اصلاح'} (موجودی/نام/قیمت خرید سازگاری): ${productAliases}`);
  console.log(`اختلاف قیمت دستی کاتالوگ با فرمول فروش: ${catalogDifferences}`);
  console.log(`${APPLY && SYNC_CATALOG ? 'قیمت دستی حذف‌شده از کاتالوگ' : 'قیمت دستی قابل همسان‌سازی'}: ${catalogSynced}`);
  console.log(`فاکتورهای بررسی‌شده: ${invoices.length}`);
  console.log(`${APPLY ? 'فاکتورهای اصلاح‌شده' : 'فاکتورهای نیازمند اصلاح'}: ${invoicesChanged}`);
  console.log(`اقلام اصلاح‌شده: ${itemsChanged}`);
  console.log(`فاکتور بدون snapshot هزینه: ${noCostSnapshot}`);
  console.log(`جمع تغییر مبلغ فاکتورها: ${amountDelta.toLocaleString('fa-IR')} تومان`);
  console.log(`جمع تغییر سود فاکتورها: ${profitDelta.toLocaleString('fa-IR')} تومان`);

  if (catalogSamples.length) {
    console.log('\nنمونه اختلاف‌های کاتالوگ:');
    for (const sample of catalogSamples) console.log('  •', sample);
  }
  if (invoiceSamples.length) {
    console.log('\nنمونه اصلاح فاکتورها:');
    for (const sample of invoiceSamples) console.log('  •', sample);
  }
  if (!APPLY) {
    console.log('\nبرای اعمال: npm run repair:catalog-sales -- --apply --sync-catalog');
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
