/** نرمال‌سازی نام محصول برای جلوگیری از تکرار */
export function normalizeProductName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\u200c\u200f\u202a-\u202e]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/ی/g, 'ي')
    .replace(/ک/g, 'ك')
    .replace(/iphone/gi, 'iphone')
    .replace(/آیفون/g, 'iphone')
    .replace(/ایفون/g, 'iphone');
}

/** تبدیل اعداد فارسی/عربی به انگلیسی */
export function persianToEnglishDigits(input: string): string {
  const map: Record<string, string> = {
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
    '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  };
  return input.replace(/[۰-۹٠-٩]/g, (d) => map[d] ?? d);
}

/** استخراج مبلغ از متن (ریال/تومان) */
export function extractAmount(text: string): number | null {
  const normalized = persianToEnglishDigits(text);
  const patterns = [
    /(\d[\d,.\s]*)\s*(?:میلیون|million)/i,
    /(\d[\d,.\s]*)\s*(?:هزار|thousand)/i,
    /(\d[\d,.\s]*)\s*(?:ریال|rial)/i,
    /(\d[\d,.\s]*)\s*(?:تومان|toman)/i,
    /(?:مبلغ|amount)[:\s]*(\d[\d,.\s]*)/i,
    /(\d{1,3}(?:,\d{3})+)/,
    /(\d{4,})/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      const raw = match[1].replace(/[,\s.]/g, '');
      let amount = parseInt(raw, 10);
      if (isNaN(amount)) continue;

      if (/میلیون|million/i.test(normalized)) amount *= 1_000_000;
      else if (/هزار|thousand/i.test(normalized)) amount *= 1_000;
      else if (/تومان|toman/i.test(normalized)) amount *= 10;

      return amount;
    }
  }
  return null;
}

export function formatRial(amount: number): string {
  return new Intl.NumberFormat('fa-IR').format(amount) + ' ریال';
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** رند مبلغ تومان به پلهٔ تمیز */
export function roundToman(amount: number, step?: number): number {
  const n = Math.max(0, Math.round(Number(amount) || 0));
  if (n === 0) return 0;
  const s = step ?? (n < 10_000 ? 100 : n < 100_000 ? 1_000 : 10_000);
  return Math.round(n / s) * s;
}

/** رند تخفیف کیلویی → ۱۰۰ / ۲۰۰ / ۵۰۰ */
export function roundPerKgDiscount(amount: number): number {
  const n = Math.max(0, Number(amount) || 0);
  if (n <= 0) return 0;
  if (n < 150) return 100;
  if (n < 350) return 200;
  if (n < 750) return 500;
  return Math.round(n / 100) * 100;
}

export function isValidBackdate(date: Date, openingDate: Date): boolean {
  const now = new Date();
  return date >= startOfDay(openingDate) && date <= now;
}
