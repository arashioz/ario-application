import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonItem,
  IonLabel,
  IonInput,
  IonButton,
  IonChip,
  IonToast,
  IonSearchbar,
  IonIcon,
  IonToggle,
  IonButtons,
  IonModal,
  IonRefresher,
  IonRefresherContent,
  IonSegment,
  IonSegmentButton,
  useIonViewWillEnter,
  RefresherEventDetail,
} from '@ionic/react';
import {
  addOutline,
  trashOutline,
  checkmarkCircleOutline,
  diamondOutline,
  removeOutline,
  timeOutline,
  sparklesOutline,
  mapOutline,
} from 'ionicons/icons';
import { wsClient, newMutationId } from '../api/ws';
import {
  parseAmount,
  formatKg,
  formatToman,
  resolveQty,
  resolvePrices,
  todayIso,
  formatMoneyInput,
  formatDate,
} from '../utils/format';
import { paymentMethods } from '../theme/colors';
import { PersianDateField } from '../components/PersianDateField';
import { MoneyInput } from '../components/MoneyInput';
import { LocationPicker } from '../components/LocationPicker';
import { InvoiceListPanel } from '../components/InvoiceListPanel';
import { useAuth } from '../auth/AuthContext';
import { resolveMediaUrl } from '../api/client';
import { geoErrorMessage, getCurrentPositionAsync, isGeoSecureContext } from '../utils/geo';
import { reverseGeocode } from '../utils/geocode';
import { useHistory } from 'react-router-dom';

type PriceTier = 'retail' | 'supermarket' | 'wholesale';
type CostBasis = 'weighted' | 'last';

interface Product {
  _id: string;
  name: string;
  stockKg: number;
  stock?: number;
  avgCostPerKg: number;
  lastPurchasePricePerKg?: number;
  purchasePrice?: number;
  kgPerPackage: number;
  imageUrl?: string;
  categoryId: {
    profitPercent: number;
    profitRetail?: number;
    profitSupermarket?: number;
    profitWholesale?: number;
  };
  profitPercent?: number;
  profitRetail?: number;
  profitSupermarket?: number;
  profitWholesale?: number;
}

interface Customer {
  _id: string;
  name: string;
  phone?: string;
  address?: string;
  lat?: number;
  lng?: number;
}

interface PrevInv {
  id?: string;
  _id?: string;
  invoiceNumber: string;
  totalAmount: number;
  date: string;
  totalKg?: number;
  discount?: number;
  priceTier?: string;
  itemCount?: number;
  items?: Array<{
    productId: string;
    productName: string;
    unit: 'kg' | 'package';
    qtyInput: number;
    unitPricePerKg: number;
    kgPerPackage: number;
  }>;
}

interface LineItem {
  key: string;
  productId: string;
  productName: string;
  imageUrl?: string;
  unit: 'kg' | 'package';
  qtyInput: string;
  unitPrice: string;
  kgPerPackage: number;
  suggestedPerKg: number;
  /** تخفیف این قلم (تومان) */
  discount: string;
}

type DiscountMode = 'invoice' | 'per_kg' | 'product';

const TIER_LABELS: Record<PriceTier, string> = {
  retail: 'تکی',
  supermarket: 'سوپرمارکت',
  wholesale: 'عمده',
};

function tierPercent(p: Product, tier: PriceTier): number {
  const c = p.categoryId;
  if (tier === 'supermarket') return p.profitSupermarket ?? c?.profitSupermarket ?? 10;
  if (tier === 'wholesale') return p.profitWholesale ?? c?.profitWholesale ?? 6;
  return p.profitRetail ?? p.profitPercent ?? c?.profitRetail ?? c?.profitPercent ?? 12;
}

function productCost(p: Product, basis: CostBasis): number {
  if (basis === 'last') {
    const last = p.lastPurchasePricePerKg || 0;
    if (last > 0) return last;
  }
  return p.avgCostPerKg ?? p.purchasePrice ?? 0;
}

const COST_BASIS_KEY = 'ario_cost_basis';

function newLineKey() {
  return `l-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const Sale: React.FC = () => {
  const { isAdmin, user } = useAuth();
  const history = useHistory();
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const [showInvoiceList, setShowInvoiceList] = useState(false);
  const [cashBalance, setCashBalance] = useState(0);
  const [cardBalance, setCardBalance] = useState(0);
  const [costBasis, setCostBasis] = useState<CostBasis>(() => {
    try {
      const v = localStorage.getItem(COST_BASIS_KEY);
      return v === 'weighted' ? 'weighted' : 'last';
    } catch {
      return 'last';
    }
  });
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [custSearch, setCustSearch] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerLat, setCustomerLat] = useState<number | null>(null);
  const [customerLng, setCustomerLng] = useState<number | null>(null);
  const [prevInvoices, setPrevInvoices] = useState<PrevInv[]>([]);
  const [suggestHint, setSuggestHint] = useState('');
  const [suggestedDiscount, setSuggestedDiscount] = useState(0);
  const [offers, setOffers] = useState<
    Array<{ key: string; label: string; amount: number; reason: string }>
  >([]);
  const [campaignOffers, setCampaignOffers] = useState<
    Array<{
      campaignId: string;
      campaignName: string;
      ruleType: string;
      label: string;
      discountPercent: number;
      discountAmount: number;
      matched: boolean;
      hint?: string;
    }>
  >([]);
  const [suggestedInvoices, setSuggestedInvoices] = useState<
    Array<{
      campaignId: string;
      campaignName: string;
      title: string;
      note?: string;
      lines: Array<{
        productName: string;
        qty: number;
        unit: 'kg' | 'package';
        resolvedProductId?: string;
      }>;
    }>
  >([]);
  const [activeCampaigns, setActiveCampaigns] = useState<
    Array<{
      _id: string;
      name: string;
      description?: string;
      rules?: Array<{ type: string; label?: string; discountPercent: number }>;
      suggestedInvoice?: { title?: string };
    }>
  >([]);
  const [powerLabel, setPowerLabel] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [lines, setLines] = useState<LineItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [payCash, setPayCash] = useState('');
  const [payCard, setPayCard] = useState('');
  const [payCardToCard, setPayCardToCard] = useState('');
  const [payCredit, setPayCredit] = useState('');
  const [workOn, setWorkOn] = useState(false);
  const [priceTier, setPriceTier] = useState<PriceTier>('retail');
  const [deliveryMode, setDeliveryMode] = useState<'company' | 'self'>('company');
  const [isGolden, setIsGolden] = useState(false);
  const [discountMode, setDiscountMode] = useState<DiscountMode>('invoice');
  const [discount, setDiscount] = useState('');
  const [discountPerKg, setDiscountPerKg] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });
  const [mapOpen, setMapOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [saleTab, setSaleTab] = useState<'single' | 'bulk'>('single');
  const [bulkCount, setBulkCount] = useState(0);
  const needsCustomer = priceTier !== 'retail';

  const loadProducts = useCallback(async () => {
    try {
      const list = await wsClient.request<Product[]>('product.list', {});
      setProducts(Array.isArray(list) ? list : []);
      if (!Array.isArray(list) || list.length === 0) {
        console.warn('product.list empty', list);
      }
    } catch (e) {
      console.warn(e);
      setToast({
        open: true,
        msg: e instanceof Error ? e.message : 'لیست محصول لود نشد',
        color: 'danger',
      });
    }
  }, []);

  const loadActiveCampaigns = useCallback(async () => {
    try {
      const list = await wsClient.request<typeof activeCampaigns>('campaign.list', {
        activeOnly: true,
        forMarketer: user?.role === 'marketer',
      });
      setActiveCampaigns(Array.isArray(list) ? list : []);
    } catch {
      setActiveCampaigns([]);
    }
  }, [user?.role]);

  useEffect(() => {
    void loadProducts();
    void loadActiveCampaigns();
  }, [loadProducts, loadActiveCampaigns]);

  useIonViewWillEnter(() => {
    void loadProducts();
    void loadActiveCampaigns();
    void wsClient
      .request<{ cashBalance?: number; cardBalance?: number; costBasis?: CostBasis }>('settings.get')
      .then((s) => {
        if (isAdmin) {
          setCashBalance(s.cashBalance || 0);
          setCardBalance(s.cardBalance || 0);
        }
        if (s.costBasis === 'weighted' || s.costBasis === 'last') {
          setCostBasis(s.costBasis);
          try {
            localStorage.setItem(COST_BASIS_KEY, s.costBasis);
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => undefined);
  });

  const applyCostBasis = async (basis: CostBasis) => {
    setCostBasis(basis);
    try {
      localStorage.setItem(COST_BASIS_KEY, basis);
    } catch {
      /* ignore */
    }
    if (isAdmin) {
      try {
        await wsClient.request('settings.update', { costBasis: basis });
      } catch {
        /* local fallback ok */
      }
    }
  };

  useEffect(() => {
    const unsub = wsClient.onEvent('data_changed', (payload: unknown) => {
      const p = payload as { entity?: string };
      if (p?.entity === 'purchase' || p?.entity === 'product' || p?.entity === 'sale') {
        void loadProducts();
      }
      if (p?.entity === 'campaign') {
        void loadActiveCampaigns();
      }
    });
    return unsub;
  }, [loadProducts, loadActiveCampaigns]);
  // بازاریاب: اشتراک موقعیت وقتی کار فعال است
  useEffect(() => {
    if (user?.role !== 'marketer' || !workOn) return;
    if (!navigator.geolocation || !isGeoSecureContext()) return;
    const wid = navigator.geolocation.watchPosition(
      (pos) => {
        void wsClient
          .request('marketer.location.update', {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            workActive: true,
          })
          .catch(console.warn);
        // اگر آدرس خالی است مختصات را برای فاکتور نگه دار
        if (customerLat == null) {
          setCustomerLat(pos.coords.latitude);
          setCustomerLng(pos.coords.longitude);
        }
      },
      console.warn,
      { enableHighAccuracy: true, maximumAge: 8000 }
    );
    return () => navigator.geolocation.clearWatch(wid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workOn, user?.role]);

  const fillAddressFromGps = () => {
    void getCurrentPositionAsync()
      .then(async (pos) => {
        const { latitude, longitude } = pos.coords;
        setCustomerLat(latitude);
        setCustomerLng(longitude);
        try {
          const geo = await reverseGeocode(latitude, longitude);
          setCustomerAddress(geo.display);
          setToast({ open: true, msg: `آدرس: ${geo.display}`, color: 'success' });
        } catch {
          setToast({ open: true, msg: 'موقعیت ثبت شد — آدرس خیابان پیدا نشد', color: 'warning' });
        }
      })
      .catch((err) => setToast({ open: true, msg: geoErrorMessage(err), color: 'warning' }));
  };

  useEffect(() => {
    const q = custSearch.trim();
    if (!q || q.length < 2) {
      setCustomers([]);
      return;
    }
    const t = setTimeout(() => {
      setLookingUp(true);
      void wsClient
        .request<{
          customers: Customer[];
          exactPhone?: Customer | null;
          fromInvoice?: {
            invoice: PrevInv & {
              customerName?: string;
              customerPhone?: string;
              customerAddress?: string;
              customerId?: string;
            };
            customer?: Customer | null;
          } | null;
        }>('customer.quick', { query: q })
        .then(async (res) => {
          setCustomers(res.customers || []);
          // موبایل دقیق → خودکار لود
          if (
            res.exactPhone?._id &&
            /^\d{8,}$/.test(q.replace(/\D/g, '')) &&
            String(res.exactPhone._id) !== customerId
          ) {
            await pickCustomer(res.exactPhone as Customer);
            return;
          }
          if (res.fromInvoice?.customer || res.fromInvoice?.invoice) {
            const inv = res.fromInvoice.invoice;
            const c = res.fromInvoice.customer;
            if (c?._id) {
              await pickCustomer(c as Customer);
            } else if (inv) {
              setCustomerName(inv.customerName || '');
              setCustomerPhone(inv.customerPhone || '');
              setCustomerAddress(inv.customerAddress || '');
              if (inv.customerId) setCustomerId(String(inv.customerId));
              setToast({
                open: true,
                msg: `فاکتور ${inv.invoiceNumber} پیدا شد`,
                color: 'success',
              });
            }
          }
        })
        .catch(console.warn)
        .finally(() => setLookingUp(false));
    }, 280);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custSearch]);

  const filtered = products.filter((p) => !search || p.name.includes(search));

  const lineQty = (productId: string) =>
    lines
      .filter((l) => l.productId === productId)
      .reduce((sum, l) => sum + (parseFloat(l.qtyInput) || 0), 0);

  const totals = useMemo(() => {
    let kg = 0;
    let amount = 0;
    let lineDisc = 0;
    for (const l of lines) {
      const qty = parseFloat(l.qtyInput) || 0;
      const price = parseAmount(l.unitPrice) || 0;
      const { qtyKg } = resolveQty(l.unit, qty, l.kgPerPackage);
      const { perKg } = resolvePrices(l.unit, price, l.kgPerPackage);
      const gross = perKg * qtyKg;
      const disc = Math.max(0, Math.min(parseAmount(l.discount) || 0, gross));
      kg += qtyKg;
      amount += gross;
      lineDisc += disc;
    }
    const afterLines = Math.max(0, amount - lineDisc);
    let invoiceDisc = 0;
    if (discountMode === 'per_kg') {
      invoiceDisc = Math.round((parseAmount(discountPerKg) || 0) * kg);
    } else if (discountMode === 'invoice') {
      invoiceDisc = parseAmount(discount) || 0;
    } else {
      // product: تخفیف فاکتور اختیاری اضافه (معمولاً ۰)
      invoiceDisc = parseAmount(discount) || 0;
    }
    invoiceDisc = Math.min(invoiceDisc, afterLines);
    const disc = lineDisc + invoiceDisc;
    return {
      kg,
      amount,
      lineDisc,
      invoiceDisc,
      disc,
      net: Math.max(afterLines - invoiceDisc, 0),
      count: lines.length,
    };
  }, [lines, discount, discountPerKg, discountMode]);

  const applySuggest = (suggest: {
    preferredTier?: string;
    lastTier?: string;
    suggestedDiscount?: number;
    lastDiscount?: number;
    suggestReason?: string;
    avgOrder?: number;
    invoiceCount?: number;
    recentInvoices?: PrevInv[];
    lastInvoice?: PrevInv | null;
    power?: string;
    timing?: string;
    daysSince?: number | null;
    offers?: Array<{ key: string; label: string; amount: number; reason: string }>;
    maxSafeByHistory?: number;
  }) => {
    const tier = (suggest.preferredTier || suggest.lastTier) as PriceTier | undefined;
    if (tier && ['retail', 'supermarket', 'wholesale'].includes(tier)) {
      setPriceTier(tier);
    }
    const disc = suggest.suggestedDiscount ?? suggest.lastDiscount ?? 0;
    setSuggestedDiscount(disc);
    setOffers(suggest.offers || []);
    const powerMap: Record<string, string> = {
      new: 'جدید',
      low: 'ضعیف',
      mid: 'متوسط',
      high: 'قوی',
      vip: 'VIP',
    };
    const timingMap: Record<string, string> = {
      new: 'بدون سابقه',
      hot: 'خرید اخیر',
      active: 'فعال',
      followup: 'موعد فالوآپ',
      dormant: 'خوابیده',
    };
    setPowerLabel(
      `قدرت خرید: ${powerMap[suggest.power || ''] || '—'} · تایم: ${timingMap[suggest.timing || ''] || '—'}${
        suggest.daysSince != null ? ` · ${suggest.daysSince} روز از آخرین خرید` : ''
      }`
    );
    setSuggestHint(
      `${suggest.suggestReason || ''} · ${suggest.invoiceCount || 0} فاکتور · میانگین ${formatToman(suggest.avgOrder || 0)}`
    );
    if (suggest.recentInvoices) setPrevInvoices(suggest.recentInvoices);
  };

  /** سقف تخفیف تا ضرر نکنی: حداکثر ۶۰٪ سود این سبد */
  const safeCartCap = useMemo(() => {
    let cost = 0;
    for (const l of lines) {
      const p = products.find((x) => x._id === l.productId);
      const costPerKg = p ? productCost(p, costBasis) : 0;
      const qty = parseFloat(l.qtyInput) || 0;
      const { qtyKg } = resolveQty(l.unit, qty, l.kgPerPackage);
      cost += costPerKg * qtyKg;
    }
    const profit = Math.max(0, totals.amount - cost);
    return {
      cost,
      profit,
      maxDiscount: Math.max(0, Math.floor(profit * 0.6)),
    };
  }, [lines, products, totals.amount, costBasis]);

  const applyOffer = (amount: number, label: string) => {
    const capped = Math.min(amount, safeCartCap.maxDiscount || amount);
    if (discountMode === 'per_kg' && totals.kg > 0) {
      const perKg = Math.round(capped / totals.kg);
      setDiscountPerKg(formatMoneyInput(String(perKg)));
      setToast({
        open: true,
        msg: `${label}: ${formatToman(perKg)}/کیلو (≈ ${formatToman(perKg * totals.kg)})`,
        color: capped < amount ? 'warning' : 'success',
      });
      return;
    }
    if (discountMode === 'product' && lines.length === 1) {
      setLines((prev) =>
        prev.map((l, i) => (i === 0 ? { ...l, discount: formatMoneyInput(String(capped)) } : l))
      );
      setToast({ open: true, msg: `${label} روی محصول اعمال شد`, color: 'success' });
      return;
    }
    if (discountMode === 'product' && lines.length > 1) {
      setDiscountMode('invoice');
      setDiscount(formatMoneyInput(String(capped)));
      setToast({
        open: true,
        msg: `${label} روی کل فاکتور اعمال شد — برای محصول خاص از سبد تخفیف بزن`,
        color: 'warning',
      });
      return;
    }
    setDiscountMode('invoice');
    setDiscount(formatMoneyInput(String(capped)));
    if (totals.amount <= 0) {
      setToast({
        open: true,
        msg: `${label}: ${formatToman(capped)} — بعد از افزودن کالا سقف امن روی سود سبد اعمال می‌شود`,
        color: 'warning',
      });
      return;
    }
    if (capped < amount) {
      setToast({
        open: true,
        msg: `${label} به ${formatToman(capped)} محدود شد تا ضرر نکنی (سقف ۶۰٪ سود سبد)`,
        color: 'warning',
      });
      return;
    }
    setToast({ open: true, msg: `${label} اعمال شد: ${formatToman(capped)}`, color: 'success' });
  };

  const applyCampaignOffer = (o: {
    ruleType: string;
    label: string;
    discountAmount: number;
    matched: boolean;
    hint?: string;
  }) => {
    if (!o.matched) {
      setToast({
        open: true,
        msg: o.hint || 'شرایط این جشنواره هنوز برقرار نیست',
        color: 'warning',
      });
      if (o.ruleType === 'payment_cash') setPaymentMethod('cash');
      if (o.ruleType === 'payment_card') setPaymentMethod('card');
      return;
    }
    if (o.ruleType === 'payment_cash') setPaymentMethod('cash');
    if (o.ruleType === 'payment_card') setPaymentMethod('card');
    applyOffer(o.discountAmount, o.label);
  };

  const applySuggestedInvoice = (sug: {
    title: string;
    note?: string;
    lines: Array<{
      productName: string;
      qty: number;
      unit: 'kg' | 'package';
      resolvedProductId?: string;
    }>;
  }) => {
    const next: LineItem[] = [];
    const missing: string[] = [];
    for (const sl of sug.lines) {
      const p =
        products.find((x) => x._id === sl.resolvedProductId) ||
        products.find((x) => x.name.includes(sl.productName) || sl.productName.includes(x.name));
      if (!p) {
        missing.push(sl.productName);
        continue;
      }
      const percent = tierPercent(p, priceTier);
      const cost = productCost(p, costBasis);
      const suggested = Math.round(cost * (1 + percent / 100));
      const unit = sl.unit || 'package';
      const price = unit === 'package' ? suggested * (p.kgPerPackage || 5) : suggested;
      next.push({
        key: newLineKey(),
        productId: p._id,
        productName: p.name,
        unit,
        qtyInput: String(sl.qty),
        unitPrice: formatMoneyInput(String(Math.round(price))),
        kgPerPackage: p.kgPerPackage || 5,
        suggestedPerKg: suggested,
        discount: '',
      });
    }
    if (!next.length) {
      setToast({
        open: true,
        msg: `محصول پیشنهادی پیدا نشد: ${missing.join('، ') || '—'}`,
        color: 'danger',
      });
      return;
    }
    setLines(next);
    setToast({
      open: true,
      msg:
        missing.length > 0
          ? `${sug.title} · بعضی اقلام نبود: ${missing.join('، ')}`
          : `${sug.title} به اقلام اضافه شد`,
      color: missing.length ? 'warning' : 'success',
    });
  };

  useEffect(() => {
    const t = window.setTimeout(() => {
      const payloadLines = lines.map((l) => {
        const qty = parseFloat(l.qtyInput) || 0;
        const price = parseAmount(l.unitPrice) || 0;
        const { qtyKg } = resolveQty(l.unit, qty, l.kgPerPackage);
        const { perKg } = resolvePrices(l.unit, price, l.kgPerPackage);
        return {
          productId: l.productId,
          productName: l.productName,
          unit: l.unit,
          qtyInput: qty,
          qtyKg,
          lineAmount: perKg * qtyKg,
          kgPerPackage: l.kgPerPackage,
        };
      });
      void wsClient
        .request<{
          offers?: typeof campaignOffers;
          suggestedInvoices?: typeof suggestedInvoices;
        }>('campaign.evaluate', {
          lines: payloadLines,
          paymentMethod,
          customerId: customerId || undefined,
        })
        .then((res) => {
          setCampaignOffers(Array.isArray(res.offers) ? res.offers : []);
          setSuggestedInvoices(Array.isArray(res.suggestedInvoices) ? res.suggestedInvoices : []);
        })
        .catch(() => {
          /* offline / no campaigns */
        });
    }, 320);
    return () => clearTimeout(t);
  }, [lines, paymentMethod, customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickCustomer = async (c: Customer) => {
    setCustomerId(c._id);
    setCustomerName(c.name);
    setCustomerPhone(c.phone || '');
    setCustomerAddress(c.address || '');
    setCustomerLat(c.lat ?? null);
    setCustomerLng(c.lng ?? null);
    setCustSearch(c.name);
    setCustomers([]);
    try {
      const res = await wsClient.request<{
        invoices: Array<{
          _id: string;
          invoiceNumber: string;
          totalAmount: number;
          date: string;
          totalKg?: number;
          discount?: number;
          priceTier?: string;
          items?: PrevInv['items'];
        }>;
        suggest?: Parameters<typeof applySuggest>[0];
      }>('customer.get', { id: c._id });
      setPrevInvoices(
        (res.invoices || []).map((inv) => ({
          id: inv._id,
          invoiceNumber: inv.invoiceNumber,
          totalAmount: inv.totalAmount,
          date: inv.date,
          totalKg: inv.totalKg,
          discount: inv.discount,
          priceTier: inv.priceTier,
          itemCount: inv.items?.length,
          items: inv.items?.map((i) => ({
            productId: String(i.productId),
            productName: i.productName,
            unit: i.unit,
            qtyInput: i.qtyInput,
            unitPricePerKg: i.unitPricePerKg,
            kgPerPackage: i.kgPerPackage,
          })),
        }))
      );
      if (res.suggest) applySuggest(res.suggest);
      setHistOpen(true);
    } catch {
      setPrevInvoices([]);
    }
  };

  const applyInvoiceTemplate = (inv: PrevInv) => {
    if (inv.priceTier) setPriceTier(inv.priceTier as PriceTier);
    if (inv.discount) setDiscount(formatMoneyInput(String(inv.discount)));
    if (inv.items?.length) {
      setLines(
        inv.items.map((i) => ({
          key: newLineKey(),
          productId: String(i.productId),
          productName: i.productName,
          unit: i.unit || 'kg',
          qtyInput: String(i.qtyInput || 1),
          unitPrice: formatMoneyInput(String(i.unitPricePerKg)),
          kgPerPackage: i.kgPerPackage || 5,
          suggestedPerKg: i.unitPricePerKg,
          discount: '',
        }))
      );
      setToast({ open: true, msg: `اقلام فاکتور ${inv.invoiceNumber} بارگذاری شد`, color: 'success' });
    } else {
      // fetch full invoice via suggest lastInvoice or sale list
      void wsClient
        .request<{ suggest?: { lastInvoice?: PrevInv } }>('customer.get', {
          id: customerId,
          productId: undefined,
        })
        .then((res) => {
          const full = res.suggest?.lastInvoice;
          if (full?.items?.length && full.invoiceNumber === inv.invoiceNumber) {
            applyInvoiceTemplate(full);
          } else {
            setToast({ open: true, msg: 'اقلام این فاکتور در دسترس نیست — تخفیف اعمال شد', color: 'warning' });
          }
        })
        .catch(console.warn);
    }
    setHistOpen(false);
  };

  const addProduct = (p: Product) => {
    const percent = tierPercent(p, priceTier);
    const cost = productCost(p, costBasis);
    const suggested = Math.round(cost * (1 + percent / 100));
    setLines((prev) => [
      ...prev,
      {
        key: newLineKey(),
        productId: p._id,
        productName: p.name,
        imageUrl: p.imageUrl,
        unit: 'package',
        qtyInput: '1',
        unitPrice: formatMoneyInput(String(suggested * (p.kgPerPackage || 5))),
        kgPerPackage: p.kgPerPackage || 5,
        suggestedPerKg: suggested,
        discount: '',
      },
    ]);
  };

  useEffect(() => {
    setLines((prev) =>
      prev.map((l) => {
        const p = products.find((x) => x._id === l.productId);
        if (!p) return l;
        const percent = tierPercent(p, priceTier);
        const cost = productCost(p, costBasis);
        const suggested = Math.round(cost * (1 + percent / 100));
        const price = l.unit === 'package' ? suggested * (l.kgPerPackage || 5) : suggested;
        return { ...l, suggestedPerKg: suggested, unitPrice: formatMoneyInput(String(Math.round(price))) };
      })
    );
  }, [priceTier, costBasis]); // eslint-disable-line react-hooks/exhaustive-deps

  const bumpQty = (idx: number, delta: number) => {
    setLines((prev) =>
      prev
        .map((l, i) => {
          if (i !== idx) return l;
          const next = Math.max(0, (parseFloat(l.qtyInput) || 0) + delta);
          return { ...l, qtyInput: String(next) };
        })
        .filter((l) => (parseFloat(l.qtyInput) || 0) > 0)
    );
  };

  const openPdf = async (id: string) => {
    const res = await wsClient.request<{ html: string }>('sale.pdf', { id });
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(res.html);
      w.document.close();
    }
  };

  const submit = async () => {
    if (!lines.length) {
      setToast({ open: true, msg: 'اقلامی نیست — اول محصول اضافه کنید', color: 'danger' });
      return;
    }
    setLoading(true);
    try {
      const net = totals.net;
      let payment: { cash?: number; card?: number; credit?: number } | undefined;
      if (paymentMethod === 'mixed') {
        let cash = parseAmount(payCash) || 0;
        const pos = parseAmount(payCard) || 0;
        const c2c = parseAmount(payCardToCard) || 0;
        let card = pos + c2c;
        let credit = parseAmount(payCredit) || 0;
        const sum = cash + card + credit;
        if (sum === 0) card = net;
        else if (Math.abs(sum - net) > 1) {
          credit = Math.max(0, net - cash - card);
        }
        payment = { cash, card, credit };
      }

      const invoice = await wsClient.request<{ _id: string; invoiceNumber: string; status: string }>(
        'sale.create',
        {
          customerId: customerId || undefined,
          customerName: customerName || undefined,
          customerPhone: customerPhone || undefined,
          customerAddress: customerAddress || undefined,
          customerLat: customerLat ?? undefined,
          customerLng: customerLng ?? undefined,
          paymentMethod,
          payment,
          date,
          dueDate:
            paymentMethod === 'credit' || (paymentMethod === 'mixed' && (parseAmount(payCredit) || 0) > 0)
              ? dueDate || undefined
              : undefined,
          priceTier,
          deliveryMode: !isAdmin ? deliveryMode : undefined,
          isGolden,
          discountMode,
          discount:
            discountMode === 'per_kg'
              ? totals.invoiceDisc
              : parseAmount(discount) || 0,
          discountPerKg:
            discountMode === 'per_kg' ? parseAmount(discountPerKg) || 0 : undefined,
          notes: notes || undefined,
          items: lines.map((l) => ({
            productId: l.productId,
            unit: l.unit,
            qtyInput: parseFloat(l.qtyInput) || 0,
            unitPrice: parseAmount(l.unitPrice) || undefined,
            discount: parseAmount(l.discount) || 0,
          })),
        },
        { clientMutationId: newMutationId(), queueIfOffline: true }
      );

      if ((invoice as { queued?: boolean }).queued) {
        setToast({ open: true, msg: 'آفلاین در صف قرار گرفت — بعد از وصل ثبت می‌شود', color: 'warning' });
      } else {
        const msg =
          invoice.status === 'pending'
            ? `فاکتور ${invoice.invoiceNumber} ثبت شد — منتظر تأیید ادمین`
            : `فاکتور ${invoice.invoiceNumber} ثبت شد`;
        setToast({ open: true, msg, color: 'success' });
        if (saleTab !== 'bulk') {
          await openPdf(invoice._id);
        }
        setListRefreshKey((k) => k + 1);
      }

      setLines([]);
      setDiscount('');
      setDiscountPerKg('');
      setDiscountMode('invoice');
      setNotes('');
      setIsGolden(false);
      setPayCash('');
      setPayCard('');
      setPayCardToCard('');
      setPayCredit('');
      if (saleTab !== 'bulk') {
        setPaymentMethod('card');
      }
      setCustomerId('');
      setCustomerName('');
      setCustomerPhone('');
      setCustomerAddress('');
      setCustomerLat(null);
      setCustomerLng(null);
      setCustSearch('');
      setCustomers([]);
      setPrevInvoices([]);
      setSuggestHint('');
      if (saleTab === 'bulk') {
        setBulkCount((c) => c + 1);
      } else {
        setBulkCount(0);
      }
      setSuggestedDiscount(0);
      setOffers([]);
      setCampaignOffers([]);
      setSuggestedInvoices([]);
      setPowerLabel('');
      setDueDate('');
      setDate(todayIso());
      setDeliveryMode('company');
      setPriceTier('retail');
      setMapOpen(false);
      setHistOpen(false);
    } catch (e) {
      setToast({
        open: true,
        msg: e instanceof Error ? e.message : 'ثبت نشد — خطا',
        color: 'danger',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <IonPage className="sale-page-navy">
      <IonHeader translucent className="ios-header sale-navy-header">
        <IonToolbar>
          <IonTitle>{isGolden ? 'فاکتور طلایی' : 'فاکتور فروش'}</IonTitle>
          <IonButtons slot="end">
            <IonChip color={user?.role === 'marketer' ? 'warning' : 'primary'}>
              {user?.role === 'marketer' ? 'نیاز به تأیید' : 'ثبت مستقیم'}
            </IonChip>
          </IonButtons>
        </IonToolbar>
        <IonToolbar>
          <IonSegment
            value={saleTab}
            onIonChange={(e) => setSaleTab((e.detail.value as 'single' | 'bulk') || 'single')}
          >
            <IonSegmentButton value="single">
              <IonLabel>فاکتور تکی</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="bulk">
              <IonLabel>دسته‌جمعی روزانه</IonLabel>
            </IonSegmentButton>
          </IonSegment>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="page-content ios-content sale-navy-content">
        <IonRefresher
          slot="fixed"
          onIonRefresh={async (e: CustomEvent<RefresherEventDetail>) => {
            try {
              await loadProducts();
              await loadActiveCampaigns();
            } finally {
              e.detail.complete();
            }
          }}
        >
          <IonRefresherContent />
        </IonRefresher>
        <div className="ion-padding compact sale-navy-body" style={{ paddingBottom: 100 }}>
          {user?.role === 'marketer' && (
            <div className="ios-glass-card ios-row sale-navy-card">
              <div>
                <div className="ios-label">شروع کار / اشتراک لوکیشن</div>
                <div className="ios-caption">{workOn ? 'مدیر موقعیتت را می‌بیند' : 'خاموش'}</div>
              </div>
              <IonToggle
                checked={workOn}
                onIonChange={async (e) => {
                  const on = e.detail.checked;
                  setWorkOn(on);
                  try {
                    await wsClient.request('work.set', { active: on });
                    if (on) fillAddressFromGps();
                  } catch (err) {
                    setToast({
                      open: true,
                      msg: err instanceof Error ? err.message : 'خطا',
                      color: 'danger',
                    });
                  }
                }}
              />
            </div>
          )}

          <div className={`ios-glass-card sale-navy-card sale-toolbar ${isGolden ? 'golden-card' : ''}`}>
            {saleTab === 'bulk' && (
              <p className="hint convert-hint" style={{ marginTop: 0 }}>
                حالت سریع روزانه — بعد از ثبت فقط مشتری و اقلام پاک می‌شود
                {bulkCount > 0 ? ` · امروز ${bulkCount.toLocaleString('fa-IR')} فاکتور ثبت شد` : ''}
              </p>
            )}
            <div className="sale-tier-row">
              {(Object.keys(TIER_LABELS) as PriceTier[]).map((t) => (
                <button
                  type="button"
                  key={t}
                  className={`sale-tier-btn ${priceTier === t ? 'active' : ''}`}
                  onClick={() => setPriceTier(t)}
                >
                  {TIER_LABELS[t]}
                </button>
              ))}
              <IonToggle
                checked={isGolden}
                onIonChange={(e) => setIsGolden(e.detail.checked)}
                title="فاکتور طلایی"
              />
            </div>
            <div className="chip-row" style={{ marginTop: 6 }}>
              <IonChip
                className={costBasis === 'last' ? 'ios-chip-active' : 'ios-chip'}
                onClick={() => void applyCostBasis('last')}
              >
                قیمت آخر خرید
              </IonChip>
              <IonChip
                className={costBasis === 'weighted' ? 'ios-chip-active' : 'ios-chip'}
                onClick={() => void applyCostBasis('weighted')}
              >
                میانگین موزون
              </IonChip>
            </div>
            <p className="hint" style={{ margin: '4px 0 0' }}>
              {costBasis === 'last'
                ? 'قیمت پیشنهادی بر اساس آخرین خرید است'
                : 'قیمت پیشنهادی بر اساس میانگین موزون موجودی است'}
            </p>
          </div>

          <div className="ios-glass-card sale-navy-card">
            <IonSearchbar
              value={custSearch}
              debounce={150}
              placeholder="مشتری: موبایل، نام یا فاکتور…"
              className="ios-search"
              onIonInput={(e) => setCustSearch(e.detail.value || '')}
            />
            {customers.length > 0 && (
              <div className="cust-chip-row">
                {customers.slice(0, 4).map((c) => (
                  <button
                    type="button"
                    key={c._id}
                    className={`cust-pill ${customerId === c._id ? 'active' : ''}`}
                    onClick={() => void pickCustomer(c)}
                  >
                    {c.name}
                    {c.phone ? ` · ${c.phone.slice(-4)}` : ''}
                  </button>
                ))}
              </div>
            )}

            {customerId && (
              <div className="cust-picked">
                <div className="ios-row">
                  <div>
                    <strong>{customerName}</strong>
                    <div className="ios-caption">
                      {customerPhone || '—'}
                      {customerAddress ? ` · ${customerAddress}` : ''}
                    </div>
                  </div>
                  <IonButton size="small" fill="outline" onClick={() => setHistOpen(true)}>
                    <IonIcon slot="start" icon={timeOutline} />
                    قبلی
                  </IonButton>
                </div>
                {powerLabel && <p className="hint convert-hint">{powerLabel}</p>}
                {suggestHint && (
                  <p className="hint convert-hint">
                    <IonIcon icon={sparklesOutline} /> {suggestHint}
                  </p>
                )}
                <div className="offer-row">
                  {(offers.length
                    ? offers
                    : suggestedDiscount > 0
                      ? [
                          {
                            key: 'special',
                            label: 'آفر ویژه',
                            amount: suggestedDiscount,
                            reason: suggestHint,
                          },
                        ]
                      : []
                  ).map((o) => (
                    <IonButton
                      key={o.key}
                      size="small"
                      className={o.key === 'special' ? 'offer-btn special' : 'offer-btn'}
                      onClick={() => applyOffer(o.amount, o.label)}
                    >
                      <IonIcon slot="start" icon={sparklesOutline} />
                      {o.label}
                      <br />
                      <span className="offer-amt">{formatToman(o.amount)}</span>
                    </IonButton>
                  ))}
                </div>
              </div>
            )}

            {(needsCustomer || customerId) && (
              <details className="sale-details">
                <summary>آدرس و نقشه</summary>
                <IonItem lines="full">
                  <IonLabel position="stacked">نام</IonLabel>
                  <IonInput
                    value={customerName}
                    onIonInput={(e) => setCustomerName(e.detail.value || '')}
                  />
                </IonItem>
                <IonItem lines="full">
                  <IonLabel position="stacked">موبایل</IonLabel>
                  <IonInput
                    value={customerPhone}
                    inputmode="tel"
                    placeholder="09…"
                    onIonInput={(e) => {
                      const v = e.detail.value || '';
                      setCustomerPhone(v);
                      const digits = v.replace(/\D/g, '');
                      if (digits.length >= 8) setCustSearch(v);
                    }}
                  />
                </IonItem>
                <div className="sale-address-row">
                  <IonItem lines="none" className="sale-address-input">
                    <IonLabel position="stacked">آدرس</IonLabel>
                    <IonInput
                      value={customerAddress}
                      onIonInput={(e) => setCustomerAddress(e.detail.value || '')}
                      placeholder="آدرس ارسال"
                    />
                  </IonItem>
                  <IonButton
                    className="sale-map-btn"
                    fill="outline"
                    onClick={() => setMapOpen(true)}
                  >
                    <IonIcon slot="start" icon={mapOutline} />
                    نقشه
                  </IonButton>
                </div>
                {(customerLat != null && customerLng != null) && (
                  <p className="hint" style={{ marginTop: 4 }}>
                    موقعیت انتخاب شده · {customerLat.toFixed(5)}, {customerLng.toFixed(5)}
                  </p>
                )}
              </details>
            )}
          </div>

          {!isAdmin && (
            <div className="chip-row">
              <IonChip
                className={deliveryMode === 'company' ? 'ios-chip-active' : 'ios-chip'}
                onClick={() => setDeliveryMode('company')}
              >
                پخش شرکت
              </IonChip>
              <IonChip
                className={deliveryMode === 'self' ? 'ios-chip-active' : 'ios-chip'}
                onClick={() => setDeliveryMode('self')}
              >
                پخش خودم
              </IonChip>
            </div>
          )}

          <div className="sale-products-head">
            <span>محصولات ({filtered.length})</span>
            <IonSearchbar
              value={search}
              placeholder="جستجو…"
              className="ios-search sale-prod-search"
              onIonInput={(e) => setSearch(e.detail.value || '')}
            />
          </div>
          <div className="product-card-grid product-card-grid-dense">
            {filtered.length === 0 && (
              <p className="hint">محصولی نیست — از خرید ثبت کن</p>
            )}
            {filtered.map((p) => {
              const stock = p.stockKg ?? p.stock ?? 0;
              const inLines = lineQty(p._id);
              const percent = tierPercent(p, priceTier);
              const cost = productCost(p, costBasis);
              const suggested = Math.round(cost * (1 + percent / 100));
              return (
                <button
                  type="button"
                  key={p._id}
                  className={`product-card product-card-dense product-card-side ${inLines ? 'in-cart' : ''} ${stock <= 0 ? 'out' : ''}`}
                  onClick={() => addProduct(p)}
                >
                  {p.imageUrl ? (
                    <img src={resolveMediaUrl(p.imageUrl)} alt="" className="pc-thumb-sm" />
                  ) : (
                    <div className="pc-thumb-sm pc-thumb-ph">{p.name.slice(0, 1)}</div>
                  )}
                  <div className="pc-side-body">
                    <div className="pc-top">
                      <span className="pc-badge">{p.kgPerPackage || 5}kg</span>
                      {inLines > 0 && <span className="pc-qty">×{inLines}</span>}
                    </div>
                    <div className="pc-name">{p.name}</div>
                    <div className="pc-meta">{formatKg(stock)}</div>
                    <div className="pc-price">{formatToman(suggested)}</div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="ios-glass-card sale-navy-card">
            <div className="ios-row" style={{ marginBottom: 8 }}>
              <strong>اقلام فاکتور ({lines.length})</strong>
              <span className="ios-caption">{formatToman(totals.net)}</span>
            </div>
            {lines.length === 0 && (
              <p className="hint">روی محصول بزنید تا قلم اضافه شود — هر قلم قیمت جدا دارد</p>
            )}
            {lines.map((l, idx) => {
              const qty = parseFloat(l.qtyInput) || 0;
              const price = parseAmount(l.unitPrice) || 0;
              const { qtyKg, qtyPackages } = resolveQty(l.unit, qty, l.kgPerPackage);
              const { perKg } = resolvePrices(l.unit, price, l.kgPerPackage);
              return (
                <div key={l.key} className="cart-item-card">
                  <div className="ios-row">
                    <div className="cart-item-title">
                      {l.imageUrl ? (
                        <img src={resolveMediaUrl(l.imageUrl)} alt="" className="cart-thumb" />
                      ) : (
                        <div className="cart-thumb cart-thumb-ph">{l.productName.slice(0, 1)}</div>
                      )}
                      <strong>
                        {idx + 1}. {l.productName}
                      </strong>
                    </div>
                    <IonButton
                      fill="clear"
                      color="danger"
                      size="small"
                      onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                    >
                      <IonIcon icon={trashOutline} />
                    </IonButton>
                  </div>
                  <div className="chip-row">
                    <IonChip
                      className={l.unit === 'kg' ? 'ios-chip-active' : 'ios-chip'}
                      onClick={() =>
                        setLines(
                          lines.map((x, i) =>
                            i === idx
                              ? {
                                  ...x,
                                  unit: 'kg',
                                  unitPrice: formatMoneyInput(String(x.suggestedPerKg)),
                                }
                              : x
                          )
                        )
                      }
                    >
                      کیلو
                    </IonChip>
                    <IonChip
                      className={l.unit === 'package' ? 'ios-chip-active' : 'ios-chip'}
                      onClick={() =>
                        setLines(
                          lines.map((x, i) =>
                            i === idx
                              ? {
                                  ...x,
                                  unit: 'package',
                                  unitPrice: formatMoneyInput(
                                    String(Math.round(x.suggestedPerKg * (x.kgPerPackage || 5)))
                                  ),
                                }
                              : x
                          )
                        )
                      }
                    >
                      بسته
                    </IonChip>
                  </div>
                  <div className="qty-stepper">
                    <IonButton fill="outline" size="small" onClick={() => bumpQty(idx, -1)}>
                      <IonIcon icon={removeOutline} />
                    </IonButton>
                    <IonInput
                      type="number"
                      className="qty-input"
                      value={l.qtyInput}
                      onIonInput={(e) =>
                        setLines(
                          lines.map((x, i) =>
                            i === idx ? { ...x, qtyInput: e.detail.value || '' } : x
                          )
                        )
                      }
                    />
                    <IonButton fill="outline" size="small" onClick={() => bumpQty(idx, 1)}>
                      <IonIcon icon={addOutline} />
                    </IonButton>
                    <IonButton fill="solid" size="small" className="qty-plus5" onClick={() => bumpQty(idx, 5)}>
                      +۵
                    </IonButton>
                  </div>
                  <IonItem lines="none">
                    <IonLabel position="stacked">فی تومان (قابل تغییر)</IonLabel>
                    <IonInput
                      inputmode="numeric"
                      value={l.unitPrice}
                      onIonInput={(e) =>
                        setLines(
                          lines.map((x, i) =>
                            i === idx
                              ? { ...x, unitPrice: formatMoneyInput(e.detail.value || '') }
                              : x
                          )
                        )
                      }
                    />
                  </IonItem>
                  {discountMode === 'product' && (
                    <MoneyInput
                      label="تخفیف این قلم (تومان)"
                      value={l.discount}
                      onChange={(v) =>
                        setLines(lines.map((x, i) => (i === idx ? { ...x, discount: v } : x)))
                      }
                    />
                  )}
                  <p className="hint convert-hint">
                    {formatKg(qtyKg)} · {Math.round(qtyPackages).toLocaleString('fa-IR')} بسته ·{' '}
                    {formatToman(Math.max(0, perKg * qtyKg - (parseAmount(l.discount) || 0)))}
                  </p>
                </div>
              );
            })}
          </div>

          <details className="sale-details ios-glass-card sale-navy-card">
            <summary>تخفیف و پرداخت · {formatToman(totals.net)}</summary>
            <PersianDateField value={date} onChange={setDate} />
            <div className="chip-row">
              {(
                [
                  { value: 'invoice' as DiscountMode, label: 'کل فاکتور' },
                  { value: 'per_kg' as DiscountMode, label: 'هر کیلو' },
                  { value: 'product' as DiscountMode, label: 'محصول' },
                ] as const
              ).map((m) => (
                <IonChip
                  key={m.value}
                  className={discountMode === m.value ? 'ios-chip-active' : 'ios-chip'}
                  onClick={() => setDiscountMode(m.value)}
                >
                  {m.label}
                </IonChip>
              ))}
            </div>
            {discountMode === 'per_kg' ? (
              <MoneyInput
                label="تخفیف هر کیلو"
                value={discountPerKg}
                onChange={(v) => setDiscountPerKg(v)}
              />
            ) : discountMode === 'product' ? (
              <p className="hint">تخفیف هر قلم را در لیست اقلام بالا تنظیم کنید</p>
            ) : (
              <MoneyInput label="تخفیف کل" value={discount} onChange={(v) => setDiscount(v)} />
            )}

            {activeCampaigns.length > 0 && (
              <div className="campaign-active-list" style={{ marginTop: 8 }}>
                {activeCampaigns.slice(0, 2).map((c) => (
                  <div key={c._id} className="hint">
                    🎉 {c.name}
                  </div>
                ))}
              </div>
            )}
            {(campaignOffers.length > 0 || suggestedInvoices.length > 0) && (
              <div className="offer-row">
                {suggestedInvoices.map((s) => (
                  <IonButton
                    key={`sug-${s.campaignId}`}
                    size="small"
                    fill="outline"
                    className="offer-btn"
                    onClick={() => applySuggestedInvoice(s)}
                  >
                    {s.title}
                  </IonButton>
                ))}
                {campaignOffers.map((o, i) => (
                  <IonButton
                    key={`${o.campaignId}-${o.ruleType}-${i}`}
                    size="small"
                    className={o.matched ? 'offer-btn special' : 'offer-btn'}
                    fill={o.matched ? 'solid' : 'outline'}
                    onClick={() => applyCampaignOffer(o)}
                  >
                    {o.label}
                  </IonButton>
                ))}
              </div>
            )}
            <IonItem>
              <IonLabel position="stacked">یادداشت</IonLabel>
              <IonInput value={notes} onIonInput={(e) => setNotes(e.detail.value || '')} />
            </IonItem>
            <div className="chip-row">
              {paymentMethods.map((m) => (
                <IonChip
                  key={m.value}
                  className={paymentMethod === m.value ? 'ios-chip-active' : 'ios-chip'}
                  onClick={() => setPaymentMethod(m.value)}
                >
                  {m.label}
                </IonChip>
              ))}
            </div>
            {paymentMethod === 'mixed' && (
              <div className="mixed-pay">
                <MoneyInput label="نقد" value={payCash} onChange={(v) => setPayCash(v)} />
                <MoneyInput label="پوز" value={payCard} onChange={(v) => setPayCard(v)} />
                <MoneyInput
                  label="کارت به کارت"
                  value={payCardToCard}
                  onChange={(v) => setPayCardToCard(v)}
                />
                <MoneyInput label="نسیه" value={payCredit} onChange={(v) => setPayCredit(v)} />
              </div>
            )}
            {(paymentMethod === 'credit' ||
              (paymentMethod === 'mixed' && (parseAmount(payCredit) || 0) > 0)) && (
              <PersianDateField label="سررسید نسیه" value={dueDate} onChange={setDueDate} />
            )}
          </details>

          <IonButton
            expand="block"
            className="ios-primary-btn"
            color={isGolden ? 'warning' : 'primary'}
            onClick={submit}
            disabled={loading}
          >
            <IonIcon slot="start" icon={isGolden ? diamondOutline : checkmarkCircleOutline} />
            {loading ? '…' : isAdmin ? `ثبت · ${formatToman(totals.net)}` : 'ارسال برای تأیید'}
          </IonButton>

          {isAdmin && (
            <div className="ios-glass-card sale-navy-card" style={{ marginTop: 10 }}>
              <div className="ios-row">
                <div className="ios-caption">
                  نقد {formatToman(cashBalance)} · کارت {formatToman(cardBalance)}
                </div>
                <IonButton size="small" fill="clear" onClick={() => history.push('/history')}>
                  صندوق
                </IonButton>
              </div>
            </div>
          )}

          <IonButton
            expand="block"
            fill="outline"
            size="small"
            className="ion-margin-top"
            onClick={() => setShowInvoiceList((v) => !v)}
          >
            {showInvoiceList ? 'بستن لیست فاکتورها' : 'نمایش فاکتورهای قبلی'}
          </IonButton>
          {showInvoiceList && (
            <InvoiceListPanel
              kind="sale"
              refreshKey={listRefreshKey}
              onToast={(msg, color) => setToast({ open: true, msg, color: color || 'success' })}
            />
          )}
        </div>

        {/* نقشه آدرس — فقط با دکمه باز می‌شود */}
        <IonModal isOpen={mapOpen} onDidDismiss={() => setMapOpen(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>انتخاب روی نقشه</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setMapOpen(false)}>تأیید</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <LocationPicker
              lat={customerLat}
              lng={customerLng}
              address={customerAddress}
              height={360}
              onChange={({ lat, lng, address }) => {
                setCustomerLat(lat);
                setCustomerLng(lng);
                if (address) setCustomerAddress(address);
              }}
            />
            {customerAddress && (
              <p className="hint convert-hint" style={{ marginTop: 10 }}>
                {customerAddress}
              </p>
            )}
          </IonContent>
        </IonModal>

        {/* تاریخچه فاکتور مشتری */}
        <IonModal isOpen={histOpen} onDidDismiss={() => setHistOpen(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>فاکتورهای {customerName}</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setHistOpen(false)}>بستن</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            {suggestHint && <p className="hint convert-hint">{suggestHint}</p>}
            {prevInvoices.length === 0 && <div className="empty-state">فاکتوری نیست</div>}
            {prevInvoices.map((inv) => (
              <div key={inv.invoiceNumber} className="ios-glass-card">
                <div className="ios-row">
                  <strong>{inv.invoiceNumber}</strong>
                  <span className="ios-caption">{formatDate(inv.date)}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">مبلغ</span>
                  <span className="stat-value">{formatToman(inv.totalAmount)}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">تناژ</span>
                  <span className="stat-value">{formatKg(inv.totalKg || 0)}</span>
                </div>
                {inv.discount ? (
                  <div className="stat-row">
                    <span className="stat-label">تخفیف</span>
                    <span className="stat-value">{formatToman(inv.discount)}</span>
                  </div>
                ) : null}
                {inv.priceTier && (
                  <IonChip outline>{TIER_LABELS[inv.priceTier as PriceTier] || inv.priceTier}</IonChip>
                )}
                <IonButton
                  expand="block"
                  size="small"
                  className="ion-margin-top"
                  onClick={() => {
                    if (inv.items?.length) applyInvoiceTemplate(inv);
                    else {
                      // load suggest.lastInvoice if matching
                      void wsClient
                        .request<{
                          suggest?: { lastInvoice?: PrevInv; recentInvoices?: PrevInv[]; suggestedDiscount?: number; preferredTier?: string };
                        }>('customer.get', { id: customerId })
                        .then((res) => {
                          const match =
                            res.suggest?.lastInvoice?.invoiceNumber === inv.invoiceNumber
                              ? res.suggest.lastInvoice
                              : null;
                          if (match) applyInvoiceTemplate(match);
                          else {
                            if (res.suggest?.preferredTier) setPriceTier(res.suggest.preferredTier as PriceTier);
                            if (inv.discount) setDiscount(formatMoneyInput(String(inv.discount)));
                            else if (res.suggest?.suggestedDiscount)
                              setDiscount(formatMoneyInput(String(res.suggest.suggestedDiscount)));
                            setToast({
                              open: true,
                              msg: 'نوع قیمت و تخفیف از تاریخچه اعمال شد',
                              color: 'success',
                            });
                            setHistOpen(false);
                          }
                        });
                    }
                  }}
                >
                  استفاده به‌عنوان فاکتور پیشنهادی
                </IonButton>
              </div>
            ))}
          </IonContent>
        </IonModal>

        <IonToast
          isOpen={toast.open}
          message={toast.msg}
          color={toast.color}
          duration={2800}
          onDidDismiss={() => setToast((t) => ({ ...t, open: false }))}
          position="top"
        />
      </IonContent>
    </IonPage>
  );
};

export default Sale;
