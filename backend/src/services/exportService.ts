import {
  Campaign,
  CashTransaction,
  Category,
  CheckReminder,
  CompanyPayment,
  Customer,
  Debtor,
  Expense,
  ExpenseCategory,
  MutationLog,
  PlatformOrder,
  Product,
  PurchaseInvoice,
  SaleInvoice,
  SalesTarget,
  ShopNote,
  ShopSettings,
  SmsMessage,
  SupplierDebt,
  User,
  WalletTransaction,
} from '../models';

export type ExportKind = 'sales' | 'purchases' | 'expenses' | 'customers' | 'database' | 'history';

const KINDS: ExportKind[] = ['sales', 'purchases', 'expenses', 'customers', 'database', 'history'];

function withoutSecrets<T extends Record<string, unknown>>(record: T) {
  const { passwordHash, actionPassword, wipePassword, mongoCompassUri, ...safe } = record;
  return safe;
}

async function records(model: { find: () => { lean: () => Promise<Record<string, unknown>[]> } }) {
  return model.find().lean();
}

/**
 * A portable, read-only JSON backup. Authentication sessions and credentials are
 * intentionally omitted, so a downloaded export cannot be used to sign in.
 */
export async function createExport(kind: ExportKind) {
  if (!KINDS.includes(kind)) throw new Error('نوع خروجی نامعتبر است');

  const generatedAt = new Date().toISOString();

  if (kind === 'sales') {
    return { exportType: 'sale_invoices', generatedAt, data: await records(SaleInvoice) };
  }
  if (kind === 'purchases') {
    return { exportType: 'purchase_invoices', generatedAt, data: await records(PurchaseInvoice) };
  }
  if (kind === 'expenses') {
    return { exportType: 'expenses', generatedAt, data: await records(Expense) };
  }
  if (kind === 'customers') {
    const [customers, invoices] = await Promise.all([records(Customer), records(SaleInvoice)]);
    const invoicesByCustomer = new Map<string, Record<string, unknown>[]>();
    const unlinkedInvoices: Record<string, unknown>[] = [];

    for (const invoice of invoices) {
      const customerId = invoice.customerId ? String(invoice.customerId) : '';
      if (!customerId) {
        unlinkedInvoices.push(invoice);
        continue;
      }
      const current = invoicesByCustomer.get(customerId) || [];
      current.push(invoice);
      invoicesByCustomer.set(customerId, current);
    }

    return {
      exportType: 'customers_with_locations_and_invoices',
      generatedAt,
      data: customers.map((customer) => ({
        ...customer,
        location: {
          lat: customer.lat ?? null,
          lng: customer.lng ?? null,
          address: customer.address ?? null,
        },
        invoices: invoicesByCustomer.get(String(customer._id)) || [],
      })),
      // Old invoices that were registered without choosing a customer remain available.
      unlinkedInvoices,
    };
  }

  const [cashTransactions, smsMessages, mutationLogs, shopNotes, checkReminders, walletTransactions, companyPayments, supplierDebts] =
    await Promise.all([
      records(CashTransaction),
      records(SmsMessage),
      records(MutationLog),
      records(ShopNote),
      records(CheckReminder),
      records(WalletTransaction),
      records(CompanyPayment),
      records(SupplierDebt),
    ]);

  if (kind === 'history') {
    return {
      exportType: 'history',
      generatedAt,
      data: {
        cashTransactions,
        smsMessages,
        mutationLogs,
        shopNotes,
        checkReminders,
        walletTransactions,
        companyPayments,
        supplierDebts,
      },
    };
  }

  const [categories, products, purchases, sales, expenses, expenseCategories, debtors, customers, settings, targets, campaigns, platformOrders, users] =
    await Promise.all([
      records(Category),
      records(Product),
      records(PurchaseInvoice),
      records(SaleInvoice),
      records(Expense),
      records(ExpenseCategory),
      records(Debtor),
      records(Customer),
      records(ShopSettings),
      records(SalesTarget),
      records(Campaign),
      records(PlatformOrder),
      records(User),
    ]);

  return {
    exportType: 'important_database_data',
    generatedAt,
    formatVersion: 1,
    data: {
      categories,
      products,
      purchaseInvoices: purchases,
      saleInvoices: sales,
      expenses,
      expenseCategories,
      debtors,
      customers,
      settings: settings.map(withoutSecrets),
      salesTargets: targets,
      campaigns,
      platformOrders,
      users: users.map(withoutSecrets),
      history: {
        cashTransactions,
        smsMessages,
        mutationLogs,
        shopNotes,
        checkReminders,
        walletTransactions,
        companyPayments,
        supplierDebts,
      },
      // Files are stored separately on disk; this preserves every file reference
      // and its product update history in the JSON backup.
      files: products
        .filter((product) => typeof product.imageUrl === 'string' && product.imageUrl.length > 0)
        .map((product) => ({
          productId: product._id,
          productName: product.name,
          path: product.imageUrl,
          createdAt: product.createdAt,
          updatedAt: product.updatedAt,
        })),
    },
    omittedForSecurity: ['sessions', 'user.passwordHash', 'settings.actionPassword', 'settings.wipePassword', 'settings.mongoCompassUri'],
  };
}
