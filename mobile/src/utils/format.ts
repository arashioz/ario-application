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

/** جداکننده هزارگان فارسی — مبالغ سیستم به تومان است */
export function formatGrouped(amount: number): string {
  return new Intl.NumberFormat('fa-IR').format(Math.round(amount || 0));
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

/** فقط ارقام خام (بدون جداکننده) */
export function digitsOnly(text: string): string {
  return toEnglishDigits(text).replace(/[^\d]/g, '');
}

/** نمایش مبلغ با جداکننده هنگام تایپ */
export function formatMoneyInput(text: string): string {
  const d = digitsOnly(text);
  if (!d) return '';
  return formatGrouped(parseInt(d, 10));
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

export function todayIso(): string {
  return new Date().toISOString().split('T')[0];
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
      perKg: kgPerPackage > 0 ? Math.round(price / kgPerPackage) : price,
    };
  }
  return { perKg: price, perPackage: Math.round(price * kgPerPackage) };
}
