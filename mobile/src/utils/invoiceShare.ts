import { formatToman, formatKg, formatDate } from './format';

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
};

const PAY_LABEL: Record<string, string> = {
  cash: 'نقد',
  card: 'پوز / کارتخوان',
  card_to_card: 'کارت به کارت',
  credit: 'نسیه',
  mixed: 'ترکیبی',
};

/** متن قابل کپی برای ارسال فاکتور به مشتری */
export function buildInvoiceShareText(inv: ShareInvoiceInput): string {
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
  lines.push(`مبلغ نهایی: ${formatToman(inv.totalAmount)}`);
  lines.push('────────────');
  lines.push('با تشکر 🙏');
  return lines.join('\n');
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
