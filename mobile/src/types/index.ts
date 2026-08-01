export interface Category {
  _id: string;
  name: string;
  profitPercent: number;
  description?: string;
}

export interface Product {
  _id: string;
  name: string;
  stock: number;
  purchasePrice: number;
  categoryId: { _id?: string; name?: string; profitPercent: number };
}

export interface DashboardData {
  date?: string;
  totalSales: number;
  totalProfit: number;
  totalExpenses: number;
  netProfit: number;
  cashSales: number;
  cardSales: number;
  creditSales: number;
  cardDepositTotal: number;
  cashBalance: number;
  cardBalance: number;
  salesCount: number;
  expenseCount?: number;
  debtors: {
    total: number;
    count: number;
    overdue: Array<{ name: string; remaining: number; dueDate: string }>;
    upcoming?: Array<{ name: string; remaining: number; dueDate: string }>;
  };
}

export interface Debtor {
  _id: string;
  name: string;
  phone?: string;
  amount: number;
  paidAmount: number;
  dueDate: string;
  isSettled: boolean;
}

export interface PeriodData {
  totalSales: number;
  totalProfit: number;
  totalExpenses: number;
  daily: Array<{
    date: string;
    sales: number;
    profit: number;
    expenses: number;
    netProfit: number;
  }>;
}

export interface ShopSettings {
  shopName: string;
  openingDate: string;
  cashBalance: number;
  cardBalance: number;
}

export interface ChatResponse {
  text: string;
  suggestedAction?: string;
  intent?: {
    intent?: string;
    confidence?: number;
    entities: Record<string, string | number | boolean>;
  };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'bot';
  text: string;
  action?: string;
  entities?: Record<string, string | number | boolean>;
  rawUserText?: string;
  pending?: boolean;
}
