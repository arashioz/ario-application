import { useEffect, useMemo, useRef, useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonItem,
  IonLabel,
  IonInput,
  IonButton,
  IonChip,
  IonToast,
  IonToggle,
  IonIcon,
} from '@ionic/react';
import { addOutline, checkmarkCircleOutline, imageOutline, trashOutline, walletOutline } from 'ionicons/icons';
import { useHistory } from 'react-router-dom';
import { wsClient, newMutationId } from '../api/ws';
import { resolveMediaUrl } from '../api/client';
import { parseAmount, formatRial, formatKg, resolveLineAmount, todayIso, formatMoneyInput, formatToman, sanitizeNumberInput } from '../utils/format';
import { PersianDateField } from '../components/PersianDateField';
import { InvoiceListPanel } from '../components/InvoiceListPanel';
import { useAuth } from '../auth/AuthContext';

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
  kgPerPackage: number;
  stockKg: number;
  avgCostPerKg: number;
  categoryId: { _id?: string; name?: string; profitPercent: number } | string;
}

interface Item {
  name: string;
  categoryId: string;
  categoryName: string;
  unit: 'kg' | 'package';
  qtyInput: string;
  unitPrice: string;
  kgPerPackage: string;
  profitRetail: string;
  profitSupermarket: string;
  profitWholesale: string;
}

interface ProductSnapshot {
  productId: string;
  name: string;
  avgCostPerKg: number;
  lastPurchasePricePerKg?: number;
  stockKg: number;
  isNew: boolean;
  imageUrl?: string;
  categoryId?: string;
  profitRetail?: number;
  profitSupermarket?: number;
  profitWholesale?: number;
}

const empty = (): Item => ({
  name: '',
  categoryId: '',
  categoryName: '',
  unit: 'kg',
  qtyInput: '',
  unitPrice: '',
  kgPerPackage: '5',
  profitRetail: '15',
  profitSupermarket: '10',
  profitWholesale: '6',
});

const Purchase: React.FC = () => {
  const history = useHistory();
  const { isAdmin } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [supplier, setSupplier] = useState('شرکت');
  const [date, setDate] = useState(todayIso());
  const [paidNow, setPaidNow] = useState(false);
  const [items, setItems] = useState<Item[]>([empty()]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });
  const [snapshots, setSnapshots] = useState<ProductSnapshot[]>([]);
  const [snapEdits, setSnapEdits] = useState<
    Record<string, { retail: string; supermarket: string; wholesale: string }>
  >({});
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const [cashBalance, setCashBalance] = useState(0);
  const [cardBalance, setCardBalance] = useState(0);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    void (async () => {
      const [cats, prods, settings] = await Promise.all([
        wsClient.request<Category[]>('category.list'),
        wsClient.request<Product[]>('product.list'),
        wsClient.request<{ cashBalance: number; cardBalance: number }>('settings.get').catch(() => null),
      ]);
      setCategories(cats);
      setProducts(prods);
      if (settings) {
        setCashBalance(settings.cashBalance || 0);
        setCardBalance(settings.cardBalance || 0);
      }
    })().catch(console.warn);
  }, []);

  const update = (i: number, field: keyof Item, value: string) => {
    setItems((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: value };
      if (field === 'name') {
        const match = products.find((p) => p.name === value);
        if (match) {
          next[i].kgPerPackage = String(match.kgPerPackage || 5);
          const catId =
            typeof match.categoryId === 'string' ? match.categoryId : match.categoryId?._id || '';
          const catName =
            typeof match.categoryId === 'object' ? match.categoryId?.name || '' : '';
          if (catId) next[i].categoryId = catId;
          if (catName) next[i].categoryName = catName;
        }
      }
      if (field === 'categoryName') {
        const cat = categories.find((c) => c.name === value);
        if (cat) {
          next[i].categoryId = cat._id;
          next[i].profitRetail = String(cat.profitRetail ?? cat.profitPercent ?? 15);
          next[i].profitSupermarket = String(cat.profitSupermarket ?? 10);
          next[i].profitWholesale = String(cat.profitWholesale ?? 6);
        } else {
          next[i].categoryId = '';
        }
      }
      return next;
    });
  };

  const liveTotals = useMemo(() => {
    let kg = 0;
    let amount = 0;
    for (const it of items) {
      const qty = parseFloat(it.qtyInput) || 0;
      const price = parseAmount(it.unitPrice) || 0;
      const kgPer = parseFloat(it.kgPerPackage) || 5;
      const { qtyKg, lineAmount } = resolveLineAmount(it.unit, price, qty, kgPer);
      kg += qtyKg;
      amount += lineAmount;
    }
    return { kg, amount };
  }, [items]);

  const pickProduct = (index: number, p: Product) => {
    setItems((prev) => {
      const next = [...prev];
      const catId =
        typeof p.categoryId === 'string' ? p.categoryId : p.categoryId?._id || '';
      const catName =
        typeof p.categoryId === 'object' ? p.categoryId?.name || '' : '';
      const cat = categories.find((c) => c._id === catId);
      next[index] = {
        ...next[index],
        name: p.name,
        kgPerPackage: String(p.kgPerPackage || 5),
        categoryId: catId,
        categoryName: catName,
        profitRetail: String(cat?.profitRetail ?? cat?.profitPercent ?? 15),
        profitSupermarket: String(cat?.profitSupermarket ?? 10),
        profitWholesale: String(cat?.profitWholesale ?? 6),
        unitPrice:
          p.avgCostPerKg > 0
            ? formatMoneyInput(String(Math.round(p.avgCostPerKg)))
            : next[index].unitPrice,
      };
      return next;
    });
  };

  const submit = async () => {
    const valid = items.filter((i) => i.name && (i.categoryName.trim() || i.categoryId) && i.unitPrice && i.qtyInput);
    if (!valid.length) {
      setToast({ open: true, msg: 'محصول، دسته و مبلغ را وارد کنید', color: 'danger' });
      return;
    }
    setLoading(true);
    try {
      const res = await wsClient.request<{
        invoice: { totalAmount: number; totalKg: number };
        productSnapshots: ProductSnapshot[];
        queued?: boolean;
      }>(
        'purchase.create',
        {
          supplier,
          date,
          paidNow,
          items: valid.map((i) => ({
            name: i.name.trim(),
            categoryId: i.categoryId || undefined,
            categoryName: i.categoryName.trim() || undefined,
            unit: i.unit,
            qtyInput: parseFloat(i.qtyInput) || 0,
            unitPrice: parseAmount(i.unitPrice) || 0,
            kgPerPackage: parseFloat(i.kgPerPackage) || 5,
            profitRetail: parseFloat(i.profitRetail) || 15,
            profitSupermarket: parseFloat(i.profitSupermarket) || 10,
            profitWholesale: parseFloat(i.profitWholesale) || 6,
          })),
        },
        { clientMutationId: newMutationId(), queueIfOffline: true }
      );

      if ((res as { queued?: boolean }).queued) {
        setToast({ open: true, msg: 'آفلاین ذخیره شد — بعد از وصل sync می‌شود', color: 'warning' });
      } else {
        const snaps = res.productSnapshots || [];
        setSnapshots(snaps);
        const edits: typeof snapEdits = {};
        for (const s of snaps) {
          edits[s.productId] = {
            retail: String(s.profitRetail ?? 15),
            supermarket: String(s.profitSupermarket ?? 10),
            wholesale: String(s.profitWholesale ?? 6),
          };
        }
        setSnapEdits(edits);
        setToast({ open: true, msg: 'فاکتور خرید ثبت شد — عکس و درصد را تنظیم کنید', color: 'success' });
        setListRefreshKey((k) => k + 1);
        const [prods, cats, settings] = await Promise.all([
          wsClient.request<Product[]>('product.list'),
          wsClient.request<Category[]>('category.list'),
          wsClient.request<{ cashBalance: number; cardBalance: number }>('settings.get').catch(() => null),
        ]);
        setProducts(prods);
        setCategories(cats);
        if (settings) {
          setCashBalance(settings.cashBalance || 0);
          setCardBalance(settings.cardBalance || 0);
        }
      }
      setItems([empty()]);
    } catch (e) {
      setToast({ open: true, msg: e instanceof Error ? e.message : 'خطا', color: 'danger' });
    } finally {
      setLoading(false);
    }
  };

  const uploadSnapImage = (productId: string, file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      void wsClient
        .request<{ imageUrl?: string }>('product.uploadImage', {
          id: productId,
          dataUrl: String(reader.result || ''),
        })
        .then((updated) => {
          const url = (updated as { imageUrl?: string })?.imageUrl;
          setSnapshots((prev) =>
            prev.map((s) => (s.productId === productId ? { ...s, imageUrl: url || s.imageUrl } : s))
          );
          setToast({ open: true, msg: 'عکس ذخیره شد', color: 'success' });
          return wsClient.request<Product[]>('product.list').then(setProducts);
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

  const saveSnapProfits = async (s: ProductSnapshot) => {
    if (!s.categoryId) {
      setToast({ open: true, msg: 'دسته این محصول مشخص نیست', color: 'warning' });
      return;
    }
    const e = snapEdits[s.productId];
    if (!e) return;
    try {
      await wsClient.request('category.update', {
        id: s.categoryId,
        profitRetail: parseFloat(e.retail) || 0,
        profitSupermarket: parseFloat(e.supermarket) || 0,
        profitWholesale: parseFloat(e.wholesale) || 0,
      });
      setToast({ open: true, msg: `درصد سود «${s.name}» ذخیره شد`, color: 'success' });
    } catch (err) {
      setToast({
        open: true,
        msg: err instanceof Error ? err.message : 'ذخیره نشد',
        color: 'danger',
      });
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar color="primary">
          <IonTitle>خرید</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="page-content">
        <div className="ion-padding compact">
          <IonCard className="tight-card">
            <IonCardContent>
              <IonItem>
                <IonLabel position="stacked">تأمین‌کننده / شرکت</IonLabel>
                <IonInput value={supplier} onIonInput={(e) => setSupplier(e.detail.value || '')} />
              </IonItem>
              <PersianDateField value={date} onChange={setDate} />
              <IonItem lines="none">
                <IonLabel>پرداخت نقد الان</IonLabel>
                <IonToggle checked={paidNow} onIonChange={(e) => setPaidNow(e.detail.checked)} />
              </IonItem>
              <p className="hint">{paidNow ? 'از صندوق کم می‌شود' : 'بدهی به شرکت ثبت می‌شود'}</p>
            </IonCardContent>
          </IonCard>

          {items.map((item, index) => {
            const qty = parseFloat(item.qtyInput) || 0;
            const price = parseAmount(item.unitPrice) || 0;
            const kgPer = parseFloat(item.kgPerPackage) || 5;
            const { qtyKg, qtyPackages, perKg, perPackage, lineAmount } = resolveLineAmount(
              item.unit,
              price,
              qty,
              kgPer
            );
            const nameSuggestions = item.name.trim()
              ? products.filter((p) => p.name.includes(item.name)).slice(0, 6)
              : products.slice(0, 8);
            return (
              <IonCard key={index} className="tight-card">
                <IonCardHeader>
                  <IonCardTitle className="small-title">
                    قلم {index + 1}
                    {items.length > 1 && (
                      <IonButton fill="clear" color="danger" size="small" onClick={() => setItems(items.filter((_, i) => i !== index))}>
                        <IonIcon icon={trashOutline} />
                      </IonButton>
                    )}
                  </IonCardTitle>
                </IonCardHeader>
                <IonCardContent>
                  <IonItem>
                    <IonLabel position="stacked">نام محصول (خودکار به لیست اضافه می‌شود)</IonLabel>
                    <IonInput
                      value={item.name}
                      onIonInput={(e) => update(index, 'name', e.detail.value || '')}
                      placeholder="مثلاً قند ۵ کیلویی"
                    />
                  </IonItem>
                  <p className="hint" style={{ margin: '4px 0 2px' }}>
                    {item.name.trim() ? 'محصولات مشابه:' : 'محصولات موجود — بزن تا پر شود:'}
                  </p>
                  <div className="chip-row">
                    {nameSuggestions.map((p) => (
                      <IonChip
                        key={p._id}
                        color={item.name === p.name ? 'primary' : 'medium'}
                        outline={item.name !== p.name}
                        onClick={() => pickProduct(index, p)}
                      >
                        {p.name}
                      </IonChip>
                    ))}
                  </div>

                  <IonItem>
                    <IonLabel position="stacked">دسته (خودتان بنویسید — اگر نبود ساخته می‌شود)</IonLabel>
                    <IonInput
                      value={item.categoryName}
                      onIonInput={(e) => update(index, 'categoryName', e.detail.value || '')}
                      placeholder="مثلاً قند"
                    />
                  </IonItem>
                  <div className="chip-row">
                    {categories.slice(0, 8).map((c) => (
                      <IonChip
                        key={c._id}
                        color={item.categoryName === c.name ? 'primary' : 'medium'}
                        outline={item.categoryName !== c.name}
                        onClick={() => update(index, 'categoryName', c.name)}
                      >
                        {c.name}
                      </IonChip>
                    ))}
                  </div>
                  {!item.categoryId && item.categoryName.trim() && (
                    <>
                      <p className="hint">درصد سود دسته جدید:</p>
                      <div className="profit-row">
                        <IonItem>
                          <IonLabel position="stacked">تکی %</IonLabel>
                          <IonInput
                            type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                            value={item.profitRetail}
                            onIonInput={(e) => update(index, 'profitRetail', sanitizeNumberInput(e.detail.value || '', { decimal: true }))}
                          />
                        </IonItem>
                        <IonItem>
                          <IonLabel position="stacked">سوپر %</IonLabel>
                          <IonInput
                            type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                            value={item.profitSupermarket}
                            onIonInput={(e) => update(index, 'profitSupermarket', sanitizeNumberInput(e.detail.value || '', { decimal: true }))}
                          />
                        </IonItem>
                        <IonItem>
                          <IonLabel position="stacked">عمده %</IonLabel>
                          <IonInput
                            type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                            value={item.profitWholesale}
                            onIonInput={(e) => update(index, 'profitWholesale', sanitizeNumberInput(e.detail.value || '', { decimal: true }))}
                          />
                        </IonItem>
                      </div>
                    </>
                  )}

                  <IonItem>
                    <IonLabel position="stacked">کیلو هر بسته</IonLabel>
                    <IonInput
                      type="text"
                      inputMode="decimal"
                      value={item.kgPerPackage}
                      onIonInput={(e) => update(index, 'kgPerPackage', sanitizeNumberInput(e.detail.value || '', { decimal: true }))}
                    />
                  </IonItem>

                  <div className="ios-section-title" style={{ marginTop: 8 }}>
                    مقدار — کیلو ↔ بسته (خودکار)
                  </div>
                  <div className="profit-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
                    <IonItem>
                      <IonLabel position="stacked">کیلوگرم</IonLabel>
                      <IonInput
                        type="text"
                        inputMode="decimal"
                        placeholder="0.2"
                        value={item.unit === 'kg' ? item.qtyInput : String(Math.round(qtyKg * 100) / 100 || '')}
                        onIonInput={(e) => {
                        const v = sanitizeNumberInput(e.detail.value || '', { decimal: true });
                          setItems((prev) => {
                            const next = [...prev];
                            const kpp = parseFloat(next[index].kgPerPackage) || 5;
                            next[index] = {
                              ...next[index],
                              unit: 'kg',
                              qtyInput: v,
                            };
                            return next;
                          });
                        }}
                      />
                    </IonItem>
                    <IonItem>
                      <IonLabel position="stacked">بسته (گرد)</IonLabel>
                      <IonInput
                        type="text"
                        inputMode="decimal"
                        placeholder="0.2"
                        value={
                          item.unit === 'package'
                            ? item.qtyInput
                            : qty > 0
                              ? String(Math.round(qtyPackages))
                              : ''
                        }
                        onIonInput={(e) => {
                        const v = sanitizeNumberInput(e.detail.value || '', { decimal: true });
                          setItems((prev) => {
                            const next = [...prev];
                            next[index] = {
                              ...next[index],
                              unit: 'package',
                              qtyInput: v,
                            };
                            return next;
                          });
                        }}
                      />
                    </IonItem>
                  </div>
                  <p className="hint convert-hint">
                    {qty > 0
                      ? item.unit === 'package'
                        ? `${Math.round(qty)} بسته × ${kgPer} کیلو = ${formatKg(qtyKg)}`
                        : `${formatKg(qty)} ≈ ${Math.round(qtyPackages).toLocaleString('fa-IR')} بسته (${kgPer} کیلو/بسته)`
                      : 'مثلاً ۵۰۰ بسته بزن → کیلو حساب می‌شود، یا کیلو بزن → بسته گرد می‌شود'}
                  </p>

                  <div className="chip-row">
                    <IonChip
                      className={item.unit === 'kg' ? 'ios-chip-active' : 'ios-chip'}
                      onClick={() => update(index, 'unit', 'kg')}
                    >
                      قیمت بر اساس کیلو
                    </IonChip>
                    <IonChip
                      className={item.unit === 'package' ? 'ios-chip-active' : 'ios-chip'}
                      onClick={() => update(index, 'unit', 'package')}
                    >
                      قیمت بر اساس بسته
                    </IonChip>
                  </div>

                  <IonItem>
                    <IonLabel position="stacked">
                      قیمت واحد تومان ({item.unit === 'kg' ? 'هر کیلو' : 'هر بسته'})
                    </IonLabel>
                    <IonInput
                      inputmode="numeric"
                      value={item.unitPrice}
                      onIonInput={(e) => update(index, 'unitPrice', formatMoneyInput(e.detail.value || ''))}
                    />
                  </IonItem>
                  {qty > 0 && price > 0 && (
                    <p className="hint convert-hint">
                      جمع قلم: {formatRial(lineAmount)}
                      <br />
                      نرخ: {formatRial(Math.round(perKg))}/کیلو · {formatRial(perPackage)}/بسته
                    </p>
                  )}
                </IonCardContent>
              </IonCard>
            );
          })}

          <IonButton
            expand="block"
            fill="outline"
            size="small"
            onClick={() => setItems([...items, empty()])}
          >
            <IonIcon slot="start" icon={addOutline} />
            افزودن قلم
          </IonButton>

          <IonCard className="tight-card">
            <IonCardContent>
              <div className="stat-row">
                <span className="stat-label">جمع کیلو</span>
                <span className="stat-value">{formatKg(liveTotals.kg)}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">جمع مبلغ</span>
                <span className="stat-value bold">{formatRial(liveTotals.amount)}</span>
              </div>
            </IonCardContent>
          </IonCard>

          {snapshots.length > 0 && (
            <IonCard className="tight-card">
              <IonCardHeader>
                <IonCardTitle className="small-title">محصولات این خرید — عکس و درصد</IonCardTitle>
              </IonCardHeader>
              <IonCardContent>
                <p className="hint">برای هر محصول عکس بگذارید و درصد سود را تنظیم کنید</p>
                {snapshots.map((s) => {
                  const edit = snapEdits[s.productId] || {
                    retail: '15',
                    supermarket: '10',
                    wholesale: '6',
                  };
                  return (
                    <div key={s.productId} className="ios-glass-card" style={{ marginBottom: 10 }}>
                      <div className="ios-row">
                        <strong>
                          {s.name}
                          {s.isNew ? ' · جدید' : ''}
                        </strong>
                        <span className="ios-caption">{formatKg(s.stockKg)}</span>
                      </div>
                      <p className="hint" style={{ margin: '4px 0 8px' }}>
                        میانگین {formatRial(s.avgCostPerKg)}/کیلو
                        {s.lastPurchasePricePerKg
                          ? ` · آخر ${formatRial(s.lastPurchasePricePerKg)}`
                          : ''}
                      </p>
                      {s.imageUrl ? (
                        <img
                          src={resolveMediaUrl(s.imageUrl)}
                          alt={s.name}
                          style={{
                            width: '100%',
                            maxHeight: 140,
                            objectFit: 'cover',
                            borderRadius: 10,
                            marginBottom: 8,
                          }}
                        />
                      ) : (
                        <p className="hint">بدون عکس</p>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        ref={(el) => {
                          fileRefs.current[s.productId] = el;
                        }}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadSnapImage(s.productId, f);
                          e.target.value = '';
                        }}
                      />
                      <IonButton
                        size="small"
                        fill="outline"
                        onClick={() => fileRefs.current[s.productId]?.click()}
                      >
                        <IonIcon slot="start" icon={imageOutline} />
                        {s.imageUrl ? 'تعویض عکس' : 'افزودن عکس'}
                      </IonButton>
                      {s.categoryId && (
                        <>
                          <div className="profit-row" style={{ marginTop: 8 }}>
                            <IonItem>
                              <IonLabel position="stacked">تکی %</IonLabel>
                              <IonInput
                                type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                                value={edit.retail}
                                onIonInput={(e) =>
                                  setSnapEdits((prev) => ({
                                    ...prev,
                                    [s.productId]: {
                                      ...edit,
                                      retail: sanitizeNumberInput(e.detail.value || '', { decimal: true }),
                                    },
                                  }))
                                }
                              />
                            </IonItem>
                            <IonItem>
                              <IonLabel position="stacked">سوپر %</IonLabel>
                              <IonInput
                                type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                                value={edit.supermarket}
                                onIonInput={(e) =>
                                  setSnapEdits((prev) => ({
                                    ...prev,
                                    [s.productId]: {
                                      ...edit,
                                      supermarket: sanitizeNumberInput(e.detail.value || '', { decimal: true }),
                                    },
                                  }))
                                }
                              />
                            </IonItem>
                            <IonItem>
                              <IonLabel position="stacked">عمده %</IonLabel>
                              <IonInput
                                type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                                value={edit.wholesale}
                                onIonInput={(e) =>
                                  setSnapEdits((prev) => ({
                                    ...prev,
                                    [s.productId]: {
                                      ...edit,
                                      wholesale: sanitizeNumberInput(e.detail.value || '', { decimal: true }),
                                    },
                                  }))
                                }
                              />
                            </IonItem>
                          </div>
                          <IonButton size="small" expand="block" onClick={() => void saveSnapProfits(s)}>
                            ذخیره درصد سود
                          </IonButton>
                        </>
                      )}
                    </div>
                  );
                })}
              </IonCardContent>
            </IonCard>
          )}

          <IonButton expand="block" onClick={submit} disabled={loading}>
            <IonIcon slot="start" icon={checkmarkCircleOutline} />
            {loading ? '…' : 'ثبت فاکتور خرید'}
          </IonButton>

          {isAdmin && (
            <div className="ios-glass-card" style={{ marginTop: 16 }}>
              <div className="ios-row">
                <div>
                  <div className="ios-section-title" style={{ marginTop: 0 }}>
                    صندوق شرکت
                  </div>
                  <div className="ios-caption">
                    نقد {formatToman(cashBalance)} · کارت {formatToman(cardBalance)}
                  </div>
                </div>
                <IonButton size="small" fill="outline" onClick={() => history.push('/history')}>
                  <IonIcon slot="start" icon={walletOutline} />
                  صندوق
                </IonButton>
              </div>
            </div>
          )}

          <InvoiceListPanel
            kind="purchase"
            refreshKey={listRefreshKey}
            onToast={(msg, color) => setToast({ open: true, msg, color: color || 'success' })}
          />
        </div>
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

export default Purchase;
