import { useCallback, useMemo, useRef, useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonBackButton,
  IonItem,
  IonLabel,
  IonInput,
  IonButton,
  IonToggle,
  IonToast,
  IonRefresher,
  IonRefresherContent,
  IonSegment,
  IonSegmentButton,
  IonModal,
  IonSelect,
  IonSelectOption,
  IonChip,
  useIonViewWillEnter,
  RefresherEventDetail,
} from '@ionic/react';
import { copyOutline, openOutline, imageOutline, trashOutline, createOutline, cubeOutline } from 'ionicons/icons';
import { IonIcon } from '@ionic/react';
import { wsClient } from '../api/ws';
import { resolveMediaUrl } from '../api/client';
import { formatToman, formatMoneyInput, parseAmount, sanitizeNumberInput, priceFromPercent, roundToman, formatKg } from '../utils/format';
import { useAuth } from '../auth/AuthContext';
import { DigitInput } from '../components/DigitInput';
import { QtyStepper } from '../components/QtyStepper';

type PriceTier = 'retail' | 'supermarket' | 'wholesale';
type AdminTab = 'products' | 'categories' | 'catalog';

interface Category {
  _id: string;
  name: string;
  profitPercent: number;
  profitRetail?: number;
  profitSupermarket?: number;
  profitWholesale?: number;
}

interface Product {
  _id: string;
  name: string;
  kgPerPackage?: number;
  stockKg?: number;
  imageUrl?: string;
  catalogVisible?: boolean;
  catalogMinQty?: number;
  catalogPricePerKg?: number;
  catalogNote?: string;
  avgCostPerKg?: number;
  lastPurchasePricePerKg?: number;
  purchasePrice?: number;
  profitPercent?: number;
  profitRetail?: number;
  profitSupermarket?: number;
  profitWholesale?: number;
  categoryId?: {
    _id?: string;
    name?: string;
    profitRetail?: number;
    profitSupermarket?: number;
    profitWholesale?: number;
    profitPercent?: number;
  };
}

function productCost(p: Product): number {
  const last = p.lastPurchasePricePerKg || 0;
  if (last > 0) return last;
  return p.avgCostPerKg ?? p.purchasePrice ?? 0;
}

function tierPercent(p: Product, tier: PriceTier): number {
  const c = p.categoryId;
  if (tier === 'supermarket') return p.profitSupermarket ?? c?.profitSupermarket ?? 10;
  if (tier === 'wholesale') return p.profitWholesale ?? c?.profitWholesale ?? 6;
  return p.profitRetail ?? p.profitPercent ?? c?.profitRetail ?? c?.profitPercent ?? 12;
}

function tierPricePerKg(p: Product, tier: PriceTier): number {
  if (tier === 'retail' && p.catalogPricePerKg && p.catalogPricePerKg > 0) {
    return roundToman(p.catalogPricePerKg, 100);
  }
  const cost = productCost(p);
  return priceFromPercent(cost, tierPercent(p, tier));
}

function pctFromPrice(cost: number, price: number): number {
  if (cost <= 0) return 0;
  return Math.round(((price / cost - 1) * 100) * 10) / 10;
}

const CatalogAdmin: React.FC = () => {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<AdminTab>('products');
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [catalogEnabled, setCatalogEnabled] = useState(true);
  const [catalogTitle, setCatalogTitle] = useState('');
  const [catalogPhone, setCatalogPhone] = useState('');
  const [catalogNote, setCatalogNote] = useState('');
  const [brandName, setBrandName] = useState('');
  const [brandTagline, setBrandTagline] = useState('');
  const [brandPrimaryColor, setBrandPrimaryColor] = useState('#1e3a5f');
  const [brandLogoUrl, setBrandLogoUrl] = useState('');
  const [supermarketMinKg, setSupermarketMinKg] = useState('500');
  const [wholesaleMinKg, setWholesaleMinKg] = useState('2000');
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const logoRef = useRef<HTMLInputElement | null>(null);
  const editFileRef = useRef<HTMLInputElement | null>(null);

  const [catName, setCatName] = useState('');
  const [catRetail, setCatRetail] = useState('15');
  const [catSuper, setCatSuper] = useState('10');
  const [catWholesale, setCatWholesale] = useState('6');
  const [catEdits, setCatEdits] = useState<
    Record<string, { retail: string; supermarket: string; wholesale: string }>
  >({});

  const [bulkCatId, setBulkCatId] = useState('');
  const [bulkRetail, setBulkRetail] = useState('15');
  const [bulkSuper, setBulkSuper] = useState('10');
  const [bulkWholesale, setBulkWholesale] = useState('6');
  const [bulkBusy, setBulkBusy] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [editName, setEditName] = useState('');
  const [editRetailPct, setEditRetailPct] = useState('');
  const [editSuperPct, setEditSuperPct] = useState('');
  const [editWholePct, setEditWholePct] = useState('');
  const [editRetailPrice, setEditRetailPrice] = useState('');
  const [editSuperPrice, setEditSuperPrice] = useState('');
  const [editWholePrice, setEditWholePrice] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deletePw, setDeletePw] = useState('');
  const [deleting, setDeleting] = useState(false);

  const [stockOpen, setStockOpen] = useState(false);
  const [stockTarget, setStockTarget] = useState<Product | null>(null);
  const [stockMode, setStockMode] = useState<'set' | 'delta'>('set');
  const [stockUnit, setStockUnit] = useState<'kg' | 'package'>('kg');
  const [stockQty, setStockQty] = useState('');
  const [stockPw, setStockPw] = useState('');
  const [stockNotes, setStockNotes] = useState('');
  const [stockSaving, setStockSaving] = useState(false);

  const catalogUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/catalog` : '/catalog';

  const load = useCallback(async () => {
    const [list, settings, cats] = await Promise.all([
      wsClient.request<Product[]>('product.list', {}),
      wsClient.request<{
        catalogEnabled?: boolean;
        catalogTitle?: string;
        catalogPhone?: string;
        catalogNote?: string;
        shopName?: string;
        brandName?: string;
        brandTagline?: string;
        brandPrimaryColor?: string;
        brandLogoUrl?: string;
        catalogSupermarketMinKg?: number;
        catalogWholesaleMinKg?: number;
      }>('settings.get'),
      wsClient.request<Category[]>('category.list'),
    ]);
    setProducts(Array.isArray(list) ? list : []);
    setCatalogEnabled(settings.catalogEnabled !== false);
    setCatalogTitle(settings.catalogTitle || settings.shopName || '');
    setCatalogPhone(settings.catalogPhone || '');
    setCatalogNote(settings.catalogNote || '');
    setBrandName(settings.brandName || settings.shopName || '');
    setBrandTagline(settings.brandTagline || '');
    setBrandPrimaryColor(settings.brandPrimaryColor || '#1e3a5f');
    setBrandLogoUrl(settings.brandLogoUrl || '');
    setSupermarketMinKg(String(settings.catalogSupermarketMinKg ?? 500));
    setWholesaleMinKg(String(settings.catalogWholesaleMinKg ?? 2000));

    const catList = Array.isArray(cats) ? cats : [];
    setCategories(catList);
    const cmap: typeof catEdits = {};
    for (const c of catList) {
      cmap[c._id] = {
        retail: String(c.profitRetail ?? c.profitPercent ?? 15),
        supermarket: String(c.profitSupermarket ?? 10),
        wholesale: String(c.profitWholesale ?? 6),
      };
    }
    setCatEdits(cmap);
  }, []);

  useIonViewWillEnter(() => {
    void load().catch(console.warn);
  });

  const catIdOf = (p: Product) =>
    p.categoryId && typeof p.categoryId === 'object'
      ? String(p.categoryId._id || '')
      : String(p.categoryId || '');

  const filteredProducts = useMemo(() => {
    if (!bulkCatId) return products;
    return products.filter((p) => catIdOf(p) === bulkCatId);
  }, [products, bulkCatId]);

  const openEdit = (p: Product) => {
    setEditProduct(p);
    setEditName(p.name || '');
    const cost = productCost(p);
    const rPct = tierPercent(p, 'retail');
    const sPct = tierPercent(p, 'supermarket');
    const wPct = tierPercent(p, 'wholesale');
    const rPrice = tierPricePerKg(p, 'retail');
    const sPrice = tierPricePerKg(p, 'supermarket');
    const wPrice = tierPricePerKg(p, 'wholesale');
    setEditRetailPct(String(rPct));
    setEditSuperPct(String(sPct));
    setEditWholePct(String(wPct));
    setEditRetailPrice(formatMoneyInput(String(rPrice)));
    setEditSuperPrice(formatMoneyInput(String(sPrice)));
    setEditWholePrice(formatMoneyInput(String(wPrice)));
    setEditNote(p.catalogNote || '');
    setEditOpen(true);
    void cost;
  };

  const syncPriceFromPct = (tier: PriceTier, pctStr: string) => {
    if (!editProduct) return;
    const cost = productCost(editProduct);
    const pct = parseFloat(pctStr) || 0;
    const price = priceFromPercent(cost, pct);
    const formatted = formatMoneyInput(String(price));
    if (tier === 'retail') {
      setEditRetailPct(pctStr);
      setEditRetailPrice(formatted);
    } else if (tier === 'supermarket') {
      setEditSuperPct(pctStr);
      setEditSuperPrice(formatted);
    } else {
      setEditWholePct(pctStr);
      setEditWholePrice(formatted);
    }
  };

  const syncPctFromPrice = (tier: PriceTier, priceStr: string) => {
    if (!editProduct) return;
    const cost = productCost(editProduct);
    const price = parseAmount(priceStr) || 0;
    const pct = pctFromPrice(cost, price);
    const formatted = formatMoneyInput(priceStr);
    if (tier === 'retail') {
      setEditRetailPrice(formatted);
      setEditRetailPct(String(pct));
    } else if (tier === 'supermarket') {
      setEditSuperPrice(formatted);
      setEditSuperPct(String(pct));
    } else {
      setEditWholePrice(formatted);
      setEditWholePct(String(pct));
    }
  };

  const saveEdit = async () => {
    if (!editProduct) return;
    const name = editName.trim();
    if (!name) {
      setToast({ open: true, msg: 'نام محصول الزامی است', color: 'warning' });
      return;
    }
    setEditSaving(true);
    try {
      const retailPct = parseFloat(editRetailPct) || 0;
      const superPct = parseFloat(editSuperPct) || 0;
      const wholePct = parseFloat(editWholePct) || 0;
      const retailPrice = parseAmount(editRetailPrice) || 0;
      const cost = productCost(editProduct);
      const computedRetail = priceFromPercent(cost, retailPct);
      await wsClient.request('product.update', {
        id: editProduct._id,
        name,
        profitRetail: retailPct,
        profitSupermarket: superPct,
        profitWholesale: wholePct,
        catalogPricePerKg:
          retailPrice > 0 && Math.abs(retailPrice - computedRetail) > 1 ? retailPrice : null,
        catalogNote: editNote,
      });
      setEditOpen(false);
      setEditProduct(null);
      await load();
      setToast({ open: true, msg: 'محصول ذخیره شد', color: 'success' });
    } catch (e) {
      setToast({ open: true, msg: e instanceof Error ? e.message : 'خطا', color: 'danger' });
    } finally {
      setEditSaving(false);
    }
  };

  const applyBulk = async (scope: 'category' | 'all') => {
    if (!isAdmin) return;
    const retail = parseFloat(bulkRetail) || 0;
    const supermarket = parseFloat(bulkSuper) || 0;
    const wholesale = parseFloat(bulkWholesale) || 0;
    let targets = products;
    if (scope === 'category') {
      if (!bulkCatId) {
        setToast({ open: true, msg: 'اول دسته را انتخاب کن', color: 'warning' });
        return;
      }
      targets = products.filter((p) => catIdOf(p) === bulkCatId);
      try {
        await wsClient.request('category.update', {
          id: bulkCatId,
          profitRetail: retail,
          profitSupermarket: supermarket,
          profitWholesale: wholesale,
        });
      } catch (e) {
        setToast({ open: true, msg: e instanceof Error ? e.message : 'خطا', color: 'danger' });
        return;
      }
    }
    if (!targets.length) {
      setToast({ open: true, msg: 'محصولی نیست', color: 'warning' });
      return;
    }
    setBulkBusy(true);
    try {
      for (const p of targets) {
        await wsClient.request('product.update', {
          id: p._id,
          profitRetail: retail,
          profitSupermarket: supermarket,
          profitWholesale: wholesale,
        });
      }
      await load();
      setToast({
        open: true,
        msg:
          scope === 'all'
            ? `سود روی ${targets.length} محصول اعمال شد`
            : `سود روی دسته و ${targets.length} محصول اعمال شد`,
        color: 'success',
      });
    } catch (e) {
      setToast({ open: true, msg: e instanceof Error ? e.message : 'خطا', color: 'danger' });
    } finally {
      setBulkBusy(false);
    }
  };

  const saveSettings = async () => {
    if (!isAdmin) {
      setToast({ open: true, msg: 'فقط مدیر می‌تواند ذخیره کند', color: 'warning' });
      return;
    }
    try {
      await wsClient.request('settings.update', {
        catalogEnabled,
        catalogTitle,
        catalogPhone,
        catalogNote,
        brandName,
        brandTagline,
        brandPrimaryColor,
        brandLogoUrl: brandLogoUrl || undefined,
        catalogSupermarketMinKg: parseFloat(supermarketMinKg) || 500,
        catalogWholesaleMinKg: parseFloat(wholesaleMinKg) || 2000,
      });
      setToast({ open: true, msg: 'تنظیمات کاتالوگ ذخیره شد', color: 'success' });
    } catch (e) {
      setToast({ open: true, msg: e instanceof Error ? e.message : 'خطا', color: 'danger' });
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(catalogUrl);
      setToast({ open: true, msg: 'لینک کاتالوگ کپی شد', color: 'success' });
    } catch {
      setToast({ open: true, msg: catalogUrl, color: 'warning' });
    }
  };

  const uploadImage = (productId: string, file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      void wsClient
        .request('product.uploadImage', { id: productId, dataUrl: String(reader.result || '') })
        .then(async () => {
          setToast({ open: true, msg: 'عکس ذخیره شد', color: 'success' });
          await load();
          if (editProduct?._id === productId) {
            const refreshed = await wsClient.request<Product[]>('product.list', {});
            const next = (Array.isArray(refreshed) ? refreshed : []).find((x) => x._id === productId);
            if (next) setEditProduct(next);
          }
        })
        .catch((e) =>
          setToast({
            open: true,
            msg: e instanceof Error ? e.message : 'آپلود نشد',
            color: 'danger',
          })
        );
    };
    reader.readAsDataURL(file);
  };

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/more" text="بازگشت" />
          </IonButtons>
          <IonTitle>مدیریت محصولات</IonTitle>
        </IonToolbar>
        <IonToolbar>
          <IonSegment
            value={tab}
            onIonChange={(e) => setTab((e.detail.value as AdminTab) || 'products')}
          >
            <IonSegmentButton value="products">
              <IonLabel>محصولات</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="categories">
              <IonLabel>دسته‌ها و سود</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="catalog">
              <IonLabel>کاتالوگ</IonLabel>
            </IonSegmentButton>
          </IonSegment>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="page-content ios-content">
        <IonRefresher
          slot="fixed"
          onIonRefresh={async (e: CustomEvent<RefresherEventDetail>) => {
            await load();
            e.detail.complete();
          }}
        >
          <IonRefresherContent />
        </IonRefresher>

        <div className="ion-padding compact">
          {tab === 'products' && isAdmin && (
            <>
              <div className="ios-glass-card">
                <div className="ios-section-title" style={{ marginTop: 0 }}>
                  اعمال سود دسته‌جمعی
                </div>
                <IonItem>
                  <IonLabel position="stacked">دسته (اختیاری)</IonLabel>
                  <IonSelect
                    value={bulkCatId}
                    placeholder="همه / انتخاب دسته"
                    interface="popover"
                    onIonChange={(e) => setBulkCatId(String(e.detail.value || ''))}
                  >
                    <IonSelectOption value="">همه محصولات</IonSelectOption>
                    {categories.map((c) => (
                      <IonSelectOption key={c._id} value={c._id}>
                        {c.name}
                      </IonSelectOption>
                    ))}
                  </IonSelect>
                </IonItem>
                <div className="profit-row">
                  <IonItem>
                    <IonLabel position="stacked">تکی %</IonLabel>
                    <IonInput
                      type="text"
                      inputMode="decimal"
                      value={bulkRetail}
                      onIonInput={(e) => setBulkRetail(sanitizeNumberInput(e.detail.value || '', { decimal: true }))}
                    />
                  </IonItem>
                  <IonItem>
                    <IonLabel position="stacked">سوپر %</IonLabel>
                    <IonInput
                      type="text"
                      inputMode="decimal"
                      value={bulkSuper}
                      onIonInput={(e) => setBulkSuper(sanitizeNumberInput(e.detail.value || '', { decimal: true }))}
                    />
                  </IonItem>
                  <IonItem>
                    <IonLabel position="stacked">عمده %</IonLabel>
                    <IonInput
                      type="text"
                      inputMode="decimal"
                      value={bulkWholesale}
                      onIonInput={(e) => setBulkWholesale(sanitizeNumberInput(e.detail.value || '', { decimal: true }))}
                    />
                  </IonItem>
                </div>
                <div className="chip-row">
                  <IonButton
                    size="small"
                    expand="block"
                    disabled={bulkBusy || !bulkCatId}
                    onClick={() => void applyBulk('category')}
                  >
                    اعمال روی دسته
                  </IonButton>
                  <IonButton
                    size="small"
                    expand="block"
                    fill="outline"
                    disabled={bulkBusy}
                    onClick={() => void applyBulk('all')}
                  >
                    اعمال روی همه
                  </IonButton>
                </div>
              </div>

              <div className="ios-section-title">
                لیست محصولات ({filteredProducts.length})
              </div>
              {filteredProducts.map((p) => (
                <div key={p._id} className="ios-glass-card prod-admin-card">
                  <div className="prod-admin-top">
                    <div className="prod-admin-thumb-wrap">
                      {p.imageUrl ? (
                        <img
                          src={resolveMediaUrl(p.imageUrl)}
                          alt={p.name}
                          className="prod-admin-thumb"
                        />
                      ) : (
                        <div className="prod-admin-thumb prod-admin-thumb-ph">
                          {p.name.slice(0, 1)}
                        </div>
                      )}
                    </div>
                    <div className="prod-admin-main">
                      <div className="ios-row">
                        <strong>{p.name}</strong>
                        <IonToggle
                          checked={!!p.catalogVisible}
                          onIonChange={(e) => {
                            const checked = e.detail.checked;
                            void wsClient
                              .request('product.update', { id: p._id, catalogVisible: checked })
                              .then(load)
                              .catch((err) =>
                                setToast({
                                  open: true,
                                  msg: err instanceof Error ? err.message : 'خطا',
                                  color: 'danger',
                                })
                              );
                          }}
                        />
                      </div>
                      <div className="ios-caption">
                        {p.categoryId?.name ? `${p.categoryId.name} · ` : ''}
                        {Math.round(p.stockKg || 0)} کیلو · بسته {p.kgPerPackage || 5}kg
                      </div>
                      <div className="prod-tier-list">
                        <div className="prod-tier-row retail">
                          <span className="prod-tier-label">تکی</span>
                          <span className="prod-tier-prices">
                            <strong>{formatToman(tierPricePerKg(p, 'retail'))}</strong>
                            <small>/کیلو</small>
                          </span>
                        </div>
                        <div className="prod-tier-row supermarket">
                          <span className="prod-tier-label">سوپر</span>
                          <span className="prod-tier-prices">
                            <strong>{formatToman(tierPricePerKg(p, 'supermarket'))}</strong>
                            <small>/کیلو</small>
                          </span>
                        </div>
                        <div className="prod-tier-row wholesale">
                          <span className="prod-tier-label">عمده</span>
                          <span className="prod-tier-prices">
                            <strong>{formatToman(tierPricePerKg(p, 'wholesale'))}</strong>
                            <small>/کیلو</small>
                          </span>
                        </div>
                      </div>
                      <IonButton
                        size="small"
                        expand="block"
                        color="warning"
                        fill="outline"
                        className="ion-margin-top"
                        onClick={() => openEdit(p)}
                      >
                        <IonIcon slot="start" icon={createOutline} />
                        ویرایش قیمت و سود
                      </IonButton>
                      {isAdmin && (
                        <>
                          <IonButton
                            size="small"
                            expand="block"
                            color="tertiary"
                            fill="outline"
                            onClick={() => {
                              setStockTarget(p);
                              setStockMode('set');
                              setStockUnit('kg');
                              setStockQty(String(Math.round(p.stockKg || 0)));
                              setStockPw('');
                              setStockNotes('');
                              setStockOpen(true);
                            }}
                          >
                            <IonIcon slot="start" icon={cubeOutline} />
                            اصلاح موجودی (رمز)
                          </IonButton>
                          <IonButton
                            size="small"
                            expand="block"
                            color="danger"
                            fill="clear"
                            onClick={() => {
                              setDeleteTarget(p);
                              setDeletePw('');
                              setDeleteOpen(true);
                            }}
                          >
                            <IonIcon slot="start" icon={trashOutline} />
                            حذف محصول
                          </IonButton>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}

          {tab === 'categories' && isAdmin && (
            <>
              <div className="ios-section-title">دسته‌ها و سود پیش‌فرض</div>
              <div className="ios-glass-card">
                <IonItem>
                  <IonLabel position="stacked">نام دسته جدید</IonLabel>
                  <IonInput value={catName} onIonInput={(e) => setCatName(e.detail.value || '')} />
                </IonItem>
                <div className="profit-row">
                  <IonItem>
                    <IonLabel position="stacked">تکی %</IonLabel>
                    <IonInput
                      type="text"
                      inputMode="decimal"
                      value={catRetail}
                      onIonInput={(e) => setCatRetail(sanitizeNumberInput(e.detail.value || '', { decimal: true }))}
                    />
                  </IonItem>
                  <IonItem>
                    <IonLabel position="stacked">سوپر %</IonLabel>
                    <IonInput
                      type="text"
                      inputMode="decimal"
                      value={catSuper}
                      onIonInput={(e) => setCatSuper(sanitizeNumberInput(e.detail.value || '', { decimal: true }))}
                    />
                  </IonItem>
                  <IonItem>
                    <IonLabel position="stacked">عمده %</IonLabel>
                    <IonInput
                      type="text"
                      inputMode="decimal"
                      value={catWholesale}
                      onIonInput={(e) => setCatWholesale(sanitizeNumberInput(e.detail.value || '', { decimal: true }))}
                    />
                  </IonItem>
                </div>
                <IonButton
                  expand="block"
                  className="ios-primary-btn"
                  onClick={async () => {
                    try {
                      await wsClient.request('category.create', {
                        name: catName.trim(),
                        profitRetail: parseFloat(catRetail) || 15,
                        profitSupermarket: parseFloat(catSuper) || 10,
                        profitWholesale: parseFloat(catWholesale) || 6,
                        profitPercent: parseFloat(catRetail) || 15,
                      });
                      setCatName('');
                      await load();
                      setToast({ open: true, msg: 'دسته ساخته شد', color: 'success' });
                    } catch (e) {
                      setToast({
                        open: true,
                        msg: e instanceof Error ? e.message : 'خطا',
                        color: 'danger',
                      });
                    }
                  }}
                >
                  افزودن دسته
                </IonButton>
              </div>

              {categories.map((c) => (
                <div key={c._id} className="ios-glass-card">
                  <div className="ios-row">
                    <strong>{c.name}</strong>
                    <IonButton
                      fill="clear"
                      color="danger"
                      size="small"
                      onClick={async () => {
                        if (!window.confirm(`حذف دسته «${c.name}»؟`)) return;
                        try {
                          await wsClient.request('category.delete', { id: c._id });
                          await load();
                          setToast({ open: true, msg: 'حذف شد', color: 'success' });
                        } catch (e) {
                          setToast({
                            open: true,
                            msg: e instanceof Error ? e.message : 'خطا',
                            color: 'danger',
                          });
                        }
                      }}
                    >
                      <IonIcon icon={trashOutline} />
                    </IonButton>
                  </div>
                  <div className="profit-row">
                    <IonItem>
                      <IonLabel position="stacked">تکی %</IonLabel>
                      <IonInput
                        type="text"
                      inputMode="decimal"
                        value={catEdits[c._id]?.retail ?? ''}
                        onIonInput={(e) =>
                          setCatEdits({
                            ...catEdits,
                            [c._id]: { ...catEdits[c._id], retail: sanitizeNumberInput(e.detail.value || '', { decimal: true }) },
                          })
                        }
                      />
                    </IonItem>
                    <IonItem>
                      <IonLabel position="stacked">سوپر %</IonLabel>
                      <IonInput
                        type="text"
                      inputMode="decimal"
                        value={catEdits[c._id]?.supermarket ?? ''}
                        onIonInput={(e) =>
                          setCatEdits({
                            ...catEdits,
                            [c._id]: { ...catEdits[c._id], supermarket: sanitizeNumberInput(e.detail.value || '', { decimal: true }) },
                          })
                        }
                      />
                    </IonItem>
                    <IonItem>
                      <IonLabel position="stacked">عمده %</IonLabel>
                      <IonInput
                        type="text"
                      inputMode="decimal"
                        value={catEdits[c._id]?.wholesale ?? ''}
                        onIonInput={(e) =>
                          setCatEdits({
                            ...catEdits,
                            [c._id]: { ...catEdits[c._id], wholesale: sanitizeNumberInput(e.detail.value || '', { decimal: true }) },
                          })
                        }
                      />
                    </IonItem>
                  </div>
                  <IonButton
                    expand="block"
                    size="small"
                    fill="outline"
                    onClick={async () => {
                      try {
                        const e = catEdits[c._id];
                        await wsClient.request('category.update', {
                          id: c._id,
                          profitRetail: parseFloat(e?.retail || '0'),
                          profitSupermarket: parseFloat(e?.supermarket || '0'),
                          profitWholesale: parseFloat(e?.wholesale || '0'),
                        });
                        await load();
                        setToast({ open: true, msg: 'درصد دسته ذخیره شد', color: 'success' });
                      } catch (err) {
                        setToast({
                          open: true,
                          msg: err instanceof Error ? err.message : 'خطا',
                          color: 'danger',
                        });
                      }
                    }}
                  >
                    ذخیره درصد دسته
                  </IonButton>
                </div>
              ))}
            </>
          )}

          {tab === 'catalog' && (
            <>
              <div className="ios-glass-card">
                <div className="ios-section-title" style={{ marginTop: 0 }}>
                  لینک اشتراک
                </div>
                <p className="hint convert-hint">{catalogUrl}</p>
                <div className="chip-row">
                  <IonButton size="small" onClick={() => void copyLink()}>
                    <IonIcon slot="start" icon={copyOutline} />
                    کپی لینک
                  </IonButton>
                  <IonButton size="small" fill="outline" href="/catalog" routerDirection="root">
                    <IonIcon slot="start" icon={openOutline} />
                    پیش‌نمایش
                  </IonButton>
                </div>
              </div>

              <div className="ios-glass-card">
                <div className="ios-section-title" style={{ marginTop: 0 }}>
                  برند
                </div>
                {brandLogoUrl && (
                  <img
                    src={resolveMediaUrl(brandLogoUrl)}
                    alt="لوگو"
                    style={{ width: 64, height: 64, borderRadius: 14, objectFit: 'cover' }}
                  />
                )}
                <input
                  ref={logoRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const r = new FileReader();
                    r.onload = () => setBrandLogoUrl(String(r.result || ''));
                    r.readAsDataURL(f);
                  }}
                />
                {isAdmin && (
                  <IonButton size="small" fill="outline" onClick={() => logoRef.current?.click()}>
                    <IonIcon slot="start" icon={imageOutline} />
                    لوگو
                  </IonButton>
                )}
                <IonItem>
                  <IonLabel position="stacked">نام برند</IonLabel>
                  <IonInput
                    value={brandName}
                    disabled={!isAdmin}
                    onIonInput={(e) => setBrandName(e.detail.value || '')}
                  />
                </IonItem>
                <IonItem>
                  <IonLabel position="stacked">شعار</IonLabel>
                  <IonInput
                    value={brandTagline}
                    disabled={!isAdmin}
                    onIonInput={(e) => setBrandTagline(e.detail.value || '')}
                  />
                </IonItem>
                <IonItem>
                  <IonLabel position="stacked">رنگ برند</IonLabel>
                  <IonInput
                    value={brandPrimaryColor}
                    disabled={!isAdmin}
                    onIonInput={(e) => setBrandPrimaryColor(e.detail.value || '#1e3a5f')}
                  />
                </IonItem>
              </div>

              <div className="ios-glass-card">
                <div className="ios-section-title" style={{ marginTop: 0 }}>
                  تنظیمات صفحه کاتالوگ
                </div>
                <div className="ios-row">
                  <span>کاتالوگ عمومی فعال</span>
                  <IonToggle
                    checked={catalogEnabled}
                    disabled={!isAdmin}
                    onIonChange={(e) => setCatalogEnabled(e.detail.checked)}
                  />
                </div>
                <IonItem>
                  <IonLabel position="stacked">عنوان کاتالوگ</IonLabel>
                  <IonInput
                    value={catalogTitle}
                    disabled={!isAdmin}
                    onIonInput={(e) => setCatalogTitle(e.detail.value || '')}
                  />
                </IonItem>
                <DigitInput
                  label="شماره تماس"
                  mode="phone"
                  value={catalogPhone}
                  disabled={!isAdmin}
                  onChange={setCatalogPhone}
                  placeholder="09…"
                />
                <IonItem>
                  <IonLabel position="stacked">یادداشت بالای صفحه</IonLabel>
                  <IonInput
                    value={catalogNote}
                    disabled={!isAdmin}
                    onIonInput={(e) => setCatalogNote(e.detail.value || '')}
                  />
                </IonItem>
                <IonItem>
                  <IonLabel position="stacked">حداقل کیلو · سوپرمارکت</IonLabel>
                  <IonInput
                    type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                    value={supermarketMinKg}
                    disabled={!isAdmin}
                    onIonInput={(e) => setSupermarketMinKg(sanitizeNumberInput(e.detail.value || '') || '500')}
                  />
                </IonItem>
                <IonItem>
                  <IonLabel position="stacked">حداقل کیلو · عمده</IonLabel>
                  <IonInput
                    type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                    value={wholesaleMinKg}
                    disabled={!isAdmin}
                    onIonInput={(e) => setWholesaleMinKg(sanitizeNumberInput(e.detail.value || '') || '2000')}
                  />
                </IonItem>
                {isAdmin && (
                  <IonButton
                    expand="block"
                    className="ios-primary-btn"
                    onClick={() => void saveSettings()}
                  >
                    ذخیره تنظیمات کاتالوگ
                  </IonButton>
                )}
              </div>
            </>
          )}

          {!isAdmin && tab !== 'catalog' && <p className="empty-state">فقط مدیر</p>}
        </div>

        <IonModal isOpen={editOpen} onDidDismiss={() => setEditOpen(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>ویرایش {editProduct?.name || ''}</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setEditOpen(false)}>بستن</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            {editProduct && (
              <>
                <div className="ios-row" style={{ marginBottom: 12 }}>
                  {editProduct.imageUrl ? (
                    <img
                      src={resolveMediaUrl(editProduct.imageUrl)}
                      alt=""
                      className="prod-admin-thumb"
                    />
                  ) : (
                    <div className="prod-admin-thumb prod-admin-thumb-ph">
                      {editProduct.name.slice(0, 1)}
                    </div>
                  )}
                  <div style={{ flex: 1 }}>
                    <input
                      ref={editFileRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadImage(editProduct._id, f);
                        e.target.value = '';
                      }}
                    />
                    <IonButton
                      size="small"
                      fill="outline"
                      onClick={() => editFileRef.current?.click()}
                    >
                      <IonIcon slot="start" icon={imageOutline} />
                      تغییر عکس
                    </IonButton>
                    <p className="hint">
                      هزینه: {formatToman(productCost(editProduct))}/کیلو
                    </p>
                  </div>
                </div>

                <IonItem>
                  <IonLabel position="stacked">نام محصول</IonLabel>
                  <IonInput
                    value={editName}
                    placeholder="مثلاً قند شکسته ۱۰ نایلونی"
                    onIonInput={(e) => setEditName(e.detail.value || '')}
                  />
                </IonItem>

                {(
                  [
                    {
                      key: 'retail' as const,
                      label: 'تکی',
                      pct: editRetailPct,
                      price: editRetailPrice,
                    },
                    {
                      key: 'supermarket' as const,
                      label: 'سوپرمارکت',
                      pct: editSuperPct,
                      price: editSuperPrice,
                    },
                    {
                      key: 'wholesale' as const,
                      label: 'عمده',
                      pct: editWholePct,
                      price: editWholePrice,
                    },
                  ] as const
                ).map((row) => (
                  <div key={row.key} className="ios-glass-card">
                    <strong>{row.label}</strong>
                    <div className="profit-row">
                      <IonItem>
                        <IonLabel position="stacked">درصد %</IonLabel>
                        <IonInput
                          type="text"
                          inputMode="decimal"
                          value={row.pct}
                          placeholder="مثلاً 2.5"
                          onIonInput={(e) => syncPriceFromPct(row.key, sanitizeNumberInput(e.detail.value || '', { decimal: true }))}
                        />
                      </IonItem>
                      <IonItem>
                        <IonLabel position="stacked">قیمت / کیلو</IonLabel>
                        <IonInput
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={row.price}
                          onIonInput={(e) => syncPctFromPrice(row.key, e.detail.value || '')}
                        />
                      </IonItem>
                    </div>
                  </div>
                ))}

                <IonItem>
                  <IonLabel position="stacked">توضیح کوتاه</IonLabel>
                  <IonInput
                    value={editNote}
                    onIonInput={(e) => setEditNote(e.detail.value || '')}
                  />
                </IonItem>

                <IonButton
                  expand="block"
                  className="ios-primary-btn"
                  disabled={editSaving}
                  onClick={() => void saveEdit()}
                >
                  {editSaving ? '…' : 'ذخیره'}
                </IonButton>
              </>
            )}
          </IonContent>
        </IonModal>

        <IonModal isOpen={stockOpen} onDidDismiss={() => setStockOpen(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>اصلاح موجودی</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setStockOpen(false)}>انصراف</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            {stockTarget && (
              <>
                <p className="hint">
                  <strong>{stockTarget.name}</strong>
                  <br />
                  موجودی فعلی: {formatKg(stockTarget.stockKg || 0)}
                  {' · '}
                  بسته {stockTarget.kgPerPackage || 5}kg
                </p>

                <div className="chip-row">
                  <IonChip
                    className={stockMode === 'set' ? 'ios-chip-active' : 'ios-chip'}
                    onClick={() => {
                      setStockMode('set');
                      setStockQty(String(Math.round(stockTarget.stockKg || 0)));
                    }}
                  >
                    تنظیم موجودی نهایی
                  </IonChip>
                  <IonChip
                    className={stockMode === 'delta' ? 'ios-chip-active' : 'ios-chip'}
                    onClick={() => {
                      setStockMode('delta');
                      setStockQty('');
                    }}
                  >
                    اضافه / کم کردن
                  </IonChip>
                </div>

                <div className="chip-row" style={{ marginTop: 8 }}>
                  <IonChip
                    className={stockUnit === 'kg' ? 'ios-chip-active' : 'ios-chip'}
                    onClick={() => setStockUnit('kg')}
                  >
                    کیلو
                  </IonChip>
                  <IonChip
                    className={stockUnit === 'package' ? 'ios-chip-active' : 'ios-chip'}
                    onClick={() => setStockUnit('package')}
                  >
                    بسته
                  </IonChip>
                </div>

                <p className="hint" style={{ marginBottom: 4 }}>
                  {stockMode === 'set'
                    ? `موجودی نهایی (${stockUnit === 'kg' ? 'کیلو' : 'بسته'})`
                    : `مقدار تغییر (+ اضافه / − کم) به ${stockUnit === 'kg' ? 'کیلو' : 'بسته'}`}
                </p>
                <QtyStepper
                  value={stockQty}
                  onChange={setStockQty}
                  min={stockMode === 'set' ? 0 : -999999}
                  allowNegative={stockMode === 'delta'}
                />
                {stockMode === 'delta' && (
                  <div className="chip-row" style={{ marginTop: 6 }}>
                    <IonButton
                      size="small"
                      fill="outline"
                      color="danger"
                      onClick={() => {
                        const n = Math.abs(parseFloat(stockQty) || 0);
                        setStockQty(n ? `-${n}` : '-');
                      }}
                    >
                      منفی (کاهش)
                    </IonButton>
                    <IonButton
                      size="small"
                      fill="outline"
                      color="success"
                      onClick={() => {
                        const n = Math.abs(parseFloat(stockQty) || 0);
                        setStockQty(n ? String(n) : '');
                      }}
                    >
                      مثبت (افزایش)
                    </IonButton>
                  </div>
                )}

                <IonItem>
                  <IonLabel position="stacked">یادداشت (اختیاری)</IonLabel>
                  <IonInput
                    value={stockNotes}
                    onIonInput={(e) => setStockNotes(e.detail.value || '')}
                    placeholder="مثلاً انبارگردانی / کسری"
                  />
                </IonItem>
                <IonItem>
                  <IonLabel position="stacked">رمز اصلاح</IonLabel>
                  <IonInput
                    type="password"
                    value={stockPw}
                    onIonInput={(e) => setStockPw(e.detail.value || '')}
                    placeholder="رمز حذف/ویرایش"
                  />
                </IonItem>

                <IonButton
                  expand="block"
                  color="tertiary"
                  className="ion-margin-top"
                  disabled={stockSaving || !stockPw || stockQty === '' || stockQty === '-'}
                  onClick={async () => {
                    if (!stockTarget) return;
                    const raw = parseFloat(stockQty);
                    if (!Number.isFinite(raw)) {
                      setToast({ open: true, msg: 'مقدار نامعتبر', color: 'danger' });
                      return;
                    }
                    const kgPer = stockTarget.kgPerPackage || 5;
                    const qtyKg = stockUnit === 'package' ? raw * kgPer : raw;
                    setStockSaving(true);
                    try {
                      const res = await wsClient.request<{
                        beforeKg: number;
                        afterKg: number;
                      }>('product.stock.adjust', {
                        id: stockTarget._id,
                        password: stockPw,
                        mode: stockMode,
                        qtyKg,
                        notes: stockNotes.trim() || undefined,
                      });
                      setToast({
                        open: true,
                        msg: `موجودی: ${formatKg(res.beforeKg)} → ${formatKg(res.afterKg)}`,
                        color: 'success',
                      });
                      setStockOpen(false);
                      setStockTarget(null);
                      await load();
                    } catch (e) {
                      setToast({
                        open: true,
                        msg: e instanceof Error ? e.message : 'ذخیره نشد',
                        color: 'danger',
                      });
                    } finally {
                      setStockSaving(false);
                    }
                  }}
                >
                  {stockSaving ? '…' : 'ذخیره با رمز'}
                </IonButton>
              </>
            )}
          </IonContent>
        </IonModal>

        <IonModal isOpen={deleteOpen} onDidDismiss={() => setDeleteOpen(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>حذف محصول</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setDeleteOpen(false)}>انصراف</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <p className="hint">
              «{deleteTarget?.name}» حذف می‌شود. موجودی باید صفر باشد. فاکتورهای قبلی نام قلم را نگه
              می‌دارند.
            </p>
            {(deleteTarget?.stockKg || 0) > 0.01 && (
              <p className="hint danger-text">
                موجودی فعلی: {Math.round(deleteTarget?.stockKg || 0).toLocaleString('fa-IR')} کیلو —
                اول خالی کنید
              </p>
            )}
            <IonItem>
              <IonLabel position="stacked">رمز حذف</IonLabel>
              <IonInput
                type="password"
                value={deletePw}
                onIonInput={(e) => setDeletePw(e.detail.value || '')}
                placeholder="رمز حذف"
              />
            </IonItem>
            <IonButton
              expand="block"
              color="danger"
              className="ion-margin-top"
              disabled={deleting || !deletePw || !deleteTarget}
              onClick={async () => {
                if (!deleteTarget) return;
                setDeleting(true);
                try {
                  await wsClient.request('product.delete', {
                    id: deleteTarget._id,
                    password: deletePw,
                  });
                  setToast({ open: true, msg: 'محصول حذف شد', color: 'success' });
                  setDeleteOpen(false);
                  setDeleteTarget(null);
                  setDeletePw('');
                  setEditOpen(false);
                  await load();
                } catch (e) {
                  setToast({
                    open: true,
                    msg: e instanceof Error ? e.message : 'حذف نشد',
                    color: 'danger',
                  });
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting ? '…' : 'تأیید حذف'}
            </IonButton>
          </IonContent>
        </IonModal>

        {/* hidden file inputs for list thumbs if needed later */}
        {products.map((p) => (
          <input
            key={`f-${p._id}`}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            ref={(el) => {
              fileRefs.current[p._id] = el;
            }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadImage(p._id, f);
              e.target.value = '';
            }}
          />
        ))}

        <IonToast
          isOpen={toast.open}
          message={toast.msg}
          color={toast.color}
          duration={2400}
          onDidDismiss={() => setToast((t) => ({ ...t, open: false }))}
          position="top"
        />
      </IonContent>
    </IonPage>
  );
};

export default CatalogAdmin;
