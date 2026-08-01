import { toEnglishDigits, formatRial, parseAmount } from '../utils/format';

export type LocalIntent =
  | 'sale'
  | 'purchase'
  | 'expense'
  | 'sms'
  | 'dashboard'
  | 'debt'
  | 'card_deposit'
  | 'help'
  | 'unknown';

export interface LocalChatResult {
  text: string;
  intent: LocalIntent;
  confidence: number;
  entities: Record<string, string | number | boolean>;
  suggestedAction?: string;
}

interface PatternDef {
  intent: LocalIntent;
  patterns: RegExp[];
  weight: number;
}

const INTENT_PATTERNS: PatternDef[] = [
  {
    intent: 'sale',
    patterns: [/فروش|فروختم|فروخت|sell/i, /(\S+)\s+رو\s+فروختم/i, /به\s+(\S+)\s+فروختم/i],
    weight: 0.92,
  },
  {
    intent: 'purchase',
    patterns: [/خرید|خریدم|purchase|buy/i, /فاکتور\s*خرید/i],
    weight: 0.9,
  },
  {
    intent: 'expense',
    patterns: [
      /هزینه|expense/i,
      /حقوق|salary/i,
      /ارسال|باربری|shipping/i,
      /برداشت|withdraw/i,
      /قرض\s*داد|قرض\s*گرف/i,
      /اجاره|rent/i,
      /قبوض|آب|برق|گاز/i,
    ],
    weight: 0.88,
  },
  {
    intent: 'sms',
    patterns: [
      /بانک|bank/i,
      /کارت\s*\*+/i,
      /خرید\s*از\s*فروشگاه/i,
      /واریز|برداشت\s*از\s*حساب/i,
      /مانده\s*حساب/i,
      /sms/i,
    ],
    weight: 0.95,
  },
  {
    intent: 'dashboard',
    patterns: [
      /سود|profit/i,
      /فروش\s*امروز|فروش\s*روز/i,
      /داشبورد|dashboard|گزارش/i,
      /موجودی\s*صندوق/i,
      /چقدر\s*فروختم/i,
    ],
    weight: 0.85,
  },
  {
    intent: 'debt',
    patterns: [/بدهکار|نسیه\s*ها|credit|debt/i, /بده\s*داد|پرداخت\s*بدهی/i, /یادآوری/i],
    weight: 0.85,
  },
  {
    intent: 'card_deposit',
    patterns: [/کارت\s*خوان|کارتخوان|pos|واریز\s*کارتی|واریز\s*کارت/i],
    weight: 0.9,
  },
  {
    intent: 'help',
    patterns: [/help|راهنما|کمک|چیکار|چه\s*کار/i],
    weight: 0.7,
  },
];

const EXPENSE_TYPE_MAP: Array<{ type: string; patterns: RegExp[] }> = [
  { type: 'salary', patterns: [/حقوق/i] },
  { type: 'shipping', patterns: [/ارسال|بار|باربری/i] },
  { type: 'withdrawal', patterns: [/برداشت/i] },
  { type: 'loan_given', patterns: [/قرض\s*داد/i] },
  { type: 'loan_received', patterns: [/قرض\s*گرف/i] },
  { type: 'rent', patterns: [/اجاره/i] },
  { type: 'utilities', patterns: [/قبوض|آب|برق|گاز/i] },
];

/**
 * موتور LLM روی دستگاه:
 * scoring مبتنی بر الگو + استخراج موجودیت + حافظه مکالمه + تولید پاسخ قالبی
 */
export class OnDeviceLlm {
  private memory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private readonly maxMemory = 24;

  process(message: string): LocalChatResult {
    this.memory.push({ role: 'user', content: message });
    if (this.memory.length > this.maxMemory) this.memory.shift();

    const text = toEnglishDigits(message.trim());
    const { intent, confidence } = this.scoreIntent(text);
    const entities = this.extractEntities(text, intent);
    const response = this.generate(intent, entities, message);
    const suggestedAction = this.action(intent);

    this.memory.push({ role: 'assistant', content: response });
    return { text: response, intent, confidence, entities, suggestedAction };
  }

  private scoreIntent(text: string): { intent: LocalIntent; confidence: number } {
    let best: LocalIntent = 'unknown';
    let score = 0.25;

    for (const { intent, patterns, weight } of INTENT_PATTERNS) {
      let hits = 0;
      for (const p of patterns) {
        if (p.test(text)) hits += 1;
      }
      if (hits > 0) {
        const s = weight + Math.min(hits - 1, 2) * 0.03;
        if (s > score) {
          score = s;
          best = intent;
        }
      }
    }

    // context boost: اگر پیام قبلی فروش بود و کاربر فقط مبلغ گفت
    const lastUser = [...this.memory].reverse().find((m) => m.role === 'user' && m.content !== text);
    if (best === 'unknown' && lastUser && /فروش|خرید|هزینه|واریز/i.test(lastUser.content)) {
      if (parseAmount(text)) {
        best = /فروش/i.test(lastUser.content)
          ? 'sale'
          : /خرید/i.test(lastUser.content)
            ? 'purchase'
            : /واریز|کارتخوان/i.test(lastUser.content)
              ? 'card_deposit'
              : 'expense';
        score = 0.7;
      }
    }

    return { intent: best, confidence: Math.min(score, 0.98) };
  }

  private extractEntities(
    text: string,
    intent: LocalIntent
  ): Record<string, string | number | boolean> {
    const e: Record<string, string | number | boolean> = {};

    const amount = parseAmount(text);
    if (amount) e.amount = amount;

    const customer = text.match(/(?:به|برای)\s+([^\s\d۰-۹]+(?:\s+[^\s\d۰-۹]+)?)/i);
    if (customer) e.customerName = customer[1].trim();

    const phone = text.match(/(?:0|\+98)?9\d{9}/);
    if (phone) e.phone = phone[0];

    const product =
      text.match(/(?:فروش|خرید|فروختم)\s+(.+?)(?:\s+رو|\s+به|\s+\d|$)/i) ||
      text.match(/(.+?)\s+رو\s+(?:به\s+\S+\s+)?فروخ/i);
    if (product) e.productName = product[1].replace(/رو$/, '').trim();

    const qty =
      text.match(/(\d+(?:\.\d+)?)\s*(?:کیلو|kg)/i) ||
      text.match(/(\d+)\s*(?:بسته|عدد|تا|دانه)/i);
    if (qty) e.quantity = parseFloat(qty[1]);

    const packKg = text.match(/(?:قند\s*)?(\d+)\s*کیلویی/i);
    if (packKg) e.kgPerPackage = parseInt(packKg[1], 10);

    if (/نسیه|قسط|credit/i.test(text)) e.paymentMethod = 'credit';
    else if (/کارت\s*به\s*کارت|کارت‌به‌کارت|card[\s_-]?to[\s_-]?card/i.test(text))
      e.paymentMethod = 'card_to_card';
    else if (/کارت|card|pos|پوز|کارتخوان/i.test(text) && intent !== 'card_deposit')
      e.paymentMethod = 'card';
    else if (/نقد|cash/i.test(text)) e.paymentMethod = 'cash';

    const dateMatch = text.match(/(\d{4}[/-]\d{1,2}[/-]\d{1,2})/);
    if (dateMatch) e.date = dateMatch[1].replace(/\//g, '-');

    if (intent === 'expense') {
      for (const { type, patterns } of EXPENSE_TYPE_MAP) {
        if (patterns.some((p) => p.test(text))) {
          e.expenseType = type;
          break;
        }
      }
      if (!e.expenseType) e.expenseType = 'other';
    }

    return e;
  }

  private generate(
    intent: LocalIntent,
    e: Record<string, string | number | boolean>,
    raw: string
  ): string {
    const payLabels: Record<string, string> = {
      cash: 'نقد',
      card: 'پوز / کارتخوان',
      card_to_card: 'کارت به کارت',
      credit: 'نسیه',
      mixed: 'ترکیبی',
    };

    switch (intent) {
      case 'sale': {
        const lines = ['🧾 فاکتور فروش تشخیص داده شد:'];
        if (e.productName) lines.push(`• محصول: ${e.productName}`);
        if (e.quantity) lines.push(`• تعداد: ${e.quantity}`);
        if (e.customerName) lines.push(`• مشتری: ${e.customerName}`);
        if (e.amount) lines.push(`• مبلغ: ${formatRial(Number(e.amount))}`);
        if (e.paymentMethod) lines.push(`• پرداخت: ${payLabels[String(e.paymentMethod)] || e.paymentMethod}`);
        lines.push('', 'برای ثبت نهایی دکمه تأیید را بزنید.');
        return lines.join('\n');
      }
      case 'purchase': {
        const lines = ['🛒 فاکتور خرید تشخیص داده شد:'];
        if (e.productName) lines.push(`• محصول: ${e.productName}`);
        if (e.quantity) lines.push(`• تعداد: ${e.quantity}`);
        if (e.amount) lines.push(`• مبلغ واحد: ${formatRial(Number(e.amount))}`);
        lines.push('', 'برای ثبت نهایی دکمه تأیید را بزنید.');
        return lines.join('\n');
      }
      case 'expense':
        return `💸 هزینه تشخیص داده شد.\nنوع: ${e.expenseType || 'سایر'}\n${
          e.amount ? `مبلغ: ${formatRial(Number(e.amount))}` : 'مبلغ را مشخص کنید'
        }\n\nبرای ثبت، تأیید کنید.`;
      case 'sms':
        return `📱 پیامک بانکی شناسایی شد.\n${raw.slice(0, 120)}${raw.length > 120 ? '…' : ''}\n\nپس از تأیید، نوع تراکنش پارس و پیشنهاد ثبت می‌شود.`;
      case 'dashboard':
        return '📊 در حال دریافت گزارش امروز از سرور…';
      case 'debt':
        return '💳 در حال دریافت لیست بدهکاران و نسیه‌ها…';
      case 'card_deposit':
        return `💳 واریز کارت‌خوان\n${
          e.amount
            ? `مبلغ: ${formatRial(Number(e.amount))}\nآیا ثبت کنم؟`
            : 'مبلغ واریز را بگویید (مثلاً: واریز کارتخوان ۵ میلیون)'
        }`;
      case 'help':
        return `🤖 دستیار هوشمند آریو

می‌تونید بنویسید:
• «آیفون ۱۵ رو به علی ۴۰ میلیون نسیه فروختم»
• «خرید ۱۰ تا کاور هر کدوم ۵۰ هزار»
• «هزینه ارسال بار ۲۰۰ هزار»
• SMS بانکی را paste کنید
• «سود امروز»
• «بدهکارام رو نشون بده»
• «واریز کارتخوان ۵ میلیون»`;
      default:
        return 'متوجه نشدم 🤔 دقیق‌تر بگویید یا «راهنما» بنویسید.';
    }
  }

  private action(intent: LocalIntent): string | undefined {
    const map: Partial<Record<LocalIntent, string>> = {
      sale: 'create_sale',
      purchase: 'create_purchase',
      expense: 'create_expense',
      sms: 'process_sms',
      dashboard: 'fetch_dashboard',
      debt: 'fetch_debtors',
      card_deposit: 'card_deposit',
      help: 'none',
      unknown: 'none',
    };
    return map[intent];
  }

  clearMemory() {
    this.memory = [];
  }
}

export const onDeviceLlm = new OnDeviceLlm();
