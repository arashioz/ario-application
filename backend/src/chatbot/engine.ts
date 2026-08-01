import { extractAmount, persianToEnglishDigits, formatRial } from '../utils/persian';

export type ChatIntent =
  | 'sale'
  | 'purchase'
  | 'expense'
  | 'sms'
  | 'dashboard'
  | 'debt'
  | 'card_deposit'
  | 'help'
  | 'unknown';

export interface ParsedIntent {
  intent: ChatIntent;
  confidence: number;
  entities: Record<string, string | number | boolean>;
  rawText: string;
}

const INTENT_PATTERNS: Array<{ intent: ChatIntent; patterns: RegExp[]; weight: number }> = [
  {
    intent: 'sale',
    patterns: [
      /فروش|فروختم|فروخت|sell/i,
      /(\S+)\s+رو\s+فروختم/i,
      /به\s+(\S+)\s+فروختم/i,
    ],
    weight: 0.9,
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
    ],
    weight: 0.85,
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
    patterns: [
      /بدهکار|نسیه|credit|debt/i,
      /بده\s*داد|پرداخت\s*بدهی/i,
      /یادآوری/i,
    ],
    weight: 0.85,
  },
  {
    intent: 'card_deposit',
    patterns: [/کارت\s*خوان|کارتخوان|pos|واریز\s*کارتی/i],
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
];

/** موتور NLP محلی - بدون API خارجی */
export function detectIntent(text: string): ParsedIntent {
  const normalized = persianToEnglishDigits(text.trim());
  let bestIntent: ChatIntent = 'unknown';
  let bestScore = 0;

  for (const { intent, patterns, weight } of INTENT_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(normalized)) {
        const score = weight;
        if (score > bestScore) {
          bestScore = score;
          bestIntent = intent;
        }
      }
    }
  }

  const entities = extractEntities(normalized, bestIntent);

  return {
    intent: bestIntent,
    confidence: bestScore || 0.3,
    entities,
    rawText: text,
  };
}

function extractEntities(text: string, intent: ChatIntent): Record<string, string | number | boolean> {
  const entities: Record<string, string | number | boolean> = {};

  const amount = extractAmount(text);
  if (amount) entities.amount = amount;

  const customerMatch = text.match(/(?:به|برای)\s+([^\s\d]+(?:\s+[^\s\d]+)?)/i);
  if (customerMatch) entities.customerName = customerMatch[1].trim();

  const phoneMatch = text.match(/(?:0|\+98)?9\d{9}/);
  if (phoneMatch) entities.phone = phoneMatch[0];

  const productMatch = text.match(/(?:فروش|خرید)\s+(.+?)(?:\s+به|\s+\d|$)/i);
  if (productMatch) entities.productName = productMatch[1].trim();

  if (intent === 'expense') {
    for (const { type, patterns } of EXPENSE_TYPE_MAP) {
      if (patterns.some((p) => p.test(text))) {
        entities.expenseType = type;
        break;
      }
    }
    if (!entities.expenseType) entities.expenseType = 'other';
  }

  if (/نسیه|credit|قسط/i.test(text)) entities.paymentMethod = 'credit';
  else if (/کارت\s*به\s*کارت|کارت‌به‌کارت|card[\s_-]?to[\s_-]?card/i.test(text))
    entities.paymentMethod = 'card_to_card';
  else if (/کارت|card|pos|پوز|کارتخوان/i.test(text)) entities.paymentMethod = 'card';
  else if (/نقد|cash/i.test(text)) entities.paymentMethod = 'cash';

  const dateMatch = text.match(/(\d{4}[/-]\d{1,2}[/-]\d{1,2})/);
  if (dateMatch) entities.date = dateMatch[1];

  const qtyMatch = text.match(/(\d+)\s*(?:عدد|تا|دانه)/i);
  if (qtyMatch) entities.quantity = parseInt(qtyMatch[1], 10);

  return entities;
}

export interface SmsParseResult {
  type: 'purchase' | 'deposit' | 'withdrawal' | 'balance' | 'transfer' | 'unknown';
  amount?: number;
  merchant?: string;
  cardLast4?: string;
  balance?: number;
  confidence: number;
}

/** پارسر SMS بانکی ایران */
export function parseSms(text: string): SmsParseResult {
  const normalized = persianToEnglishDigits(text);

  const purchasePatterns = [
    /خرید[\s\S]*?(\d[\d,]*)\s*ریال/i,
    /purchase[\s\S]*?(\d[\d,]*)/i,
    /پرداخت[\s\S]*?(\d[\d,]*)\s*ریال/i,
  ];

  for (const p of purchasePatterns) {
    const m = normalized.match(p);
    if (m) {
      const amount = parseInt(m[1].replace(/,/g, ''), 10);
      const merchant = normalized.match(/(?:از|from)\s+(.+?)(?:\s*-|\s*کارت|$)/i)?.[1];
      const card = normalized.match(/\*+(\d{4})/)?.[1];
      return { type: 'purchase', amount, merchant, cardLast4: card, confidence: 0.9 };
    }
  }

  const depositMatch = normalized.match(/واریز[\s\S]*?(\d[\d,]*)\s*ریال/i);
  if (depositMatch) {
    return {
      type: 'deposit',
      amount: parseInt(depositMatch[1].replace(/,/g, ''), 10),
      confidence: 0.85,
    };
  }

  const withdrawMatch = normalized.match(/برداشت[\s\S]*?(\d[\d,]*)\s*ریال/i);
  if (withdrawMatch) {
    return {
      type: 'withdrawal',
      amount: parseInt(withdrawMatch[1].replace(/,/g, ''), 10),
      confidence: 0.85,
    };
  }

  const balanceMatch = normalized.match(/مانده[\s\S]*?(\d[\d,]*)/i);
  if (balanceMatch) {
    return {
      type: 'balance',
      balance: parseInt(balanceMatch[1].replace(/,/g, ''), 10),
      confidence: 0.8,
    };
  }

  const amount = extractAmount(normalized);
  if (amount) {
    return { type: 'unknown', amount, confidence: 0.5 };
  }

  return { type: 'unknown', confidence: 0.1 };
}

export interface LocalLlmResponse {
  text: string;
  intent?: ParsedIntent;
  suggestedAction?: string;
}

/**
 * موتور LLM محلی سبک - ترکیب rule-based + context memory
 * بدون نیاز به API خارجی. از الگوریتم scoring و template generation استفاده می‌کند.
 */
export class LocalLlmEngine {
  private memory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private readonly maxMemory = 20;

  chat(userMessage: string): LocalLlmResponse {
    this.memory.push({ role: 'user', content: userMessage });
    if (this.memory.length > this.maxMemory) this.memory.shift();

    const intent = detectIntent(userMessage);
    const response = this.generateResponse(intent, userMessage);

    this.memory.push({ role: 'assistant', content: response.text });
    return response;
  }

  private generateResponse(intent: ParsedIntent, raw: string): LocalLlmResponse {
    const { entities } = intent;

    switch (intent.intent) {
      case 'sale':
        return {
          text: this.buildSaleResponse(entities),
          intent,
          suggestedAction: 'create_sale',
        };

      case 'purchase':
        return {
          text: `🛒 فاکتور خرید تشخیص داده شد.\n${
            entities.productName ? `محصول: ${entities.productName}\n` : ''
          }${entities.amount ? `مبلغ: ${formatRial(entities.amount as number)}\n` : ''}${
            entities.quantity ? `تعداد: ${entities.quantity}\n` : ''
          }آیا ثبت کنم؟`,
          intent,
          suggestedAction: 'create_purchase',
        };

      case 'expense':
        return {
          text: `💸 هزینه تشخیص داده شد.\nنوع: ${entities.expenseType || 'سایر'}\n${
            entities.amount ? `مبلغ: ${formatRial(entities.amount as number)}` : 'مبلغ را مشخص کنید'
          }`,
          intent,
          suggestedAction: 'create_expense',
        };

      case 'sms': {
        const sms = parseSms(raw);
        return {
          text: this.buildSmsResponse(sms),
          intent,
          suggestedAction: 'process_sms',
        };
      }

      case 'dashboard':
        return {
          text: '📊 برای مشاهده داشبورد امروز، در حال دریافت اطلاعات...',
          intent,
          suggestedAction: 'fetch_dashboard',
        };

      case 'debt':
        return {
          text: '💳 اطلاعات بدهکاران در حال بارگذاری...',
          intent,
          suggestedAction: 'fetch_debtors',
        };

      case 'card_deposit':
        return {
          text: `💳 واریز کارت‌خوان\n${
            entities.amount
              ? `مبلغ: ${formatRial(entities.amount as number)}\nآیا ثبت کنم؟`
              : 'مبلغ واریز را بگویید'
          }`,
          intent,
          suggestedAction: 'card_deposit',
        };

      case 'help':
        return {
          text: `🤖 سلام! من دستیار مغازه شما هستم.

می‌تونید به این شکل با من حرف بزنید:
• "آیفون ۱۵ رو به علی ۴۰ میلیون نسیه فروختم"
• "خرید ۱۰ تا کاور سامسونگ هر کدوم ۵۰ هزار"
• "هزینه ارسال بار ۲۰۰ هزار"
• "SMS بانکی رو paste کنید"
• "سود امروز چقدره؟"
• "بدهکارام رو نشون بده"
• "واریز کارتخوان ۵ میلیون"`,
          intent,
          suggestedAction: 'none',
        };

      default:
        return {
          text: 'متوجه نشدم 🤔 می‌تونید دقیق‌تر بگید؟ مثلاً "فروش آیفون ۱۵ به علی ۴۰ میلیون" یا "help" برای راهنما.',
          intent,
          suggestedAction: 'none',
        };
    }
  }

  private buildSaleResponse(entities: Record<string, string | number | boolean>): string {
    const parts = ['🧾 فاکتور فروش:'];
    if (entities.productName) parts.push(`محصول: ${entities.productName}`);
    if (entities.quantity) parts.push(`تعداد: ${entities.quantity}`);
    if (entities.customerName) parts.push(`مشتری: ${entities.customerName}`);
    if (entities.amount) parts.push(`مبلغ: ${formatRial(entities.amount as number)}`);
    if (entities.paymentMethod) {
      const labels: Record<string, string> = {
        cash: 'نقد',
        card: 'پوز / کارتخوان',
        card_to_card: 'کارت به کارت',
        credit: 'نسیه',
        mixed: 'ترکیبی',
      };
      parts.push(`پرداخت: ${labels[entities.paymentMethod as string] || entities.paymentMethod}`);
    }
    parts.push('آیا ثبت کنم؟');
    return parts.join('\n');
  }

  private buildSmsResponse(sms: SmsParseResult): string {
    const typeLabels: Record<string, string> = {
      purchase: 'خرید با کارت',
      deposit: 'واریز',
      withdrawal: 'برداشت',
      balance: 'مانده حساب',
      transfer: 'انتقال',
      unknown: 'نامشخص',
    };
    let text = `📱 SMS پارس شد:\nنوع: ${typeLabels[sms.type]}`;
    if (sms.amount) text += `\nمبلغ: ${formatRial(sms.amount)}`;
    if (sms.merchant) text += `\nفروشگاه: ${sms.merchant}`;
    if (sms.cardLast4) text += `\nکارت: ***${sms.cardLast4}`;
    if (sms.balance) text += `\nمانده: ${formatRial(sms.balance)}`;
    text += '\n\nچه کاری انجام بدم؟ (ثبت هزینه / ثبت واریز / نادیده)';
    return text;
  }

  clearMemory() {
    this.memory = [];
  }

  getMemory() {
    return [...this.memory];
  }
}

export const localLlm = new LocalLlmEngine();
