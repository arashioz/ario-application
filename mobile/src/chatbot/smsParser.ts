import { toEnglishDigits, parseAmount } from '../utils/format';

export interface SmsResult {
  type: 'purchase' | 'deposit' | 'withdrawal' | 'balance' | 'transfer' | 'unknown';
  amount?: number;
  merchant?: string;
  cardLast4?: string;
  balance?: number;
  confidence: number;
}

export function parseSmsLocal(text: string): SmsResult {
  const n = toEnglishDigits(text);

  const purchasePatterns = [
    /خرید[\s\S]*?(\d[\d,]*)\s*ریال/i,
    /پرداخت[\s\S]*?(\d[\d,]*)\s*ریال/i,
  ];

  for (const p of purchasePatterns) {
    const m = n.match(p);
    if (m) {
      return {
        type: 'purchase',
        amount: parseInt(m[1].replace(/,/g, ''), 10),
        merchant: n.match(/(?:از|from)\s+(.+?)(?:\s*-|\s*کارت|$)/i)?.[1]?.trim(),
        cardLast4: n.match(/\*+(\d{4})/)?.[1],
        confidence: 0.9,
      };
    }
  }

  const deposit = n.match(/واریز[\s\S]*?(\d[\d,]*)\s*ریال/i);
  if (deposit) {
    return {
      type: 'deposit',
      amount: parseInt(deposit[1].replace(/,/g, ''), 10),
      confidence: 0.85,
    };
  }

  const withdraw = n.match(/برداشت[\s\S]*?(\d[\d,]*)\s*ریال/i);
  if (withdraw) {
    return {
      type: 'withdrawal',
      amount: parseInt(withdraw[1].replace(/,/g, ''), 10),
      confidence: 0.85,
    };
  }

  const balance = n.match(/مانده[\s\S]*?(\d[\d,]*)/i);
  if (balance) {
    return {
      type: 'balance',
      balance: parseInt(balance[1].replace(/,/g, ''), 10),
      confidence: 0.8,
    };
  }

  const amount = parseAmount(n);
  if (amount) return { type: 'unknown', amount, confidence: 0.5 };

  return { type: 'unknown', confidence: 0.1 };
}
