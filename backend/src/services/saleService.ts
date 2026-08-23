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
import { startOfDay, roundToman } from '../utils/persian';

/** تاریخ فاکتور قبل از امروز محلی */
function isPastInvoiceDate(date: Date): boolean {
  return startOfDay(date).getTime() < startOfDay(new Date()).getTime();
}

/**
 * فقط فروش تکی صف ارسال ندارد (حتی با تاریخ گذشته).
 * عمده/سوپرمارکت — امروز یا قبل — باید در «آماده ارسال» بمانند تا روند ارسال نشکند.
 */
function shouldSkipShippingQueue(invoice: InstanceType<typeof SaleInvoice>): boolean {
  const tier = (invoice.priceTier || 'retail') as PriceTier;
  return tier === 'retail';
}

async function autoShipIfNoQueue(invoice: InstanceType<typeof SaleInvoice>) {
  if (!shouldSkipShippingQueue(invoice)) return invoice;
  if (invoice.status === 'pending' || invoice.status === 'cancelled' || invoice.status === 'inactive') {
    return invoice;
  }
  if (invoice.status === 'shipped' || invoice.status === 'delivered') return invoice;
  invoice.status = 'shipped';
  invoice.shippedAt =
    invoice.date && isPastInvoiceDate(invoice.date) ? invoice.date : new Date();
  if (!invoice.shippingBy) invoice.shippingBy = 'none';
  await invoice.save();
  return invoice;
}

function pushPaymentEvent(
  invoice: InstanceType<typeof SaleInvoice>,
  ev: {
    amount: number;
    method: 'cash' | 'card' | 'card_to_card';
    date: Date;
    kind: 'invoice' | 'credit_settle';
    note?: string;
  }
) {
  if (ev.amount <= 0) return;
  if (!Array.isArray(invoice.paymentEvents)) invoice.paymentEvents = [];
  invoice.paymentEvents.push(ev);
  invoice.markModified('paymentEvents');
}

function seedInvoicePaymentEvents(
  invoice: InstanceType<typeof SaleInvoice>,
  payment: { cash: number; card: number; credit: number },
  method: PaymentMethod,
  at: Date
) {
  const cardMethod: 'card' | 'card_to_card' =
    method === 'card_to_card' ? 'card_to_card' : 'card';
  if (payment.cash > 0) {
    pushPaymentEvent(invoice, {
      amount: payment.cash,
      method: 'cash',
      date: at,
      kind: 'invoice',
      note: 'پرداخت هنگام ثبت فاکتور',
    });
  }
  if (payment.card > 0) {
    pushPaymentEvent(invoice, {
      amount: payment.card,
      method: cardMethod,
      date: at,
      kind: 'invoice',
      note: 'پرداخت هنگام ثبت فاکتور',
    });
  }
  if (payment.cash + payment.card > 0) invoice.lastPaymentAt = at;
  if (payment.credit === 0) {
    invoice.paidAt = invoice.paidAt || at;
    invoice.isPaid = true;
  }
}

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
    let unitPricePerPackage = roundToman(pricing.salePricePerPackage, 100);
    let gross = roundToman(unitPricePerKg * qtyKg, 100);

    if (item.unitPrice != null) {
      const resolved = resolveLineAmount({
        unit,
        unitPrice: roundToman(item.unitPrice, 100),
        qtyInput,
        kgPerPackage,
      });
      unitPricePerKg = roundToman(resolved.unitPricePerKg, 100);
      unitPricePerPackage = roundToman(resolved.unitPricePerPackage, 100);
      gross = roundToman(resolved.totalPrice, 100);
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
  /** اگر نسیه با چک بوده */
  creditIsCheck?: boolean;
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
        creditIsCheck: data.creditIsCheck === true && payment.credit > 0,
        priceTier,
        isGolden,
        status,
        deliveryMode: data.deliveryMode === 'self' ? 'self' : 'company',
        stockApplied: false,
        approvedAt: requiresApproval ? undefined : new Date(),
        paymentEvents: [],
      });
      break;
    } catch (err: unknown) {
      const code = (err as { code?: number })?.code;
      if (code !== 11000 || attempt === 4) throw err;
    }
  }
  if (!invoice) throw new Error('ثبت فاکتور فروش ناموفق بود');

  seedInvoicePaymentEvents(invoice, payment, data.paymentMethod, date);
  await invoice.save();

  if (invoice.creditIsCheck && payment.credit > 0) {
    try {
      const { createCheckReminder } = await import('./checkService');
      const due = data.dueDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await createCheckReminder({
        payerName: customerName || 'مشتری',
        customerId: customerId || undefined,
        invoiceId: invoice._id.toString(),
        invoiceNumber: invoice.invoiceNumber,
        amount: payment.credit,
        dueDate: due,
        notes: 'ثبت خودکار از فاکتور نسیه — چک داده',
        createdBy: data.marketerId,
      });
    } catch (e) {
      console.warn('auto check reminder failed', e);
    }
  }

  if (!requiresApproval) {
    await applyStockAndMoney(invoice);
    await autoShipIfNoQueue(invoice);
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
    shippingBy?: 'us' | 'courier' | 'customer' | 'none';
    shippingCost?: number;
    shippingDiscount?: number;
    shippingDescription?: string;
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
  if (opts?.shippingDiscount != null) invoice.shippingDiscount = Math.max(0, Math.round(opts.shippingDiscount));
  if (opts?.shippingDescription !== undefined) invoice.shippingDescription = opts.shippingDescription.trim() || undefined;

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
  await applyShippingSideEffects(invoice);
  await autoShipIfNoQueue(invoice);

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

/** هزینه ارسال روی مبلغ فاکتور و مانده مشتری */
async function applyShippingChargeToInvoice(
  invoice: InstanceType<typeof SaleInvoice>,
  cost: number
) {
  const amount = Math.max(0, Math.round(cost || 0));
  if (amount <= 0) return invoice;
  if (invoice.shippingChargedOnInvoice) return invoice;

  invoice.totalAmount = Math.round((invoice.totalAmount || 0) + amount);
  const pay = {
    cash: invoice.payment?.cash || 0,
    card: invoice.payment?.card || 0,
    credit: invoice.payment?.credit || 0,
  };
  pay.credit += amount;
  invoice.payment = pay as never;
  invoice.isPaid = pay.credit === 0;
  invoice.shippingChargedOnInvoice = true;

  const debtor = await Debtor.findOne({ saleInvoiceId: invoice._id, isSettled: false });
  if (debtor) {
    debtor.amount = Math.round((debtor.amount || 0) + amount);
    await debtor.save();
  } else {
    await Debtor.create({
      name: invoice.customerName || 'مشتری نسیه',
      phone: invoice.customerPhone,
      customerId: invoice.customerId,
      amount: pay.credit,
      paidAmount: 0,
      dueDate: invoice.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      saleInvoiceId: invoice._id,
      description: `بدهی فاکتور ${invoice.invoiceNumber} (شامل هزینه ارسال)`,
    });
  }
  if (invoice.customerId) {
    await Customer.findByIdAndUpdate(invoice.customerId, { $inc: { totalCredit: amount } });
  }
  return invoice;
}

async function applyShippingSideEffects(invoice: InstanceType<typeof SaleInvoice>) {
  if (invoice.shippingBy === 'courier' || invoice.shippingBy === 'us') {
    const charge = Math.max(0, (invoice.shippingCost || 0) - (invoice.shippingDiscount || 0));
    await applyShippingChargeToInvoice(invoice, charge);
  }
  return invoice;
}
async function settleInvoiceCreditOnShip(
  invoice: InstanceType<typeof SaleInvoice>,
  method: 'cash' | 'card' | 'card_to_card'
) {
  const debtors = await Debtor.find({ saleInvoiceId: invoice._id, isSettled: false });
  let remaining = 0;
  for (const d of debtors) {
    remaining += Math.max(0, (d.amount || 0) - (d.paidAmount || 0));
  }
  if (remaining <= 0) {
    remaining = Math.max(0, Math.round(invoice.payment?.credit || 0));
  }
  if (remaining <= 0) {
    invoice.isPaid = true;
    if (!invoice.paidAt) invoice.paidAt = new Date();
    return invoice;
  }

  const now = new Date();
  for (const d of debtors) {
    const rem = Math.max(0, (d.amount || 0) - (d.paidAmount || 0));
    if (rem <= 0) continue;
    d.paidAmount = d.amount;
    d.isSettled = true;
    if (!Array.isArray(d.payments)) d.payments = [];
    d.payments.push({
      amount: rem,
      method,
      date: now,
      note: `تسویه هنگام ارسال`,
    });
    await d.save();
  }

  const isCash = method === 'cash';
  const methodLabel =
    method === 'cash' ? 'نقد' : method === 'card_to_card' ? 'کارت به کارت' : 'پوز';
  await CashTransaction.create({
    type: isCash ? 'sale_cash' : 'sale_card',
    amount: remaining,
    direction: 'in',
    description: `تسویه نسیه هنگام ارسال ${invoice.invoiceNumber} (${methodLabel})`,
    referenceId: invoice._id.toString(),
    referenceModel: 'SaleInvoice',
    date: now,
  });
  await updateBalances(isCash ? remaining : 0, isCash ? 0 : remaining);

  if (invoice.customerId) {
    await Customer.findByIdAndUpdate(invoice.customerId, { $inc: { totalCredit: -remaining } });
  }

  const pay = {
    cash: Math.round(invoice.payment?.cash || 0),
    card: Math.round(invoice.payment?.card || 0),
    credit: Math.round(invoice.payment?.credit || 0),
  };
  if (isCash) pay.cash += remaining;
  else pay.card += remaining;
  pay.credit = Math.max(0, pay.credit - remaining);
  invoice.payment = pay as never;

  if (pay.credit > 0) {
    invoice.paymentMethod = 'mixed';
  } else if (pay.cash > 0 && pay.card > 0) {
    invoice.paymentMethod = 'mixed';
  } else if (pay.cash > 0) {
    invoice.paymentMethod = 'cash';
  } else if (method === 'card_to_card') {
    invoice.paymentMethod = 'card_to_card';
  } else {
    invoice.paymentMethod = 'card';
  }

  invoice.isPaid = pay.credit === 0;
  invoice.paidAt = now;
  invoice.lastPaymentAt = now;
  pushPaymentEvent(invoice, {
    amount: remaining,
    method,
    date: now,
    kind: 'credit_settle',
    note: 'تسویه نسیه هنگام ارسال',
  });
  return invoice;
}

export async function shipSale(
  invoiceId: string,
  opts?: {
    shippingNotes?: string;
    driverId?: string | null;
    shippingBy?: 'us' | 'courier' | 'customer' | 'none';
    shippingCost?: number;
    shippingDiscount?: number;
    shippingDescription?: string;
    /** پرداخت‌شده → نسیه کم شود | نسیه → بماند */
    settlement?: 'paid' | 'credit';
    /** اگر پرداخت‌شده: نقد / پوز / کارت به کارت */
    settleMethod?: 'cash' | 'card' | 'card_to_card';
  }
) {
  const invoice = await SaleInvoice.findById(invoiceId);
  if (!invoice) throw new Error('فاکتور یافت نشد');
  if (invoice.status !== 'approved' && invoice.status !== 'shipped') {
    throw new Error('ابتدا فاکتور باید تأیید شود');
  }
  if (!invoice.stockApplied) await applyStockAndMoney(invoice);
  invoice.status = 'shipped';
  invoice.shippedAt = invoice.shippedAt || new Date();

  const shippingNotes = opts?.shippingNotes;
  const driverId = opts?.driverId;
  if (shippingNotes !== undefined) invoice.shippingNotes = shippingNotes;
  if (opts?.shippingBy) invoice.shippingBy = opts.shippingBy;
  if (opts?.shippingCost != null) invoice.shippingCost = Math.max(0, Math.round(opts.shippingCost));
  if (opts?.shippingDiscount != null) invoice.shippingDiscount = Math.max(0, Math.round(opts.shippingDiscount));
  if (opts?.shippingDescription !== undefined) invoice.shippingDescription = opts.shippingDescription.trim() || undefined;

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

  const settlement = opts?.settlement || 'credit';
  if (settlement === 'paid') {
    const method = opts?.settleMethod || 'cash';
    if (method !== 'cash' && method !== 'card' && method !== 'card_to_card') {
      throw new Error('روش دریافت نامعتبر است');
    }
    await settleInvoiceCreditOnShip(invoice, method);
  }

  await invoice.save();
  await applyShippingSideEffects(invoice);
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
    const debtPays = await CashTransaction.find({
      type: 'debt_payment',
      referenceId: d._id.toString(),
      referenceModel: 'Debtor',
    });
    let cashDelta = 0;
    let cardDelta = 0;
    for (const tx of debtPays) {
      if (tx.direction === 'in') {
        const method = tx.paymentMethod;
        const desc = String(tx.description || '');
        if (
          method === 'card' ||
          method === 'card_to_card' ||
          desc.includes('پوز') ||
          desc.includes('کارت')
        ) {
          cardDelta -= tx.amount;
        } else {
          cashDelta -= tx.amount;
        }
      }
      await tx.deleteOne();
    }
    if (cashDelta !== 0 || cardDelta !== 0) {
      await updateBalances(cashDelta, cardDelta);
    }

    // پرداخت‌های قبلی از totalCredit کم شده؛ فقط مانده باز را برگردان
    if (invoice.stockApplied && d.customerId) {
      const remaining = Math.max(0, (d.amount || 0) - (d.paidAmount || 0));
      if (remaining > 0) {
        await Customer.findByIdAndUpdate(d.customerId, { $inc: { totalCredit: -remaining } });
      }
    }
    await d.deleteOne();
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

    invoice.stockApplied = false;
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
  await assertDeletePassword(password);

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

/**
 * غیرفعال کردن فاکتور ارسال‌نشده — سند می‌ماند (تاریخچه مشتری)
 * ولی از محاسبات فروش/سود/انبار خارج می‌شود (برگشت اثر موجودی و صندوق)
 */
export async function deactivateSaleInvoice(invoiceId: string, password?: string) {
  const { assertDeletePassword } = await import('./expenseService');
  await assertDeletePassword(password);

  const invoice = await SaleInvoice.findById(invoiceId);
  if (!invoice) throw new Error('فاکتور یافت نشد');
  if (invoice.status === 'inactive') return invoice;
  if (invoice.status === 'shipped' || invoice.status === 'delivered') {
    throw new Error('فاکتور ارسال/تحویل‌شده را نمی‌توان غیرفعال کرد');
  }
  if (invoice.status === 'cancelled') {
    throw new Error('فاکتور لغوشده است');
  }

  await reverseSaleEffects(invoice);

  if (invoice.shippingExpenseId) {
    const { deleteExpense } = await import('./expenseService');
    try {
      await deleteExpense(invoice.shippingExpenseId.toString(), password);
      invoice.shippingExpenseId = undefined;
    } catch {
      /* ignore */
    }
  }

  invoice.status = 'inactive';
  invoice.notes = invoice.notes
    ? `${invoice.notes}\n[غیرفعال شد — از محاسبات خارج]`
    : '[غیرفعال شد — از محاسبات خارج]';
  await invoice.save();
  return invoice;
}

/** غیرفعال کردن همه فاکتورهای ارسال‌نشده (pending + approved) */
export async function deactivateUnshippedSales(password?: string) {
  const { assertDeletePassword } = await import('./expenseService');
  await assertDeletePassword(password);

  const list = await SaleInvoice.find({
    status: { $in: ['pending', 'approved'] },
  }).select('_id');

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const row of list) {
    try {
      await deactivateSaleInvoice(row._id.toString(), password);
      results.push({ id: row._id.toString(), ok: true });
    } catch (e) {
      results.push({
        id: row._id.toString(),
        ok: false,
        error: e instanceof Error ? e.message : 'خطا',
      });
    }
  }
  return {
    total: list.length,
    deactivated: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

/** ویرایش فاکتور فروش با رمز — برگشت اثر قبلی و اعمال مقادیر جدید */
export async function updateSaleInvoice(
  invoiceId: string,
  password: string | undefined,
  data: {
    customerName?: string;
    customerPhone?: string;
    customerAddress?: string;
    clearCustomer?: boolean;
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
  await assertDeletePassword(password);

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

  if (data.clearCustomer && priceTier === 'retail') {
    invoice.customerId = undefined;
    invoice.customerName = '';
    invoice.customerPhone = '';
    invoice.customerAddress = '';
  } else {
    if (data.customerName !== undefined) {
      invoice.customerName = data.customerName;
      if (!String(data.customerName || '').trim() && priceTier === 'retail' && !invoice.customerId) {
        invoice.customerPhone = '';
        invoice.customerAddress = '';
      }
    }
    if (data.customerPhone !== undefined) {
      invoice.customerPhone = data.customerPhone
        ? normalizePhoneDigits(data.customerPhone) || data.customerPhone
        : data.customerPhone;
    }
    if (data.customerAddress !== undefined) invoice.customerAddress = data.customerAddress;
  }

  // قانون: مشتری عمده → فاکتور تکی مجاز نیست (فقط اگر هنوز به مشتری لینک است)
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
      // اگر نسیه را صفر کرده‌اند، باقی‌مانده را دوباره نسیه نکن
      if (payment.credit <= 0) {
        payment.cash = Math.max(0, payment.cash + diff);
      } else {
        payment.credit = Math.max(0, payment.credit + diff);
      }
      const sum2 = payment.cash + payment.card + payment.credit;
      if (Math.abs(sum2 - totalAmount) > 2) {
        throw new Error(
          `مجموع پرداخت (${sum.toLocaleString('fa-IR')}) با مبلغ فاکتور (${totalAmount.toLocaleString('fa-IR')}) برابر نیست`
        );
      }
    }
  }

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

  const productRows = invoice.items
    .map(
      (it) => `<tr>
      <td>${it.productName}${it.discount ? `<br/><small style="color:#c2410c">تخفیف قلم: ${it.discount.toLocaleString('fa-IR')}</small>` : ''}</td>
      <td>${it.qtyKg.toLocaleString('fa-IR')} کیلو</td>
      <td>${it.unitPricePerKg.toLocaleString('fa-IR')}</td>
      <td>${it.totalPrice.toLocaleString('fa-IR')}</td>
    </tr>`
    )
    .join('');
  const shippingCharge = Math.max(0, (invoice.shippingCost || 0) - (invoice.shippingDiscount || 0));
  const shippingRow =
    invoice.shippingChargedOnInvoice && shippingCharge > 0
      ? `<tr><td>ارسال${invoice.shippingDescription ? ` — ${invoice.shippingDescription}` : ''}</td><td>۱</td><td>${shippingCharge.toLocaleString('fa-IR')}</td><td>${shippingCharge.toLocaleString('fa-IR')}</td></tr>`
      : '';
  const rows = productRows + shippingRow;

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
        invoice.shippingBy === 'us'
          ? 'با ما'
          : invoice.shippingBy === 'courier'
            ? 'پیک (روی فاکتور)'
            : 'با مشتری'
      }${
        invoice.shippingCost
          ? ` · هزینه ${(invoice.shippingCost || 0).toLocaleString('fa-IR')} تومان${
            invoice.shippingChargedOnInvoice ? ' (روی فاکتور)' : ''
            }${invoice.shippingDiscount ? ` · تخفیف ${(invoice.shippingDiscount || 0).toLocaleString('fa-IR')} تومان` : ''}`
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
  /** صف ارسال: فقط سوپرمارکت/عمده (+ تکیِ در انتظار تأیید) */
  shippingQueue?: boolean;
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
  if (opts?.shippingQueue) {
    // تکی‌ها صف ارسال ندارند؛ فقط اگر هنوز pending باشند برای تأیید می‌آیند
    filter.$or = [
      { priceTier: { $in: ['supermarket', 'wholesale'] } },
      { priceTier: 'retail', status: 'pending' },
      { priceTier: { $exists: false }, status: 'pending' },
    ];
  }
  return SaleInvoice.find(filter).sort({ date: -1, createdAt: -1 });
}

export async function recordDebtPayment(
  debtorId: string,
  amount: number,
  method: 'cash' | 'card' | 'card_to_card' = 'cash'
) {
  const debtor = await Debtor.findById(debtorId);
  if (!debtor) throw new Error('بدهکار یافت نشد');

  const payAmount = Math.round(amount || 0);
  if (payAmount <= 0) throw new Error('مبلغ نامعتبر است');

  const now = new Date();
  const methodLabel =
    method === 'cash' ? 'نقد' : method === 'card_to_card' ? 'کارت به کارت' : 'پوز';

  debtor.paidAmount += payAmount;
  if (debtor.paidAmount >= debtor.amount) debtor.isSettled = true;
  if (!Array.isArray(debtor.payments)) debtor.payments = [];
  debtor.payments.push({
    amount: payAmount,
    method,
    date: now,
    note: methodLabel,
  });
  await debtor.save();

  await CashTransaction.create({
    type: 'debt_payment',
    amount: payAmount,
    direction: 'in',
    description: `دریافت بدهی ${debtor.name} (${methodLabel})`,
    referenceId: debtor._id.toString(),
    referenceModel: 'Debtor',
    date: now,
  });

  const isCash = method === 'cash';
  await updateBalances(isCash ? payAmount : 0, isCash ? 0 : payAmount);

  if (debtor.saleInvoiceId) {
    const inv = await SaleInvoice.findById(debtor.saleInvoiceId);
    if (inv) {
      const pay = {
        cash: Math.round(inv.payment?.cash || 0),
        card: Math.round(inv.payment?.card || 0),
        credit: Math.round(inv.payment?.credit || 0),
      };
      if (isCash) pay.cash += payAmount;
      else pay.card += payAmount;
      pay.credit = Math.max(0, pay.credit - payAmount);
      inv.payment = pay as never;
      inv.lastPaymentAt = now;
      inv.isPaid = debtor.isSettled || pay.credit === 0;
      if (inv.isPaid) inv.paidAt = now;
      if (pay.credit === 0) {
        if (pay.cash > 0 && pay.card > 0) inv.paymentMethod = 'mixed';
        else if (pay.cash > 0) inv.paymentMethod = 'cash';
        else if (method === 'card_to_card') inv.paymentMethod = 'card_to_card';
        else inv.paymentMethod = 'card';
      } else {
        inv.paymentMethod = 'mixed';
      }
      pushPaymentEvent(inv, {
        amount: payAmount,
        method,
        date: now,
        kind: 'credit_settle',
        note: methodLabel,
      });
      await inv.save();
    }
  }

  if (debtor.customerId && payAmount > 0) {
    await Customer.findByIdAndUpdate(debtor.customerId, { $inc: { totalCredit: -payAmount } });
  }

  return debtor;
}

export async function updateDebtor(
  id: string,
  data: { dueDate?: Date; description?: string; name?: string; phone?: string }
) {
  const d = await Debtor.findById(id);
  if (!d) throw new Error('بدهکار یافت نشد');
  if (data.dueDate) d.dueDate = data.dueDate;
  if (data.description !== undefined) d.description = data.description;
  if (data.name?.trim()) d.name = data.name.trim();
  if (data.phone !== undefined) d.phone = data.phone || undefined;
  await d.save();

  // سررسید روی فاکتور هم هم‌خوان شود تا در نسیه‌ها دیده شود
  if (data.dueDate && d.saleInvoiceId) {
    await SaleInvoice.findByIdAndUpdate(d.saleInvoiceId, { dueDate: data.dueDate });
  }

  return d;
}

/** دریافت روی کل بدهی مشتری — از قدیمی‌ترین فاکتور */
export async function recordCustomerDebtPayment(opts: {
  customerId?: string;
  name?: string;
  phone?: string;
  amount: number;
  method?: 'cash' | 'card' | 'card_to_card';
}) {
  const amount = Math.round(opts.amount || 0);
  if (amount <= 0) throw new Error('مبلغ نامعتبر است');

  const filter: Record<string, unknown> = { isSettled: false };
  if (opts.customerId) filter.customerId = opts.customerId;
  else if (opts.name?.trim()) {
    filter.name = opts.name.trim();
    if (opts.phone) filter.phone = opts.phone;
  } else {
    throw new Error('مشتری مشخص نیست');
  }

  const debts = await Debtor.find(filter).sort({ dueDate: 1, createdAt: 1 });
  if (!debts.length) throw new Error('بدهی بازی برای این مشتری نیست');

  let left = amount;
  const applied: Array<{ id: string; paid: number }> = [];
  for (const d of debts) {
    if (left <= 0) break;
    const rem = Math.max(0, d.amount - (d.paidAmount || 0));
    if (rem <= 0) continue;
    const pay = Math.min(rem, left);
    await recordDebtPayment(d._id.toString(), pay, opts.method || 'cash');
    applied.push({ id: d._id.toString(), paid: pay });
    left -= pay;
  }

  return {
    requested: amount,
    applied: amount - left,
    leftover: left,
    payments: applied,
  };
}
