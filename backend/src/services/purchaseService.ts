import { PurchaseInvoice, CashTransaction, SupplierDebt, Product, Category } from '../models';
import {
  upsertProduct,
  validateTransactionDate,
  generateInvoiceNumber,
  updateBalances,
  resolveLineAmount,
  getOrCreateCategoryByName,
  findProductByName,
  QtyUnit,
} from './productService';

interface PurchaseItemInput {
  name: string;
  productId?: string;
  categoryId?: string;
  categoryName?: string;
  unit?: QtyUnit;
  qtyInput?: number;
  quantity?: number;
  unitPrice: number;
  kgPerPackage?: number;
  /** درصد سود دسته جدید در صورت ساخت */
  profitRetail?: number;
  profitSupermarket?: number;
  profitWholesale?: number;
}

export async function createPurchaseInvoice(data: {
  supplier?: string;
  items: PurchaseItemInput[];
  notes?: string;
  date?: Date;
  paidNow?: boolean;
  createdBy?: string;
}) {
  const date = data.date ? new Date(data.date) : new Date();
  validateTransactionDate(date);

  const { invoiceItems, totalAmount, totalKg, productSnapshots } = await buildPurchaseItems(data.items);
  const paidNow = data.paidNow === true;

  let invoice: InstanceType<typeof PurchaseInvoice> | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      invoice = await PurchaseInvoice.create({
        invoiceNumber: await generateInvoiceNumber('PUR'),
        supplier: data.supplier,
        items: invoiceItems,
        totalAmount,
        totalKg,
        notes: data.notes,
        date,
        paidNow,
        createdBy: data.createdBy,
      });
      break;
    } catch (err: unknown) {
      const code = (err as { code?: number })?.code;
      if (code !== 11000 || attempt === 4) throw err;
    }
  }
  if (!invoice) throw new Error('ثبت فاکتور خرید ناموفق بود');

  await applyPurchaseMoney(invoice, paidNow, totalAmount, date);

  return { invoice, productSnapshots };
}

export async function listPurchaseInvoices(from?: Date, to?: Date) {
  const filter: Record<string, unknown> = {};
  if (from || to) {
    filter.date = {};
    if (from) (filter.date as Record<string, Date>).$gte = from;
    if (to) (filter.date as Record<string, Date>).$lte = to;
  }
  return PurchaseInvoice.find(filter).sort({ date: -1 });
}

async function reversePurchaseEffects(invoice: InstanceType<typeof PurchaseInvoice>) {
  const debt = await SupplierDebt.findOne({ purchaseInvoiceId: invoice._id });
  if (debt && (debt.paidAmount || 0) > 0) {
    throw new Error('بدهی شرکت برای این فاکتور پرداخت جزئی دارد و قابل تغییر نیست');
  }

  for (const item of invoice.items) {
    const product = await Product.findById(item.productId);
    if (!product) continue;
    const stock = product.stockKg ?? product.stock ?? 0;
    const qty = item.qtyKg || 0;
    const rem = stock - qty;
    if (rem < -0.01) {
      throw new Error(
        `موجودی «${product.name}» برای برگشت کافی نیست (${stock} کیلو) — احتمالاً فروخته شده`
      );
    }
    const avg = product.avgCostPerKg ?? product.purchasePrice ?? 0;
    const price = item.unitPricePerKg || 0;
    if (rem <= 0.01) {
      product.stockKg = 0;
      product.stock = 0;
    } else {
      const oldAvg = Math.round((avg * stock - price * qty) / rem);
      product.avgCostPerKg = Math.max(0, oldAvg);
      product.purchasePrice = product.avgCostPerKg;
      product.stockKg = rem;
      product.stock = rem;
    }
    await product.save();
  }

  if (invoice.paidNow) {
    const txs = await CashTransaction.find({
      referenceId: invoice._id.toString(),
      referenceModel: 'PurchaseInvoice',
    });
    for (const tx of txs) {
      await updateBalances(tx.amount, 0);
      await tx.deleteOne();
    }
  } else if (debt) {
    await debt.deleteOne();
  } else {
    await SupplierDebt.deleteMany({ purchaseInvoiceId: invoice._id });
  }
}

async function buildPurchaseItems(items: PurchaseItemInput[]) {
  const invoiceItems = [];
  let totalAmount = 0;
  let totalKg = 0;
  const productSnapshots: Array<{
    productId: string;
    name: string;
    avgCostPerKg: number;
    lastPurchasePricePerKg: number;
    stockKg: number;
    isNew: boolean;
    imageUrl?: string;
    categoryId?: string;
    profitRetail?: number;
    profitSupermarket?: number;
    profitWholesale?: number;
  }> = [];

  for (const item of items) {
    let categoryId = item.categoryId;
    if (!categoryId && item.productId) {
      const byId = await Product.findById(item.productId);
      if (byId?.categoryId) categoryId = byId.categoryId.toString();
    }
    if (!categoryId && item.name) {
      const existing = await findProductByName(item.name);
      if (existing?.categoryId) {
        const catRef = existing.categoryId as unknown;
        if (catRef && typeof catRef === 'object' && '_id' in (catRef as object)) {
          categoryId = String((catRef as { _id: unknown })._id);
        } else {
          categoryId = String(catRef);
        }
      }
    }
    if (!categoryId) {
      if (!item.categoryName?.trim()) throw new Error(`دسته برای «${item.name}» مشخص نیست`);
      const cat = await getOrCreateCategoryByName(item.categoryName, {
        profitRetail: item.profitRetail,
        profitSupermarket: item.profitSupermarket,
        profitWholesale: item.profitWholesale,
      });
      categoryId = cat._id.toString();
    }

    const unit: QtyUnit = item.unit || 'kg';
    const qtyInput = item.qtyInput ?? item.quantity ?? 0;
    const kgPerPackage = item.kgPerPackage || 5;
    const {
      qtyKg,
      qtyPackages,
      unitPricePerKg,
      unitPricePerPackage,
      totalPrice,
    } = resolveLineAmount({
      unit,
      unitPrice: item.unitPrice,
      qtyInput,
      kgPerPackage,
    });

    // برای میانگین موزون، قیمت هر کیلو را گرد نگه می‌داریم
    const costPerKg = Math.round(unitPricePerKg);

    const { product, isNew } = await upsertProduct({
      name: item.name,
      categoryId,
      purchasePricePerKg: costPerKg,
      quantityKg: qtyKg,
      kgPerPackage,
    });

    totalAmount += totalPrice;
    totalKg += qtyKg;

    invoiceItems.push({
      productId: product._id,
      productName: product.name,
      unit,
      qtyInput,
      qtyKg,
      qtyPackages,
      kgPerPackage,
      unitPricePerKg: costPerKg,
      unitPricePerPackage,
      quantity: qtyKg,
      unitPrice: unit === 'kg' ? costPerKg : unitPricePerPackage,
      totalPrice,
    });

    const catDoc = categoryId ? await Category.findById(categoryId) : null;
    productSnapshots.push({
      productId: product._id.toString(),
      name: product.name,
      avgCostPerKg: product.avgCostPerKg,
      lastPurchasePricePerKg: product.lastPurchasePricePerKg || 0,
      stockKg: product.stockKg,
      isNew,
      imageUrl: product.imageUrl,
      categoryId: categoryId || undefined,
      profitRetail: catDoc?.profitRetail ?? catDoc?.profitPercent,
      profitSupermarket: catDoc?.profitSupermarket,
      profitWholesale: catDoc?.profitWholesale,
    });
  }

  return { invoiceItems, totalAmount, totalKg, productSnapshots };
}

async function applyPurchaseMoney(
  invoice: InstanceType<typeof PurchaseInvoice>,
  paidNow: boolean,
  totalAmount: number,
  date: Date
) {
  if (paidNow) {
    await CashTransaction.create({
      type: 'purchase',
      amount: totalAmount,
      direction: 'out',
      description: `فاکتور خرید ${invoice.invoiceNumber}`,
      referenceId: invoice._id.toString(),
      referenceModel: 'PurchaseInvoice',
      date,
    });
    await updateBalances(-totalAmount, 0);
  } else {
    await SupplierDebt.create({
      supplier: invoice.supplier || 'شرکت',
      purchaseInvoiceId: invoice._id,
      amount: totalAmount,
      paidAmount: 0,
      date,
      notes: `بدهی فاکتور ${invoice.invoiceNumber}`,
      isSettled: false,
    });
  }
}

/** حذف فاکتور خرید با رمز — برگشت موجودی و صندوق / بدهی شرکت */
export async function deletePurchaseInvoice(invoiceId: string, password?: string) {
  const { assertDeletePassword } = await import('./expenseService');
  await assertDeletePassword(password);

  const invoice = await PurchaseInvoice.findById(invoiceId);
  if (!invoice) throw new Error('فاکتور خرید یافت نشد');

  await reversePurchaseEffects(invoice);

  const id = invoice._id.toString();
  await invoice.deleteOne();
  return { ok: true, id };
}

/** ویرایش فاکتور خرید با رمز — برگشت و اعمال مجدد موجودی / صندوق */
export async function updatePurchaseInvoice(
  invoiceId: string,
  password: string | undefined,
  data: {
    supplier?: string;
    items: PurchaseItemInput[];
    notes?: string;
    date?: Date;
    paidNow?: boolean;
  }
) {
  const { assertDeletePassword } = await import('./expenseService');
  await assertDeletePassword(password);

  const invoice = await PurchaseInvoice.findById(invoiceId);
  if (!invoice) throw new Error('فاکتور خرید یافت نشد');
  if (!data.items?.length) throw new Error('حداقل یک قلم لازم است');

  await reversePurchaseEffects(invoice);

  const date = data.date ? new Date(data.date) : invoice.date;
  validateTransactionDate(date);

  const { invoiceItems, totalAmount, totalKg, productSnapshots } = await buildPurchaseItems(data.items);
  const paidNow = data.paidNow !== undefined ? data.paidNow === true : invoice.paidNow;

  invoice.supplier = data.supplier !== undefined ? data.supplier : invoice.supplier;
  invoice.items = invoiceItems as never;
  invoice.totalAmount = totalAmount;
  invoice.totalKg = totalKg;
  invoice.notes = data.notes !== undefined ? data.notes : invoice.notes;
  invoice.date = date;
  invoice.paidNow = paidNow;
  await invoice.save();

  await applyPurchaseMoney(invoice, paidNow, totalAmount, date);

  return { invoice, productSnapshots };
}
