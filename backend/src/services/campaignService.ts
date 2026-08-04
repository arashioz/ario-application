import { Campaign, ICampaign, ICampaignRule, Product, SaleInvoice } from '../models';
import { roundToman } from '../utils/persian';

export async function listCampaigns(opts?: { activeOnly?: boolean; forMarketer?: boolean }) {
  const filter: Record<string, unknown> = {};
  if (opts?.activeOnly) filter.active = true;
  if (opts?.forMarketer) filter.forMarketers = true;
  const now = new Date();
  const list = await Campaign.find(filter).sort({ updatedAt: -1 });
  if (!opts?.activeOnly) return list;
  return list.filter((c) => {
    if (c.startDate && c.startDate > now) return false;
    if (c.endDate && c.endDate < now) return false;
    return true;
  });
}

export async function createCampaign(data: Partial<ICampaign>) {
  if (!data.name?.trim()) throw new Error('نام جشنواره الزامی است');
  return Campaign.create({
    name: data.name.trim(),
    description: data.description,
    active: data.active !== false,
    forMarketers: data.forMarketers !== false,
    startDate: data.startDate,
    endDate: data.endDate,
    rules: data.rules || [],
    suggestedInvoice: data.suggestedInvoice,
  });
}

export async function updateCampaign(id: string, data: Partial<ICampaign>) {
  const c = await Campaign.findById(id);
  if (!c) throw new Error('جشنواره یافت نشد');
  if (data.name !== undefined) c.name = data.name.trim();
  if (data.description !== undefined) c.description = data.description;
  if (data.active !== undefined) c.active = data.active;
  if (data.forMarketers !== undefined) c.forMarketers = data.forMarketers;
  if (data.startDate !== undefined) c.startDate = data.startDate;
  if (data.endDate !== undefined) c.endDate = data.endDate;
  if (data.rules !== undefined) c.rules = data.rules;
  if (data.suggestedInvoice !== undefined) c.suggestedInvoice = data.suggestedInvoice;
  await c.save();
  return c;
}

export async function deleteCampaign(id: string) {
  const c = await Campaign.findById(id);
  if (!c) throw new Error('جشنواره یافت نشد');
  await c.deleteOne();
  return { ok: true, id };
}

export interface CartLineInput {
  productId: string;
  productName: string;
  unit: 'kg' | 'package';
  qtyInput: number;
  qtyKg: number;
  lineAmount: number;
  kgPerPackage?: number;
}

function lineMatchesReq(
  lines: CartLineInput[],
  nameContains?: string,
  productId?: string
): CartLineInput[] {
  return lines.filter((l) => {
    if (productId && l.productId === productId) return true;
    if (nameContains && l.productName.includes(nameContains)) return true;
    return false;
  });
}

function qtyInUnit(line: CartLineInput, unit: 'kg' | 'package'): number {
  if (unit === 'kg') return line.qtyKg;
  const kgPer = line.kgPerPackage || 5;
  if (line.unit === 'package') return line.qtyInput;
  return kgPer > 0 ? line.qtyKg / kgPer : 0;
}

function ruleMatches(
  rule: ICampaignRule,
  ctx: {
    lines: CartLineInput[];
    totalKg: number;
    totalAmount: number;
    paymentMethod?: string;
    customerInvoiceCount?: number;
    customerMonthKg?: number;
  }
): boolean {
  switch (rule.type) {
    case 'bundle': {
      const items = rule.bundleItems || [];
      if (!items.length) return false;
      return items.every((req) => {
        const matched = lineMatchesReq(ctx.lines, req.nameContains, req.productId?.toString());
        const sum = matched.reduce((s, l) => s + qtyInUnit(l, req.unit || 'package'), 0);
        return sum + 1e-6 >= req.qty;
      });
    }
    case 'volume_kg':
      return ctx.totalKg >= (rule.minKg || 0);
    case 'volume_amount':
      return ctx.totalAmount >= (rule.minAmount || 0);
    case 'payment_cash':
      return ctx.paymentMethod === 'cash' || ctx.paymentMethod === 'mixed';
    case 'payment_card':
      return (
        ctx.paymentMethod === 'card' ||
        ctx.paymentMethod === 'card_to_card' ||
        ctx.paymentMethod === 'mixed'
      );
    case 'loyalty': {
      const invOk = (ctx.customerInvoiceCount || 0) >= (rule.minInvoiceCount || 0);
      const kgOk = (ctx.customerMonthKg || 0) >= (rule.minMonthKg || 0);
      if (rule.minInvoiceCount && rule.minMonthKg) return invOk && kgOk;
      if (rule.minInvoiceCount) return invOk;
      if (rule.minMonthKg) return kgOk;
      return (ctx.customerInvoiceCount || 0) >= 3;
    }
    default:
      return false;
  }
}

function ruleLabel(rule: ICampaignRule): string {
  if (rule.label?.trim()) return rule.label.trim();
  switch (rule.type) {
    case 'bundle':
      return `پکیج جشنواره · ${rule.discountPercent}٪`;
    case 'volume_kg':
      return `خرید حجمی ≥${rule.minKg} کیلو · ${rule.discountPercent}٪`;
    case 'volume_amount':
      return `خرید مبلغی · ${rule.discountPercent}٪`;
    case 'payment_cash':
      return `پرداخت نقد · ${rule.discountPercent}٪`;
    case 'payment_card':
      return `پرداخت کارتی · ${rule.discountPercent}٪`;
    case 'loyalty':
      return `مشتری خوب · ${rule.discountPercent}٪`;
    default:
      return `${rule.discountPercent}٪ تخفیف`;
  }
}

/** ارزیابی جشنواره‌های فعال روی سبد */
export async function evaluateCampaigns(input: {
  lines: CartLineInput[];
  paymentMethod?: string;
  customerId?: string;
  role?: string;
}) {
  const campaigns = await listCampaigns({
    activeOnly: true,
    forMarketer: input.role === 'marketer' ? true : undefined,
  });

  const totalKg = input.lines.reduce((s, l) => s + (l.qtyKg || 0), 0);
  const totalAmount = input.lines.reduce((s, l) => s + (l.lineAmount || 0), 0);

  let customerInvoiceCount = 0;
  let customerMonthKg = 0;
  if (input.customerId) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const invs = await SaleInvoice.find({
      customerId: input.customerId,
      status: { $in: ['approved', 'shipped'] },
    })
      .select('date totalKg')
      .limit(100);
    customerInvoiceCount = invs.length;
    customerMonthKg = invs
      .filter((i) => new Date(i.date) >= monthStart)
      .reduce((s, i) => s + (i.totalKg || 0), 0);
  }

  const offers: Array<{
    campaignId: string;
    campaignName: string;
    ruleType: string;
    label: string;
    discountPercent: number;
    discountAmount: number;
    matched: boolean;
    hint?: string;
  }> = [];

  const suggested: Array<{
    campaignId: string;
    campaignName: string;
    title: string;
    note?: string;
    lines: Array<{
      productId?: string;
      productName: string;
      qty: number;
      unit: 'kg' | 'package';
      resolvedProductId?: string;
    }>;
  }> = [];

  for (const c of campaigns) {
    if (input.role === 'marketer' && !c.forMarketers) continue;

    for (const rule of c.rules || []) {
      const matched = ruleMatches(rule, {
        lines: input.lines,
        totalKg,
        totalAmount,
        paymentMethod: input.paymentMethod,
        customerInvoiceCount,
        customerMonthKg,
      });
      const discountAmount = matched
        ? roundToman((totalAmount * (rule.discountPercent || 0)) / 100)
        : 0;
      let hint = '';
      if (!matched) {
        if (rule.type === 'bundle') {
          hint = 'شرایط پکیج هنوز کامل نیست';
        } else if (rule.type === 'volume_kg') {
          hint = `حداقل ${rule.minKg} کیلو لازم است (الان ${Math.round(totalKg)})`;
        } else if (rule.type === 'volume_amount') {
          hint = `حداقل مبلغ لازم است`;
        } else if (rule.type === 'payment_cash') {
          hint = 'روش پرداخت را نقد کن';
        } else if (rule.type === 'loyalty') {
          hint = 'این مشتری هنوز شرایط وفاداری را ندارد';
        }
      }
      offers.push({
        campaignId: c._id.toString(),
        campaignName: c.name,
        ruleType: rule.type,
        label: ruleLabel(rule),
        discountPercent: rule.discountPercent,
        discountAmount,
        matched,
        hint: hint || undefined,
      });
    }

    if (c.suggestedInvoice?.lines?.length) {
      const resolvedLines = [];
      for (const line of c.suggestedInvoice.lines) {
        let resolvedProductId = line.productId?.toString();
        if (!resolvedProductId && line.productName) {
          const p = await Product.findOne({
            name: { $regex: line.productName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' },
          });
          if (p) resolvedProductId = p._id.toString();
        }
        resolvedLines.push({
          productId: line.productId?.toString(),
          productName: line.productName,
          qty: line.qty,
          unit: line.unit || 'package',
          resolvedProductId,
        });
      }
      suggested.push({
        campaignId: c._id.toString(),
        campaignName: c.name,
        title: c.suggestedInvoice.title || `پیشنهاد ${c.name}`,
        note: c.suggestedInvoice.note,
        lines: resolvedLines,
      });
    }
  }

  // بهترین پیشنهاد matched
  const matchedOffers = offers.filter((o) => o.matched).sort((a, b) => b.discountAmount - a.discountAmount);
  const best = matchedOffers[0] || null;

  return {
    campaigns: campaigns.map((c) => ({
      id: c._id,
      name: c.name,
      description: c.description,
      suggestedInvoice: c.suggestedInvoice,
    })),
    offers,
    matchedOffers,
    best,
    suggestedInvoices: suggested,
    cart: { totalKg, totalAmount },
  };
}
