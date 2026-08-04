import { User, SaleInvoice } from '../models';
import { persianToEnglishDigits } from '../utils/persian';

export async function listDrivers() {
  return User.find({ role: 'driver', active: true })
    .select('name username lastLat lastLng lastLocationAt workActive walletBalance cardNumber')
    .sort({ name: 1 });
}

export async function updateStaffLocation(
  userId: string,
  lat: number,
  lng: number,
  opts?: { workActive?: boolean }
) {
  const user = await User.findById(userId);
  if (!user) throw new Error('کاربر یافت نشد');
  if (user.role !== 'driver' && user.role !== 'marketer') {
    throw new Error('فقط راننده یا بازاریاب');
  }
  user.lastLat = lat;
  user.lastLng = lng;
  user.lastLocationAt = new Date();
  if (opts?.workActive !== undefined) user.workActive = opts.workActive;
  await user.save();
  return {
    id: user._id.toString(),
    name: user.name,
    role: user.role,
    lat,
    lng,
    workActive: user.workActive,
    at: user.lastLocationAt,
  };
}

export async function setWorkActive(userId: string, active: boolean) {
  const user = await User.findById(userId);
  if (!user) throw new Error('کاربر یافت نشد');
  if (user.role !== 'marketer' && user.role !== 'driver') {
    throw new Error('فقط بازاریاب یا راننده');
  }
  user.workActive = active;
  await user.save();
  return {
    id: user._id.toString(),
    name: user.name,
    role: user.role,
    workActive: user.workActive,
    lat: user.lastLat,
    lng: user.lastLng,
    at: user.lastLocationAt,
  };
}

/** سازگاری با API قبلی راننده */
export async function updateDriverLocation(driverId: string, lat: number, lng: number) {
  return updateStaffLocation(driverId, lat, lng, { workActive: true });
}

export async function getDriverLocations() {
  const drivers = await User.find({
    role: 'driver',
    active: true,
    lastLat: { $ne: null },
    lastLng: { $ne: null },
  }).select('name username lastLat lastLng lastLocationAt workActive');

  return drivers.map((d) => ({
    id: d._id.toString(),
    name: d.name,
    username: d.username,
    role: 'driver' as const,
    lat: d.lastLat!,
    lng: d.lastLng!,
    workActive: d.workActive,
    at: d.lastLocationAt,
  }));
}

/** موقعیت زنده راننده‌ها + بازاریاب‌های در حال کار */
export async function getLiveStaffLocations() {
  const staff = await User.find({
    active: true,
    role: { $in: ['driver', 'marketer'] },
    lastLat: { $ne: null },
    lastLng: { $ne: null },
    $or: [{ role: 'driver' }, { workActive: true }],
  }).select('name username role lastLat lastLng lastLocationAt workActive');

  return staff.map((d) => ({
    id: d._id.toString(),
    name: d.name,
    username: d.username,
    role: d.role as 'driver' | 'marketer',
    lat: d.lastLat!,
    lng: d.lastLng!,
    workActive: !!d.workActive,
    at: d.lastLocationAt,
  }));
}

export async function assignSaleDriver(invoiceId: string, driverId?: string | null) {
  const invoice = await SaleInvoice.findById(invoiceId);
  if (!invoice) throw new Error('فاکتور یافت نشد');
  if (invoice.status === 'cancelled') throw new Error('فاکتور لغو شده');

  if (!driverId) {
    invoice.driverId = undefined;
    await invoice.save();
    return invoice;
  }

  const driver = await User.findById(driverId);
  if (!driver || driver.role !== 'driver' || !driver.active) {
    throw new Error('راننده معتبر نیست');
  }
  invoice.driverId = driver._id as never;
  await invoice.save();
  return invoice;
}

export async function listDriverJobs(driverId: string, status?: string) {
  const filter: Record<string, unknown> = { driverId };
  if (status) filter.status = status;
  else filter.status = { $in: ['approved', 'shipped', 'delivered'] };
  return SaleInvoice.find(filter).sort({ updatedAt: -1 }).limit(100);
}

/** راننده: تحویل شد → هزینه ارسال به کیف پولش */
export async function deliverSale(invoiceId: string, driverId: string) {
  const invoice = await SaleInvoice.findById(invoiceId);
  if (!invoice) throw new Error('فاکتور یافت نشد');
  if (!invoice.driverId || invoice.driverId.toString() !== driverId) {
    throw new Error('این فاکتور به شما ارجاع نشده');
  }
  if (invoice.status === 'cancelled') throw new Error('فاکتور لغو شده');
  if (invoice.status === 'pending') throw new Error('فاکتور هنوز تأیید نشده');
  if (invoice.status === 'delivered' && invoice.deliveredAt) {
    return { invoice, walletBalance: (await User.findById(driverId))?.walletBalance || 0, credited: 0 };
  }
  if (invoice.status !== 'shipped' && invoice.status !== 'approved') {
    throw new Error('وضعیت فاکتور برای تحویل مناسب نیست');
  }

  const driver = await User.findById(driverId);
  if (!driver || driver.role !== 'driver') throw new Error('راننده معتبر نیست');

  invoice.status = 'delivered';
  invoice.deliveredAt = new Date();
  invoice.deliveredBy = driver._id as never;
  if (!invoice.shippedAt) invoice.shippedAt = invoice.deliveredAt;

  let credit = 0;
  if (!(invoice.driverEarned > 0) && invoice.shippingBy === 'us') {
    credit = Math.max(0, Math.round(invoice.shippingCost || 0));
    if (credit > 0) {
      invoice.driverEarned = credit;
      driver.walletBalance = (driver.walletBalance || 0) + credit;
      await driver.save();
    }
  }

  await invoice.save();
  return {
    invoice,
    credited: credit,
    walletBalance: driver.walletBalance || 0,
  };
}

/** ادمین: پرداخت طلب یک فاکتور تحویل‌شده به راننده */
export async function payDriverForInvoice(invoiceId: string, adminId?: string) {
  const invoice = await SaleInvoice.findById(invoiceId);
  if (!invoice) throw new Error('فاکتور یافت نشد');
  if (invoice.status !== 'delivered') throw new Error('اول باید تحویل شده باشد');
  if (invoice.driverPaid) throw new Error('قبلاً به راننده پرداخت شده');
  if (!invoice.driverId) throw new Error('راننده مشخص نیست');

  const amount = Math.round(invoice.driverEarned || invoice.shippingCost || 0);
  if (amount <= 0) {
    invoice.driverPaid = true;
    invoice.driverPaidAt = new Date();
    invoice.driverPaidAmount = 0;
    await invoice.save();
    return { invoice, paid: 0 };
  }

  const driver = await User.findById(invoice.driverId);
  if (!driver) throw new Error('راننده یافت نشد');

  const wallet = driver.walletBalance || 0;
  if (wallet + 1 < amount) {
    throw new Error(`موجودی کیف پول راننده کافی نیست (${wallet.toLocaleString('fa-IR')})`);
  }

  driver.walletBalance = Math.max(0, wallet - amount);
  await driver.save();

  const { createExpense } = await import('./expenseService');
  const expense = await createExpense({
    type: 'shipping',
    amount,
    description: `پرداخت ارسال به راننده ${driver.name} · ${invoice.invoiceNumber}`,
    date: new Date(),
    notes: `کارت: ${driver.cardNumber || '—'} · فاکتور ${invoice.invoiceNumber}${
      adminId ? ` · ادمین ${adminId}` : ''
    }`,
    affectsCash: true,
  });
  invoice.shippingExpenseId = expense._id as never;
  invoice.driverPaid = true;
  invoice.driverPaidAt = new Date();
  invoice.driverPaidAmount = amount;
  await invoice.save();

  return {
    invoice,
    paid: amount,
    walletBalance: driver.walletBalance,
    cardNumber: driver.cardNumber,
    driverName: driver.name,
  };
}

/** پرداخت مبلغ از کیف پول راننده */
export async function payDriverWallet(data: {
  driverId: string;
  amount: number;
  notes?: string;
  adminId?: string;
}) {
  const amount = Math.round(data.amount || 0);
  if (amount <= 0) throw new Error('مبلغ نامعتبر است');

  const driver = await User.findById(data.driverId);
  if (!driver || driver.role !== 'driver') throw new Error('راننده معتبر نیست');

  const wallet = driver.walletBalance || 0;
  if (wallet + 1 < amount) {
    throw new Error(`موجودی کیف پول ${wallet.toLocaleString('fa-IR')} تومان است`);
  }

  driver.walletBalance = Math.max(0, wallet - amount);
  await driver.save();

  const { createExpense } = await import('./expenseService');
  await createExpense({
    type: 'shipping',
    amount,
    description: `پرداخت کیف پول راننده ${driver.name}`,
    date: new Date(),
    notes: `کارت: ${driver.cardNumber || '—'} · ${data.notes || ''}`.trim(),
    affectsCash: true,
  });

  let remaining = amount;
  const unpaid = await SaleInvoice.find({
    driverId: driver._id,
    status: 'delivered',
    driverPaid: { $ne: true },
    driverEarned: { $gt: 0 },
  }).sort({ deliveredAt: 1 });

  for (const inv of unpaid) {
    if (remaining <= 0) break;
    const due = Math.round(inv.driverEarned || 0);
    if (due <= 0) continue;
    if (due <= remaining + 1) {
      inv.driverPaid = true;
      inv.driverPaidAt = new Date();
      inv.driverPaidAmount = due;
      remaining -= due;
      await inv.save();
    }
  }

  return {
    driverId: driver._id.toString(),
    driverName: driver.name,
    cardNumber: driver.cardNumber,
    paid: amount,
    walletBalance: driver.walletBalance,
  };
}

export async function updateDriverProfile(
  userId: string,
  data: { cardNumber?: string; name?: string },
  opts?: { asAdmin?: boolean; targetUserId?: string }
) {
  const id = opts?.asAdmin && opts.targetUserId ? opts.targetUserId : userId;
  const user = await User.findById(id);
  if (!user) throw new Error('کاربر یافت نشد');
  if (!opts?.asAdmin && user._id.toString() !== userId) {
    throw new Error('دسترسی ندارید');
  }
  if (data.cardNumber !== undefined) {
    user.cardNumber = persianToEnglishDigits(String(data.cardNumber))
      .replace(/[^\d]/g, '')
      .trim();
  }
  if (data.name?.trim()) user.name = data.name.trim();
  await user.save();
  return {
    id: user._id.toString(),
    name: user.name,
    username: user.username,
    role: user.role,
    cardNumber: user.cardNumber || '',
    walletBalance: user.walletBalance || 0,
  };
}

export async function getDriverProfile(userId: string) {
  const user = await User.findById(userId).select('name username role cardNumber walletBalance');
  if (!user) throw new Error('کاربر یافت نشد');
  return {
    id: user._id.toString(),
    name: user.name,
    username: user.username,
    role: user.role,
    cardNumber: user.cardNumber || '',
    walletBalance: user.walletBalance || 0,
  };
}

export async function listDriverPayoutsPending() {
  const invoices = await SaleInvoice.find({
    status: 'delivered',
    driverPaid: { $ne: true },
    driverEarned: { $gt: 0 },
  })
    .sort({ deliveredAt: -1 })
    .limit(100);

  const drivers = await listDrivers();
  return { invoices, drivers };
}
