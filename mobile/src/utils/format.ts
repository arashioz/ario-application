/** تبدیل اعداد فارسی به انگلیسی */
export function toEnglishDigits(input: string): string {
  const map: Record<string, string> = {
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
    '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  };
  return input.replace(/[۰-۹٠-٩]/g, (d) => map[d] ?? d);
}

/** جداکننده هزارگان فارسی — فقط برای نمایش (لیبل)، نه داخل اینپوت */
export function formatGrouped(amount: number): string {
  return new Intl.NumberFormat('fa-IR').format(Math.round(amount || 0));
}

/** جداکننده انگلیسی — برای فیلدهای ورودی تا رقم همیشه لاتین باشد */
export function formatGroupedEn(amount: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(amount || 0));
}

/**
 * رند مبلغ تومان به پلهٔ تمیز (حذف خرده‌ها)
 * زیر ۱۰هزار → ۱۰۰ | زیر ۱۰۰هزار → ۱۰۰۰ | بالاتر → ۱۰هزار
 */
export function roundToman(amount: number, step?: number): number {
  const n = Math.max(0, Math.round(Number(amount) || 0));
  if (n === 0) return 0;
  const s = step ?? (n < 10_000 ? 100 : n < 100_000 ? 1_000 : 10_000);
  return Math.round(n / s) * s;
}

/** رند تخفیف کیلویی → ۱۰۰ / ۲۰۰ / ۵۰۰ / پلهٔ ۱۰۰ */
export function roundPerKgDiscount(amount: number): number {
  const n = Math.max(0, Number(amount) || 0);
  if (n <= 0) return 0;
  if (n < 150) return 100;
  if (n < 350) return 200;
  if (n < 750) return 500;
  return Math.round(n / 100) * 100;
}

/** قیمت فروش از درصد — رند به نزدیک‌ترین ۱۰۰ تومان */
export function priceFromPercent(cost: number, percent: number): number {
  return roundToman(cost * (1 + (percent || 0) / 100), 100);
}

/** درصد سود بدون خرده (عدد صحیح) */
export function roundProfitPercent(pct: number): number {
  return Math.round(Number(pct) || 0);
}

/** قیمت واحد فروش — رند به ۱۰۰ تومان تا خرده نماند */
export function saleUnitPrice(perKg: number, unit: 'kg' | 'package', kgPerPackage = 5): number {
  if (unit === 'package') return roundToman(perKg * (kgPerPackage || 5), 100);
  return roundToman(perKg, 100);
}

export function formatToman(amount: number): string {
  return formatGrouped(amount) + ' تومان';
}

/** سازگاری با کد قدیمی — همان تومان */
export function formatRial(amount: number): string {
  return formatToman(amount);
}

export function formatKg(kg: number): string {
  return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 }).format(kg || 0) + ' کیلو';
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('fa-IR');
}

/** جستجوی فاکتور: نام / مبلغ / تاریخ / شماره فاکتور / موبایل */
export function matchesInvoiceSearch(
  q: string,
  row: {
    invoiceNumber?: string;
    customerName?: string;
    customerPhone?: string;
    supplier?: string;
    totalAmount?: number;
    date?: string | Date;
  }
): boolean {
  const raw = toEnglishDigits(q || '').trim();
  if (!raw) return true;
  const needle = raw.toLowerCase();
  const digits = digitsOnly(raw);

  const name = String(row.customerName || row.supplier || '').toLowerCase();
  const phone = digitsOnly(row.customerPhone || '');
  const invNo = toEnglishDigits(String(row.invoiceNumber || '')).toLowerCase();
  const amount = String(Math.round(row.totalAmount || 0));
  const amountGrouped = amount.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  let dateFa = '';
  let dateIso = '';
  if (row.date) {
    const d = new Date(row.date);
    if (!Number.isNaN(d.getTime())) {
      dateFa = d.toLocaleDateString('fa-IR');
      dateIso = d.toISOString().slice(0, 10); // YYYY-MM-DD
    }
  }

  if (name.includes(needle)) return true;
  if (invNo.includes(needle)) return true;
  if (digits) {
    if (phone.includes(digits)) return true;
    if (amount.includes(digits)) return true;
    if (amountGrouped.includes(digits)) return true;
    if (digitsOnly(dateFa).includes(digits)) return true;
    if (dateIso.replace(/-/g, '').includes(digits)) return true;
    if (dateIso.includes(needle)) return true;
  }
  if (dateFa.includes(raw) || dateFa.includes(needle)) return true;
  if (dateIso.includes(needle)) return true;
  return false;
}

export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleString('fa-IR', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** فقط ارقام خام (بدون جداکننده) */
export function digitsOnly(text: string): string {
  return toEnglishDigits(text).replace(/[^\d]/g, '');
}

/**
 * نرمال‌سازی شماره موبایل — ارقام فارسی→انگلیسی، حذف فاصله، +98 → 0
 * تا ۰۹۱۲… فارسی و 0912… انگلیسی یکی شوند و تکراری ساخته نشود
 */
export function normalizePhone(raw?: string): string {
  if (!raw) return '';
  let s = toEnglishDigits(String(raw)).trim();
  s = s.replace(/[^\d+]/g, '');
  if (s.startsWith('+98')) s = '0' + s.slice(3);
  if (s.startsWith('98') && s.length >= 12) s = '0' + s.slice(2);
  // فقط ارقام لاتین نگه دار
  return s.replace(/[^\d]/g, '');
}

/** ورودی اعشاری/عدد صحیح با تبدیل ارقام فارسی — مثل ۰.۲ یا ۰٫۲ */
export function sanitizeNumberInput(
  text: string,
  opts?: { decimal?: boolean; maxLen?: number }
): string {
  let s = toEnglishDigits(text || '');
  // اعشار فارسی و ویرگول → نقطه؛ جداکننده هزارگان فارسی را حذف کن
  s = s.replace(/٫/g, '.').replace(/,/g, '.').replace(/٬/g, '');
  if (opts?.decimal) {
    s = s.replace(/[^\d.]/g, '');
    const parts = s.split('.');
    if (parts.length > 2) s = parts[0] + '.' + parts.slice(1).join('');
  } else {
    s = s.replace(/[^\d]/g, '');
  }
  if (opts?.maxLen && s.length > opts.maxLen) s = s.slice(0, opts.maxLen);
  return s;
}

/** نمایش مبلغ با جداکننده هنگام تایپ — ارقام همیشه انگلیسی */
export function formatMoneyInput(text: string): string {
  const d = digitsOnly(text);
  if (!d) return '';
  return formatGroupedEn(parseInt(d, 10));
}

/**
 * پارس مبلغ تومان از متن (با جداکننده / میلیون / هزار)
 */
export function parseAmount(text: string): number | null {
  const normalized = toEnglishDigits(text).trim();
  if (!normalized) return null;
  const million = normalized.match(/([\d,.\s٬،]+)\s*(?:میلیون|m)/i);
  if (million) {
    const n = parseFloat(million[1].replace(/[,٬،\s]/g, ''));
    return isNaN(n) ? null : Math.round(n * 1_000_000);
  }
  const thousand = normalized.match(/([\d,.\s٬،]+)\s*(?:هزار|k)/i);
  if (thousand) {
    const n = parseFloat(thousand[1].replace(/[,٬،\s]/g, ''));
    return isNaN(n) ? null : Math.round(n * 1_000);
  }
  const cleaned = digitsOnly(normalized);
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? null : num;
}

/** تاریخ محلی امروز به‌صورت YYYY-MM-DD (نه UTC — در ایران یک روز عقب نمی‌افتد) */
export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** اول ماه جاری محلی */
export function monthStartIso(ref = new Date()): string {
  const y = ref.getFullYear();
  const m = String(ref.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

/** N روز قبل از امروز (محلی) */
export function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - Math.max(0, days));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function resolveQty(unit: 'kg' | 'package', qty: number, kgPerPackage: number) {
  const kpp = kgPerPackage > 0 ? kgPerPackage : 5;
  if (unit === 'package') {
    const packages = Math.round(qty);
    return { qtyKg: packages * kpp, qtyPackages: packages };
  }
  const packages = kpp > 0 ? Math.round((qty / kpp) * 100) / 100 : 0;
  const packagesRounded = kpp > 0 ? Math.round(qty / kpp) : 0;
  return { qtyKg: qty, qtyPackages: packages, packagesRounded };
}

/** از کیلو → بسته گرد‌شده (مثلاً ۲۵۰ کیلو با بسته ۵ = ۵۰ بسته) */
export function kgToPackages(kg: number, kgPerPackage: number): number {
  const kpp = kgPerPackage > 0 ? kgPerPackage : 5;
  return Math.round(kg / kpp);
}

/** از بسته → کیلو */
export function packagesToKg(packages: number, kgPerPackage: number): number {
  const kpp = kgPerPackage > 0 ? kgPerPackage : 5;
  return Math.round(packages) * kpp;
}

export function resolvePrices(unit: 'kg' | 'package', price: number, kgPerPackage: number) {
  if (unit === 'package') {
    return {
      perPackage: price,
      // بدون گرد کردن میانی — جمع قلم از قیمت واردشده محاسبه می‌شود
      perKg: kgPerPackage > 0 ? price / kgPerPackage : price,
    };
  }
  return { perKg: price, perPackage: Math.round(price * kgPerPackage) };
}

/**
 * جمع دقیق یک قلم فاکتور خرید/فروش.
 * اگر قیمت بر اساس بسته باشد، جمع = قیمت بسته × تعداد بسته (بدون خطای ±۱ از تقسیم/ضرب کیلو).
 */
export function resolveLineAmount(
  unit: 'kg' | 'package',
  unitPrice: number,
  qtyInput: number,
  kgPerPackage: number
): { qtyKg: number; qtyPackages: number; perKg: number; perPackage: number; lineAmount: number } {
  const { qtyKg, qtyPackages } = resolveQty(unit, qtyInput, kgPerPackage);
  if (unit === 'package') {
    const lineAmount = Math.round(unitPrice * qtyPackages);
    const perKg = qtyKg > 0 ? lineAmount / qtyKg : 0;
    return { qtyKg, qtyPackages, perKg, perPackage: unitPrice, lineAmount };
  }
  const lineAmount = Math.round(unitPrice * qtyKg);
  return {
    qtyKg,
    qtyPackages,
    perKg: unitPrice,
    perPackage: Math.round(unitPrice * (kgPerPackage > 0 ? kgPerPackage : 5)),
    lineAmount,
  };
}

export type InvoicePeriod = 'today' | 'yesterday' | 'week' | 'month' | 'all';

export const INVOICE_PERIODS: Array<{ value: InvoicePeriod; label: string }> = [
  { value: 'today', label: 'امروز' },
  { value: 'yesterday', label: 'دیروز' },
  { value: 'week', label: 'این هفته' },
  { value: 'month', label: 'این ماه' },
  { value: 'all', label: 'همه' },
];

/** بازه تاریخ برای فیلتر فاکتور (ISO) */
export function periodRange(period: InvoicePeriod): { from?: string; to?: string } {
  if (period === 'all') return {};
  const start = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const end = (d: Date) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  };
  const now = new Date();
  if (period === 'today') {
    return { from: start(now).toISOString(), to: end(now).toISOString() };
  }
  if (period === 'yesterday') {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    return { from: start(y).toISOString(), to: end(y).toISOString() };
  }
  if (period === 'week') {
    const from = start(now);
    const day = from.getDay(); // 0=Sun
    const diff = (day + 6) % 7; // Monday as start
    from.setDate(from.getDate() - diff);
    return { from: from.toISOString(), to: end(now).toISOString() };
  }
  // month
  const from = start(new Date(now.getFullYear(), now.getMonth(), 1));
  return { from: from.toISOString(), to: end(now).toISOString() };
}
