import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  IonCheckbox,
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
  personAddOutline,
  mapOutline,
  eyeOutline,
  copyOutline,
} from 'ionicons/icons';
import { wsClient, newMutationId } from '../api/ws';
import {
  parseAmount,
  formatKg,
  formatToman,
  resolveQty,
  resolvePrices,
  resolveLineAmount,
  todayIso,
  formatMoneyInput,
  formatDate,
  normalizePhone,
  sanitizeNumberInput,
  roundToman,
  roundPerKgDiscount,
  priceFromPercent,
} from '../utils/format';
import { paymentMethods } from '../theme/colors';
import { PersianDateField } from '../components/PersianDateField';
import { MoneyInput } from '../components/MoneyInput';
import { InvoiceListPanel } from '../components/InvoiceListPanel';
import { useAuth } from '../auth/AuthContext';
import { resolveMediaUrl } from '../api/client';
import { geoErrorMessage, getCurrentPositionAsync, isGeoSecureContext } from '../utils/geo';
import { reverseGeocode } from '../utils/geocode';
import { useHistory, useLocation } from 'react-router-dom';
import { DigitInput } from '../components/DigitInput';
import { LocationPicker } from '../components/LocationPicker';
import {
  buildInvoiceShareText,
  buildCardTransferText,
  copyText,
  pickDefaultBankCard,
} from '../utils/invoiceShare';

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
  /** تخفیف این قلم — در حالت محصول = تومان/کیلو */
  discount: string;
}

type BankCard = {
  label: string;
  cardNumber: string;
  accountHolder?: string;
  bankName?: string;
  isDefault?: boolean;
};

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
  const avg = p.avgCostPerKg ?? p.purchasePrice ?? 0;
  const last = p.lastPurchasePricePerKg || p.purchasePrice || 0;
  if (basis === 'weighted') return avg || last;
  return last || avg;
}

const COST_BASIS_KEY = 'ario_cost_basis';

function newLineKey() {
  return `l-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const Sale: React.FC = () => {
  const { isAdmin, user } = useAuth();
  const history = useHistory();
  const location = useLocation<{
    followUpCustomerId?: string;
    followUpDiscount?: number;
    followUpTier?: string;
  }>();
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
      giftLine?: {
        productName: string;
        qty: number;
        unit: 'kg' | 'package';
        resolvedProductId?: string;
      };
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
  const [creditIsCheck, setCreditIsCheck] = useState(false);
  const [workOn, setWorkOn] = useState(false);
  const [priceTier, setPriceTier] = useState<PriceTier | null>(null);
  const [dateModalOpen, setDateModalOpen] = useState(false);
  const [deliveryMode, setDeliveryMode] = useState<'company' | 'self'>('company');
  const [isGolden, setIsGolden] = useState(false);
  const [discountMode, setDiscountMode] = useState<DiscountMode>('invoice');
  const [discount, setDiscount] = useState('');
  const [discountPerKg, setDiscountPerKg] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [appliedOffer, setAppliedOffer] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });
  const [histOpen, setHistOpen] = useState(false);
  const [saleTab, setSaleTab] = useState<'single' | 'bulk'>('single');
  const [bulkCount, setBulkCount] = useState(0);
  /** نوع غالب مشتری از تاریخچه — برای قفل قانون عمده≠تکی */
  const [customerPreferredTier, setCustomerPreferredTier] = useState<PriceTier | null>(null);
  /** پاپ‌آپ افزودن/ویرایش مشتری */
  const [custModalOpen, setCustModalOpen] = useState(false);
  const [custModalName, setCustModalName] = useState('');
  const [custModalPhone, setCustModalPhone] = useState('');
  const [custModalAddress, setCustModalAddress] = useState('');
  const [custModalSaving, setCustModalSaving] = useState(false);
  const [custModalMode, setCustModalMode] = useState<'create' | 'edit'>('create');
  const [custModalShowMap, setCustModalShowMap] = useState(false);
  const [custModalLat, setCustModalLat] = useState<number | null>(null);
  const [custModalLng, setCustModalLng] = useState<number | null>(null);
  const [histDetailId, setHistDetailId] = useState<string | null>(null);
  const [bankCards, setBankCards] = useState<BankCard[]>([]);
  const [selectedBankCard, setSelectedBankCard] = useState(0);
  const [goldenAutoEnabled, setGoldenAutoEnabled] = useState(true);
  const [goldenMinKg, setGoldenMinKg] = useState(500);
  const [goldenGiftName, setGoldenGiftName] = useState('کارتن');
  const [goldenGiftQty, setGoldenGiftQty] = useState(1);
  const [goldenDiscPercent, setGoldenDiscPercent] = useState(5);
  const [shopName, setShopName] = useState('');
  const followUpHandled = useRef(false);
  const goldenAutoToastShown = useRef(false);
  /** پاپ‌آپ افزودن/ویرایش محصول */
  const [prodModalOpen, setProdModalOpen] = useState(false);
  const [prodModalProduct, setProdModalProduct] = useState<Product | null>(null);
  const [prodModalEditKey, setProdModalEditKey] = useState<string | null>(null);
  const [prodModalUnit, setProdModalUnit] = useState<'kg' | 'package'>('package');
  const [prodModalQty, setProdModalQty] = useState('1');
  const [prodModalPrice, setProdModalPrice] = useState('');
  const needsCustomer = priceTier != null && priceTier !== 'retail';
  const isWholesaleCustomer = customerPreferredTier === 'wholesale';
  /** تا وقتی تیو قیمت انتخاب نشده، قیمت‌گذاری با پیش‌فرض تکی حساب می‌شود ولی UI قفل است */
  const calcTier: PriceTier = priceTier || 'retail';
  const stepsUnlocked = priceTier != null;

  const selectPriceTier = (t: PriceTier) => {
    if (t === 'retail' && isWholesaleCustomer) {
      setToast({
        open: true,
        msg: 'مشتری عمده است — فاکتور تکی مجاز نیست',
        color: 'danger',
      });
      return;
    }
    setPriceTier(t);
  };

  const openAddCustomerModal = (
    phone = '',
    name = '',
    address = '',
    mode: 'create' | 'edit' = 'create'
  ) => {
    setCustModalMode(mode);
    setCustModalPhone(phone || (mode === 'edit' ? customerPhone : '') || '');
    setCustModalName(name || (mode === 'edit' ? customerName : '') || '');
    setCustModalAddress(address || (mode === 'edit' ? customerAddress : '') || '');
    setCustModalLat(mode === 'edit' ? customerLat : null);
    setCustModalLng(mode === 'edit' ? customerLng : null);
    setCustModalShowMap(false);
    setCustModalOpen(true);
  };

  const saveCustomerFromModal = async () => {
    const name = custModalName.trim();
    const phone = normalizePhone(custModalPhone) || custModalPhone.trim();
    if (!name) {
      setToast({ open: true, msg: 'نام مشتری را وارد کنید', color: 'danger' });
      return;
    }
    setCustModalSaving(true);
    try {
      if (custModalMode === 'edit' && customerId) {
        await wsClient.request(
          'customer.update',
          {
            id: customerId,
            name,
            phone: phone || undefined,
            address: custModalAddress.trim() || undefined,
            lat: custModalLat ?? undefined,
            lng: custModalLng ?? undefined,
          },
          { clientMutationId: newMutationId(), queueIfOffline: true }
        );
        setCustomerName(name);
        setCustomerPhone(phone);
        setCustomerAddress(custModalAddress.trim());
        setCustomerLat(custModalLat);
        setCustomerLng(custModalLng);
        setCustModalOpen(false);
        setToast({ open: true, msg: 'مشتری به‌روز شد', color: 'success' });
        return;
      }
      const created = await wsClient.request<Customer>(
        'customer.create',
        {
          name,
          phone: phone || undefined,
          address: custModalAddress.trim() || undefined,
          lat: custModalLat ?? undefined,
          lng: custModalLng ?? undefined,
        },
        { clientMutationId: newMutationId(), queueIfOffline: true }
      );
      setCustModalOpen(false);
      setToast({ open: true, msg: 'مشتری اضافه شد', color: 'success' });
      if (created?._id) {
        await pickCustomer(created);
      } else {
        setCustomerName(name);
        setCustomerPhone(phone);
        setCustomerAddress(custModalAddress.trim());
        setCustomerLat(custModalLat);
        setCustomerLng(custModalLng);
        setCustSearch(name);
      }
    } catch (e) {
      setToast({
        open: true,
        msg: e instanceof Error ? e.message : 'ثبت مشتری نشد',
        color: 'danger',
      });
    } finally {
      setCustModalSaving(false);
    }
  };

  const clearCustomer = () => {
    setCustomerId('');
    setCustomerName('');
    setCustomerPhone('');
    setCustomerAddress('');
    setCustomerLat(null);
    setCustomerLng(null);
    setCustomerPreferredTier(null);
    setCustSearch('');
    setCustomers([]);
    setPrevInvoices([]);
    setSuggestHint('');
    setPowerLabel('');
    setOffers([]);
    setSuggestedDiscount(0);
    setAppliedOffer('');
  };

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
      .request<{ cashBalance?: number; cardBalance?: number; costBasis?: CostBasis; bankCards?: BankCard[]; goldenAutoEnabled?: boolean; goldenMinKg?: number; goldenSuggestGiftName?: string; goldenSuggestGiftQty?: number; goldenSuggestDiscountPercent?: number; shopName?: string }>('settings.get')
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
        if (Array.isArray(s.bankCards)) {
          setBankCards(s.bankCards);
          const di = s.bankCards.findIndex((c) => c.isDefault);
          setSelectedBankCard(di >= 0 ? di : 0);
        }
        if (s.goldenAutoEnabled !== undefined) setGoldenAutoEnabled(s.goldenAutoEnabled !== false);
        if (s.goldenMinKg != null) setGoldenMinKg(s.goldenMinKg);
        if (s.goldenSuggestGiftName) setGoldenGiftName(s.goldenSuggestGiftName);
        if (s.goldenSuggestGiftQty != null) setGoldenGiftQty(s.goldenSuggestGiftQty);
        if (s.goldenSuggestDiscountPercent != null) setGoldenDiscPercent(s.goldenSuggestDiscountPercent);
        if (s.shopName) setShopName(s.shopName);
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
    const sample = products[0];
    if (sample) {
      const cost = productCost(sample, basis);
      setToast({
        open: true,
        msg:
          basis === 'weighted'
            ? `میانگین موزون فعال — نمونه ${sample.name}: ${formatToman(cost)}/کیلو`
            : `قیمت آخر خرید فعال — نمونه ${sample.name}: ${formatToman(cost)}/کیلو`,
        color: 'success',
      });
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
          const phoneDigits = normalizePhone(q).replace(/\D/g, '');
          const looksLikePhone = phoneDigits.length >= 10;

          // موبایل دقیق → خودکار لود
          if (
            res.exactPhone?._id &&
            phoneDigits.length >= 8 &&
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
              return;
            }
            if (inv) {
              setCustomerName(inv.customerName || '');
              setCustomerPhone(inv.customerPhone || '');
              setCustomerAddress(inv.customerAddress || '');
              if (inv.customerId) setCustomerId(String(inv.customerId));
              setToast({
                open: true,
                msg: `فاکتور ${inv.invoiceNumber} پیدا شد`,
                color: 'success',
              });
              return;
            }
          }

          // شماره کامل زده شده ولی مشتری نیست → پاپ‌آپ افزودن
          if (
            looksLikePhone &&
            !res.exactPhone &&
            !(res.customers || []).length &&
            !customerId
          ) {
            openAddCustomerModal(phoneDigits);
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
      const { qtyKg, lineAmount } = resolveLineAmount(l.unit, price, qty, l.kgPerPackage);
      let disc = 0;
      if (discountMode === 'product') {
        // تخفیف محصول = تومان به ازای هر کیلو
        const perKgDisc = parseAmount(l.discount) || 0;
        disc = Math.max(0, Math.min(roundToman(perKgDisc * qtyKg), lineAmount));
      } else {
        disc = Math.max(0, Math.min(parseAmount(l.discount) || 0, lineAmount));
      }
      kg += qtyKg;
      amount += lineAmount;
      lineDisc += disc;
    }
    const afterLines = Math.max(0, amount - lineDisc);
    let invoiceDisc = 0;
    if (discountMode === 'per_kg') {
      invoiceDisc = Math.round((roundPerKgDiscount(parseAmount(discountPerKg) || 0)) * kg);
    } else if (discountMode === 'invoice') {
      invoiceDisc = roundToman(parseAmount(discount) || 0);
    } else {
      // product: تخفیف فاکتور اختیاری اضافه (معمولاً ۰)
      invoiceDisc = roundToman(parseAmount(discount) || 0);
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

  // ترکیبی: با تغییر مبلغ فاکتور، مانده نسیه را دوباره حساب کن
  useEffect(() => {
    if (paymentMethod !== 'mixed') return;
    const cash = parseAmount(payCash) || 0;
    const pos = parseAmount(payCard) || 0;
    const c2c = parseAmount(payCardToCard) || 0;
    const rem = Math.max(0, totals.net - cash - pos - c2c);
    const next = rem > 0 ? formatMoneyInput(String(rem)) : '';
    if ((parseAmount(payCredit) || 0) !== rem) setPayCredit(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totals.net, paymentMethod]);

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
      setCustomerPreferredTier(tier);
      // مشتری عمده → تکی ممنوع؛ نوع را روی عمده می‌گذاریم
      if (tier === 'wholesale') setPriceTier('wholesale');
      else setPriceTier(tier);
    } else {
      setCustomerPreferredTier(null);
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

  /** تحلیل سود: خرید + درصد پیشنهادی + قیمت واقعی بعد از تخفیف */
  const marginInfo = useMemo(() => {
    let cost = 0;
    let suggestedGross = 0;
    const lineHints: Array<{
      key: string;
      name: string;
      costPerKg: number;
      pct: number;
      suggestedPerKg: number;
      yourPerKg: number;
      diffPerKg: number;
      status: 'low' | 'ok' | 'high';
    }> = [];

    for (const l of lines) {
      const p = products.find((x) => x._id === l.productId);
      const costPerKg = p ? productCost(p, costBasis) : 0;
      const pct = p ? tierPercent(p, calcTier) : 0;
      const suggestedPerKg = p
        ? l.suggestedPerKg > 0
          ? l.suggestedPerKg
          : priceFromPercent(costPerKg, pct)
        : 0;
      const qty = parseFloat(l.qtyInput) || 0;
      const price = parseAmount(l.unitPrice) || 0;
      const { qtyKg } = resolveLineAmount(l.unit, price, qty, l.kgPerPackage);
      const yourPerKg =
        l.unit === 'package' && l.kgPerPackage > 0
          ? Math.round(price / l.kgPerPackage)
          : Math.round(price);
      cost += costPerKg * qtyKg;
      suggestedGross += suggestedPerKg * qtyKg;
      const diff = yourPerKg - suggestedPerKg;
      const status: 'low' | 'ok' | 'high' =
        Math.abs(diff) <= Math.max(100, suggestedPerKg * 0.01)
          ? 'ok'
          : diff < 0
            ? 'low'
            : 'high';
      lineHints.push({
        key: l.key,
        name: l.productName,
        costPerKg,
        pct,
        suggestedPerKg,
        yourPerKg,
        diffPerKg: diff,
        status,
      });
    }

    const targetProfit = suggestedGross - cost;
    /** سود واقعی بعد از تخفیف — تخفیف از سود فروش کم می‌کند */
    const actualProfit = totals.net - cost;

    return {
      cost: Math.round(cost),
      suggestedGross: Math.round(suggestedGross),
      targetProfit: Math.round(targetProfit),
      actualProfit: Math.round(actualProfit),
      vsTarget: Math.round(actualProfit - targetProfit),
      discount: totals.disc,
      net: totals.net,
      lineHints,
      maxDiscount: Math.max(0, Math.floor(Math.max(0, targetProfit) * 0.6)),
    };
  }, [lines, products, totals.net, totals.disc, costBasis, calcTier]);

  const safeCartCap = useMemo(
    () => ({
      cost: marginInfo.cost,
      profit: Math.max(0, marginInfo.targetProfit),
      maxDiscount: marginInfo.maxDiscount,
    }),
    [marginInfo]
  );

  const applyOffer = (amount: number, label: string) => {
    const capped = roundToman(Math.min(amount, safeCartCap.maxDiscount || amount));
    setAppliedOffer(label);
    if (discountMode === 'per_kg' && totals.kg > 0) {
      const perKg = roundPerKgDiscount(capped / totals.kg);
      setDiscountPerKg(formatMoneyInput(String(perKg)));
      setToast({
        open: true,
        msg: `${label}: ${formatToman(perKg)}/کیلو (≈ ${formatToman(perKg * totals.kg)})`,
        color: capped < amount ? 'warning' : 'success',
      });
      return;
    }
    if (discountMode === 'product' && lines.length === 1) {
      const qty = parseFloat(lines[0].qtyInput) || 0;
      const { qtyKg } = resolveQty(lines[0].unit, qty, lines[0].kgPerPackage);
      const perKgDisc = qtyKg > 0 ? Math.round(capped / qtyKg) : capped;
      setLines((prev) =>
        prev.map((l, i) =>
          i === 0 ? { ...l, discount: formatMoneyInput(String(perKgDisc)) } : l
        )
      );
      setToast({
        open: true,
        msg: `${label}: ${formatToman(perKgDisc)}/کیلو (≈ ${formatToman(capped)})`,
        color: 'success',
      });
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

  /** امتیازهای مدیر فروش روی فاکتور طلایی */
  const applyGoldenPerk = (
    kind: 'pct5' | 'pct10' | 'pct15' | 'perkg' | 'gift1' | 'vip_combo'
  ) => {
    if (!lines.length) {
      setToast({ open: true, msg: 'اول اقلام را به سبد اضافه کن', color: 'warning' });
      return;
    }
    const addGift = (qty = 1) => {
      const base = lines.find((l) => (parseAmount(l.unitPrice) || 0) > 0) ?? lines[0];
      if (!base) return false;
      const p = products.find((x) => x._id === base.productId);
      if (!p) return false;
      setLines((prev) => {
        const without = prev.filter(
          (l) => !(l.productId === p._id && (parseAmount(l.unitPrice) || 0) === 0)
        );
        return [
          ...without,
          {
            key: newLineKey(),
            productId: p._id,
            productName: `🎁 اشانتیون طلایی ${p.name}`,
            imageUrl: p.imageUrl,
            unit: 'package' as const,
            qtyInput: String(qty),
            unitPrice: '0',
            kgPerPackage: p.kgPerPackage || 5,
            suggestedPerKg: 0,
            discount: '',
          },
        ];
      });
      return true;
    };

    if (kind === 'gift1') {
      if (!addGift(1)) {
        setToast({ open: true, msg: 'محصول برای اشانتیون پیدا نشد', color: 'danger' });
        return;
      }
      setAppliedOffer('اشانتیون طلایی ۱ بسته');
      setToast({ open: true, msg: 'اشانتیون طلایی ۱ بسته اضافه شد', color: 'success' });
      return;
    }

    if (kind === 'perkg') {
      setDiscountMode('per_kg');
      setDiscountPerKg(formatMoneyInput('1000'));
      setAppliedOffer('تخفیف طلایی ۱۰۰۰ ت/کیلو');
      setToast({
        open: true,
        msg: `تخفیف طلایی ۱۰۰۰ ت/کیلو ≈ ${formatToman(1000 * totals.kg)}`,
        color: 'success',
      });
      return;
    }

    const pct = kind === 'pct5' ? 5 : kind === 'pct10' ? 10 : kind === 'pct15' ? 15 : 5;
    const amount = roundToman((totals.amount * pct) / 100);
    if (kind === 'vip_combo') {
      addGift(1);
      applyOffer(amount, `بسته VIP طلایی ${pct}٪ + اشانتیون`);
      return;
    }
    applyOffer(amount, `تخفیف طلایی ${pct}٪`);
  };

  const goldenSuggestions = useMemo(() => {
    if (!lines.length) return [] as Array<{ key: string; text: string; action: 'disc' | 'gift' | 'vip' }>;
    const tips: Array<{ key: string; text: string; action: 'disc' | 'gift' | 'vip' }> = [];
    const minKg = goldenMinKg || 500;
    const hit = goldenAutoEnabled && totals.kg >= minKg;
    if (hit || isGolden) {
      tips.push({
        key: 'disc',
        text: `بیش از ${minKg} کیلو — تخفیف ${goldenDiscPercent}٪ می‌خوای؟ (≈ ${formatToman(roundToman((totals.amount * goldenDiscPercent) / 100))})`,
        action: 'disc',
      });
      tips.push({
        key: 'gift',
        text: `پیشنهاد: ${goldenGiftQty} ${goldenGiftName} اشانتیون اضافه کنم؟`,
        action: 'gift',
      });
      tips.push({
        key: 'vip',
        text: `بسته طلایی: تخفیف ${goldenDiscPercent}٪ + ${goldenGiftQty} ${goldenGiftName}`,
        action: 'vip',
      });
    } else if (isGolden) {
      tips.push({
        key: 'manual',
        text: 'مشتری ویژه — یکی از امتیازهای زیر را بزن',
        action: 'disc',
      });
    }
    return tips;
  }, [
    lines.length,
    totals.kg,
    totals.amount,
    isGolden,
    goldenAutoEnabled,
    goldenMinKg,
    goldenGiftName,
    goldenGiftQty,
    goldenDiscPercent,
  ]);

  // وقتی از حد طلایی رد شد، خودکار حالت طلایی را پیشنهاد بده
  useEffect(() => {
    if (!goldenAutoEnabled || !lines.length) {
      if (totals.kg < (goldenMinKg || 500)) goldenAutoToastShown.current = false;
      return;
    }
    if (totals.kg >= (goldenMinKg || 500)) {
      if (!isGolden) setIsGolden(true);
      if (!goldenAutoToastShown.current) {
        goldenAutoToastShown.current = true;
        setToast({
          open: true,
          msg: `تناژ از ${goldenMinKg} کیلو گذشت — فاکتور طلایی فعال شد`,
          color: 'warning',
        });
      }
    }
  }, [totals.kg, goldenAutoEnabled, goldenMinKg]); // eslint-disable-line react-hooks/exhaustive-deps

  // فالوآپ از داشبورد
  useEffect(() => {
    if (followUpHandled.current) return;
    const st = location.state;
    if (!st?.followUpCustomerId) return;
    followUpHandled.current = true;
    void (async () => {
      try {
        const res = await wsClient.request<{
          customer: Customer;
        }>('customer.get', { id: st.followUpCustomerId });
        if (res.customer) {
          await pickCustomer(res.customer);
          if (st.followUpTier) {
            const t = st.followUpTier as PriceTier;
            if (!(t === 'retail' && isWholesaleCustomer)) setPriceTier(t);
          }
          if (st.followUpDiscount) {
            setDiscountMode('invoice');
            setDiscount(formatMoneyInput(String(st.followUpDiscount)));
            setAppliedOffer('آفر فالوآپ پیشنهادی');
          }
          setToast({
            open: true,
            msg: `مشتری ${res.customer.name} انتخاب شد — فاکتور بزنید`,
            color: 'success',
          });
        }
      } catch {
        /* ignore */
      }
      history.replace('/sale');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const applyAutoGolden = (action: 'disc' | 'gift' | 'vip') => {
    setIsGolden(true);
    if (action === 'gift' || action === 'vip') {
      const name = goldenGiftName || 'کارتن';
      const p =
        products.find((x) => x.name.includes(name) || name.includes(x.name)) || products[0];
      if (p) {
        setLines((prev) => {
          const withoutGift = prev.filter(
            (l) => !(l.productId === p._id && parseAmount(l.unitPrice) === 0)
          );
          return [
            ...withoutGift,
            {
              key: newLineKey(),
              productId: p._id,
              productName: `🎁 اشانتیون ${p.name}`,
              imageUrl: p.imageUrl,
              unit: 'package' as const,
              qtyInput: String(goldenGiftQty || 1),
              unitPrice: '0',
              kgPerPackage: p.kgPerPackage || 5,
              suggestedPerKg: 0,
              discount: '',
            },
          ];
        });
      }
    }
    if (action === 'disc' || action === 'vip') {
      const amount = roundToman((totals.amount * (goldenDiscPercent || 5)) / 100);
      applyOffer(amount, `از طرح طلایی ${goldenDiscPercent}٪ استفاده شد`);
    } else {
      setAppliedOffer(`اشانتیون طلایی: ${goldenGiftQty} ${goldenGiftName}`);
      setToast({ open: true, msg: 'اشانتیون اضافه شد', color: 'success' });
    }
  };

  const applyCampaignOffer = (o: {
    campaignName?: string;
    ruleType: string;
    label: string;
    discountAmount: number;
    matched: boolean;
    hint?: string;
    giftLine?: {
      productName: string;
      qty: number;
      unit: 'kg' | 'package';
      resolvedProductId?: string;
    };
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

    if (o.ruleType === 'free_gift' && o.giftLine) {
      const gl = o.giftLine;
      const p =
        products.find((x) => x._id === gl.resolvedProductId) ||
        products.find((x) => x.name.includes(gl.productName) || gl.productName.includes(x.name));
      if (!p) {
        setToast({
          open: true,
          msg: `محصول اشانتیون پیدا نشد: ${gl.productName}`,
          color: 'danger',
        });
        return;
      }
      const unit = gl.unit || 'package';
      const offerLabel = `از طرح «${o.campaignName || o.label}» استفاده شد`;
      setLines((prev) => {
        const withoutGift = prev.filter((l) => !(l.productId === p._id && parseAmount(l.unitPrice) === 0));
        return [
          ...withoutGift,
          {
            key: newLineKey(),
            productId: p._id,
            productName: `🎁 اشانتیون ${p.name}`,
            imageUrl: p.imageUrl,
            unit,
            qtyInput: String(gl.qty),
            unitPrice: '0',
            kgPerPackage: p.kgPerPackage || 5,
            suggestedPerKg: 0,
            discount: '',
          },
        ];
      });
      setAppliedOffer(offerLabel);
      if (o.discountAmount > 0) applyOffer(o.discountAmount, offerLabel);
      else setToast({ open: true, msg: `${offerLabel} — اشانتیون اضافه شد`, color: 'success' });
      return;
    }

    if (o.discountAmount > 0) {
      applyOffer(o.discountAmount, `از طرح «${o.campaignName || o.label}» استفاده شد`);
    } else {
      const label = `از طرح «${o.campaignName || o.label}» استفاده شد`;
      setAppliedOffer(label);
      setToast({ open: true, msg: label, color: 'success' });
    }
  };

  const applySuggestedInvoice = (sug: {
    campaignName?: string;
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
      const percent = tierPercent(p, calcTier);
      const cost = productCost(p, costBasis);
      const suggested = priceFromPercent(cost, percent);
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
    setAppliedOffer(`از طرح «${sug.campaignName || sug.title}» استفاده شد`);
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
        const { qtyKg, lineAmount } = resolveLineAmount(l.unit, price, qty, l.kgPerPackage);
        return {
          productId: l.productId,
          productName: l.productName,
          unit: l.unit,
          qtyInput: qty,
          qtyKg,
          lineAmount,
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
      setHistDetailId(null);
    } catch {
      setPrevInvoices([]);
    }
  };

  const applyInvoiceTemplate = (inv: PrevInv) => {
    if (inv.priceTier) {
      const t = inv.priceTier as PriceTier;
      if (t === 'retail' && isWholesaleCustomer) {
        setToast({
          open: true,
          msg: 'مشتری عمده است — فاکتور تکی از تاریخچه اعمال نشد؛ نوع عمده ماند',
          color: 'warning',
        });
        setPriceTier('wholesale');
      } else {
        setPriceTier(t);
      }
    }
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

  const openProductModal = (p: Product, existing?: LineItem) => {
    const percent = tierPercent(p, calcTier);
    const cost = productCost(p, costBasis);
    const suggested = priceFromPercent(cost, percent);
    if (existing) {
      setProdModalEditKey(existing.key);
      setProdModalUnit(existing.unit);
      setProdModalQty(existing.qtyInput || '1');
      setProdModalPrice(existing.unitPrice);
    } else {
      setProdModalEditKey(null);
      setProdModalUnit('package');
      setProdModalQty('1');
      setProdModalPrice(formatMoneyInput(String(Math.round(suggested * (p.kgPerPackage || 5)))));
    }
    setProdModalProduct(p);
    setProdModalOpen(true);
  };

  const setModalUnit = (unit: 'kg' | 'package') => {
    const p = prodModalProduct;
    if (!p) {
      setProdModalUnit(unit);
      return;
    }
    if (unit === prodModalUnit) return;

    const kgPer = p.kgPerPackage || 5;
    const currentPrice = parseAmount(prodModalPrice) || 0;
    setProdModalUnit(unit);

    // قیمت فعلی را بین کیلو ↔ بسته تبدیل کن (نه برگشت به قیمت پیشنهادی)
    if (currentPrice > 0) {
      const { perKg, perPackage } = resolvePrices(prodModalUnit, currentPrice, kgPer);
      const next = unit === 'package' ? Math.round(perPackage) : Math.round(perKg);
      setProdModalPrice(formatMoneyInput(String(Math.max(0, next))));
      return;
    }

    // اگر هنوز قیمت نزده، از پیشنهاد شروع کن
    const percent = tierPercent(p, calcTier);
    const cost = productCost(p, costBasis);
    const suggested = priceFromPercent(cost, percent);
    setProdModalPrice(
      formatMoneyInput(String(Math.round(unit === 'package' ? suggested * kgPer : suggested)))
    );
  };

  const confirmProductModal = () => {
    const p = prodModalProduct;
    if (!p) return;
    const qty = parseFloat(prodModalQty) || 0;
    if (qty <= 0) {
      setToast({ open: true, msg: 'تعداد معتبر وارد کنید', color: 'danger' });
      return;
    }
    if (needsCustomer && !customerId && !customerName.trim()) {
      setToast({
        open: true,
        msg: 'اول مشتری را انتخاب یا اضافه کنید',
        color: 'warning',
      });
      openAddCustomerModal();
      return;
    }
    const percent = tierPercent(p, calcTier);
    const cost = productCost(p, costBasis);
    const suggested = priceFromPercent(cost, percent);
    const priceStr = prodModalPrice || formatMoneyInput(String(Math.round(suggested)));

    setLines((prev) => {
      if (prodModalEditKey) {
        return prev.map((l) =>
          l.key === prodModalEditKey
            ? {
                ...l,
                unit: prodModalUnit,
                qtyInput: String(qty),
                unitPrice: priceStr,
                suggestedPerKg: suggested,
              }
            : l
        );
      }
      const idx = prev.findIndex((l) => l.productId === p._id && l.unit === prodModalUnit);
      if (idx >= 0) {
        const next = [...prev];
        const cur = parseFloat(next[idx].qtyInput) || 0;
        next[idx] = {
          ...next[idx],
          qtyInput: String(cur + qty),
          unitPrice: priceStr,
          suggestedPerKg: suggested,
        };
        return next;
      }
      return [
        ...prev,
        {
          key: newLineKey(),
          productId: p._id,
          productName: p.name,
          imageUrl: p.imageUrl,
          unit: prodModalUnit,
          qtyInput: String(qty),
          unitPrice: priceStr,
          kgPerPackage: p.kgPerPackage || 5,
          suggestedPerKg: suggested,
          discount: '',
        },
      ];
    });
    setProdModalOpen(false);
    setProdModalProduct(null);
    setToast({
      open: true,
      msg: prodModalEditKey ? 'قلم به‌روز شد' : `${p.name} اضافه شد`,
      color: 'success',
    });
  };

  const addProduct = (p: Product) => {
    if (needsCustomer && !customerId && !customerName.trim()) {
      openAddCustomerModal();
      setToast({
        open: true,
        msg: 'برای سوپر/عمده اول مشتری را اضافه کنید',
        color: 'warning',
      });
      return;
    }
    openProductModal(p);
  };

  useEffect(() => {
    setLines((prev) =>
      prev.map((l) => {
        const p = products.find((x) => x._id === l.productId);
        if (!p) return l;
        const percent = tierPercent(p, calcTier);
        const cost = productCost(p, costBasis);
        const suggested = priceFromPercent(cost, percent);
        const price = l.unit === 'package' ? suggested * (l.kgPerPackage || 5) : suggested;
        return { ...l, suggestedPerKg: suggested, unitPrice: formatMoneyInput(String(Math.round(price))) };
      })
    );
  }, [priceTier, costBasis]); // eslint-disable-line react-hooks/exhaustive-deps

  const openPdf = async (id: string) => {
    const res = await wsClient.request<{ html: string }>('sale.pdf', { id });
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(res.html);
      w.document.close();
    }
  };

  const submit = async () => {
    if (!priceTier) {
      setToast({
        open: true,
        msg: 'اول نوع فروش را انتخاب کنید: تکی / سوپرمارکت / عمده',
        color: 'warning',
      });
      return;
    }
    if (!lines.length) {
      setToast({ open: true, msg: 'اقلامی نیست — اول محصول اضافه کنید', color: 'danger' });
      return;
    }
    if (
      (priceTier === 'supermarket' || priceTier === 'wholesale') &&
      !customerId &&
      !customerName.trim()
    ) {
      setToast({
        open: true,
        msg: 'برای سوپرمارکت / عمده باید مشتری انتخاب یا ثبت شود',
        color: 'danger',
      });
      return;
    }
    if (priceTier === 'retail' && isWholesaleCustomer) {
      setToast({
        open: true,
        msg: 'مشتری عمده است — فاکتور تکی مجاز نیست',
        color: 'danger',
      });
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
          customerPhone: customerPhone ? normalizePhone(customerPhone) || undefined : undefined,
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
          creditIsCheck:
            creditIsCheck &&
            (paymentMethod === 'credit' ||
              (paymentMethod === 'mixed' && (parseAmount(payCredit) || 0) > 0)),
          priceTier,
          deliveryMode: !isAdmin ? deliveryMode : undefined,
          isGolden,
          discountMode,
          discount:
            discountMode === 'per_kg'
              ? totals.invoiceDisc
              : roundToman(parseAmount(discount) || 0),
          discountPerKg:
            discountMode === 'per_kg' ? roundPerKgDiscount(parseAmount(discountPerKg) || 0) : undefined,
          notes: notes || undefined,
          appliedOffer: appliedOffer || undefined,
          items: lines.map((l) => {
            const qty = parseFloat(l.qtyInput) || 0;
            const price = parseAmount(l.unitPrice) || 0;
            const { qtyKg, lineAmount } = resolveLineAmount(l.unit, price, qty, l.kgPerPackage);
            const disc =
              discountMode === 'product'
                ? Math.max(
                    0,
                    Math.min(roundToman((parseAmount(l.discount) || 0) * qtyKg), lineAmount)
                  )
                : roundToman(parseAmount(l.discount) || 0);
            return {
              productId: l.productId,
              unit: l.unit,
              qtyInput: qty,
              unitPrice: price || undefined,
              discount: disc,
            };
          }),
        },
        { clientMutationId: newMutationId(), queueIfOffline: true }
      );

      if ((invoice as { queued?: boolean }).queued) {
        setToast({ open: true, msg: 'آفلاین در صف قرار گرفت — بعد از وصل ثبت می‌شود', color: 'warning' });
      } else {
        const defaultCard = pickDefaultBankCard(bankCards);
        const shareText = buildInvoiceShareText(
          {
            invoiceNumber: invoice.invoiceNumber,
            customerName: customerName || undefined,
            customerPhone: customerPhone || undefined,
            date,
            totalAmount: totals.net,
            totalKg: totals.kg,
            discount: totals.disc,
            paymentMethod,
            isGolden,
            appliedOffer: appliedOffer || undefined,
            shopName: shopName || undefined,
            items: lines.map((l) => {
              const qty = parseFloat(l.qtyInput) || 0;
              const price = parseAmount(l.unitPrice) || 0;
              const { qtyKg, perKg, lineAmount } = resolveLineAmount(
                l.unit,
                price,
                qty,
                l.kgPerPackage
              );
              return {
                productName: l.productName,
                qtyKg,
                qtyInput: qty,
                unit: l.unit,
                unitPricePerKg: Math.round(perKg),
                totalPrice: lineAmount,
              };
            }),
          },
          defaultCard
            ? {
                defaultCard: {
                  label: defaultCard.label,
                  cardNumber: defaultCard.cardNumber,
                  accountHolder: defaultCard.accountHolder,
                  bankName: defaultCard.bankName,
                },
              }
            : undefined
        );
        await copyText(shareText);
        const msg =
          invoice.status === 'pending'
            ? `فاکتور ${invoice.invoiceNumber} ثبت شد — متن برای مشتری کپی شد`
            : `فاکتور ${invoice.invoiceNumber} ثبت شد — متن کپی شد، بفرستید برای مشتری`;
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
      setAppliedOffer('');
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
      setCustomerPreferredTier(null);
      if (saleTab === 'bulk') {
        setBulkCount((c) => c + 1);
      } else {
        setBulkCount(0);
        setDate(todayIso());
      }
      setSuggestedDiscount(0);
      setOffers([]);
      setCampaignOffers([]);
      setSuggestedInvoices([]);
      setPowerLabel('');
      setDueDate('');
      setDeliveryMode('company');
      setPriceTier(null);
      setCreditIsCheck(false);
      setHistOpen(false);
      setCustModalOpen(false);
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
                حالت سریع روزانه — تاریخ ثابت می‌ماند؛ بعد از ثبت فقط مشتری و اقلام پاک می‌شود
                {bulkCount > 0 ? ` · امروز ${bulkCount.toLocaleString('fa-IR')} فاکتور ثبت شد` : ''}
              </p>
            )}
            <button type="button" className="sale-date-btn" onClick={() => setDateModalOpen(true)}>
              <span className="sale-date-label">تاریخ فاکتور</span>
              <span className="sale-date-value">
                {date ? new Date(date + 'T12:00:00').toLocaleDateString('fa-IR') : 'انتخاب'}
              </span>
            </button>
            <div className="sale-tier-row">
              {(Object.keys(TIER_LABELS) as PriceTier[]).map((t) => {
                const lockedRetail = t === 'retail' && isWholesaleCustomer;
                return (
                  <button
                    type="button"
                    key={t}
                    className={`sale-tier-btn ${priceTier === t ? 'active' : ''} ${lockedRetail ? 'locked' : ''}`}
                    disabled={lockedRetail}
                    onClick={() => selectPriceTier(t)}
                  >
                    {TIER_LABELS[t]}
                  </button>
                );
              })}
              <IonToggle
                checked={isGolden}
                disabled={!stepsUnlocked}
                onIonChange={(e) => setIsGolden(e.detail.checked)}
                title="فاکتور ویژه / VIP"
              />
            </div>
            {!stepsUnlocked && (
              <p className="hint sale-step-hint">
                مرحله ۱: تکی / سوپرمارکت / عمده را انتخاب کنید تا بقیه فیلدها فعال شود
              </p>
            )}
            {stepsUnlocked && (isGolden || (goldenAutoEnabled && totals.kg >= (goldenMinKg || 500))) && (
              <div className="golden-perks">
                <div className="golden-perks-title">⭐ امتیاز مدیر فروش (فاکتور طلایی)</div>
                {goldenSuggestions.map((t) => (
                  <div key={t.key} style={{ marginBottom: 8 }}>
                    <p className="hint convert-hint" style={{ margin: '0 0 4px' }}>
                      {t.text}
                    </p>
                    <IonButton
                      size="small"
                      className="golden-perk-btn special"
                      onClick={() => applyAutoGolden(t.action)}
                    >
                      اعمال این پیشنهاد
                    </IonButton>
                  </div>
                ))}
                <div className="chip-row">
                  <IonButton size="small" className="golden-perk-btn" onClick={() => applyGoldenPerk('pct5')}>تخفیف ۵٪</IonButton>
                  <IonButton size="small" className="golden-perk-btn" onClick={() => applyGoldenPerk('pct10')}>تخفیف ۱۰٪</IonButton>
                  <IonButton size="small" className="golden-perk-btn" onClick={() => applyGoldenPerk('pct15')}>تخفیف ۱۵٪</IonButton>
                  <IonButton size="small" className="golden-perk-btn" onClick={() => applyGoldenPerk('perkg')}>۱۰۰۰ ت/کیلو</IonButton>
                  <IonButton size="small" className="golden-perk-btn" onClick={() => applyGoldenPerk('gift1')}>اشانتیون ۱ بسته</IonButton>
                  <IonButton size="small" className="golden-perk-btn special" onClick={() => applyGoldenPerk('vip_combo')}>VIP: ۵٪ + اشانتیون</IonButton>
                </div>
              </div>
            )}
            {isWholesaleCustomer && (
              <p className="hint convert-hint" style={{ margin: '6px 0 0' }}>
                مشتری عمده — فاکتور تکی مجاز نیست
              </p>
            )}
            {stepsUnlocked && (
              <>
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
                    ? 'قیمت پیشنهادی بر اساس آخرین خرید است — روی محصول هزینه و پیشنهاد را ببینید'
                    : 'قیمت پیشنهادی بر اساس میانگین موزون موجودی است — روی محصول هزینه و پیشنهاد را ببینید'}
                </p>
              </>
            )}
          </div>

          <div className={stepsUnlocked ? 'sale-steps' : 'sale-steps sale-steps-locked'}>
            {!stepsUnlocked && (
              <div className="sale-lock-banner">برای ادامه، نوع فروش (تکی / سوپر / عمده) را بالا انتخاب کنید</div>
            )}
          <div className="ios-glass-card sale-navy-card">
            <div className="ios-row" style={{ marginBottom: 6 }}>
              <strong>مشتری</strong>
              <IonButton
                size="small"
                fill="outline"
                onClick={() =>
                  openAddCustomerModal(normalizePhone(custSearch) || '', '', '', 'create')
                }
              >
                <IonIcon slot="start" icon={personAddOutline} />
                افزودن
              </IonButton>
            </div>
            <IonSearchbar
              value={custSearch}
              debounce={150}
              placeholder="موبایل، نام یا فاکتور…"
              className="ios-search"
              inputMode="search"
              onIonInput={(e) => {
                const raw = e.detail.value || '';
                const digits = normalizePhone(raw);
                const digitRatio = digits.length / Math.max(raw.replace(/\s/g, '').length, 1);
                setCustSearch(digitRatio >= 0.6 && digits.length >= 3 ? digits : raw);
              }}
            />
            {lookingUp && <p className="hint convert-hint">در حال جستجو…</p>}
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

            {customerId ? (
              <div className="cust-picked">
                <div className="ios-row">
                  <div>
                    <strong>{customerName}</strong>
                    <div className="ios-caption">
                      {customerPhone || '—'}
                      {customerAddress ? ` · ${customerAddress}` : ''}
                    </div>
                  </div>
                  <div className="chip-row" style={{ margin: 0 }}>
                    <IonButton size="small" fill="outline" onClick={() => setHistOpen(true)}>
                      <IonIcon slot="start" icon={timeOutline} />
                      قبلی
                    </IonButton>
                    <IonButton
                      size="small"
                      fill="clear"
                      onClick={() =>
                        openAddCustomerModal(
                          customerPhone,
                          customerName,
                          customerAddress,
                          'edit'
                        )
                      }
                    >
                      ویرایش
                    </IonButton>
                    <IonButton size="small" fill="clear" color="medium" onClick={clearCustomer}>
                      پاک
                    </IonButton>
                  </div>
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
                  ).map((o) => {
                    const amt = roundToman(o.amount);
                    const perKg =
                      totals.kg > 0 ? roundPerKgDiscount(amt / totals.kg) : 0;
                    return (
                      <IonButton
                        key={o.key}
                        size="small"
                        className={`${o.key === 'special' ? 'offer-btn special' : 'offer-btn'}${
                          appliedOffer === o.label ? ' active' : ''
                        }`}
                        onClick={() => applyOffer(amt, o.label)}
                      >
                        <IonIcon slot="start" icon={sparklesOutline} />
                        {o.label}
                        <br />
                        <span className="offer-amt">
                          {formatToman(amt)}
                          {perKg > 0 ? ` · ${formatToman(perKg)}/کیلو` : ''}
                        </span>
                      </IonButton>
                    );
                  })}
                </div>
                {appliedOffer && (
                  <p className="hint convert-hint">آفر انتخاب‌شده: {appliedOffer}</p>
                )}
              </div>
            ) : (
              <p className="hint convert-hint" style={{ marginBottom: 0 }}>
                شماره را بزنید — اگر نبود، پاپ‌آپ افزودن باز می‌شود
              </p>
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
          <p className="hint convert-hint" style={{ marginTop: 0 }}>
            روی محصول بزنید — تعداد و قیمت در پاپ‌آپ تنظیم می‌شود
          </p>
          <div className="product-card-grid product-card-grid-dense">
            {filtered.length === 0 && (
              <p className="hint">محصولی نیست — از خرید ثبت کن</p>
            )}
            {filtered.map((p) => {
              const stock = p.stockKg ?? p.stock ?? 0;
              const inLines = lineQty(p._id);
              const percent = tierPercent(p, calcTier);
              const cost = productCost(p, costBasis);
              const suggested = priceFromPercent(cost, percent);
              const avg = p.avgCostPerKg ?? p.purchasePrice ?? 0;
              const last = p.lastPurchasePricePerKg || p.purchasePrice || 0;
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
                    <div className="pc-meta" style={{ fontSize: 11, opacity: 0.85 }}>
                      {costBasis === 'weighted' ? 'میانگین' : 'آخر'} {formatToman(cost)}
                      {avg > 0 && last > 0 && Math.abs(avg - last) > 1
                        ? ` · ${costBasis === 'weighted' ? `آخر ${formatToman(last)}` : `میانگین ${formatToman(avg)}`}`
                        : ''}
                    </div>
                    <div className="pc-price">{formatToman(suggested)}/کیلو</div>
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
              <p className="hint">روی محصول بزنید تا پاپ‌آپ تعداد و قیمت باز شود</p>
            )}
            {lines.map((l, idx) => {
              const qty = parseFloat(l.qtyInput) || 0;
              const price = parseAmount(l.unitPrice) || 0;
              const { qtyKg, qtyPackages, lineAmount } = resolveLineAmount(
                l.unit,
                price,
                qty,
                l.kgPerPackage
              );
              const lineDiscAmt =
                discountMode === 'product'
                  ? Math.max(
                      0,
                      Math.min(roundToman((parseAmount(l.discount) || 0) * qtyKg), lineAmount)
                    )
                  : Math.max(0, Math.min(parseAmount(l.discount) || 0, lineAmount));
              const lineTotal = Math.max(0, lineAmount - lineDiscAmt);
              const prod = products.find((x) => x._id === l.productId);
              return (
                <div
                  key={l.key}
                  className="cart-item-card cart-item-compact"
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (prod) openProductModal(prod, l);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && prod) openProductModal(prod, l);
                  }}
                >
                  <div className="ios-row">
                    <div className="cart-item-title">
                      {l.imageUrl ? (
                        <img src={resolveMediaUrl(l.imageUrl)} alt="" className="cart-thumb" />
                      ) : (
                        <div className="cart-thumb cart-thumb-ph">{l.productName.slice(0, 1)}</div>
                      )}
                      <div>
                        <strong>
                          {idx + 1}. {l.productName}
                        </strong>
                        <div className="ios-caption">
                          {qty.toLocaleString('fa-IR')} {l.unit === 'kg' ? 'کیلو' : 'بسته'} · فی{' '}
                          {formatToman(price)}
                        </div>
                        <div className="ios-caption">
                          {formatKg(qtyKg)} · {Math.round(qtyPackages).toLocaleString('fa-IR')} بسته
                          {lineDiscAmt > 0 ? ` · تخفیف ${formatToman(lineDiscAmt)}` : ''}
                        </div>
                        {(() => {
                          const hint = marginInfo.lineHints.find((h) => h.key === l.key);
                          if (!hint) return null;
                          return (
                            <div className="ios-caption">
                              خرید {formatToman(hint.costPerKg)} · {hint.pct.toLocaleString('fa-IR')}٪
                              → {formatToman(hint.suggestedPerKg)}
                              {hint.status === 'low' && (
                                <span style={{ color: 'var(--ion-color-danger)' }}>
                                  {' '}
                                  · قیمت کم
                                </span>
                              )}
                              {hint.status === 'high' && (
                                <span style={{ color: 'var(--ion-color-success)' }}>
                                  {' '}
                                  · بالاتر از پیشنهاد
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                    <div className="cart-item-actions" onClick={(e) => e.stopPropagation()}>
                      <strong className="cart-line-total">{formatToman(lineTotal)}</strong>
                      <IonButton
                        fill="clear"
                        color="danger"
                        size="small"
                        onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                      >
                        <IonIcon icon={trashOutline} />
                      </IonButton>
                    </div>
                  </div>
                  {discountMode === 'product' && (
                    <div onClick={(e) => e.stopPropagation()}>
                      <MoneyInput
                        label="تخفیف هر کیلو (تومان/کیلو)"
                        value={l.discount}
                        onChange={(v) =>
                          setLines(lines.map((x, i) => (i === idx ? { ...x, discount: v } : x)))
                        }
                      />
                      {(parseAmount(l.discount) || 0) > 0 && (
                        <p className="hint convert-hint" style={{ margin: '4px 0 0' }}>
                          جمع تخفیف این قلم: {formatToman(lineDiscAmt)} (= {formatToman(parseAmount(l.discount) || 0)} ×{' '}
                          {formatKg(qtyKg)})
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {lines.length > 0 && (
            <div className="ios-glass-card sale-navy-card sale-margin-card">
              <div className="ios-section-title" style={{ marginTop: 0 }}>
                سود این فاکتور
              </div>
              <p className="hint" style={{ marginTop: 0 }}>
                سود = مبلغ نهایی بعد از تخفیف − هزینه خرید. تخفیف از سود کم می‌کند؛ هزینه مغازه جداست.
              </p>
              <div className="stat-row">
                <span className="stat-label">هزینه خرید (اولیه)</span>
                <span className="stat-value">{formatToman(marginInfo.cost)}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">پیشنهادی با درصد شما</span>
                <span className="stat-value">{formatToman(marginInfo.suggestedGross)}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">سود هدف (با درصد)</span>
                <span className="stat-value">{formatToman(marginInfo.targetProfit)}</span>
              </div>
              {marginInfo.discount > 0 && (
                <div className="stat-row">
                  <span className="stat-label">تخفیف</span>
                  <span className="stat-value danger">−{formatToman(marginInfo.discount)}</span>
                </div>
              )}
              <div className="stat-row">
                <span className="stat-label">فروش نهایی</span>
                <span className="stat-value">{formatToman(marginInfo.net)}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">سود واقعی این فاکتور</span>
                <span
                  className={`stat-value ${marginInfo.actualProfit >= 0 ? 'success' : 'danger'}`}
                >
                  {formatToman(marginInfo.actualProfit)}
                </span>
              </div>
              {marginInfo.vsTarget !== 0 && (
                <div className="stat-row">
                  <span className="stat-label">نسبت به هدف درصد</span>
                  <span
                    className={`stat-value ${marginInfo.vsTarget >= 0 ? 'success' : 'danger'}`}
                  >
                    {marginInfo.vsTarget >= 0 ? '+' : ''}
                    {formatToman(marginInfo.vsTarget)}
                  </span>
                </div>
              )}
              {marginInfo.lineHints.map((h) => (
                <div key={h.key} className="ios-caption" style={{ marginTop: 6 }}>
                  <strong>{h.name}</strong>
                  {' · خرید '}
                  {formatToman(h.costPerKg)}
                  {' · '}
                  {h.pct.toLocaleString('fa-IR')}٪
                  {' → پیشنهادی '}
                  {formatToman(h.suggestedPerKg)}
                  {' · شما '}
                  {formatToman(h.yourPerKg)}
                  {h.status === 'low' && (
                    <span style={{ color: 'var(--ion-color-danger)' }}>
                      {' '}
                      · کم {formatToman(Math.abs(h.diffPerKg))}/کیلو
                    </span>
                  )}
                  {h.status === 'high' && (
                    <span style={{ color: 'var(--ion-color-success)' }}>
                      {' '}
                      · بیشتر {formatToman(h.diffPerKg)}/کیلو
                    </span>
                  )}
                  {h.status === 'ok' && <span> · نزدیک پیشنهاد</span>}
                </div>
              ))}
            </div>
          )}

          <details className="sale-details ios-glass-card sale-navy-card">
            <summary>تخفیف · {formatToman(totals.net)}</summary>
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
              <p className="hint">
                برای هر محصول در سبد، تخفیف را به تومان/کیلو بزن — جمع تخفیف خودکار حساب می‌شود
              </p>
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
          </details>

          <div className="ios-glass-card sale-navy-card sale-settle">
            <div className="sale-settle-title">تسویه · {formatToman(totals.net)}</div>
            {appliedOffer && (
              <div
                className="hint convert-hint"
                style={{
                  margin: '0 0 10px',
                  padding: '8px 10px',
                  background: 'rgba(251, 146, 60, 0.12)',
                  borderRadius: 10,
                  border: '1px solid rgba(251, 146, 60, 0.35)',
                }}
              >
                {appliedOffer}
              </div>
            )}
            <div className="chip-row">
              {paymentMethods.map((m) => (
                <IonChip
                  key={m.value}
                  className={paymentMethod === m.value ? 'ios-chip-active' : 'ios-chip'}
                  onClick={() => {
                    setPaymentMethod(m.value);
                    if (m.value === 'mixed') {
                      const rem = Math.max(0, totals.net);
                      setPayCash('');
                      setPayCard('');
                      setPayCardToCard('');
                      setPayCredit(rem > 0 ? formatMoneyInput(String(rem)) : '');
                    }
                  }}
                >
                  {m.label}
                </IonChip>
              ))}
            </div>
            {paymentMethod === 'card_to_card' && (
              <div style={{ marginTop: 10 }}>
                <div className="ios-section-title" style={{ marginTop: 0 }}>
                  کارت مقصد
                </div>
                {bankCards.length === 0 ? (
                  <p className="hint">
                    هنوز کارتی ثبت نشده — از تنظیمات اپ کارت اضافه کنید
                  </p>
                ) : (
                  bankCards.map((c, i) => (
                    <div
                      key={`${c.cardNumber}-${i}`}
                      className={`ios-glass-card ${selectedBankCard === i ? 'in-cart' : ''}`}
                      style={{ marginBottom: 8, padding: 10 }}
                    >
                      <div className="ios-row">
                        <button
                          type="button"
                          style={{
                            background: 'none',
                            border: 'none',
                            textAlign: 'right',
                            flex: 1,
                            color: 'inherit',
                            padding: 0,
                          }}
                          onClick={() => setSelectedBankCard(i)}
                        >
                          <strong>{c.label}</strong>
                          <div className="ios-caption">
                            {c.bankName ? `${c.bankName} · ` : ''}
                            {c.accountHolder || ''}
                          </div>
                          <div className="ios-caption" dir="ltr" style={{ textAlign: 'right' }}>
                            {c.cardNumber.replace(/(\d{4})(?=\d)/g, '$1 ')}
                          </div>
                        </button>
                        <IonButton
                          size="small"
                          fill="outline"
                          onClick={() => {
                            const text = buildCardTransferText({
                              cardLabel: c.label,
                              cardNumber: c.cardNumber,
                              accountHolder: c.accountHolder,
                              bankName: c.bankName,
                              amount: totals.net,
                              customerName: customerName || undefined,
                            });
                            void copyText(text).then((ok) =>
                              setToast({
                                open: true,
                                msg: ok
                                  ? 'متن کارت‌به‌کارت کپی شد — برای مشتری بفرستید'
                                  : 'کپی نشد',
                                color: ok ? 'success' : 'danger',
                              })
                            );
                          }}
                        >
                          <IonIcon slot="start" icon={copyOutline} />
                          کپی برای مشتری
                        </IonButton>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
            {paymentMethod === 'mixed' && (
              <div className="mixed-pay">
                <MoneyInput
                  label="پوز / کارتخوان"
                  value={payCard}
                  onChange={(v) => {
                    setPayCard(v);
                    const cash = parseAmount(payCash) || 0;
                    const pos = parseAmount(v) || 0;
                    const c2c = parseAmount(payCardToCard) || 0;
                    const rem = Math.max(0, totals.net - cash - pos - c2c);
                    setPayCredit(rem > 0 ? formatMoneyInput(String(rem)) : '');
                  }}
                />
                <MoneyInput
                  label="نقد"
                  value={payCash}
                  onChange={(v) => {
                    setPayCash(v);
                    const cash = parseAmount(v) || 0;
                    const pos = parseAmount(payCard) || 0;
                    const c2c = parseAmount(payCardToCard) || 0;
                    const rem = Math.max(0, totals.net - cash - pos - c2c);
                    setPayCredit(rem > 0 ? formatMoneyInput(String(rem)) : '');
                  }}
                />
                <MoneyInput
                  label="کارت به کارت"
                  value={payCardToCard}
                  onChange={(v) => {
                    setPayCardToCard(v);
                    const cash = parseAmount(payCash) || 0;
                    const pos = parseAmount(payCard) || 0;
                    const c2c = parseAmount(v) || 0;
                    const rem = Math.max(0, totals.net - cash - pos - c2c);
                    setPayCredit(rem > 0 ? formatMoneyInput(String(rem)) : '');
                  }}
                />
                <div className="mixed-credit-remain">
                  <div className="mixed-credit-label">مانده نسیه</div>
                  <div className="mixed-credit-value">
                    {formatToman(parseAmount(payCredit) || 0)}
                  </div>
                  <p className="hint">خودکار: مبلغ فاکتور − (پوز + نقد + کارت‌به‌کارت)</p>
                </div>
              </div>
            )}
            {(paymentMethod === 'credit' ||
              (paymentMethod === 'mixed' && (parseAmount(payCredit) || 0) > 0)) && (
              <>
                <PersianDateField label="سررسید نسیه" value={dueDate} onChange={setDueDate} />
                <IonItem lines="none" className="credit-check-item">
                  <IonCheckbox
                    slot="start"
                    checked={creditIsCheck}
                    onIonChange={(e) => setCreditIsCheck(e.detail.checked)}
                  />
                  <IonLabel>
                    <strong>چک داده</strong>
                    <p className="ios-caption">اگر مشتری چک داد، تیک بزنید تا در چک‌ها ثبت شود</p>
                  </IonLabel>
                </IonItem>
                {creditIsCheck && (
                  <div className="sale-check-badge">✓ چک داده — سررسید همان تاریخ نسیه</div>
                )}
              </>
            )}
          </div>

          </div>

          <IonButton
            expand="block"
            className="ios-primary-btn"
            color={isGolden ? 'warning' : 'primary'}
            onClick={submit}
            disabled={loading || !stepsUnlocked}
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

        {/* پاپ‌آپ افزودن مشتری */}
        <IonModal isOpen={custModalOpen} onDidDismiss={() => setCustModalOpen(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>{custModalMode === 'edit' ? 'ویرایش مشتری' : 'افزودن مشتری'}</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setCustModalOpen(false)}>بستن</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <div className="ios-glass-card">
              <p className="hint" style={{ marginTop: 0 }}>
                {custModalMode === 'edit'
                  ? 'مشخصات مشتری را ویرایش کنید'
                  : 'این شماره در سیستم نیست — مشتری را ثبت کنید'}
              </p>
              <IonItem lines="full">
                <IonLabel position="stacked">نام</IonLabel>
                <IonInput
                  value={custModalName}
                  placeholder="نام مشتری"
                  onIonInput={(e) => setCustModalName(e.detail.value || '')}
                />
              </IonItem>
              <DigitInput
                label="موبایل"
                mode="phone"
                value={custModalPhone}
                placeholder="09…"
                onChange={(v) => setCustModalPhone(v)}
              />
              <IonItem lines="full">
                <IonLabel position="stacked">آدرس (اختیاری)</IonLabel>
                <IonInput
                  value={custModalAddress}
                  placeholder="آدرس ارسال"
                  onIonInput={(e) => setCustModalAddress(e.detail.value || '')}
                />
              </IonItem>
              <IonButton
                expand="block"
                fill="outline"
                size="small"
                style={{ marginTop: 10 }}
                onClick={() => setCustModalShowMap((v) => !v)}
              >
                <IonIcon slot="start" icon={mapOutline} />
                {custModalShowMap
                  ? 'بستن نقشه'
                  : custModalLat != null
                    ? 'ویرایش موقعیت روی نقشه'
                    : 'انتخاب موقعیت روی نقشه'}
              </IonButton>
              {custModalShowMap && (
                <div style={{ marginTop: 8 }}>
                  <LocationPicker
                    lat={custModalLat}
                    lng={custModalLng}
                    address={custModalAddress}
                    height={220}
                    onChange={({ lat: la, lng: ln, address: street }) => {
                      setCustModalLat(la);
                      setCustModalLng(ln);
                      if (street) setCustModalAddress(street);
                    }}
                  />
                </div>
              )}
              {!custModalShowMap && custModalLat != null && custModalLng != null && (
                <p className="hint convert-hint">
                  موقعیت ثبت شد: {custModalLat.toFixed(5)}, {custModalLng.toFixed(5)}
                </p>
              )}
              <IonButton
                expand="block"
                className="ios-primary-btn"
                style={{ marginTop: 14 }}
                disabled={custModalSaving}
                onClick={() => void saveCustomerFromModal()}
              >
                <IonIcon slot="start" icon={personAddOutline} />
                {custModalSaving ? '…' : custModalMode === 'edit' ? 'ذخیره' : 'ثبت مشتری'}
              </IonButton>
            </div>
          </IonContent>
        </IonModal>

        {/* پاپ‌آپ افزودن / ویرایش محصول */}
        <IonModal
          isOpen={prodModalOpen}
          onDidDismiss={() => {
            setProdModalOpen(false);
            setProdModalProduct(null);
          }}
          className="product-pick-modal"
        >
          <IonHeader>
            <IonToolbar>
              <IonTitle>{prodModalEditKey ? 'ویرایش قلم' : 'افزودن محصول'}</IonTitle>
              <IonButtons slot="end">
                <IonButton
                  onClick={() => {
                    setProdModalOpen(false);
                    setProdModalProduct(null);
                  }}
                >
                  بستن
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            {prodModalProduct && (
              <div className="prod-modal-body">
                <div className="prod-modal-head">
                  {prodModalProduct.imageUrl ? (
                    <img
                      src={resolveMediaUrl(prodModalProduct.imageUrl)}
                      alt=""
                      className="prod-modal-thumb"
                    />
                  ) : (
                    <div className="prod-modal-thumb ph">{prodModalProduct.name.slice(0, 1)}</div>
                  )}
                  <div>
                    <strong className="prod-modal-name">{prodModalProduct.name}</strong>
                    <div className="ios-caption">
                      موجودی {formatKg(prodModalProduct.stockKg ?? prodModalProduct.stock ?? 0)} ·{' '}
                      {prodModalProduct.kgPerPackage || 5} کیلو/بسته
                    </div>
                    <div className="ios-caption">
                      هزینه ({costBasis === 'weighted' ? 'میانگین' : 'آخر'}):{' '}
                      {formatToman(productCost(prodModalProduct, costBasis))}/کیلو
                    </div>
                    <div className="ios-caption">
                      پیشنهادی:{' '}
                      {formatToman(
                        priceFromPercent(
                          productCost(prodModalProduct, costBasis),
                          tierPercent(prodModalProduct, calcTier)
                        )
                      )}
                      /کیلو
                    </div>
                  </div>
                </div>

                <div className="chip-row" style={{ marginTop: 8 }}>
                  <IonChip
                    className={prodModalUnit === 'kg' ? 'ios-chip-active' : 'ios-chip'}
                    onClick={() => setModalUnit('kg')}
                  >
                    کیلو
                  </IonChip>
                  <IonChip
                    className={prodModalUnit === 'package' ? 'ios-chip-active' : 'ios-chip'}
                    onClick={() => setModalUnit('package')}
                  >
                    بسته
                  </IonChip>
                </div>

                <div className="qty-stepper" style={{ marginTop: 10 }}>
                  <IonButton
                    fill="outline"
                    size="small"
                    onClick={() =>
                      setProdModalQty(String(Math.max(0, (parseFloat(prodModalQty) || 0) - 1)))
                    }
                  >
                    <IonIcon icon={removeOutline} />
                  </IonButton>
                  <IonInput
                    type="text"
                    inputMode="decimal"
                    className="qty-input"
                    value={prodModalQty}
                    onIonInput={(e) =>
                      setProdModalQty(
                        sanitizeNumberInput(e.detail.value || '', { decimal: true })
                      )
                    }
                  />
                  <IonButton
                    fill="outline"
                    size="small"
                    onClick={() =>
                      setProdModalQty(String((parseFloat(prodModalQty) || 0) + 1))
                    }
                  >
                    <IonIcon icon={addOutline} />
                  </IonButton>
                  <IonButton
                    fill="solid"
                    size="small"
                    className="qty-plus5"
                    onClick={() =>
                      setProdModalQty(String((parseFloat(prodModalQty) || 0) + 5))
                    }
                  >
                    +۵
                  </IonButton>
                </div>

                <IonItem lines="full" style={{ marginTop: 8 }}>
                  <IonLabel position="stacked">
                    فی تومان / {prodModalUnit === 'kg' ? 'کیلو' : 'بسته'}
                  </IonLabel>
                  <IonInput
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={prodModalPrice}
                    onIonInput={(e) => setProdModalPrice(formatMoneyInput(e.detail.value || ''))}
                  />
                </IonItem>

                {(() => {
                  const qty = parseFloat(prodModalQty) || 0;
                  const price = parseAmount(prodModalPrice) || 0;
                  const kgPer = prodModalProduct.kgPerPackage || 5;
                  const { qtyKg, qtyPackages } = resolveQty(prodModalUnit, qty, kgPer);
                  const { perKg, perPackage } = resolvePrices(prodModalUnit, price, kgPer);
                  return (
                    <p className="hint convert-hint">
                      {formatKg(qtyKg)} · {Math.round(qtyPackages).toLocaleString('fa-IR')} بسته · جمع{' '}
                      {formatToman(Math.round(perKg * qtyKg))}
                      {price > 0
                        ? prodModalUnit === 'package'
                          ? ` · معادل ${formatToman(Math.round(perKg))}/کیلو`
                          : ` · معادل ${formatToman(Math.round(perPackage))}/بسته`
                        : ''}
                    </p>
                  );
                })()}

                <IonButton
                  expand="block"
                  className="ios-primary-btn"
                  style={{ marginTop: 12 }}
                  onClick={confirmProductModal}
                >
                  {prodModalEditKey ? 'ذخیره تغییرات' : 'افزودن به فاکتور'}
                </IonButton>
              </div>
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
                {histDetailId === inv.invoiceNumber && (
                  <div style={{ marginTop: 8 }}>
                    {(inv.items?.length || 0) === 0 ? (
                      <p className="hint">اقلام این فاکتور در دسترس نیست</p>
                    ) : (
                      inv.items!.map((it, i) => (
                        <div key={`${inv.invoiceNumber}-${i}`} className="stat-row">
                          <span className="stat-label">
                            {it.productName}
                            {it.qtyInput
                              ? ` · ${it.qtyInput} ${it.unit === 'package' ? 'بسته' : 'کیلو'}`
                              : ''}
                          </span>
                          <span className="stat-value">
                            {formatToman(it.unitPricePerKg)}/کیلو
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}
                <div className="chip-row" style={{ marginTop: 8 }}>
                  <IonButton
                    size="small"
                    fill="outline"
                    onClick={() =>
                      setHistDetailId((cur) =>
                        cur === inv.invoiceNumber ? null : inv.invoiceNumber
                      )
                    }
                  >
                    <IonIcon slot="start" icon={eyeOutline} />
                    {histDetailId === inv.invoiceNumber ? 'بستن جزئیات' : 'جزئیات'}
                  </IonButton>
                  <IonButton
                    size="small"
                    onClick={() => {
                      if (inv.items?.length) applyInvoiceTemplate(inv);
                      else {
                        void wsClient
                          .request<{
                            suggest?: {
                              lastInvoice?: PrevInv;
                              recentInvoices?: PrevInv[];
                              suggestedDiscount?: number;
                              preferredTier?: string;
                            };
                          }>('customer.get', { id: customerId })
                          .then((res) => {
                            const match =
                              res.suggest?.lastInvoice?.invoiceNumber === inv.invoiceNumber
                                ? res.suggest.lastInvoice
                                : null;
                            if (match) applyInvoiceTemplate(match);
                            else {
                              if (res.suggest?.preferredTier)
                                setPriceTier(res.suggest.preferredTier as PriceTier);
                              if (inv.discount)
                                setDiscount(formatMoneyInput(String(inv.discount)));
                              else if (res.suggest?.suggestedDiscount)
                                setDiscount(
                                  formatMoneyInput(String(res.suggest.suggestedDiscount))
                                );
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
              </div>
            ))}
          </IonContent>
        </IonModal>


        <IonModal isOpen={dateModalOpen} onDidDismiss={() => setDateModalOpen(false)} initialBreakpoint={0.45} breakpoints={[0, 0.45, 0.7]}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>تاریخ فاکتور</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setDateModalOpen(false)}>تأیید</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <PersianDateField label="تاریخ" value={date} onChange={setDate} />
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
