import { Router, Request, Response } from 'express';
import {
  getCategories,
  createCategory,
  listProducts,
  getOrCreateSettings,
} from '../services/productService';
import { createPurchaseInvoice, listPurchaseInvoices } from '../services/purchaseService';
import { createSaleInvoice, listSaleInvoices, recordDebtPayment } from '../services/saleService';
import { createExpense, listExpenses, recordCardDeposit } from '../services/expenseService';
import {
  getDashboard,
  getPeriodSummary,
  updateShopSettings,
  listDebtors,
  getProductAnalytics,
} from '../services/dashboardService';
import { localLlm, parseSms } from '../chatbot/engine';
import { SmsMessage } from '../models';
import { getShopOpeningDate } from '../config/database';

const router = Router();

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err) => {
      res.status(400).json({ error: err.message || 'خطای سرور' });
    });
  };
}

// ─── Settings ───
router.get('/settings', asyncHandler(async (_req, res) => {
  const settings = await getOrCreateSettings();
  res.json(settings);
}));

router.put('/settings', asyncHandler(async (req, res) => {
  const settings = await updateShopSettings(req.body);
  res.json(settings);
}));

router.get('/settings/opening-date', (_req, res) => {
  res.json({ openingDate: getShopOpeningDate().toISOString() });
});

// ─── Categories ───
router.get('/categories', asyncHandler(async (_req, res) => {
  res.json(await getCategories());
}));

router.post('/categories', asyncHandler(async (req, res) => {
  const { name, profitPercent, description } = req.body;
  const cat = await createCategory(name, profitPercent ?? 15, description);
  res.status(201).json(cat);
}));

// ─── Products ───
router.get('/products', asyncHandler(async (req, res) => {
  res.json(await listProducts(req.query.search as string));
}));

// ─── Purchases ───
router.get('/purchases', asyncHandler(async (req, res) => {
  const from = req.query.from ? new Date(req.query.from as string) : undefined;
  const to = req.query.to ? new Date(req.query.to as string) : undefined;
  res.json(await listPurchaseInvoices(from, to));
}));

router.post('/purchases', asyncHandler(async (req, res) => {
  const invoice = await createPurchaseInvoice(req.body);
  res.status(201).json(invoice);
}));

// ─── Sales ───
router.get('/sales', asyncHandler(async (req, res) => {
  const from = req.query.from ? new Date(req.query.from as string) : undefined;
  const to = req.query.to ? new Date(req.query.to as string) : undefined;
  res.json(await listSaleInvoices({ from, to }));
}));

router.post('/sales', asyncHandler(async (req, res) => {
  const invoice = await createSaleInvoice(req.body);
  res.status(201).json(invoice);
}));

// ─── Expenses ───
router.get('/expenses', asyncHandler(async (req, res) => {
  const from = req.query.from ? new Date(req.query.from as string) : undefined;
  const to = req.query.to ? new Date(req.query.to as string) : undefined;
  res.json(await listExpenses({ from, to }));
}));

router.post('/expenses', asyncHandler(async (req, res) => {
  const expense = await createExpense(req.body);
  res.status(201).json(expense);
}));

router.post('/card-deposit', asyncHandler(async (req, res) => {
  const { amount, description, date } = req.body;
  const settings = await recordCardDeposit(amount, description, date ? new Date(date) : undefined);
  res.json(settings);
}));

// ─── Debtors ───
router.get('/debtors', asyncHandler(async (req, res) => {
  const settled = req.query.settled === 'true' ? true : req.query.settled === 'false' ? false : undefined;
  res.json(await listDebtors(settled));
}));

router.post('/debtors/:id/pay', asyncHandler(async (req, res) => {
  const { amount, method } = req.body;
  const debtor = await recordDebtPayment(String(req.params.id), amount, method);
  res.json(debtor);
}));

// ─── Dashboard ───
router.get('/dashboard', asyncHandler(async (req, res) => {
  const date = req.query.date ? new Date(req.query.date as string) : undefined;
  res.json(await getDashboard(date));
}));

router.get('/dashboard/period', asyncHandler(async (req, res) => {
  const from = new Date(req.query.from as string);
  const to = new Date(req.query.to as string);
  res.json(await getPeriodSummary(from, to));
}));

router.get('/products/:id/analytics', asyncHandler(async (req, res) => {
  res.json(await getProductAnalytics(String(req.params.id)));
}));

// ─── Chatbot ───
router.post('/chat', asyncHandler(async (req, res) => {
  const { message } = req.body;
  if (!message) {
    res.status(400).json({ error: 'پیام الزامی است' });
    return;
  }

  const response = localLlm.chat(message);
  const intent = response.intent!;

  if (response.suggestedAction === 'fetch_dashboard') {
    const dashboard = await getDashboard();
    response.text = `📊 داشبورد امروز:
💰 فروش: ${dashboard.totalSales.toLocaleString('fa-IR')} ریال
📈 سود ناخالص: ${dashboard.totalProfit.toLocaleString('fa-IR')} ریال
💸 هزینه‌ها: ${dashboard.totalExpenses.toLocaleString('fa-IR')} ریال
✅ سود خالص: ${dashboard.netProfit.toLocaleString('fa-IR')} ریال
💵 نقد صندوق: ${dashboard.cashBalance.toLocaleString('fa-IR')} ریال
💳 کارت: ${dashboard.cardBalance.toLocaleString('fa-IR')} ریال
📋 تعداد فروش: ${dashboard.salesCount}`;
  }

  if (response.suggestedAction === 'fetch_debtors') {
    const debtors = await listDebtors(false);
    if (debtors.length === 0) {
      response.text = '✅ بدهکار فعالی ندارید!';
    } else {
      response.text = '💳 بدهکاران:\n' + debtors.map((d) =>
        `• ${d.name}: ${(d.amount - d.paidAmount).toLocaleString('fa-IR')} ریال - سررسید: ${new Date(d.dueDate).toLocaleDateString('fa-IR')}${new Date(d.dueDate) < new Date() ? ' ⚠️ معوق' : ''}`
      ).join('\n');
    }
  }

  res.json({
    ...response,
    intent: {
      ...intent,
      entities: intent.entities,
    },
  });
}));

router.post('/chat/confirm', asyncHandler(async (req, res) => {
  const { action, data } = req.body;
  let result;

  switch (action) {
    case 'create_sale':
      result = await createSaleInvoice(data);
      break;
    case 'create_purchase':
      result = await createPurchaseInvoice(data);
      break;
    case 'create_expense':
      result = await createExpense(data);
      break;
    case 'card_deposit':
      result = await recordCardDeposit(data.amount, data.description, data.date ? new Date(data.date) : undefined);
      break;
    default:
      res.status(400).json({ error: 'عملیات نامعتبر' });
      return;
  }

  res.json({ success: true, result });
}));

// ─── SMS ───
router.post('/sms/parse', asyncHandler(async (req, res) => {
  const { text, sender } = req.body;
  const parsed = parseSms(text);
  const saved = await SmsMessage.create({
    rawText: text,
    sender,
    parsedType: parsed.type,
    parsedAmount: parsed.amount,
    parsedData: parsed,
  });
  res.json({ parsed, id: saved._id });
}));

router.get('/sms', asyncHandler(async (_req, res) => {
  const messages = await SmsMessage.find().sort({ receivedAt: -1 }).limit(50);
  res.json(messages);
}));

router.post('/sms/:id/process', asyncHandler(async (req, res) => {
  const sms = await SmsMessage.findById(req.params.id);
  if (!sms) {
    res.status(404).json({ error: 'پیام یافت نشد' });
    return;
  }

  const { action, data } = req.body;
  let result;

  if (action === 'expense' && sms.parsedAmount) {
    result = await createExpense({
      type: 'other',
      amount: sms.parsedAmount,
      description: `خرید از SMS: ${sms.rawText.slice(0, 50)}`,
      ...data,
    });
  } else if (action === 'deposit' && sms.parsedAmount) {
    result = await recordCardDeposit(sms.parsedAmount, 'واریز از SMS');
  }

  sms.isProcessed = true;
  sms.processedAction = action;
  await sms.save();

  res.json({ success: true, result });
}));

export default router;
