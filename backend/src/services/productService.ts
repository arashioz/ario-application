import { Category, Product, ShopSettings } from '../models';
import { normalizeProductName, isValidBackdate } from '../utils/persian';
import { getShopOpeningDate } from '../config/database';
import { Types } from 'mongoose';

export type QtyUnit = 'kg' | 'package';

export function resolveQty(input: {
  unit: QtyUnit;
  qtyInput: number;
  kgPerPackage: number;
}): { qtyKg: number; qtyPackages: number } {
  const kgPer = input.kgPerPackage || 5;
  if (input.unit === 'package') {
    return { qtyKg: input.qtyInput * kgPer, qtyPackages: input.qtyInput };
  }
  return { qtyKg: input.qtyInput, qtyPackages: kgPer > 0 ? input.qtyInput / kgPer : 0 };
}

export function resolvePrices(input: {
  unit: QtyUnit;
  unitPrice: number;
  kgPerPackage: number;
}): { unitPricePerKg: number; unitPricePerPackage: number } {
  const kgPer = input.kgPerPackage || 5;
  if (input.unit === 'package') {
    return {
      unitPricePerPackage: input.unitPrice,
      unitPricePerKg: kgPer > 0 ? Math.round(input.unitPrice / kgPer) : input.unitPrice,
    };
  }
  return {
    unitPricePerKg: input.unitPrice,
    unitPricePerPackage: Math.round(input.unitPrice * kgPer),
  };
}

export async function getOrCreateSettings() {
  let settings = await ShopSettings.findOne();
  if (!settings) {
    settings = await ShopSettings.create({
      shopName: 'مغازه آریو — قند',
      openingDate: getShopOpeningDate(),
      cashBalance: 0,
      cardBalance: 0,
    });
  }
  return settings;
}

export async function upsertProduct(data: {
  name: string;
  categoryId: string;
  purchasePricePerKg: number;
  quantityKg?: number;
  kgPerPackage?: number;
  profitPercent?: number;
  sku?: string;
  notes?: string;
}) {
  const normalizedName = normalizeProductName(data.name);
  let product = await Product.findOne({ normalizedName });
  const addKg = data.quantityKg || 0;

  if (product) {
    const oldKg = product.stockKg ?? product.stock ?? 0;
    const oldAvg = product.avgCostPerKg ?? product.purchasePrice ?? 0;
    if (addKg > 0 && data.purchasePricePerKg > 0) {
      const newAvg = Math.round(
        (oldAvg * oldKg + data.purchasePricePerKg * addKg) / Math.max(oldKg + addKg, 1)
      );
      product.avgCostPerKg = newAvg;
      product.purchasePrice = newAvg;
      product.lastPurchasePricePerKg = Math.round(data.purchasePricePerKg);
    }
    product.stockKg = oldKg + addKg;
    product.stock = product.stockKg;
    if (data.kgPerPackage) product.kgPerPackage = data.kgPerPackage;
    if (data.profitPercent !== undefined) product.profitPercent = data.profitPercent;
    if (data.categoryId) product.categoryId = new Types.ObjectId(data.categoryId);
    await product.save();
    return { product, isNew: false };
  }

  product = await Product.create({
    name: data.name.trim(),
    normalizedName,
    categoryId: new Types.ObjectId(data.categoryId),
    avgCostPerKg: data.purchasePricePerKg,
    lastPurchasePricePerKg: data.purchasePricePerKg,
    purchasePrice: data.purchasePricePerKg,
    stockKg: addKg,
    stock: addKg,
    kgPerPackage: data.kgPerPackage || 5,
    profitPercent: data.profitPercent,
    sku: data.sku,
    notes: data.notes,
  });

  return { product, isNew: true };
}

export async function findProductByName(name: string) {
  const normalized = normalizeProductName(name);
  return Product.findOne({ normalizedName: normalized }).populate('categoryId');
}

export async function listProducts(search?: string) {
  const filter: Record<string, unknown> = {};
  if (search) {
    filter.name = { $regex: search, $options: 'i' };
  }
  // موجودی بیشتر اول — و نام تکراری فقط یک‌بار (همان که موجودی دارد)
  const all = await Product.find(filter).populate('categoryId').sort({ stockKg: -1, name: 1 });
  const seen = new Set<string>();
  const unique: typeof all = [];
  for (const p of all) {
    const key = (p.normalizedName || p.name || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }
  return unique;
}

export async function getCategories() {
  return Category.find().sort({ name: 1 });
}

/** ساخت یا یافتن دسته با نام — برای ورود دستی در فاکتور خرید */
export async function getOrCreateCategoryByName(
  name: string,
  profits?: {
    profitRetail?: number;
    profitSupermarket?: number;
    profitWholesale?: number;
    profitPercent?: number;
  }
) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('نام دسته الزامی است');
  let cat = await Category.findOne({ name: trimmed });
  if (cat) return cat;

  const retail = profits?.profitRetail ?? profits?.profitPercent ?? 15;
  const supermarket = profits?.profitSupermarket ?? Math.max(retail - 4, 0);
  const wholesale = profits?.profitWholesale ?? Math.max(retail - 8, 0);

  cat = await Category.create({
    name: trimmed,
    profitPercent: retail,
    profitRetail: retail,
    profitSupermarket: supermarket,
    profitWholesale: wholesale,
  });
  return cat;
}

export async function createCategory(
  name: string,
  profitPercent: number,
  description?: string,
  extras?: { profitRetail?: number; profitSupermarket?: number; profitWholesale?: number }
) {
  const retail = extras?.profitRetail ?? profitPercent;
  return Category.create({
    name,
    profitPercent: retail,
    profitRetail: retail,
    profitSupermarket: extras?.profitSupermarket ?? Math.max(retail - 4, 0),
    profitWholesale: extras?.profitWholesale ?? Math.max(retail - 8, 0),
    description,
  });
}

export async function updateCategory(
  id: string,
  data: {
    name?: string;
    profitPercent?: number;
    profitRetail?: number;
    profitSupermarket?: number;
    profitWholesale?: number;
    description?: string;
  }
) {
  const cat = await Category.findById(id);
  if (!cat) throw new Error('دسته یافت نشد');
  if (data.name !== undefined) cat.name = data.name;
  if (data.profitRetail !== undefined) {
    cat.profitRetail = data.profitRetail;
    cat.profitPercent = data.profitRetail;
  } else if (data.profitPercent !== undefined) {
    cat.profitPercent = data.profitPercent;
    cat.profitRetail = data.profitPercent;
  }
  if (data.profitSupermarket !== undefined) cat.profitSupermarket = data.profitSupermarket;
  if (data.profitWholesale !== undefined) cat.profitWholesale = data.profitWholesale;
  if (data.description !== undefined) cat.description = data.description;
  await cat.save();
  return cat;
}

export async function deleteCategory(id: string) {
  const cat = await Category.findById(id);
  if (!cat) throw new Error('دسته یافت نشد');
  const used = await Product.countDocuments({ categoryId: id });
  if (used > 0) {
    throw new Error(`این دسته روی ${used} محصول است؛ اول محصولات را جابه‌جا کنید`);
  }
  await cat.deleteOne();
  return { ok: true, id };
}

export type PriceTier = 'retail' | 'supermarket' | 'wholesale';

function tierPercent(
  category: {
    profitPercent?: number;
    profitRetail?: number;
    profitSupermarket?: number;
    profitWholesale?: number;
  } | null,
  productPercent: number | undefined,
  tier: PriceTier
): number {
  if (productPercent != null && tier === 'retail') return productPercent;
  if (!category) return 15;
  if (tier === 'supermarket') return category.profitSupermarket ?? category.profitPercent ?? 10;
  if (tier === 'wholesale') return category.profitWholesale ?? category.profitPercent ?? 6;
  return category.profitRetail ?? category.profitPercent ?? 15;
}

export type CostBasis = 'weighted' | 'last';

export function resolveProductCost(
  product: {
    avgCostPerKg?: number;
    purchasePrice?: number;
    lastPurchasePricePerKg?: number;
  },
  costBasis: CostBasis = 'last'
): number {
  if (costBasis === 'last') {
    const last = product.lastPurchasePricePerKg || 0;
    if (last > 0) return last;
  }
  return product.avgCostPerKg ?? product.purchasePrice ?? 0;
}

export async function calculateSalePrice(
  productId: string,
  customPercent?: number,
  priceTier: PriceTier = 'retail',
  costBasis: CostBasis = 'last'
) {
  const product = await Product.findById(productId).populate('categoryId');
  if (!product) throw new Error('محصول یافت نشد');

  const category = product.categoryId as unknown as {
    profitPercent: number;
    profitRetail?: number;
    profitSupermarket?: number;
    profitWholesale?: number;
  };

  const percent =
    customPercent ??
    tierPercent(category, product.profitPercent, priceTier);

  const cost = resolveProductCost(product, costBasis);
  const salePricePerKg = Math.round(cost * (1 + percent / 100));
  return {
    salePrice: salePricePerKg,
    salePricePerKg,
    salePricePerPackage: Math.round(salePricePerKg * (product.kgPerPackage || 5)),
    percent,
    priceTier,
    costBasis,
    purchasePrice: cost,
    avgCostPerKg: product.avgCostPerKg ?? product.purchasePrice ?? 0,
    lastPurchasePricePerKg: product.lastPurchasePricePerKg || 0,
    kgPerPackage: product.kgPerPackage || 5,
  };
}

export function validateTransactionDate(date: Date) {
  const opening = getShopOpeningDate();
  if (!isValidBackdate(date, opening)) {
    throw new Error(`تاریخ باید بین ${opening.toLocaleDateString('fa-IR')} و امروز باشد`);
  }
}

export async function updateBalances(cashDelta: number, cardDelta: number) {
  const settings = await getOrCreateSettings();
  settings.cashBalance += cashDelta;
  settings.cardBalance += cardDelta;
  await settings.save();
  return settings;
}

export async function generateInvoiceNumber(prefix: string): Promise<string> {
  const models = await import('../models');
  let count = 0;
  if (prefix === 'PUR') count = await models.PurchaseInvoice.countDocuments();
  else if (prefix === 'GOL') count = await models.SaleInvoice.countDocuments({ isGolden: true });
  else count = await models.SaleInvoice.countDocuments({ isGolden: { $ne: true } });
  const date = new Date();
  const y = date.getFullYear().toString().slice(-2);
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${prefix}-${y}${m}${d}-${String(count + 1).padStart(4, '0')}`;
}

export async function updateProduct(
  id: string,
  data: {
    catalogVisible?: boolean;
    catalogMinQty?: number;
    catalogPricePerKg?: number | null;
    catalogNote?: string;
    imageUrl?: string;
    notes?: string;
    name?: string;
  }
) {
  const p = await Product.findById(id);
  if (!p) throw new Error('محصول یافت نشد');
  if (data.catalogVisible !== undefined) p.catalogVisible = data.catalogVisible;
  if (data.catalogMinQty !== undefined) p.catalogMinQty = Math.max(0, data.catalogMinQty);
  if (data.catalogPricePerKg === null) p.catalogPricePerKg = undefined;
  else if (data.catalogPricePerKg !== undefined) p.catalogPricePerKg = data.catalogPricePerKg;
  if (data.catalogNote !== undefined) p.catalogNote = data.catalogNote;
  if (data.imageUrl !== undefined) p.imageUrl = data.imageUrl;
  if (data.notes !== undefined) p.notes = data.notes;
  if (data.name?.trim()) {
    p.name = data.name.trim();
    p.normalizedName = normalizeProductName(data.name);
  }
  await p.save();
  return Product.findById(id).populate('categoryId');
}

export async function saveProductImage(productId: string, dataUrl: string) {
  const fs = await import('fs');
  const path = await import('path');
  const match = /^data:(image\/[\w+.-]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) throw new Error('فرمت تصویر نامعتبر است');
  const mime = match[1].toLowerCase();
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  const buf = Buffer.from(match[2], 'base64');
  if (buf.length > 3_500_000) throw new Error('حجم تصویر حداکثر ۳٫۵ مگابایت');

  const dir = path.join(process.cwd(), 'uploads', 'products');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${productId}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), buf);
  const imageUrl = `/uploads/products/${filename}?t=${Date.now()}`;
  return updateProduct(productId, { imageUrl });
}

/** کاتالوگ عمومی مشتریان — بدون auth */
export async function getPublicCatalog() {
  const settings = await getOrCreateSettings();
  const supermarketMinKg = settings.catalogSupermarketMinKg || 500;
  const wholesaleMinKg = settings.catalogWholesaleMinKg || 2000;

  if (settings.catalogEnabled === false) {
    return {
      enabled: false,
      shopName: settings.shopName,
      brandName: settings.brandName || settings.shopName,
      brandTagline: settings.brandTagline || null,
      brandPrimaryColor: settings.brandPrimaryColor || '#0d9488',
      brandLogoUrl: settings.brandLogoUrl || null,
      title: settings.catalogTitle || settings.shopName,
      products: [] as unknown[],
      tiers: {
        supermarketMinKg,
        wholesaleMinKg,
      },
    };
  }

  const products = await Product.find({ catalogVisible: true }).sort({ name: 1 });
  const items = [];
  for (const p of products) {
    const retail = await calculateSalePrice(p._id.toString(), undefined, 'retail');
    const supermarket = await calculateSalePrice(p._id.toString(), undefined, 'supermarket');
    const wholesale = await calculateSalePrice(p._id.toString(), undefined, 'wholesale');
    const kgPer = p.kgPerPackage || 5;
    const retailPerKg =
      p.catalogPricePerKg && p.catalogPricePerKg > 0
        ? Math.round(p.catalogPricePerKg)
        : retail.salePricePerKg;

    items.push({
      id: p._id.toString(),
      name: p.name,
      imageUrl: p.imageUrl || null,
      kgPerPackage: kgPer,
      minQty: p.catalogMinQty || 1,
      minQtyUnit: 'package' as const,
      note: p.catalogNote || null,
      /** سازگاری قدیمی */
      pricePerKg: retailPerKg,
      pricePerPackage: Math.round(retailPerKg * kgPer),
      prices: {
        retail: {
          label: 'تکی / خرده‌فروشی',
          pricePerKg: retailPerKg,
          pricePerPackage: Math.round(retailPerKg * kgPer),
        },
        supermarket: {
          label: `از ${supermarketMinKg.toLocaleString('fa-IR')} کیلو`,
          minKg: supermarketMinKg,
          pricePerKg: supermarket.salePricePerKg,
          pricePerPackage: Math.round(supermarket.salePricePerKg * kgPer),
        },
        wholesale: {
          label: `از ${(wholesaleMinKg / 1000).toLocaleString('fa-IR')} تن`,
          minKg: wholesaleMinKg,
          pricePerKg: wholesale.salePricePerKg,
          pricePerPackage: Math.round(wholesale.salePricePerKg * kgPer),
        },
      },
    });
  }

  return {
    enabled: true,
    shopName: settings.shopName,
    brandName: settings.brandName || settings.shopName,
    brandTagline: settings.brandTagline || null,
    brandPrimaryColor: settings.brandPrimaryColor || '#0d9488',
    brandLogoUrl: settings.brandLogoUrl || null,
    title: settings.catalogTitle || `کاتالوگ قیمت ${settings.brandName || settings.shopName}`,
    phone: settings.catalogPhone || null,
    note: settings.catalogNote || null,
    updatedAt: new Date().toISOString(),
    tiers: {
      supermarketMinKg,
      wholesaleMinKg,
    },
    products: items,
  };
}


