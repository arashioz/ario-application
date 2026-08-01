import { useCallback, useRef, useState } from 'react';
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
  useIonViewWillEnter,
  RefresherEventDetail,
} from '@ionic/react';
import { copyOutline, openOutline, imageOutline } from 'ionicons/icons';
import { IonIcon } from '@ionic/react';
import { wsClient } from '../api/ws';
import { formatToman, formatMoneyInput, parseAmount } from '../utils/format';
import { useAuth } from '../auth/AuthContext';

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
  categoryId?: { profitRetail?: number; profitPercent?: number };
}

const CatalogAdmin: React.FC = () => {
  const { isAdmin } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [catalogEnabled, setCatalogEnabled] = useState(true);
  const [catalogTitle, setCatalogTitle] = useState('');
  const [catalogPhone, setCatalogPhone] = useState('');
  const [catalogNote, setCatalogNote] = useState('');
  const [brandName, setBrandName] = useState('');
  const [brandTagline, setBrandTagline] = useState('');
  const [brandPrimaryColor, setBrandPrimaryColor] = useState('#0d9488');
  const [brandLogoUrl, setBrandLogoUrl] = useState('');
  const [supermarketMinKg, setSupermarketMinKg] = useState('500');
  const [wholesaleMinKg, setWholesaleMinKg] = useState('2000');
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const logoRef = useRef<HTMLInputElement | null>(null);

  const catalogUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/catalog` : '/catalog';

  const load = useCallback(async () => {
    const [list, settings] = await Promise.all([
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
    ]);
    setProducts(Array.isArray(list) ? list : []);
    setCatalogEnabled(settings.catalogEnabled !== false);
    setCatalogTitle(settings.catalogTitle || settings.shopName || '');
    setCatalogPhone(settings.catalogPhone || '');
    setCatalogNote(settings.catalogNote || '');
    setBrandName(settings.brandName || settings.shopName || '');
    setBrandTagline(settings.brandTagline || '');
    setBrandPrimaryColor(settings.brandPrimaryColor || '#0d9488');
    setBrandLogoUrl(settings.brandLogoUrl || '');
    setSupermarketMinKg(String(settings.catalogSupermarketMinKg ?? 500));
    setWholesaleMinKg(String(settings.catalogWholesaleMinKg ?? 2000));
  }, []);

  useIonViewWillEnter(() => {
    void load().catch(console.warn);
  });

  const suggestedPrice = (p: Product) => {
    if (p.catalogPricePerKg && p.catalogPricePerKg > 0) return p.catalogPricePerKg;
    const cost = p.avgCostPerKg || 0;
    const pct = p.categoryId?.profitRetail ?? p.categoryId?.profitPercent ?? 12;
    return Math.round(cost * (1 + pct / 100));
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
        .then(() => {
          setToast({ open: true, msg: 'عکس ذخیره شد', color: 'success' });
          return load();
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
          <IonTitle>مدیریت کاتالوگ</IonTitle>
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
          <div className="ios-glass-card">
            <div className="ios-section-title" style={{ marginTop: 0 }}>
              لینک اشتراک برای مشتریان
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
              برند کاتالوگ
            </div>
            {brandLogoUrl && (
              <img
                src={brandLogoUrl}
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
                onIonInput={(e) => setBrandPrimaryColor(e.detail.value || '#0d9488')}
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
            <IonItem>
              <IonLabel position="stacked">شماره تماس</IonLabel>
              <IonInput
                value={catalogPhone}
                disabled={!isAdmin}
                onIonInput={(e) => setCatalogPhone(e.detail.value || '')}
              />
            </IonItem>
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
                type="number"
                value={supermarketMinKg}
                disabled={!isAdmin}
                onIonInput={(e) => setSupermarketMinKg(e.detail.value || '500')}
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">حداقل کیلو · عمده (۲۰۰۰ = ۲ تن)</IonLabel>
              <IonInput
                type="number"
                value={wholesaleMinKg}
                disabled={!isAdmin}
                onIonInput={(e) => setWholesaleMinKg(e.detail.value || '2000')}
              />
            </IonItem>
            {isAdmin && (
              <IonButton expand="block" className="ios-primary-btn" onClick={() => void saveSettings()}>
                ذخیره تنظیمات کاتالوگ
              </IonButton>
            )}
          </div>

          {isAdmin && (
            <>
              <div className="ios-section-title">محصولات کاتالوگ</div>
              <p className="hint">محصول را روشن کن، عکس بگذار، حداقل خرید و قیمت نمایشی</p>
              {products.map((p) => (
                <div key={p._id} className="ios-glass-card">
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
                    موجودی {Math.round(p.stockKg || 0)} کیلو · بسته {p.kgPerPackage || 5}kg
                  </div>
                  {p.imageUrl ? (
                    <img
                      src={p.imageUrl}
                      alt={p.name}
                      style={{
                        width: '100%',
                        maxHeight: 160,
                        objectFit: 'cover',
                        borderRadius: 12,
                        marginTop: 8,
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
                      fileRefs.current[p._id] = el;
                    }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadImage(p._id, f);
                      e.target.value = '';
                    }}
                  />
                  <IonButton size="small" fill="outline" onClick={() => fileRefs.current[p._id]?.click()}>
                    <IonIcon slot="start" icon={imageOutline} />
                    انتخاب عکس
                  </IonButton>
                  <IonItem lines="none">
                    <IonLabel position="stacked">حداقل خرید (بسته)</IonLabel>
                    <IonInput
                      type="number"
                      value={String(p.catalogMinQty ?? 1)}
                      onIonBlur={(e) => {
                        const v =
                          parseFloat(String((e.target as HTMLIonInputElement).value ?? '1')) || 1;
                        void wsClient
                          .request('product.update', { id: p._id, catalogMinQty: v })
                          .then(load)
                          .catch(console.warn);
                      }}
                    />
                  </IonItem>
                  <IonItem lines="none">
                    <IonLabel position="stacked">قیمت نمایشی هر کیلو</IonLabel>
                    <IonInput
                      inputmode="numeric"
                      value={
                        p.catalogPricePerKg
                          ? formatMoneyInput(String(p.catalogPricePerKg))
                          : formatMoneyInput(String(suggestedPrice(p)))
                      }
                      onIonBlur={(e) => {
                        const raw = String((e.target as HTMLIonInputElement).value ?? '');
                        const amount = parseAmount(raw) || 0;
                        void wsClient
                          .request('product.update', {
                            id: p._id,
                            catalogPricePerKg: amount > 0 ? amount : null,
                          })
                          .then(load)
                          .catch(console.warn);
                      }}
                    />
                  </IonItem>
                  <p className="hint">
                    پیشنهادی: {formatToman(suggestedPrice(p))}/کیلو
                  </p>
                  <IonItem lines="none">
                    <IonLabel position="stacked">توضیح کوتاه</IonLabel>
                    <IonInput
                      value={p.catalogNote || ''}
                      onIonBlur={(e) => {
                        const note = String((e.target as HTMLIonInputElement).value ?? '');
                        void wsClient
                          .request('product.update', { id: p._id, catalogNote: note })
                          .then(load)
                          .catch(console.warn);
                      }}
                    />
                  </IonItem>
                </div>
              ))}
            </>
          )}
        </div>

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
