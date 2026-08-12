import { formatToman, formatKg, formatDate, normalizePhone } from './format';

export type ShareInvoiceItem = {
  productName: string;
  qtyKg?: number;
  qtyInput?: number;
  unit?: 'kg' | 'package';
  unitPricePerKg?: number;
  totalPrice?: number;
  discount?: number;
};

export type ShareInvoiceInput = {
  invoiceNumber?: string;
  customerName?: string;
  customerPhone?: string;
  date?: string | Date;
  totalAmount: number;
  totalKg?: number;
  discount?: number;
  paymentMethod?: string;
  isGolden?: boolean;
  appliedOffer?: string;
  items?: ShareInvoiceItem[];
  shopName?: string;
  /** تفکیک پرداخت برای گزارش نسیه */
  payment?: { cash?: number; card?: number; credit?: number };
  isPaid?: boolean;
};

const PAY_LABEL: Record<string, string> = {
  cash: 'نقد',
  card: 'پوز / کارتخوان',
  card_to_card: 'کارت به کارت',
  credit: 'نسیه',
  mixed: 'ترکیبی',
};

/** متن قابل کپی برای ارسال فاکتور به مشتری / بدهی */
export function buildInvoiceShareText(
  inv: ShareInvoiceInput,
  opts?: {
    defaultCard?: {
      label: string;
      cardNumber: string;
      accountHolder?: string;
      bankName?: string;
    };
  }
): string {
  const lines: string[] = [];
  const title = inv.isGolden ? '⭐ فاکتور طلایی' : 'فاکتور فروش';
  lines.push(`${title} ${inv.invoiceNumber || ''}`.trim());
  if (inv.shopName) lines.push(inv.shopName);
  lines.push('────────────');
  if (inv.customerName) lines.push(`مشتری: ${inv.customerName}`);
  if (inv.customerPhone) lines.push(`موبایل: ${inv.customerPhone}`);
  if (inv.date) lines.push(`تاریخ: ${formatDate(inv.date)}`);
  if (inv.paymentMethod) {
    lines.push(`پرداخت: ${PAY_LABEL[inv.paymentMethod] || inv.paymentMethod}`);
  }
  if (inv.items?.length) {
    lines.push('────────────');
    lines.push('اقلام:');
    for (const it of inv.items) {
      const qty =
        it.unit === 'package' && it.qtyInput
          ? `${it.qtyInput} بسته`
          : formatKg(it.qtyKg || 0);
      const price =
        it.unitPricePerKg != null ? ` · ${formatToman(it.unitPricePerKg)}/کیلو` : '';
      const total = it.totalPrice != null ? ` = ${formatToman(it.totalPrice)}` : '';
      lines.push(`• ${it.productName} · ${qty}${price}${total}`);
    }
  }
  lines.push('────────────');
  if (inv.discount) lines.push(`تخفیف: ${formatToman(inv.discount)}`);
  if (inv.appliedOffer) lines.push(inv.appliedOffer);
  if (inv.totalKg != null) lines.push(`تناژ: ${formatKg(inv.totalKg)}`);
  lines.push(`مبلغ فاکتور: ${formatToman(inv.totalAmount)}`);

  const cash = Math.round(inv.payment?.cash || 0);
  const card = Math.round(inv.payment?.card || 0);
  const credit = Math.round(inv.payment?.credit || 0);
  const paid = cash + card;
  if (inv.payment || paid > 0 || credit > 0) {
    const paidParts: string[] = [];
    if (cash > 0) paidParts.push(`نقد ${formatToman(cash)}`);
    if (card > 0) paidParts.push(`کارت/پوز ${formatToman(card)}`);
    lines.push(
      `پرداخت‌شده: ${formatToman(paid)}${paidParts.length ? ` (${paidParts.join(' + ')})` : ''}`
    );
    lines.push(`مانده نسیه: ${formatToman(credit)}`);
    if (inv.isPaid || credit <= 0) lines.push('وضعیت: تسویه‌شده ✅');
    else lines.push('وضعیت: نسیه باز');
  } else {
    lines.push(`مبلغ نهایی: ${formatToman(inv.totalAmount)}`);
  }

  lines.push('────────────');
  lines.push('با تشکر 🙏');

  const settled = inv.isPaid === true || (inv.payment != null && credit <= 0);
  const bankCard = opts?.defaultCard;
  if (!settled && bankCard?.cardNumber) {
    const spaced = bankCard.cardNumber.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
    const due = credit > 0 ? credit : inv.totalAmount;
    lines.push('');
    lines.push('💳 کارت مقصد برای واریز');
    if (bankCard.bankName) lines.push(`بانک: ${bankCard.bankName}`);
    lines.push(`به نام: ${bankCard.accountHolder || bankCard.label}`);
    lines.push(`شماره کارت: ${spaced}`);
    lines.push(`مبلغ: ${formatToman(due)}`);
    lines.push('لطفاً پس از واریز رسید را ارسال کنید.');
  }

  return lines.join('\n');
}

/** اولین کارت پیش‌فرض تنظیمات (یا اولین کارت) */
export function pickDefaultBankCard<T extends { isDefault?: boolean }>(cards: T[]): T | undefined {
  if (!cards?.length) return undefined;
  return cards.find((c) => c.isDefault) || cards[0];
}

/** متن کارت‌به‌کارت برای ارسال به مشتری */
export function buildCardTransferText(opts: {
  cardLabel: string;
  cardNumber: string;
  accountHolder?: string;
  bankName?: string;
  amount: number;
  invoiceNumber?: string;
  customerName?: string;
}): string {
  const spaced = opts.cardNumber.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
  const lines = [
    '💳 پرداخت کارت به کارت',
    opts.bankName ? `بانک: ${opts.bankName}` : '',
    `به نام: ${opts.accountHolder || opts.cardLabel}`,
    `شماره کارت: ${spaced}`,
    `مبلغ: ${formatToman(opts.amount)}`,
    opts.invoiceNumber ? `فاکتور: ${opts.invoiceNumber}` : '',
    opts.customerName ? `مشتری: ${opts.customerName}` : '',
    '',
    'لطفاً پس از واریز رسید را ارسال کنید.',
  ].filter(Boolean);
  return lines.join('\n');
}

/** فاکتور تسویه‌شده — کارت بانکی در متن پیامک/کپی نیاید */
export function invoiceIsSettled(inv: {
  isPaid?: boolean;
  payment?: { credit?: number };
}): boolean {
  if (inv.isPaid === true) return true;
  if (!inv.payment) return false;
  return Math.round(Number(inv.payment.credit) || 0) <= 0;
}

/** باز کردن پیامک با متن فاکتور */
export function openSmsComposer(phone: string | undefined, body: string): boolean {
  const digits = normalizePhone(phone);
  if (!digits) return false;
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const href = ios
    ? `sms:${digits}&body=${encodeURIComponent(body)}`
    : `sms:${digits}?body=${encodeURIComponent(body)}`;
  window.location.href = href;
  return true;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}
