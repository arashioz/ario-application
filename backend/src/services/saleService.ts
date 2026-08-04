import { SaleInvoice, Debtor, CashTransaction, Product, Customer } from '../models';
import {
  calculateSalePrice,
  validateTransactionDate,
  generateInvoiceNumber,
  updateBalances,
  findProductByName,
  resolveQty,
  resolveLineAmount,
  resolveProductCost,
  getOrCreateSettings,
  QtyUnit,
  PriceTier as PricingTier,
  CostBasis,
} from './productService';
import { PaymentMethod, PriceTier, SaleStatus } from '../models/SaleInvoice';
import { createCustomer, normalizePhoneDigits, findCustomerByPhone, getCustomerPreferredTier } from './customerService';

interface SaleItemInput {
  productId?: string;
  productName?: string;
  unit?: QtyUnit;
  qtyInput?: number;
  quantity?: number;
  unitPrice?: number;
  /** تخفیف این قلم (تومان) */
  discount?: number;
}

async function buildSaleItems(
  items: SaleItemInput[],
  priceTier: PriceTier,
  checkStock: boolean,
  costBasis: CostBasis = 'last'
) {
  const saleItems = [];
  let totalAmount = 0;
  let totalCost = 0;
  let totalKg = 0;
  let itemsDiscount = 0;

  for (const item of items) {
    let product;
    if (item.productId) {
      product = await Product.findById(item.productId).populate('categoryId');
    } else if (item.productName) {
      product = await findProductByName(item.productName);
    }
    if (!product) throw new Error(`محصول "${item.productName || item.productId}" یافت نشد`);

    const unit: QtyUnit = item.unit || 'kg';
    const qtyInput = item.qtyInput ?? item.quantity ?? 0;
    const kgPerPackage = product.kgPerPackage || 5;
    const { qtyKg, qtyPackages } = resolveQty({ unit, qtyInput, kgPerPackage });

    const stockKg = product.stockKg ?? product.stock ?? 0;
    if (checkStock && stockKg < qtyKg) {
      throw new Error(`موجودی "${product.name}" کافی نیست (${stockKg} کیلو)`);
    }

    const pricing = await calculateSalePrice(
      product._id.toString(),
      undefined,
      priceTier as PricingTier,
      costBasis
    );
    let unitPricePerKg = pricing.salePricePerKg;
    let unitPricePerPackage = pricing.salePricePerPackage;
    let gross = Math.round(unitPricePerKg * qtyKg);

    if (item.unitPrice != null) {
      const resolved = resolveLineAmount({
        unit,
        unitPrice: item.unitPrice,
        qtyInput,
        kgPerPackage,
      });
      unitPricePerKg = Math.round(resolved.unitPricePerKg);
      unitPricePerPackage = resolved.unitPricePerPackage;
      gross = resolved.totalPrice;
    }

    const lineDisc = Math.max(0, Math.min(Math.round(item.discount || 0), gross));
    const totalPrice = gross - lineDisc;
    const unitCost = resolveProductCost(product, costBasis);
    const cost = Math.round(unitCost * qtyKg);
    const profit = totalPrice - cost;

    saleItems.push({
      productId: product._id,
      productName: product.name,
      unit,
      qtyInput,
      qtyKg,
      qtyPackages,
      kgPerPackage,
      unitCostPerKg: unitCost,
      unitPricePerKg,
      unitPricePerPackage,
      quantity: qtyKg,
      unitCost: unitCost,
      unitPrice: unit === 'kg' ? unitPricePerKg : unitPricePerPackage,
      totalPrice,
      discount: lineDisc,
      profit,
      priceTier,
    });

    totalAmount += totalPrice;
    totalCost += cost;
    totalKg += qtyKg;
    itemsDiscount += lineDisc;
  }

  return { saleItems, totalAmount, totalCost, totalKg, itemsDiscount };
}

async function applyStockAndMoney(invoice: InstanceType<typeof SaleInvoice>) {
  if (invoice.stockApplied) return invoice;

  for (const item of invoice.items) {
    const product = await Product.findById(item.productId);
    if (!product) throw new Error(`محصول ${item.productName} یافت نشد`);
    const stockKg = product.stockKg ?? product.stock ?? 0;
    if (stockKg < item.qtyKg) {
      throw new Error(`موجودی "${product.name}" کافی نیست (${stockKg} کیلو)`);
    }
    product.stockKg = stockKg - item.qtyKg;
    product.stock = product.stockKg;
    await product.save();
  }

  const { payment, invoiceNumber, isGolden, date } = invoice;
  if (payment.cash > 0) {
    await CashTransaction.create({
      type: 'sale_cash',
      amount: payment.cash,
      direction: 'in',
      description: `${isGolden ? 'فروش طلایی' : 'فروش'} نقد ${invoiceNumber}`,
      referenceId: invoice._id.toString(),
      referenceModel: 'SaleInvoice',
      date,
    });
  }
  if (payment.card > 0) {
    const cardKind = invoice.paymentMethod === 'card_to_card' ? 'کارت به کارت' : 'کارتی';
    await CashTransaction.create({
      type: 'sale_card',
      amount: payment.card,
      direction: 'in',
      description: `${isGolden ? 'فروش طلایی' : 'فروش'} ${cardKind} ${invoiceNumber}`,
      referenceId: invoice._id.toString(),
      referenceModel: 'SaleInvoice',
      date,
    });
  }
  await updateBalances(payment.cash, payment.card);

  if (payment.credit > 0) {
    await Debtor.create({
      name: invoice.customerName || 'مشتری نسیه',
      phone: invoice.customerPhone,
      customerId: invoice.customerId,
      amount: payment.credit,
      paidAmount: 0,
      dueDate: invoice.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      saleInvoiceId: invoice._id,
      description: `بدهی فاکتور ${invoiceNumber}`,
    });
    if (invoice.customerId) {
      await Customer.findByIdAndUpdate(invoice.customerId, { $inc: { totalCredit: payment.credit } });
    }
  }

  invoice.stockApplied = true;
  await invoice.save();
  return invoice;
}

export async function createSaleInvoice(data: {
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  customerLat?: number;
  customerLng?: number;
  marketerId?: string;
  items: SaleItemInput[];
  paymentMethod: PaymentMethod;
  payment?: { cash?: number; card?: number; credit?: number };
  discount?: number;
  discountMode?: 'invoice' | 'per_kg' | 'product';
  discountPerKg?: number;
  notes?: string;
  appliedOffer?: string;
  date?: Date;
  dueDate?: Date;
  priceTier?: PriceTier;
  isGolden?: boolean;
  /** اگر true یا نقش بازاریاب: منتظر تأیید ادمین */
  requiresApproval?: boolean;
  /** پخش شرکت یا خود بازاریاب — برای پورسانت */
  deliveryMode?: 'company' | 'self';
  createdByRole?: string;
}) {
  const priceTier: PriceTier = data.priceTier || 'retail';
  if (
    (priceTier === 'supermarket' || priceTier === 'wholesale') &&
    !data.customerId &&
    !data.customerName?.trim()
  ) {
    throw new Error('برای فروش سوپرمارکت یا عمده، انتخاب / ثبت مشتری الزامی است');
  }

  // قانون: مشتری عمده → فاکتور تکی مجاز نیست
  if (priceTier === 'retail' && data.customerId) {
    const preferred = await getCustomerPreferredTier(data.customerId);
    if (preferred === 'wholesale') {
      throw new Error('این مشتری عمده است — صدور فاکتور تکی مجاز نیست');
    }
  }

  const date = data.date ? new Date(data.date) : new Date();
  validateTransactionDate(date);
  const isGolden = data.isGolden === true;
  const requiresApproval =
    data.requiresApproval === true || data.createdByRole === 'marketer';

  let customerName = data.customerName;
  let customerPhone = data.customerPhone ? normalizePhoneDigits(data.customerPhone) : data.customerPhone;
  if (customerPhone === '') customerPhone = undefined;
  let customerAddress = data.customerAddress;
  let customerId = data.customerId;

  const applyGeo = async (c: { address?: string; lat?: number; lng?: number; save: () => Promise<unknown> }) => {
    let dirty = false;
    if (data.customerAddress && data.customerAddress !== c.address) {
      c.address = data.customerAddress;
      dirty = true;
    }
    if (data.customerLat != null) {
      c.lat = data.customerLat;
      dirty = true;
    }
    if (data.customerLng != null) {
      c.lng = data.customerLng;
      dirty = true;
    }
    if (dirty) await c.save();
  };

  if (customerId) {
    const c = await Customer.findById(customerId);
    if (c) {
      customerName = customerName || c.name;
      customerPhone = customerPhone || c.phone;
      customerAddress = customerAddress || c.address;
      await applyGeo(c);
    }
  } else if (customerName || customerPhone) {
    let customer: InstanceType<typeof Customer> | null = null;
    if (customerPhone) {
      customer = await findCustomerByPhone(customerPhone);
    }
    if (!customer && customerName) {
      customer = await Customer.findOne({ name: customerName });
    }
    if (!customer && customerName) {
      customer = await createCustomer({
        name: customerName,
        phone: customerPhone,
        address: customerAddress,
        lat: data.customerLat,
        lng: data.customerLng,
      });
    } else if (customer) {
      if (customerName) customer.name = customerName;
      if (customerPhone) customer.phone = customerPhone;
      await applyGeo(customer);
      await customer.save();
    }
    if (customer) customerId = customer._id.toString();
  }

  const settings = await getOrCreateSettings();
  const costBasis: CostBasis =
    settings.costBasis === 'weighted' || settings.costBasis === 'last' ? settings.costBasis : 'last';

  const { saleItems, totalAmount: rawTotal, totalCost, totalKg } = await buildSaleItems(
    data.items,
    priceTier,
    !requiresApproval,
    costBasis
  );

  const discountMode = data.discountMode || 'invoice';
  let discountPerKg = Math.max(0, data.discountPerKg || 0);
  let discount = Math.max(0, data.discount || 0);

  if (discountMode === 'per_kg') {
    if (discountPerKg <= 0 && discount > 0 && totalKg > 0) {
      discountPerKg = Math.round(discount / totalKg);
    }
    discount = Math.round(discountPerKg * totalKg);
  } else if (discountMode === 'product') {
    // تخفیف اقلام قبلاً از total کم شده؛ تخفیف فاکتور اختیاری اضافه
    discount = Math.max(0, data.discount || 0);
  }

  // rawTotal already has line discounts subtracted
  let totalAmount = Math.max(0, rawTotal - discount);
  const totalProfit = totalAmount - totalCost;

  const payment = {
    cash: data.payment?.cash || 0,
    card: data.payment?.card || 0,
    credit: data.payment?.credit || 0,
  };

  if (data.paymentMethod === 'cash') payment.cash = totalAmount;
  else if (data.paymentMethod === 'card' || data.paymentMethod === 'card_to_card') payment.card = totalAmount;
  else if (data.paymentMethod === 'credit') payment.credit = totalAmount;
  else if (data.paymentMethod === 'mixed') {
    const sum = payment.cash + payment.card + payment.credit;
    if (sum === 0) {
      // اگر چیزی نزده، کل را کارت بگذار تا ثبت خراب نشود
      payment.card = totalAmount;
    } else if (Math.abs(sum - totalAmount) > 1) {
      // باقی‌مانده را نسیه کن (یا از نسیه کم کن)
      const diff = totalAmount - sum;
      payment.credit = Math.max(0, payment.credit + diff);
      const sum2 = payment.cash + payment.card + payment.credit;
      if (Math.abs(sum2 - totalAmount) > 2) {
        throw new Error(
          `مجموع پرداخت (${sum.toLocaleString('fa-IR')}) با مبلغ فاکتور (${totalAmount.toLocaleString('fa-IR')}) برابر نیست`
        );
      }
    }
  }

  const status: SaleStatus = requiresApproval ? 'pending' : 'approved';
  const prefix = isGolden ? 'GOL' : 'SAL';

  let invoice: InstanceType<typeof SaleInvoice> | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      invoice = await SaleInvoice.create({
        invoiceNumber: await generateInvoiceNumber(prefix),
        customerId,
        customerName,
        customerPhone,
        customerAddress,
        customerLat: data.customerLat,
        customerLng: data.customerLng,
        marketerId: data.marketerId,
        items: saleItems,
        totalAmount,
        totalCost,
        totalProfit,
        totalKg,
        paymentMethod: data.paymentMethod,
        payment,
        discount,
        discountMode,
        discountPerKg: discountMode === 'per_kg' ? discountPerKg : 0,
        notes: data.notes,
        appliedOffer: data.appliedOffer,
        date,
        dueDate: data.dueDate,
        isPaid: payment.credit === 0,
        priceTier,
        isGolden,
        status,
        deliveryMode: data.deliveryMode === 'self' ? 'self' : 'company',
        stockApplied: false,
        approvedAt: requiresApproval ? undefined : new Date(),
      });
      break;
    } catch (err: unknown) {
      const code = (err as { code?: number })?.code;
      if (code !== 11000 || attempt === 4) throw err;
    }
  }
  if (!invoice) throw new Error('ثبت فاکتور فروش ناموفق بود');

  if (!requiresApproval) {
    await applyStockAndMoney(invoice);
    if (data.marketerId && data.createdByRole === 'marketer') {
      try {
        const { creditSaleCommission } = await import('./platformService');
        await creditSaleCommission({
          marketerId: data.marketerId,
          saleId: invoice._id.toString(),
          invoiceNumber: invoice.invoiceNumber,
          totalAmount: invoice.totalAmount,
          deliveryMode: data.deliveryMode || 'company',
        });
      } catch (e) {
        console.warn('commission credit failed', e);
      }
    }
  }

  return invoice;
}

export async function approveSale(
  invoiceId: string,
  adminId: string,
  opts?: {
    driverId?: string | null;
    shippingBy?: 'us' | 'customer' | 'none';
    shippingCost?: number;
    shippingNotes?: string;
  }
) {
  const invoice = await SaleInvoice.findById(invoiceId);
  if (!invoice) throw new Error('فاکتور یافت نشد');
  if (invoice.status !== 'pending') throw new Error('این فاکتور در صف تأیید نیست');
  await applyStockAndMoney(invoice);
  invoice.status = 'approved';
  invoice.approvedBy = adminId as never;
  invoice.approvedAt = new Date();

  if (opts?.shippingBy) invoice.shippingBy = opts.shippingBy;
  if (opts?.shippingNotes !== undefined) invoice.shippingNotes = opts.shippingNotes;
  if (opts?.shippingCost != null) invoice.shippingCost = Math.max(0, Math.round(opts.shippingCost));

  if (opts?.driverId !== undefined) {
    if (opts.driverId) {
      const { User } = await import('../models');
      const driver = await User.findById(opts.driverId);
      if (!driver || driver.role !== 'driver') throw new Error('راننده معتبر نیست');
      invoice.driverId = driver._id as never;
    } else {
      invoice.driverId = undefined;
    }
  }

  await invoice.save();
  await maybeRecordShippingExpense(invoice);

  if (invoice.marketerId) {
    try {
      const { creditSaleCommission } = await import('./platformService');
      await creditSaleCommission({
        marketerId: invoice.marketerId.toString(),
        saleId: invoice._id.toString(),
        invoiceNumber: invoice.invoiceNumber,
        totalAmount: invoice.totalAmount,
        deliveryMode:
          (invoice as { deliveryMode?: 'company' | 'self' }).deliveryMode ||
          (opts?.shippingBy === 'customer' ? 'self' : 'company'),
      });
    } catch (e) {
      console.warn('commission on approve failed', e);
    }
  }

  return invoice;
}

async function maybeRecordShippingExpense(invoice: InstanceType<typeof SaleInvoice>) {
  if (invoice.shippingExpenseId) return invoice;
  if (invoice.shippingBy !== 'us') return invoice;
  const cost = Math.round(invoice.shippingCost || 0);
  if (cost <= 0) return invoice;
  // اگر راننده دارد: هزینه موقع پرداخت به راننده ثبت می‌شود (از کیف پول)
  if (invoice.driverId) return invoice;

  const { createExpense } = await import('./expenseService');
  const expense = await createExpense({
    type: 'shipping',
    amount: cost,
    description: `هزینه ارسال فاکتور ${invoice.invoiceNumber}`,
    date: invoice.shippedAt || invoice.approvedAt || new Date(),
    notes: `مشتری: ${invoice.customerName || '—'} · فروش ${invoice.invoiceNumber}`,
    affectsCash: true,
  });
  invoice.shippingExpenseId = expense._id as never;
  await invoice.save();
  return invoice;
}

export async function shipSale(
  invoiceId: string,
  opts?: {
    shippingNotes?: string;
    driverId?: string | null;
    shippingBy?: 'us' | 'customer' | 'none';
    shippingCost?: number;
  }
) {
  const invoice = await SaleInvoice.findById(invoiceId);
  if (!invoice) throw new Error('فاکتور یافت نشد');
  if (invoice.status !== 'approved' && invoice.status !== 'shipped') {
    throw new Error('ابتدا فاکتور باید تأیید شود');
  }
  if (!invoice.stockApplied) await applyStockAndMoney(invoice);
  invoice.status = 'shipped';
  invoice.shippedAt = new Date();

  const shippingNotes = opts?.shippingNotes;
  const driverId = opts?.driverId;
  if (shippingNotes !== undefined) invoice.shippingNotes = shippingNotes;
  if (opts?.shippingBy) invoice.shippingBy = opts.shippingBy;
  if (opts?.shippingCost != null) invoice.shippingCost = Math.max(0, Math.round(opts.shippingCost));

  if (driverId !== undefined) {
    if (driverId) {
      const { User } = await import('../models');
      const driver = await User.findById(driverId);
      if (!driver || driver.role !== 'driver') throw new Error('راننده معتبر نیست');
      invoice.driverId = driver._id as never;
    } else {
      invoice.driverId = undefined;
    }
  }
  await invoice.save();
  await maybeRecordShippingExpense(invoice);
  return invoice;
}

export async function cancelSale(invoiceId: string) {
  const invoice = await SaleInvoice.findById(invoiceId);
  if (!invoice) throw new Error('فاکتور یافت نشد');
  if (invoice.status === 'shipped') throw new Error('فاکتور ارسال‌شده قابل لغو نیست');
  if (invoice.stockApplied) throw new Error('فاکتور تأییدشده را از این مسیر لغو نکنید');
  invoice.status = 'cancelled';
  await invoice.save();
  return invoice;
}

/** برگشت اثر فروش روی موجودی/صندوق/بدهی (بدون حذف سند و بدون دست زدن به هزینه ارسال) */
async function reverseSaleEffects(invoice: InstanceType<typeof SaleInvoice>) {
  if (invoice.driverPaid) {
    throw new Error('به راننده پرداخت شده — ابتدا آن را برگردانید');
  }

  const debtors = await Debtor.find({ saleInvoiceId: invoice._id });
  for (const d of debtors) {
    if ((d.paidAmount || 0) > 0) {
      throw new Error('بدهی این فاکتور پرداخت جزئی دارد و قابل ویرایش/حذف نیست');
    }
  }

  if (invoice.stockApplied) {
    for (const item of invoice.items) {
      const product = await Product.findById(item.productId);
      if (!product) continue;
      const stockKg = product.stockKg ?? product.stock ?? 0;
      product.stockKg = stockKg + (item.qtyKg || 0);
      product.stock = product.stockKg;
      await product.save();
    }

    const txs = await CashTransaction.find({
      referenceId: invoice._id.toString(),
      referenceModel: 'SaleInvoice',
    });
    let cashDelta = 0;
    let cardDelta = 0;
    for (const tx of txs) {
      if (tx.type === 'sale_cash') cashDelta -= tx.amount;
      else if (tx.type === 'sale_card') cardDelta -= tx.amount;
      else if (tx.direction === 'in') cashDelta -= tx.amount;
      else cashDelta += tx.amount;
      await tx.deleteOne();
    }
    if (cashDelta !== 0 || cardDelta !== 0) {
      await updateBalances(cashDelta, cardDelta);
    }

    for (const d of debtors) {
      if (d.customerId && d.amount > 0) {
        await Customer.findByIdAndUpdate(d.customerId, { $inc: { totalCredit: -d.amount } });
      }
      await d.deleteOne();
    }

    invoice.stockApplied = false;
  } else {
    await Debtor.deleteMany({ saleInvoiceId: invoice._id });
  }

  try {
    const { reverseSaleCommission } = await import('./platformService');
    await reverseSaleCommission(invoice._id.toString());
  } catch (e) {
    console.warn('reverse commission failed', e);
  }
}

/** حذف کامل فاکتور فروش با رمز — برگشت موجودی، صندوق و بدهی */
export async function deleteSaleInvoice(invoiceId: string, password?: string) {
  const { assertDeletePassword } = await import('./expenseService');
  assertDeletePassword(password);

  const invoice = await SaleInvoice.findById(invoiceId);
  if (!invoice) throw new Error('فاکتور یافت نشد');

  await reverseSaleEffects(invoice);

  if (invoice.shippingExpenseId) {
    const { deleteExpense } = await import('./expenseService');
    try {
      await deleteExpense(invoice.shippingExpenseId.toString(), password);
    } catch {
      // اگر هزینه قبلاً حذف شده بود ادامه بده
    }
  }

  const id = invoice._id.toString();
  await invoice.deleteOne();
  return { ok: true, id };
}

/** ویرایش فاکتور فروش با رمز — برگشت اثر قبلی و اعمال مقادیر جدید */
export async function updateSaleInvoice(
  invoiceId: string,
  password: string | undefined,
  data: {
    customerName?: string;
    customerPhone?: string;
    customerAddress?: string;
    items: SaleItemInput[];
    paymentMethod: PaymentMethod;
    payment?: { cash?: number; card?: number; credit?: number };
    discount?: number;
    discountMode?: 'invoice' | 'per_kg' | 'product';
    discountPerKg?: number;
    notes?: string;
    date?: Date;
    dueDate?: Date;
    priceTier?: PriceTier;
  }
) {
  const { assertDeletePassword } = await import('./expenseService');
  assertDeletePassword(password);

  const invoice = await SaleInvoice.findById(invoiceId);
  if (!invoice) throw new Error('فاکتور یافت نشد');
  if (invoice.status === 'cancelled') throw new Error('فاکتور لغوشده قابل ویرایش نیست');
  if (!data.items?.length) throw new Error('حداقل یک قلم لازم است');

  const wasApplied = invoice.stockApplied;
  const marketerId = invoice.marketerId?.toString();
  const deliveryMode = (invoice as { deliveryMode?: 'company' | 'self' }).deliveryMode || 'company';

  await reverseSaleEffects(invoice);

  const date = data.date ? new Date(data.date) : invoice.date;
  validateTransactionDate(date);
  if (data.dueDate) invoice.dueDate = new Date(data.dueDate);
  const priceTier: PriceTier = data.priceTier || invoice.priceTier || 'retail';

  // قانون: مشتری عمده → فاکتور تکی مجاز نیست
  const custId = invoice.customerId?.toString() || undefined;
  if (priceTier === 'retail' && custId) {
    const preferred = await getCustomerPreferredTier(custId);
    if (preferred === 'wholesale') {
      throw new Error('این مشتری عمده است — صدور فاکتور تکی مجاز نیست');
    }
  }

  const checkStock = wasApplied || invoice.status !== 'pending';
  const settings = await getOrCreateSettings();
  const costBasis: CostBasis =
    settings.costBasis === 'weighted' || settings.costBasis === 'last' ? settings.costBasis : 'last';
  const { saleItems, totalAmount: rawTotal, totalCost, totalKg } = await buildSaleItems(
    data.items,
    priceTier,
    checkStock,
    costBasis
  );

  const discountMode = data.discountMode || invoice.discountMode || 'invoice';
  let discountPerKg = Math.max(0, data.discountPerKg ?? invoice.discountPerKg ?? 0);
  let discount = Math.max(0, data.discount ?? invoice.discount ?? 0);

  if (discountMode === 'per_kg') {
    if (discountPerKg <= 0 && discount > 0 && totalKg > 0) {
      discountPerKg = Math.round(discount / totalKg);
    }
    discount = Math.round(discountPerKg * totalKg);
  } else if (discountMode === 'product') {
    discount = Math.max(0, data.discount ?? 0);
  }

  let totalAmount = Math.max(0, rawTotal - discount);
  const totalProfit = totalAmount - totalCost;

  const payment = {
    cash: data.payment?.cash || 0,
    card: data.payment?.card || 0,
    credit: data.payment?.credit || 0,
  };

  if (data.paymentMethod === 'cash') payment.cash = totalAmount;
  else if (data.paymentMethod === 'card' || data.paymentMethod === 'card_to_card') payment.card = totalAmount;
  else if (data.paymentMethod === 'credit') payment.credit = totalAmount;
  else if (data.paymentMethod === 'mixed') {
    const sum = payment.cash + payment.card + payment.credit;
    if (sum === 0) payment.card = totalAmount;
    else if (Math.abs(sum - totalAmount) > 1) {
      const diff = totalAmount - sum;
      payment.credit = Math.max(0, payment.credit + diff);
      const sum2 = payment.cash + payment.card + payment.credit;
      if (Math.abs(sum2 - totalAmount) > 2) {
        throw new Error(
          `مجموع پرداخت (${sum.toLocaleString('fa-IR')}) با مبلغ فاکتور (${totalAmount.toLocaleString('fa-IR')}) برابر نیست`
        );
      }
    }
  }

  if (data.customerName !== undefined) invoice.customerName = data.customerName;
  if (data.customerPhone !== undefined) {
    invoice.customerPhone = data.customerPhone
      ? normalizePhoneDigits(data.customerPhone) || data.customerPhone
      : data.customerPhone;
  }
  if (data.customerAddress !== undefined) invoice.customerAddress = data.customerAddress;
  if (data.notes !== undefined) invoice.notes = data.notes;

  invoice.items = saleItems as never;
  invoice.totalAmount = totalAmount;
  invoice.totalCost = totalCost;
  invoice.totalProfit = totalProfit;
  invoice.totalKg = totalKg;
  invoice.paymentMethod = data.paymentMethod;
  invoice.payment = payment as never;
  invoice.discount = discount;
  invoice.discountMode = discountMode;
  invoice.discountPerKg = discountMode === 'per_kg' ? discountPerKg : 0;
  invoice.date = date;
  invoice.priceTier = priceTier;
  invoice.isPaid = payment.credit === 0;
  await invoice.save();

  if (wasApplied || invoice.status !== 'pending') {
    await applyStockAndMoney(invoice);
    if (marketerId) {
      try {
        const { creditSaleCommission } = await import('./platformService');
        await creditSaleCommission({
          marketerId,
          saleId: invoice._id.toString(),
          invoiceNumber: invoice.invoiceNumber,
          totalAmount: invoice.totalAmount,
          deliveryMode,
        });
      } catch (e) {
        console.warn('commission re-credit failed', e);
      }
    }
  }

  return invoice;
}

export function buildInvoiceHtml(invoice: InstanceType<typeof SaleInvoice>) {
  const tierLabel =
    invoice.priceTier === 'supermarket'
      ? 'سوپرمارکت'
      : invoice.priceTier === 'wholesale'
        ? 'عمده'
        : 'تکی';
  const statusLabel =
    invoice.status === 'pending'
      ? 'منتظر تأیید'
      : invoice.status === 'approved'
        ? 'تأیید شده'
        : invoice.status === 'shipped'
          ? 'ارسال شد'
          : invoice.status === 'delivered'
            ? 'تحویل شد'
            : invoice.status;

  const rows = invoice.items
    .map(
      (it) => `<tr>
      <td>${it.productName}${it.discount ? `<br/><small style="color:#c2410c">تخفیف قلم: ${it.discount.toLocaleString('fa-IR')}</small>` : ''}</td>
      <td>${it.qtyKg.toLocaleString('fa-IR')} کیلو</td>
      <td>${it.unitPricePerKg.toLocaleString('fa-IR')}</td>
      <td>${it.totalPrice.toLocaleString('fa-IR')}</td>
    </tr>`
    )
    .join('');

  const itemsDisc = invoice.items.reduce((s, it) => s + (it.discount || 0), 0);
  const modeLabel =
    invoice.discountMode === 'per_kg'
      ? `کیلویی (${(invoice.discountPerKg || 0).toLocaleString('fa-IR')} تومان/کیلو)`
      : invoice.discountMode === 'product'
        ? 'روی محصول'
        : 'کل فاکتور';

  return `<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8"/>
<title>فاکتور ${invoice.invoiceNumber}</title>
<style>
body{font-family:Tahoma,Arial,sans-serif;padding:24px;color:#111}
h1{font-size:20px;margin:0 0 8px}
.meta{color:#555;font-size:13px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;margin:16px 0}
th,td{border:1px solid #ddd;padding:8px;font-size:13px;text-align:right}
th{background:#f5f5f7}
.gold{color:#b45309}
.total{font-size:16px;font-weight:700;margin-top:12px}
.ship{margin-top:16px;padding:12px;background:#f5f5f7;border-radius:12px}
@media print{button{display:none}}
</style></head><body>
<button onclick="window.print()">چاپ / ذخیره PDF</button>
<h1 class="${invoice.isGolden ? 'gold' : ''}">${invoice.isGolden ? '⭐ فاکتور طلایی' : 'فاکتور فروش'} ${invoice.invoiceNumber}</h1>
<div class="meta">
وضعیت: ${statusLabel} · نوع قیمت: ${tierLabel}<br/>
مشتری: ${invoice.customerName || '—'} · تلفن: ${invoice.customerPhone || '—'}<br/>
آدرس: ${invoice.customerAddress || '—'}<br/>
${
  invoice.customerLat != null && invoice.customerLng != null
    ? `موقعیت: <a href="https://maps.google.com/?q=${invoice.customerLat},${invoice.customerLng}" target="_blank">باز کردن نقشه</a><br/>`
    : ''
}
تاریخ: ${new Date(invoice.date).toLocaleDateString('fa-IR')}<br/>
پرداخت: ${
  invoice.paymentMethod === 'cash'
    ? 'نقد'
    : invoice.paymentMethod === 'card'
      ? 'پوز / کارتخوان'
      : invoice.paymentMethod === 'card_to_card'
        ? 'کارت به کارت'
        : invoice.paymentMethod === 'credit'
          ? 'نسیه'
          : 'ترکیبی'
}
</div>
<table>
<thead><tr><th>محصول</th><th>مقدار</th><th>فی (تومان/کیلو)</th><th>جمع</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<div>تخفیف اقلام: ${itemsDisc.toLocaleString('fa-IR')} تومان</div>
<div>تخفیف فاکتور (${modeLabel}): ${(invoice.discount || 0).toLocaleString('fa-IR')} تومان</div>
${
  invoice.appliedOffer
    ? `<div class="ship" style="background:#fff7ed;border:1px solid #fdba74"><b>طرح / آفر:</b> ${invoice.appliedOffer}</div>`
    : ''
}
<div class="total">مبلغ نهایی: ${invoice.totalAmount.toLocaleString('fa-IR')} تومان</div>
<div>تناژ: ${invoice.totalKg.toLocaleString('fa-IR')} کیلو</div>
${invoice.shippingNotes ? `<div class="ship"><b>ارسال بار:</b><br/>${invoice.shippingNotes}</div>` : ''}
${
  invoice.shippingBy && invoice.shippingBy !== 'none'
    ? `<div class="ship"><b>ارسال:</b> ${
        invoice.shippingBy === 'us' ? 'با ما' : 'با مشتری'
      }${
        invoice.shippingCost
          ? ` · هزینه ${(invoice.shippingCost || 0).toLocaleString('fa-IR')} تومان`
          : ''
      }</div>`
    : ''
}
${invoice.notes ? `<div class="ship"><b>یادداشت:</b><br/>${invoice.notes}</div>` : ''}
</body></html>`;
}

export async function getSalePdfHtml(invoiceId: string) {
  const invoice = await SaleInvoice.findById(invoiceId);
  if (!invoice) throw new Error('فاکتور یافت نشد');
  return { html: buildInvoiceHtml(invoice), invoice };
}

export async function listSaleInvoices(opts?: {
  from?: Date;
  to?: Date;
  customerId?: string;
  marketerId?: string;
  driverId?: string;
  status?: SaleStatus;
}) {
  const filter: Record<string, unknown> = {};
  if (opts?.from || opts?.to) {
    filter.date = {};
    if (opts.from) (filter.date as Record<string, Date>).$gte = opts.from;
    if (opts.to) (filter.date as Record<string, Date>).$lte = opts.to;
  }
  if (opts?.customerId) filter.customerId = opts.customerId;
  if (opts?.marketerId) filter.marketerId = opts.marketerId;
  if (opts?.driverId) filter.driverId = opts.driverId;
  if (opts?.status) filter.status = opts.status;
  return SaleInvoice.find(filter).sort({ createdAt: -1 });
}

export async function recordDebtPayment(debtorId: string, amount: number, method: 'cash' | 'card' = 'cash') {
  const debtor = await Debtor.findById(debtorId);
  if (!debtor) throw new Error('بدهکار یافت نشد');

  debtor.paidAmount += amount;
  if (debtor.paidAmount >= debtor.amount) debtor.isSettled = true;
  await debtor.save();

  await CashTransaction.create({
    type: 'debt_payment',
    amount,
    direction: 'in',
    description: `دریافت بدهی ${debtor.name}`,
    referenceId: debtor._id.toString(),
    referenceModel: 'Debtor',
    date: new Date(),
  });

  await updateBalances(method === 'cash' ? amount : 0, method === 'card' ? amount : 0);

  if (debtor.saleInvoiceId) {
    await SaleInvoice.findByIdAndUpdate(debtor.saleInvoiceId, { isPaid: debtor.isSettled });
  }

  return debtor;
}
