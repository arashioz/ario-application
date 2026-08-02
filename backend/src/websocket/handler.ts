import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { MutationLog } from '../models';
import { getSession, login, logout, listUsers, listMarketers, createUser } from '../services/authService';
import { getDashboard, getPeriodSummary, updateShopSettings, listDebtors } from '../services/dashboardService';
import {
  listProducts,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  calculateSalePrice,
  updateProduct,
  saveProductImage,
  getPublicCatalog,
} from '../services/productService';
import { createPurchaseInvoice, listPurchaseInvoices, deletePurchaseInvoice, updatePurchaseInvoice } from '../services/purchaseService';
import { createSaleInvoice, listSaleInvoices, recordDebtPayment, approveSale, shipSale, cancelSale, getSalePdfHtml, deleteSaleInvoice, updateSaleInvoice } from '../services/saleService';
import { createExpense, recordCardDeposit, listExpenses, listCardDeposits, deleteExpense, deleteCardDeposit, deleteCompanyPayment, listCashTransactions } from '../services/expenseService';
import { createCustomer, listCustomers, getCustomer, getCustomerInvoices, updateCustomer, getCustomerSuggestedPricing, quickFindCustomer, getCustomerCrmInsights, listCustomerDirectory, getCustomersMap } from '../services/customerService';
import {
  createCompanyPayment,
  listCompanyPayments,
  listSupplierDebts,
  getCompanyDebtSummary,
} from '../services/companyService';
import { upsertTarget, getTargetProgress, listTargets } from '../services/targetService';
import {
  listCampaigns,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  evaluateCampaigns,
} from '../services/campaignService';
import {
  createCheckReminder,
  listCheckReminders,
  updateCheckReminder,
  deleteCheckReminder,
} from '../services/checkService';
import {
  listDrivers,
  updateDriverLocation,
  getDriverLocations,
  assignSaleDriver,
  listDriverJobs,
  updateStaffLocation,
  setWorkActive,
  getLiveStaffLocations,
  deliverSale,
  payDriverForInvoice,
  payDriverWallet,
  updateDriverProfile,
  getDriverProfile,
  listDriverPayoutsPending,
} from '../services/driverService';
import {
  registerPartner,
  listPartnerApprovals,
  setPartnerApproval,
  getPlatformConfig,
  updatePlatformConfig,
  createVolumeOrder,
  listVolumeOrders,
  updateVolumeOrderStatus,
  getWallet,
  payPartnerWallet,
} from '../services/platformService';
import {
  listExpenseCategories,
  createExpenseCategory,
  deleteExpenseCategory,
  resolveExpenseTypeKey,
} from '../services/expenseCategoryService';
import { localLlm, parseSms } from '../chatbot/engine';
import { SmsMessage } from '../models';
import { getOrCreateSettings as getSettings } from '../services/productService';

export interface WsMessage {
  type: string;
  payload?: unknown;
  requestId?: string;
  token?: string;
  clientMutationId?: string;
}

type Authed = { userId: string; role: string; name: string; username: string };

interface ExtWebSocket extends WebSocket {
  session?: Authed | null;
}

const clients = new Set<ExtWebSocket>();

export function setupWebSocket(server: Server, path: string) {
  const wss = new WebSocketServer({ server, path });

  wss.on('connection', (ws: ExtWebSocket) => {
    clients.add(ws);
    ws.session = null;
    console.log(`🔌 WS client connected (${clients.size} total)`);

    ws.send(
      JSON.stringify({
        type: 'connected',
        payload: { message: 'اتصال برقرار شد', timestamp: new Date().toISOString() },
      })
    );

    ws.on('message', async (raw) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'پیام نامعتبر' } }));
        return;
      }

      try {
        const response = await handleMessage(msg, ws);
        ws.send(JSON.stringify({ ...response, requestId: msg.requestId }));
      } catch (err) {
        ws.send(
          JSON.stringify({
            type: 'error',
            payload: { message: err instanceof Error ? err.message : 'خطا' },
            requestId: msg.requestId,
          })
        );
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`🔌 WS client disconnected (${clients.size} total)`);
    });
  });

  return wss;
}

async function requireAuth(ws: ExtWebSocket, msg: WsMessage): Promise<Authed> {
  let session: Authed | null | undefined = ws.session;
  if (msg.token) {
    const fromDb = await getSession(msg.token);
    if (fromDb) {
      session = {
        userId: fromDb.userId,
        role: fromDb.role,
        name: fromDb.name,
        username: fromDb.username,
      };
    }
  }
  if (!session) throw new Error('نشست منقضی شده — لطفاً دوباره وارد شوید');
  ws.session = session;
  return session;
}

function requireAdmin(user: Authed) {
  if (user.role !== 'admin') throw new Error('دسترسی فقط برای مدیر');
}

async function withIdempotency(
  clientMutationId: string | undefined,
  type: string,
  userId: string | undefined,
  fn: () => Promise<unknown>
) {
  if (clientMutationId) {
    const existing = await MutationLog.findOne({ clientMutationId });
    if (existing) return existing.result;
  }
  const result = await fn();
  if (clientMutationId) {
    try {
      await MutationLog.create({ clientMutationId, type, userId, result });
    } catch (err: unknown) {
      // درخواست تکراری هم‌زمان — نتیجهٔ قبلی را برگردان
      if ((err as { code?: number })?.code === 11000) {
        const existing = await MutationLog.findOne({ clientMutationId });
        if (existing) return existing.result;
      }
      throw err;
    }
  }
  return result;
}

async function handleMessage(msg: WsMessage, ws: ExtWebSocket): Promise<WsMessage> {
  const p = (msg.payload || {}) as Record<string, unknown>;

  switch (msg.type) {
    case 'ping':
      return { type: 'pong', payload: { timestamp: Date.now() } };

    case 'auth.login': {
      const result = await login(String(p.username || ''), String(p.password || ''));
      ws.session = {
        userId: result.user.id,
        role: result.user.role,
        name: result.user.name,
        username: result.user.username,
      };
      return { type: 'auth.login', payload: result };
    }

    case 'auth.register': {
      const result = await registerPartner({
        username: String(p.username || ''),
        password: String(p.password || ''),
        name: String(p.name || ''),
        phone: p.phone as string | undefined,
        city: String(p.city || ''),
      });
      notifyDataChange('partner', 'register', result);
      return { type: 'auth.register', payload: result };
    }

    case 'auth.logout': {
      if (msg.token) await logout(msg.token);
      ws.session = null;
      return { type: 'auth.logout', payload: { ok: true } };
    }

    case 'auth.me': {
      const user = await requireAuth(ws, msg);
      return { type: 'auth.me', payload: { user } };
    }

    case 'dashboard.get': {
      const user = await requireAuth(ws, msg);
      const marketerId = user.role === 'marketer' ? user.userId : (p.marketerId as string | undefined);
      const date = p.date ? new Date(String(p.date)) : undefined;
      return { type: 'dashboard.get', payload: await getDashboard(date, marketerId) };
    }

    case 'dashboard.period': {
      const user = await requireAuth(ws, msg);
      const from = new Date(String(p.from));
      const to = new Date(String(p.to));
      const marketerId = user.role === 'marketer' ? user.userId : (p.marketerId as string | undefined);
      return { type: 'dashboard.period', payload: await getPeriodSummary(from, to, marketerId) };
    }

    case 'settings.get': {
      await requireAuth(ws, msg);
      return { type: 'settings.get', payload: await getSettings() };
    }

    case 'settings.update': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await updateShopSettings({
        shopName: p.shopName as string | undefined,
        openingDate: p.openingDate ? new Date(String(p.openingDate)) : undefined,
        cashBalance: p.cashBalance as number | undefined,
        cardBalance: p.cardBalance as number | undefined,
        catalogEnabled: p.catalogEnabled as boolean | undefined,
        catalogTitle: p.catalogTitle as string | undefined,
        catalogPhone: p.catalogPhone as string | undefined,
        catalogNote: p.catalogNote as string | undefined,
        catalogSupermarketMinKg: p.catalogSupermarketMinKg as number | undefined,
        catalogWholesaleMinKg: p.catalogWholesaleMinKg as number | undefined,
        brandName: p.brandName as string | undefined,
        brandTagline: p.brandTagline as string | undefined,
        brandPrimaryColor: p.brandPrimaryColor as string | undefined,
        brandLogoUrl: p.brandLogoUrl as string | undefined,
        platformEnabled: p.platformEnabled as boolean | undefined,
        commissionPercentCompany: p.commissionPercentCompany as number | undefined,
        commissionPercentSelf: p.commissionPercentSelf as number | undefined,
        platformMinOrderKg: p.platformMinOrderKg as number | undefined,
        platformCities: p.platformCities as string | undefined,
        costBasis: p.costBasis as 'weighted' | 'last' | undefined,
      });
      notifyDataChange('settings', 'update', result);
      return { type: 'settings.update', payload: result };
    }

    case 'product.list': {
      await requireAuth(ws, msg);
      return { type: 'product.list', payload: await listProducts(p.search as string | undefined) };
    }

    case 'product.update': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await updateProduct(String(p.id), {
        catalogVisible: p.catalogVisible as boolean | undefined,
        catalogMinQty: p.catalogMinQty as number | undefined,
        catalogPricePerKg:
          p.catalogPricePerKg === null
            ? null
            : (p.catalogPricePerKg as number | undefined),
        catalogNote: p.catalogNote as string | undefined,
        imageUrl: p.imageUrl as string | undefined,
        notes: p.notes as string | undefined,
        name: p.name as string | undefined,
        categoryId: p.categoryId as string | undefined,
        profitPercent:
          p.profitPercent === null ? null : (p.profitPercent as number | undefined),
        profitRetail: p.profitRetail === null ? null : (p.profitRetail as number | undefined),
        profitSupermarket:
          p.profitSupermarket === null ? null : (p.profitSupermarket as number | undefined),
        profitWholesale:
          p.profitWholesale === null ? null : (p.profitWholesale as number | undefined),
      });
      notifyDataChange('product', 'update', result);
      return { type: 'product.update', payload: result };
    }

    case 'product.uploadImage': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await saveProductImage(String(p.id), String(p.dataUrl || ''));
      notifyDataChange('product', 'update', result);
      return { type: 'product.uploadImage', payload: result };
    }

    case 'catalog.public': {
      // برای پیش‌نمایش داخل اپ (با auth هم می‌شود)
      await requireAuth(ws, msg);
      return { type: 'catalog.public', payload: await getPublicCatalog() };
    }

    case 'category.list': {
      await requireAuth(ws, msg);
      return { type: 'category.list', payload: await getCategories() };
    }

    case 'category.create': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await createCategory(
        String(p.name),
        Number(p.profitPercent || p.profitRetail || 15),
        p.description as string | undefined,
        {
          profitRetail: p.profitRetail as number | undefined,
          profitSupermarket: p.profitSupermarket as number | undefined,
          profitWholesale: p.profitWholesale as number | undefined,
        }
      );
      notifyDataChange('category', 'create', result);
      return { type: 'category.create', payload: result };
    }

    case 'category.update': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await updateCategory(String(p.id), {
        name: p.name as string | undefined,
        profitPercent: p.profitPercent as number | undefined,
        profitRetail: p.profitRetail as number | undefined,
        profitSupermarket: p.profitSupermarket as number | undefined,
        profitWholesale: p.profitWholesale as number | undefined,
        description: p.description as string | undefined,
      });
      notifyDataChange('category', 'update', result);
      return { type: 'category.update', payload: result };
    }

    case 'category.delete': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await deleteCategory(String(p.id));
      notifyDataChange('category', 'delete', result);
      return { type: 'category.delete', payload: result };
    }

    case 'product.price': {
      await requireAuth(ws, msg);
      return {
        type: 'product.price',
        payload: await calculateSalePrice(
          String(p.productId),
          p.percent as number | undefined,
          (p.priceTier as 'retail' | 'supermarket' | 'wholesale') || 'retail',
          (p.costBasis as 'weighted' | 'last') || 'last'
        ),
      };
    }

    case 'customer.list': {
      await requireAuth(ws, msg);
      return {
        type: 'customer.list',
        payload: await listCustomers(p.search as string | undefined, {
          limit: p.limit as number | undefined,
          all: p.all === true || p.all === 'true',
        }),
      };
    }

    case 'customer.directory': {
      await requireAuth(ws, msg);
      return {
        type: 'customer.directory',
        payload: await listCustomerDirectory(p.search as string | undefined),
      };
    }

    case 'customer.map': {
      await requireAuth(ws, msg);
      return { type: 'customer.map', payload: await getCustomersMap() };
    }

    case 'customer.quick': {
      await requireAuth(ws, msg);
      return {
        type: 'customer.quick',
        payload: await quickFindCustomer(String(p.query || p.search || '')),
      };
    }

    case 'customer.crm': {
      await requireAuth(ws, msg);
      return {
        type: 'customer.crm',
        payload: await getCustomerCrmInsights(p.date ? new Date(String(p.date)) : undefined),
      };
    }

    case 'customer.create': {
      const user = await requireAuth(ws, msg);
      const result = await withIdempotency(msg.clientMutationId, msg.type, user.userId, () =>
        createCustomer({
          name: String(p.name),
          phone: p.phone as string | undefined,
          address: p.address as string | undefined,
          lat: p.lat as number | undefined,
          lng: p.lng as number | undefined,
          notes: p.notes as string | undefined,
        })
      );
      notifyDataChange('customer', 'create', result);
      return { type: 'customer.create', payload: result };
    }

    case 'customer.update': {
      await requireAuth(ws, msg);
      const result = await updateCustomer(String(p.id), {
        name: p.name as string | undefined,
        phone: p.phone as string | undefined,
        address: p.address as string | undefined,
        lat: p.lat as number | undefined,
        lng: p.lng as number | undefined,
        notes: p.notes as string | undefined,
      });
      notifyDataChange('customer', 'update', result);
      return { type: 'customer.update', payload: result };
    }

    case 'customer.get': {
      await requireAuth(ws, msg);
      const customer = await getCustomer(String(p.id));
      const invoices = await getCustomerInvoices(String(p.id));
      const suggest = await getCustomerSuggestedPricing(String(p.id), p.productId as string | undefined);
      return { type: 'customer.get', payload: { customer, invoices, suggest } };
    }

    case 'customer.suggest': {
      await requireAuth(ws, msg);
      return {
        type: 'customer.suggest',
        payload: await getCustomerSuggestedPricing(String(p.customerId), p.productId as string | undefined),
      };
    }

    case 'purchase.create': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await withIdempotency(msg.clientMutationId, msg.type, user.userId, () =>
        createPurchaseInvoice({
          supplier: p.supplier as string | undefined,
          items: p.items as never,
          notes: p.notes as string | undefined,
          date: p.date ? new Date(String(p.date)) : undefined,
          paidNow: p.paidNow as boolean | undefined,
          createdBy: user.userId,
        })
      );
      notifyDataChange('purchase', 'create', result);
      return { type: 'purchase.create', payload: result };
    }

    case 'purchase.list': {
      await requireAuth(ws, msg);
      return {
        type: 'purchase.list',
        payload: await listPurchaseInvoices(
          p.from ? new Date(String(p.from)) : undefined,
          p.to ? new Date(String(p.to)) : undefined
        ),
      };
    }

    case 'purchase.delete': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await deletePurchaseInvoice(String(p.id), p.password as string | undefined);
      notifyDataChange('purchase', 'delete', result);
      notifyDataChange('product', 'update', result);
      return { type: 'purchase.delete', payload: result };
    }

    case 'purchase.update': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await updatePurchaseInvoice(String(p.id), p.password as string | undefined, {
        supplier: p.supplier as string | undefined,
        items: p.items as never,
        notes: p.notes as string | undefined,
        date: p.date ? new Date(String(p.date)) : undefined,
        paidNow: p.paidNow as boolean | undefined,
      });
      notifyDataChange('purchase', 'update', result);
      notifyDataChange('product', 'update', result);
      return { type: 'purchase.update', payload: result };
    }

    case 'sale.create': {
      const user = await requireAuth(ws, msg);
      const result = await withIdempotency(msg.clientMutationId, msg.type, user.userId, () =>
        createSaleInvoice({
          customerId: p.customerId as string | undefined,
          customerName: p.customerName as string | undefined,
          customerPhone: p.customerPhone as string | undefined,
          customerAddress: p.customerAddress as string | undefined,
          customerLat: p.customerLat as number | undefined,
          customerLng: p.customerLng as number | undefined,
          marketerId: user.role === 'marketer' ? user.userId : (p.marketerId as string | undefined) || user.userId,
          items: p.items as never,
          paymentMethod: p.paymentMethod as never,
          payment: p.payment as never,
          discount: p.discount as number | undefined,
          discountMode: p.discountMode as 'invoice' | 'per_kg' | 'product' | undefined,
          discountPerKg: p.discountPerKg as number | undefined,
          notes: p.notes as string | undefined,
          date: p.date ? new Date(String(p.date)) : undefined,
          dueDate: p.dueDate ? new Date(String(p.dueDate)) : undefined,
          priceTier: p.priceTier as 'retail' | 'supermarket' | 'wholesale' | undefined,
          isGolden: p.isGolden as boolean | undefined,
          requiresApproval: user.role === 'marketer' || p.requiresApproval === true,
          createdByRole: user.role,
          deliveryMode: p.deliveryMode as 'company' | 'self' | undefined,
        })
      );
      notifyDataChange('sale', 'create', result);
      return { type: 'sale.create', payload: result };
    }

  case 'sale.list': {
      const user = await requireAuth(ws, msg);
      const marketerId = user.role === 'marketer' ? user.userId : (p.marketerId as string | undefined);
      const driverId = user.role === 'driver' ? user.userId : (p.driverId as string | undefined);
      return {
        type: 'sale.list',
        payload: await listSaleInvoices({
          from: p.from ? new Date(String(p.from)) : undefined,
          to: p.to ? new Date(String(p.to)) : undefined,
          customerId: p.customerId as string | undefined,
          marketerId,
          driverId,
          status: p.status as never,
        }),
      };
    }

    case 'sale.approve': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await approveSale(String(p.id), user.userId, {
        driverId: p.driverId !== undefined ? (p.driverId as string | null) : undefined,
        shippingBy: p.shippingBy as 'us' | 'customer' | 'none' | undefined,
        shippingCost: p.shippingCost as number | undefined,
        shippingNotes: p.shippingNotes as string | undefined,
      });
      notifyDataChange('sale', 'approve', result);
      if (result.shippingExpenseId) notifyDataChange('expense', 'create', { id: result.shippingExpenseId });
      return { type: 'sale.approve', payload: result };
    }

    case 'sale.ship': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await shipSale(String(p.id), {
        shippingNotes: p.shippingNotes as string | undefined,
        driverId: p.driverId !== undefined ? (p.driverId as string | null) : undefined,
        shippingBy: p.shippingBy as 'us' | 'customer' | 'none' | undefined,
        shippingCost: p.shippingCost as number | undefined,
      });
      notifyDataChange('sale', 'ship', result);
      if (result.shippingExpenseId) notifyDataChange('expense', 'create', { id: result.shippingExpenseId });
      return { type: 'sale.ship', payload: result };
    }

    case 'sale.assignDriver': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await assignSaleDriver(
        String(p.id),
        p.driverId === null || p.driverId === '' ? null : (p.driverId as string | undefined)
      );
      notifyDataChange('sale', 'assignDriver', result);
      return { type: 'sale.assignDriver', payload: result };
    }

    case 'sale.cancel': {
      const user = await requireAuth(ws, msg);
      const result = await cancelSale(String(p.id));
      notifyDataChange('sale', 'cancel', result);
      return { type: 'sale.cancel', payload: result };
    }

    case 'sale.delete': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await deleteSaleInvoice(String(p.id), p.password as string | undefined);
      notifyDataChange('sale', 'delete', result);
      notifyDataChange('product', 'update', result);
      return { type: 'sale.delete', payload: result };
    }

    case 'sale.update': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await updateSaleInvoice(String(p.id), p.password as string | undefined, {
        customerName: p.customerName as string | undefined,
        customerPhone: p.customerPhone as string | undefined,
        customerAddress: p.customerAddress as string | undefined,
        items: p.items as never,
        paymentMethod: p.paymentMethod as never,
        payment: p.payment as never,
        discount: p.discount as number | undefined,
        discountMode: p.discountMode as 'invoice' | 'per_kg' | 'product' | undefined,
        discountPerKg: p.discountPerKg as number | undefined,
        notes: p.notes as string | undefined,
        date: p.date ? new Date(String(p.date)) : undefined,
        dueDate: p.dueDate ? new Date(String(p.dueDate)) : undefined,
        priceTier: p.priceTier as 'retail' | 'supermarket' | 'wholesale' | undefined,
      });
      notifyDataChange('sale', 'update', result);
      notifyDataChange('product', 'update', result);
      return { type: 'sale.update', payload: result };
    }

    case 'sale.pdf': {
      await requireAuth(ws, msg);
      return { type: 'sale.pdf', payload: await getSalePdfHtml(String(p.id)) };
    }

    case 'cash.list': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      return {
        type: 'cash.list',
        payload: await listCashTransactions({
          from: p.from ? new Date(String(p.from)) : undefined,
          to: p.to ? new Date(String(p.to)) : undefined,
          limit: p.limit as number | undefined,
        }),
      };
    }

    case 'expense.create': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const typeKey = resolveExpenseTypeKey(String(p.type || p.categoryName || 'other'));
      const result = await withIdempotency(msg.clientMutationId, msg.type, user.userId, () =>
        createExpense({
          type: typeKey,
          categoryId: p.categoryId as string | undefined,
          amount: Number(p.amount),
          description: String(p.description || ''),
          date: p.date ? new Date(String(p.date)) : undefined,
          notes: p.notes as string | undefined,
          affectsCash: p.affectsCash as boolean | undefined,
        })
      );
      notifyDataChange('expense', 'create', result);
      return { type: 'expense.create', payload: result };
    }

    case 'expenseCategory.list': {
      await requireAuth(ws, msg);
      return { type: 'expenseCategory.list', payload: await listExpenseCategories() };
    }

    case 'expenseCategory.create': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await createExpenseCategory(String(p.name));
      notifyDataChange('expenseCategory', 'create', result);
      return { type: 'expenseCategory.create', payload: result };
    }

    case 'expenseCategory.delete': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await deleteExpenseCategory(String(p.id));
      notifyDataChange('expenseCategory', 'delete', result);
      return { type: 'expenseCategory.delete', payload: result };
    }

    case 'expense.list': {
      await requireAuth(ws, msg);
      return {
        type: 'expense.list',
        payload: await listExpenses({
          from: p.from ? new Date(String(p.from)) : undefined,
          to: p.to ? new Date(String(p.to)) : undefined,
          page: p.page as number | undefined,
          pageSize: p.pageSize as number | undefined,
        }),
      };
    }

    case 'expense.delete': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await deleteExpense(String(p.id), p.password as string | undefined);
      notifyDataChange('expense', 'delete', result);
      return { type: 'expense.delete', payload: result };
    }

    case 'cardDeposit.create': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await withIdempotency(msg.clientMutationId, msg.type, user.userId, () =>
        recordCardDeposit(
          Number(p.amount),
          p.description as string | undefined,
          p.date ? new Date(String(p.date)) : undefined,
          {
            customerId: p.customerId as string | undefined,
            customerName: p.customerName as string | undefined,
          }
        )
      );
      notifyDataChange('cardDeposit', 'create', result);
      return { type: 'cardDeposit.create', payload: result };
    }

    case 'cardDeposit.list': {
      await requireAuth(ws, msg);
      return {
        type: 'cardDeposit.list',
        payload: await listCardDeposits({
          from: p.from ? new Date(String(p.from)) : undefined,
          to: p.to ? new Date(String(p.to)) : undefined,
          page: p.page as number | undefined,
          pageSize: p.pageSize as number | undefined,
        }),
      };
    }

    case 'cardDeposit.delete': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await deleteCardDeposit(String(p.id), p.password as string | undefined);
      notifyDataChange('cardDeposit', 'delete', result);
      return { type: 'cardDeposit.delete', payload: result };
    }

    case 'companyPayment.create': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await withIdempotency(msg.clientMutationId, msg.type, user.userId, () =>
        createCompanyPayment({
          supplier: p.supplier as string | undefined,
          amount: Number(p.amount),
          method: (p.method as 'cash' | 'card') || 'cash',
          date: p.date ? new Date(String(p.date)) : undefined,
          notes: p.notes as string | undefined,
          supplierDebtId: p.supplierDebtId as string | undefined,
          createdBy: user.userId,
        })
      );
      notifyDataChange('companyPayment', 'create', result);
      return { type: 'companyPayment.create', payload: result };
    }

    case 'companyPayment.list': {
      await requireAuth(ws, msg);
      return {
        type: 'companyPayment.list',
        payload: await listCompanyPayments(
          p.from ? new Date(String(p.from)) : undefined,
          p.to ? new Date(String(p.to)) : undefined
        ),
      };
    }

    case 'companyPayment.delete': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await deleteCompanyPayment(String(p.id), p.password as string | undefined);
      notifyDataChange('companyPayment', 'delete', result);
      return { type: 'companyPayment.delete', payload: result };
    }

    case 'companyDebt.list': {
      await requireAuth(ws, msg);
      return {
        type: 'companyDebt.list',
        payload: await listSupplierDebts(p.settled as boolean | undefined),
      };
    }

    case 'companyDebt.summary': {
      await requireAuth(ws, msg);
      return { type: 'companyDebt.summary', payload: await getCompanyDebtSummary() };
    }

    case 'check.create': {
      const user = await requireAuth(ws, msg);
      const result = await withIdempotency(msg.clientMutationId, msg.type, user.userId, () =>
        createCheckReminder({
          payerName: String(p.payerName),
          customerId: p.customerId as string | undefined,
          invoiceId: p.invoiceId as string | undefined,
          invoiceNumber: p.invoiceNumber as string | undefined,
          amount: Number(p.amount),
          checkNumber: p.checkNumber as string | undefined,
          bankName: p.bankName as string | undefined,
          dueDate: new Date(String(p.dueDate)),
          followUpDate: p.followUpDate ? new Date(String(p.followUpDate)) : undefined,
          notes: p.notes as string | undefined,
          createdBy: user.userId,
        })
      );
      notifyDataChange('check', 'create', result);
      return { type: 'check.create', payload: result };
    }

    case 'check.list': {
      await requireAuth(ws, msg);
      return {
        type: 'check.list',
        payload: await listCheckReminders({
          status: (p.status as never) || 'pending',
          dueSoon: p.dueSoon as boolean | undefined,
        }),
      };
    }

    case 'check.update': {
      await requireAuth(ws, msg);
      const result = await updateCheckReminder(String(p.id), {
        payerName: p.payerName as string | undefined,
        amount: p.amount as number | undefined,
        checkNumber: p.checkNumber as string | undefined,
        bankName: p.bankName as string | undefined,
        dueDate: p.dueDate ? new Date(String(p.dueDate)) : undefined,
        followUpDate: p.followUpDate ? new Date(String(p.followUpDate)) : undefined,
        notes: p.notes as string | undefined,
        status: p.status as never,
        invoiceNumber: p.invoiceNumber as string | undefined,
      });
      notifyDataChange('check', 'update', result);
      return { type: 'check.update', payload: result };
    }

    case 'check.delete': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await deleteCheckReminder(String(p.id));
      notifyDataChange('check', 'delete', result);
      return { type: 'check.delete', payload: result };
    }

    case 'debtor.list': {
      await requireAuth(ws, msg);
      return {
        type: 'debtor.list',
        payload: await listDebtors(p.settled as boolean | undefined),
      };
    }

    case 'debtor.pay': {
      const user = await requireAuth(ws, msg);
      const result = await withIdempotency(msg.clientMutationId, msg.type, user.userId, () =>
        recordDebtPayment(String(p.id), Number(p.amount), (p.method as 'cash' | 'card') || 'cash')
      );
      notifyDataChange('debtor', 'pay', result);
      return { type: 'debtor.pay', payload: result };
    }

    case 'target.upsert': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await upsertTarget({
        marketerId: String(p.marketerId),
        year: Number(p.year),
        month: Number(p.month),
        targetAmount: p.targetAmount as number | undefined,
        targetKg: p.targetKg as number | undefined,
        notes: p.notes as string | undefined,
      });
      return { type: 'target.upsert', payload: result };
    }

    case 'target.get': {
      const user = await requireAuth(ws, msg);
      const marketerId = user.role === 'marketer' ? user.userId : String(p.marketerId || user.userId);
      const year = Number(p.year || new Date().getFullYear());
      const month = Number(p.month || new Date().getMonth() + 1);
      return { type: 'target.get', payload: await getTargetProgress(marketerId, year, month) };
    }

    case 'target.list': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      return {
        type: 'target.list',
        payload: await listTargets(p.year as number | undefined, p.month as number | undefined),
      };
    }

    case 'campaign.list': {
      await requireAuth(ws, msg);
      return {
        type: 'campaign.list',
        payload: await listCampaigns({
          activeOnly: p.activeOnly === true,
          forMarketer: p.forMarketer === true,
        }),
      };
    }

    case 'campaign.create': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await createCampaign({
        name: String(p.name || ''),
        description: p.description as string | undefined,
        active: p.active !== false,
        forMarketers: p.forMarketers !== false,
        startDate: p.startDate ? new Date(String(p.startDate)) : undefined,
        endDate: p.endDate ? new Date(String(p.endDate)) : undefined,
        rules: p.rules as never,
        suggestedInvoice: p.suggestedInvoice as never,
      });
      notifyDataChange('campaign', 'create', result);
      return { type: 'campaign.create', payload: result };
    }

    case 'campaign.update': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await updateCampaign(String(p.id), {
        name: p.name as string | undefined,
        description: p.description as string | undefined,
        active: p.active as boolean | undefined,
        forMarketers: p.forMarketers as boolean | undefined,
        startDate: p.startDate ? new Date(String(p.startDate)) : undefined,
        endDate: p.endDate ? new Date(String(p.endDate)) : undefined,
        rules: p.rules as never,
        suggestedInvoice: p.suggestedInvoice as never,
      });
      notifyDataChange('campaign', 'update', result);
      return { type: 'campaign.update', payload: result };
    }

    case 'campaign.delete': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await deleteCampaign(String(p.id));
      notifyDataChange('campaign', 'delete', result);
      return { type: 'campaign.delete', payload: result };
    }

    case 'campaign.evaluate': {
      const user = await requireAuth(ws, msg);
      return {
        type: 'campaign.evaluate',
        payload: await evaluateCampaigns({
          lines: (p.lines as never) || [],
          paymentMethod: p.paymentMethod as string | undefined,
          customerId: p.customerId as string | undefined,
          role: user.role,
        }),
      };
    }

    case 'user.list': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      return { type: 'user.list', payload: await listUsers() };
    }

    case 'user.marketers': {
      await requireAuth(ws, msg);
      return { type: 'user.marketers', payload: await listMarketers() };
    }

    case 'user.drivers':
    case 'driver.list': {
      await requireAuth(ws, msg);
      return { type: 'driver.list', payload: await listDrivers() };
    }

    case 'driver.locations': {
      const user = await requireAuth(ws, msg);
      if (user.role !== 'admin' && user.role !== 'marketer') {
        throw new Error('دسترسی ندارید');
      }
      return { type: 'driver.locations', payload: await getDriverLocations() };
    }

    case 'staff.locations': {
      const user = await requireAuth(ws, msg);
      if (user.role !== 'admin') throw new Error('فقط مدیر');
      return { type: 'staff.locations', payload: await getLiveStaffLocations() };
    }

    case 'work.set': {
      const user = await requireAuth(ws, msg);
      if (user.role !== 'marketer' && user.role !== 'driver') {
        throw new Error('فقط بازاریاب یا راننده');
      }
      const result = await setWorkActive(user.userId, p.active !== false);
      broadcast({ type: 'staff.location', payload: result });
      return { type: 'work.set', payload: result };
    }

    case 'staff.location.update':
    case 'marketer.location.update': {
      const user = await requireAuth(ws, msg);
      if (user.role !== 'marketer' && user.role !== 'driver') {
        throw new Error('فقط بازاریاب یا راننده');
      }
      const loc = await updateStaffLocation(user.userId, Number(p.lat), Number(p.lng), {
        workActive: p.workActive !== false,
      });
      broadcast({ type: 'staff.location', payload: loc });
      return { type: 'staff.location.update', payload: loc };
    }

    case 'driver.location.update': {
      const user = await requireAuth(ws, msg);
      if (user.role !== 'driver') throw new Error('فقط راننده');
      const loc = await updateDriverLocation(user.userId, Number(p.lat), Number(p.lng));
      broadcast({
        type: 'driver.location',
        payload: loc,
      });
      broadcast({ type: 'staff.location', payload: loc });
      return { type: 'driver.location.update', payload: loc };
    }

    case 'driver.jobs': {
      const user = await requireAuth(ws, msg);
      if (user.role !== 'driver' && user.role !== 'admin') throw new Error('دسترسی ندارید');
      const driverId = user.role === 'driver' ? user.userId : String(p.driverId || user.userId);
      return {
        type: 'driver.jobs',
        payload: await listDriverJobs(driverId, p.status as string | undefined),
      };
    }

    case 'driver.deliver': {
      const user = await requireAuth(ws, msg);
      if (user.role !== 'driver') throw new Error('فقط راننده');
      const result = await deliverSale(String(p.id), user.userId);
      notifyDataChange('sale', 'deliver', result.invoice);
      return { type: 'driver.deliver', payload: result };
    }

    case 'driver.profile.get': {
      const user = await requireAuth(ws, msg);
      const targetId =
        user.role === 'admin' && p.userId ? String(p.userId) : user.userId;
      return { type: 'driver.profile.get', payload: await getDriverProfile(targetId) };
    }

    case 'driver.profile.update': {
      const user = await requireAuth(ws, msg);
      if (user.role === 'admin' && p.userId) {
        const result = await updateDriverProfile(
          user.userId,
          { cardNumber: p.cardNumber as string | undefined, name: p.name as string | undefined },
          { asAdmin: true, targetUserId: String(p.userId) }
        );
        notifyDataChange('driver', 'profile', result);
        return { type: 'driver.profile.update', payload: result };
      }
      if (user.role !== 'driver' && user.role !== 'marketer') {
        throw new Error('فقط راننده، همکار یا مدیر');
      }
      const result = await updateDriverProfile(user.userId, {
        cardNumber: p.cardNumber as string | undefined,
        name: p.name as string | undefined,
      });
      notifyDataChange('driver', 'profile', result);
      return { type: 'driver.profile.update', payload: result };
    }

    case 'driver.payInvoice': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await payDriverForInvoice(String(p.id), user.userId);
      notifyDataChange('sale', 'driverPay', result.invoice);
      notifyDataChange('expense', 'create', result);
      return { type: 'driver.payInvoice', payload: result };
    }

    case 'driver.wallet.pay': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await payDriverWallet({
        driverId: String(p.driverId),
        amount: Number(p.amount),
        notes: p.notes as string | undefined,
        adminId: user.userId,
      });
      notifyDataChange('driver', 'walletPay', result);
      notifyDataChange('expense', 'create', result);
      return { type: 'driver.wallet.pay', payload: result };
    }

    case 'driver.payouts.pending': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      return { type: 'driver.payouts.pending', payload: await listDriverPayoutsPending() };
    }

    case 'partner.list': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      return {
        type: 'partner.list',
        payload: await listPartnerApprovals(p.status as string | undefined),
      };
    }

    case 'partner.approve': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await setPartnerApproval(String(p.id), 'approve', {
        canSelfDeliver: p.canSelfDeliver as boolean | undefined,
      });
      notifyDataChange('partner', 'approve', result);
      return { type: 'partner.approve', payload: result };
    }

    case 'partner.reject': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await setPartnerApproval(String(p.id), 'reject');
      notifyDataChange('partner', 'reject', result);
      return { type: 'partner.reject', payload: result };
    }

    case 'platform.config.get': {
      await requireAuth(ws, msg);
      return { type: 'platform.config.get', payload: await getPlatformConfig() };
    }

    case 'platform.config.update': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await updatePlatformConfig({
        platformEnabled: p.platformEnabled as boolean | undefined,
        commissionPercentCompany: p.commissionPercentCompany as number | undefined,
        commissionPercentSelf: p.commissionPercentSelf as number | undefined,
        platformMinOrderKg: p.platformMinOrderKg as number | undefined,
        platformCities: p.platformCities as string | undefined,
      });
      notifyDataChange('platform', 'config', result);
      return { type: 'platform.config.update', payload: result };
    }

    case 'volumeOrder.create': {
      const user = await requireAuth(ws, msg);
      if (user.role !== 'marketer' && user.role !== 'admin') throw new Error('دسترسی ندارید');
      const marketerId = user.role === 'marketer' ? user.userId : String(p.marketerId || user.userId);
      const result = await createVolumeOrder({
        marketerId,
        city: String(p.city || ''),
        customerName: p.customerName as string | undefined,
        customerPhone: p.customerPhone as string | undefined,
        address: p.address as string | undefined,
        deliveryMode: (p.deliveryMode as 'company' | 'self') || 'company',
        priceTier: (p.priceTier as 'supermarket' | 'wholesale') || 'supermarket',
        notes: p.notes as string | undefined,
        items: (p.items as never) || [],
      });
      notifyDataChange('volumeOrder', 'create', result);
      return { type: 'volumeOrder.create', payload: result };
    }

    case 'volumeOrder.list': {
      const user = await requireAuth(ws, msg);
      const marketerId =
        user.role === 'marketer' ? user.userId : (p.marketerId as string | undefined);
      return {
        type: 'volumeOrder.list',
        payload: await listVolumeOrders({
          marketerId,
          status: p.status as string | undefined,
        }),
      };
    }

    case 'volumeOrder.status': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await updateVolumeOrderStatus(
        String(p.id),
        p.status as 'approved' | 'shipping' | 'delivered' | 'cancelled',
        user.userId
      );
      notifyDataChange('volumeOrder', 'status', result);
      return { type: 'volumeOrder.status', payload: result };
    }

    case 'wallet.get': {
      const user = await requireAuth(ws, msg);
      const targetId =
        user.role === 'admin' && p.userId ? String(p.userId) : user.userId;
      return { type: 'wallet.get', payload: await getWallet(targetId) };
    }

    case 'wallet.pay': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const result = await payPartnerWallet({
        userId: String(p.userId),
        amount: Number(p.amount),
        notes: p.notes as string | undefined,
      });
      notifyDataChange('wallet', 'pay', result);
      notifyDataChange('expense', 'create', result);
      return { type: 'wallet.pay', payload: result };
    }

    case 'user.create': {
      const user = await requireAuth(ws, msg);
      requireAdmin(user);
      const created = await createUser({
        username: String(p.username),
        password: String(p.password),
        name: String(p.name),
        role: p.role as 'admin' | 'marketer' | 'driver',
      });
      return {
        type: 'user.create',
        payload: { id: created._id, username: created.username, name: created.name, role: created.role },
      };
    }

    case 'chat':
    case 'chat.message': {
      await requireAuth(ws, msg);
      const message = String(p.message || '');
      const response = localLlm.chat(message);
      if (response.suggestedAction === 'fetch_dashboard') {
        const dashboard = await getDashboard();
        response.text = `امروز:\n• فروش: ${dashboard.soldKg.toLocaleString('fa-IR')} کیلو\n• مبلغ: ${dashboard.totalSalesToman.toLocaleString('fa-IR')} تومان\n• سود خالص: ${Math.round(dashboard.netProfit).toLocaleString('fa-IR')} تومان\n• تعداد فاکتور: ${dashboard.salesCount}`;
      }
      if (response.suggestedAction === 'fetch_debtors') {
        const debtors = await listDebtors(false);
        response.text =
          debtors.length === 0
            ? 'بدهکار فعالی ندارید'
            : 'بدهکاران:\n' +
              debtors
                .map(
                  (d) =>
                    `• ${d.name}: ${(d.amount - d.paidAmount).toLocaleString('fa-IR')} تومان`
                )
                .join('\n');
      }
      return { type: 'chat.response', payload: response };
    }

    case 'chat.confirm': {
      const user = await requireAuth(ws, msg);
      const action = String(p.action);
      const data = (p.data || {}) as Record<string, unknown>;
      const result = await withIdempotency(msg.clientMutationId, `chat.${action}`, user.userId, async () => {
        switch (action) {
          case 'create_sale':
            return createSaleInvoice({
              ...(data as object as Parameters<typeof createSaleInvoice>[0]),
              marketerId:
                user.role === 'marketer'
                  ? user.userId
                  : (data.marketerId as string) || user.userId,
            });
          case 'create_purchase':
            requireAdmin(user);
            return createPurchaseInvoice({
              ...(data as object as Parameters<typeof createPurchaseInvoice>[0]),
              createdBy: user.userId,
            });
          case 'create_expense':
            requireAdmin(user);
            return createExpense(data as Parameters<typeof createExpense>[0]);
          case 'card_deposit':
            requireAdmin(user);
            return recordCardDeposit(
              Number(data.amount),
              data.description as string | undefined,
              data.date ? new Date(String(data.date)) : undefined
            );
          default:
            throw new Error('عملیات نامعتبر');
        }
      });
      notifyDataChange('chat', action, result);
      return { type: 'chat.confirm', payload: { success: true, result } };
    }

    case 'sms.parse': {
      await requireAuth(ws, msg);
      const text = String(p.text || '');
      const parsed = parseSms(text);
      const saved = await SmsMessage.create({
        rawText: text,
        sender: p.sender as string | undefined,
        parsedType: parsed.type,
        parsedAmount: parsed.amount,
        parsedData: parsed,
      });
      return { type: 'sms.parse', payload: { parsed, id: saved._id } };
    }

    default:
      return { type: 'error', payload: { message: `نوع پیام ناشناخته: ${msg.type}` } };
  }
}

export function broadcast(event: WsMessage) {
  const data = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

export function notifyDataChange(entity: string, action: string, data?: unknown) {
  broadcast({
    type: 'data_changed',
    payload: { entity, action, data, timestamp: new Date().toISOString() },
  });
}
