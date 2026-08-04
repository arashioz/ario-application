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
  IonToast,
  IonToggle,
  IonCheckbox,
  IonChip,
  IonIcon,
  IonRefresher,
  IonRefresherContent,
  useIonViewWillEnter,
  RefresherEventDetail,
} from '@ionic/react';
import { addOutline, trashOutline, copyOutline } from 'ionicons/icons';
import { wsClient } from '../api/ws';
import { useAuth } from '../auth/AuthContext';
import { formatToman, formatKg, formatDate, todayIso, sanitizeNumberInput } from '../utils/format';
import { copyText } from '../utils/invoiceShare';

type BankCard = {
  label: string;
  cardNumber: string;
  accountHolder?: string;
  bankName?: string;
};

type DailyPoint = {
  date: string;
  sales: number;
  soldKg: number;
  netProfit: number;
};

/** تنظیمات عمومی مغازه — برند و کاتالوگ در «مدیریت کاتالوگ» */
const AppSettings: React.FC = () => {
  const { isAdmin } = useAuth();
  const [shopName, setShopName] = useState('');
  const [driverPanelEnabled, setDriverPanelEnabled] = useState(true);
  const [marketerPanelEnabled, setMarketerPanelEnabled] = useState(true);
  const [mongoCompassUri, setMongoCompassUri] = useState('');
  const [mongoUriHint, setMongoUriHint] = useState('');
  const [wipeSections, setWipeSections] = useState<Array<{ key: string; label: string }>>([]);
  const [selectedWipe, setSelectedWipe] = useState<Record<string, boolean>>({});
  const [wipePassword, setWipePassword] = useState('');
  const [wiping, setWiping] = useState(false);
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });

  const [bankCards, setBankCards] = useState<BankCard[]>([]);
  const [newCard, setNewCard] = useState<BankCard>({
    label: '',
    cardNumber: '',
    accountHolder: '',
    bankName: '',
  });

  const [goldenAutoEnabled, setGoldenAutoEnabled] = useState(true);
  const [goldenMinKg, setGoldenMinKg] = useState('500');
  const [goldenGiftName, setGoldenGiftName] = useState('کارتن');
  const [goldenGiftQty, setGoldenGiftQty] = useState('1');
  const [goldenDiscPercent, setGoldenDiscPercent] = useState('5');

  const [chartDays, setChartDays] = useState<DailyPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartRange, setChartRange] = useState<'7' | '30' | '90'>('30');

  const loadChart = useCallback(async (range: '7' | '30' | '90' = chartRange) => {
    setChartLoading(true);
    try {
      const days = parseInt(range, 10);
      const to = new Date();
      to.setHours(23, 59, 59, 999);
      const from = new Date();
      from.setDate(from.getDate() - (days - 1));
      from.setHours(0, 0, 0, 0);
      const data = await wsClient.request<{
        daily?: DailyPoint[];
      }>('dashboard.period', {
        from: from.toISOString(),
        to: to.toISOString(),
      });
      setChartDays(Array.isArray(data.daily) ? data.daily : []);
    } catch {
      setChartDays([]);
    } finally {
      setChartLoading(false);
    }
  }, [chartRange]);

  const load = useCallback(async () => {
    const s = await wsClient.request<{
      shopName?: string;
      driverPanelEnabled?: boolean;
      marketerPanelEnabled?: boolean;
      mongoCompassUri?: string;
      mongoUriHint?: string;
      bankCards?: BankCard[];
      goldenAutoEnabled?: boolean;
      goldenMinKg?: number;
      goldenSuggestGiftName?: string;
      goldenSuggestGiftQty?: number;
      goldenSuggestDiscountPercent?: number;
    }>('settings.get');
    setShopName(s.shopName || '');
    setDriverPanelEnabled(s.driverPanelEnabled !== false);
    setMarketerPanelEnabled(s.marketerPanelEnabled !== false);
    setMongoCompassUri(s.mongoCompassUri || s.mongoUriHint || '');
    setMongoUriHint(s.mongoUriHint || '');
    setBankCards(Array.isArray(s.bankCards) ? s.bankCards : []);
    setGoldenAutoEnabled(s.goldenAutoEnabled !== false);
    setGoldenMinKg(String(s.goldenMinKg ?? 500));
    setGoldenGiftName(s.goldenSuggestGiftName || 'کارتن');
    setGoldenGiftQty(String(s.goldenSuggestGiftQty ?? 1));
    setGoldenDiscPercent(String(s.goldenSuggestDiscountPercent ?? 5));
    if (isAdmin) {
      try {
        const w = await wsClient.request<{ sections: Array<{ key: string; label: string }> }>(
          'dev.wipe.sections'
        );
        setWipeSections(w.sections || []);
        const init: Record<string, boolean> = {};
        for (const sec of w.sections || []) init[sec.key] = false;
        setSelectedWipe(init);
      } catch {
        /* ignore */
      }
    }
    await loadChart(chartRange);
  }, [isAdmin, loadChart, chartRange]);

  const skipToggleSave = useRef(true);
  useIonViewWillEnter(() => {
    skipToggleSave.current = true;
    void load()
      .catch(console.warn)
      .finally(() => {
        window.setTimeout(() => {
          skipToggleSave.current = false;
        }, 400);
      });
  });

  const maxSales = useMemo(
    () => Math.max(1, ...chartDays.map((d) => d.sales || 0)),
    [chartDays]
  );
  const chartTotals = useMemo(() => {
    let sales = 0;
    let kg = 0;
    let profit = 0;
    for (const d of chartDays) {
      sales += d.sales || 0;
      kg += d.soldKg || 0;
      profit += d.netProfit || 0;
    }
    return { sales, kg, profit };
  }, [chartDays]);

  const copyUri = async () => {
    const text = mongoCompassUri || mongoUriHint;
    if (!text) return;
    const ok = await copyText(text);
    setToast({
      open: true,
      msg: ok ? 'آدرس کپی شد — در Compass پیست کنید' : text,
      color: ok ? 'success' : 'warning',
    });
  };

  const selectAllWipe = (on: boolean) => {
    const next: Record<string, boolean> = {};
    for (const s of wipeSections) next[s.key] = on;
    setSelectedWipe(next);
  };

  const runWipe = async () => {
    const sections = Object.keys(selectedWipe).filter((k) => selectedWipe[k]);
    if (!sections.length) {
      setToast({ open: true, msg: 'حداقل یک بخش را تیک بزنید', color: 'danger' });
      return;
    }
    if (!wipePassword.trim()) {
      setToast({ open: true, msg: 'رمز پاک‌سازی را وارد کنید', color: 'danger' });
      return;
    }
    if (
      !window.confirm(
        `آیا مطمئنید؟ این کار برگشت‌ناپذیر است.\n${sections.length} بخش پاک می‌شود.`
      )
    ) {
      return;
    }
    setWiping(true);
    try {
      const res = await wsClient.request<{ message: string }>('dev.wipe', {
        password: wipePassword,
        sections,
      });
      setWipePassword('');
      setToast({ open: true, msg: res.message || 'پاک شد', color: 'success' });
      selectAllWipe(false);
    } catch (e) {
      setToast({
        open: true,
        msg: e instanceof Error ? e.message : 'خطا',
        color: 'danger',
      });
    } finally {
      setWiping(false);
    }
  };

  const saveBankCards = async (next: BankCard[]) => {
    try {
      await wsClient.request('settings.update', { bankCards: next });
      setBankCards(next);
      setToast({ open: true, msg: 'کارت‌ها ذخیره شد', color: 'success' });
    } catch (e) {
      setToast({
        open: true,
        msg: e instanceof Error ? e.message : 'ذخیره نشد',
        color: 'danger',
      });
    }
  };

  const addBankCard = () => {
    if (!newCard.label.trim() || !newCard.cardNumber.trim()) {
      setToast({ open: true, msg: 'عنوان و شماره کارت لازم است', color: 'danger' });
      return;
    }
    const next = [
      ...bankCards,
      {
        label: newCard.label.trim(),
        cardNumber: newCard.cardNumber.replace(/\s+/g, ''),
        accountHolder: newCard.accountHolder?.trim() || undefined,
        bankName: newCard.bankName?.trim() || undefined,
      },
    ];
    setNewCard({ label: '', cardNumber: '', accountHolder: '', bankName: '' });
    void saveBankCards(next);
  };

  const saveGolden = async () => {
    try {
      await wsClient.request('settings.update', {
        goldenAutoEnabled,
        goldenMinKg: parseFloat(goldenMinKg) || 500,
        goldenSuggestGiftName: goldenGiftName.trim() || 'کارتن',
        goldenSuggestGiftQty: parseFloat(goldenGiftQty) || 1,
        goldenSuggestDiscountPercent: parseFloat(goldenDiscPercent) || 5,
      });
      setToast({ open: true, msg: 'تنظیمات فاکتور طلایی ذخیره شد', color: 'success' });
    } catch (e) {
      setToast({
        open: true,
        msg: e instanceof Error ? e.message : 'خطا',
        color: 'danger',
      });
    }
  };

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/more" text="بازگشت" />
          </IonButtons>
          <IonTitle>تنظیمات اپ</IonTitle>
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
              نمودار فروش
            </div>
            <div className="chip-row">
              {(['7', '30', '90'] as const).map((r) => (
                <IonChip
                  key={r}
                  className={chartRange === r ? 'ios-chip-active' : 'ios-chip'}
                  onClick={() => {
                    setChartRange(r);
                    void loadChart(r);
                  }}
                >
                  {r === '7' ? '۷ روز' : r === '30' ? '۳۰ روز' : '۹۰ روز'}
                </IonChip>
              ))}
            </div>
            {chartLoading && <p className="hint">در حال بارگذاری…</p>}
            {!chartLoading && (
              <>
                <div className="stat-row">
                  <span className="stat-label">فروش بازه</span>
                  <span className="stat-value">{formatToman(chartTotals.sales)}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">تناژ</span>
                  <span className="stat-value">{formatKg(chartTotals.kg)}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">سود خالص</span>
                  <span className="stat-value success">{formatToman(chartTotals.profit)}</span>
                </div>
                {chartDays.length === 0 ? (
                  <p className="hint">در این بازه فروشی نیست</p>
                ) : (
                  <div className="pa-trend" style={{ marginTop: 10 }}>
                    {chartDays.map((d) => (
                      <div key={d.date} className="pa-trend-row">
                        <span className="pa-trend-label">{formatDate(d.date).replace(/\/\d{4}$/, '')}</span>
                        <div className="pa-trend-bar-wrap">
                          <div
                            className="pa-trend-bar"
                            style={{
                              width: `${Math.max(4, ((d.sales || 0) / maxSales) * 100)}%`,
                            }}
                            title={todayIso()}
                          />
                        </div>
                        <span className="pa-trend-val">{formatToman(d.sales)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            <p className="hint" style={{ marginBottom: 0 }}>
              گزارش جزئی‌تر در بخش «گزارشات / صندوق» هم هست
            </p>
          </div>

          <div className="ios-glass-card" style={{ marginTop: 12 }}>
            <p className="hint">
              لینک کاتالوگ، برند، لوگو، عکس محصول و پله‌های قیمت در{' '}
              <a href="/catalog-admin">مدیریت کاتالوگ</a> است.
            </p>
            <IonItem>
              <IonLabel position="stacked">نام مغازه (سیستم داخلی)</IonLabel>
              <IonInput
                value={shopName}
                disabled={!isAdmin}
                onIonInput={(e) => setShopName(e.detail.value || '')}
              />
            </IonItem>
          </div>

          {isAdmin && (
            <div className="ios-glass-card" style={{ marginTop: 12 }}>
              <div className="ios-section-title" style={{ marginTop: 0 }}>
                کارت‌به‌کارت (حساب‌های من)
              </div>
              <p className="hint">
                این کارت‌ها موقع انتخاب «کارت به کارت» در فروش نمایش داده می‌شوند تا برای مشتری کپی
                کنید
              </p>
              {bankCards.map((c, i) => (
                <div key={`${c.cardNumber}-${i}`} className="ios-glass-card" style={{ marginBottom: 8 }}>
                  <div className="ios-row">
                    <div>
                      <strong>{c.label}</strong>
                      <div className="ios-caption">
                        {c.bankName ? `${c.bankName} · ` : ''}
                        {c.accountHolder || ''}
                      </div>
                      <div className="ios-caption" dir="ltr" style={{ textAlign: 'right' }}>
                        {c.cardNumber.replace(/(\d{4})(?=\d)/g, '$1 ')}
                      </div>
                    </div>
                    <div className="chip-row">
                      <IonButton
                        size="small"
                        fill="outline"
                        onClick={() =>
                          void copyText(c.cardNumber).then((ok) =>
                            setToast({
                              open: true,
                              msg: ok ? 'شماره کارت کپی شد' : 'کپی نشد',
                              color: ok ? 'success' : 'danger',
                            })
                          )
                        }
                      >
                        <IonIcon slot="start" icon={copyOutline} />
                        کپی
                      </IonButton>
                      <IonButton
                        size="small"
                        fill="clear"
                        color="danger"
                        onClick={() => void saveBankCards(bankCards.filter((_, j) => j !== i))}
                      >
                        <IonIcon icon={trashOutline} />
                      </IonButton>
                    </div>
                  </div>
                </div>
              ))}
              <IonItem>
                <IonLabel position="stacked">عنوان (مثلاً کارت ملت)</IonLabel>
                <IonInput
                  value={newCard.label}
                  onIonInput={(e) => setNewCard({ ...newCard, label: e.detail.value || '' })}
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">شماره کارت</IonLabel>
                <IonInput
                  inputMode="numeric"
                  value={newCard.cardNumber}
                  placeholder="6037…"
                  onIonInput={(e) =>
                    setNewCard({
                      ...newCard,
                      cardNumber: sanitizeNumberInput(e.detail.value || ''),
                    })
                  }
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">به نام</IonLabel>
                <IonInput
                  value={newCard.accountHolder || ''}
                  onIonInput={(e) =>
                    setNewCard({ ...newCard, accountHolder: e.detail.value || '' })
                  }
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">بانک (اختیاری)</IonLabel>
                <IonInput
                  value={newCard.bankName || ''}
                  onIonInput={(e) => setNewCard({ ...newCard, bankName: e.detail.value || '' })}
                />
              </IonItem>
              <IonButton expand="block" fill="outline" size="small" className="ion-margin-top" onClick={addBankCard}>
                <IonIcon slot="start" icon={addOutline} />
                افزودن کارت
              </IonButton>
            </div>
          )}

          {isAdmin && (
            <div className="ios-glass-card" style={{ marginTop: 12 }}>
              <div className="ios-section-title" style={{ marginTop: 0 }}>
                فاکتور طلایی خودکار
              </div>
              <p className="hint">
                وقتی تناژ فاکتور از حد بگذرد، در فروش پیشنهاد تخفیف یا اشانتیون می‌آید
              </p>
              <div className="ios-row" style={{ padding: '8px 0' }}>
                <span>فعال</span>
                <IonToggle
                  checked={goldenAutoEnabled}
                  onIonChange={(e) => setGoldenAutoEnabled(e.detail.checked)}
                />
              </div>
              <IonItem>
                <IonLabel position="stacked">حداقل کیلو برای پیشنهاد</IonLabel>
                <IonInput
                  inputMode="numeric"
                  value={goldenMinKg}
                  onIonInput={(e) =>
                    setGoldenMinKg(sanitizeNumberInput(e.detail.value || '', { decimal: true }))
                  }
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">نام اشانتیون پیشنهادی</IonLabel>
                <IonInput
                  value={goldenGiftName}
                  placeholder="کارتن"
                  onIonInput={(e) => setGoldenGiftName(e.detail.value || '')}
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">تعداد اشانتیون</IonLabel>
                <IonInput
                  inputMode="numeric"
                  value={goldenGiftQty}
                  onIonInput={(e) => setGoldenGiftQty(sanitizeNumberInput(e.detail.value || ''))}
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">درصد تخفیف پیشنهادی</IonLabel>
                <IonInput
                  inputMode="numeric"
                  value={goldenDiscPercent}
                  onIonInput={(e) =>
                    setGoldenDiscPercent(sanitizeNumberInput(e.detail.value || '', { decimal: true }))
                  }
                />
              </IonItem>
              <IonButton expand="block" className="ios-primary-btn ion-margin-top" onClick={() => void saveGolden()}>
                ذخیره فاکتور طلایی
              </IonButton>
              <p className="hint" style={{ marginBottom: 0 }}>
                پیامک خودکار بعداً به سامانه پیامکی وصل می‌شود
              </p>
            </div>
          )}

          {isAdmin && (
            <div className="ios-glass-card" style={{ marginTop: 12 }}>
              <div className="ios-section-title" style={{ marginTop: 0 }}>
                پنل‌ها
              </div>
              <p className="hint">سوییچ را بزنید — بلافاصله ذخیره می‌شود و منوی بیشتر به‌روز می‌شود</p>
              <IonItem lines="full">
                <IonLabel>
                  <h3>پنل راننده</h3>
                  <p>نقشه راننده‌ها، پرداخت راننده، اپ ارسال</p>
                </IonLabel>
                <IonToggle
                  checked={driverPanelEnabled}
                  onIonChange={(e) => {
                    const checked = e.detail.checked;
                    if (skipToggleSave.current) return;
                    if (checked === driverPanelEnabled) return;
                    setDriverPanelEnabled(checked);
                    void wsClient
                      .request('settings.update', { driverPanelEnabled: checked })
                      .then(() =>
                        setToast({
                          open: true,
                          msg: checked ? 'پنل راننده روشن شد' : 'پنل راننده خاموش شد',
                          color: 'success',
                        })
                      )
                      .catch((err) => {
                        setDriverPanelEnabled(!checked);
                        setToast({
                          open: true,
                          msg: err instanceof Error ? err.message : 'خطا',
                          color: 'danger',
                        });
                      });
                  }}
                />
              </IonItem>
              <IonItem lines="none">
                <IonLabel>
                  <h3>پنل بازاریاب</h3>
                  <p>ثبت‌نام همکار، سفارش حجمی، تارگت</p>
                </IonLabel>
                <IonToggle
                  checked={marketerPanelEnabled}
                  onIonChange={(e) => {
                    const checked = e.detail.checked;
                    if (skipToggleSave.current) return;
                    if (checked === marketerPanelEnabled) return;
                    setMarketerPanelEnabled(checked);
                    void wsClient
                      .request('settings.update', { marketerPanelEnabled: checked })
                      .then(() =>
                        setToast({
                          open: true,
                          msg: checked ? 'پنل بازاریاب روشن شد' : 'پنل بازاریاب خاموش شد',
                          color: 'success',
                        })
                      )
                      .catch((err) => {
                        setMarketerPanelEnabled(!checked);
                        setToast({
                          open: true,
                          msg: err instanceof Error ? err.message : 'خطا',
                          color: 'danger',
                        });
                      });
                  }}
                />
              </IonItem>
              <IonButton
                expand="block"
                className="ios-primary-btn"
                onClick={async () => {
                  try {
                    await wsClient.request('settings.update', {
                      shopName,
                      driverPanelEnabled,
                      marketerPanelEnabled,
                      mongoCompassUri,
                    });
                    setToast({ open: true, msg: 'ذخیره شد', color: 'success' });
                  } catch (e) {
                    setToast({
                      open: true,
                      msg: e instanceof Error ? e.message : 'خطا',
                      color: 'danger',
                    });
                  }
                }}
              >
                ذخیره نام مغازه
              </IonButton>
            </div>
          )}

          {isAdmin && (
            <div className="ios-glass-card" style={{ marginTop: 12 }}>
              <div className="ios-section-title" style={{ marginTop: 0 }}>
                MongoDB Compass
              </div>
              <p className="hint">
                آدرس اتصال را در MongoDB Compass پیست کنید. اگر مونگو روی سرور است، IP عمومی و پورت
                ۲۷۰۱۷ را باز کنید.
              </p>
              {mongoUriHint && (
                <p className="hint convert-hint" style={{ marginTop: 0 }}>
                  پیشنهاد سرور: {mongoUriHint}
                </p>
              )}
              <IonItem lines="full">
                <IonLabel position="stacked">Connection URI</IonLabel>
                <IonInput
                  value={mongoCompassUri}
                  placeholder="mongodb://127.0.0.1:27017/ario-shop"
                  onIonInput={(e) => setMongoCompassUri(e.detail.value || '')}
                />
              </IonItem>
              <div className="chip-row" style={{ marginTop: 8 }}>
                <IonButton size="small" fill="outline" onClick={() => void copyUri()}>
                  کپی URI
                </IonButton>
                {mongoUriHint && (
                  <IonButton size="small" fill="clear" onClick={() => setMongoCompassUri(mongoUriHint)}>
                    از پیشنهاد سرور
                  </IonButton>
                )}
                <IonButton
                  size="small"
                  className="ios-primary-btn"
                  onClick={async () => {
                    try {
                      await wsClient.request('settings.update', { mongoCompassUri });
                      setToast({ open: true, msg: 'آدرس مونگو ذخیره شد', color: 'success' });
                    } catch (e) {
                      setToast({
                        open: true,
                        msg: e instanceof Error ? e.message : 'خطا',
                        color: 'danger',
                      });
                    }
                  }}
                >
                  ذخیره URI
                </IonButton>
              </div>
            </div>
          )}

          {isAdmin && wipeSections.length > 0 && (
            <div className="ios-glass-card wipe-card" style={{ marginTop: 12 }}>
              <div className="ios-section-title" style={{ marginTop: 0 }}>
                پاک‌سازی توسعه
              </div>
              <p className="hint">
                فقط برای حالت توسعه. رمز: <code>wipe-ario-dev</code> — کاربران ادمین حذف نمی‌شوند.
              </p>
              <div className="chip-row" style={{ marginBottom: 8 }}>
                <IonButton size="small" fill="outline" onClick={() => selectAllWipe(true)}>
                  همه
                </IonButton>
                <IonButton size="small" fill="clear" onClick={() => selectAllWipe(false)}>
                  هیچ‌کدام
                </IonButton>
              </div>
              {wipeSections.map((s) => (
                <IonItem key={s.key} lines="full" className="wipe-item">
                  <IonCheckbox
                    slot="start"
                    checked={!!selectedWipe[s.key]}
                    onIonChange={(e) =>
                      setSelectedWipe((prev) => ({ ...prev, [s.key]: e.detail.checked }))
                    }
                  />
                  <IonLabel>{s.label}</IonLabel>
                </IonItem>
              ))}
              <IonItem lines="full">
                <IonLabel position="stacked">رمز پاک‌سازی</IonLabel>
                <IonInput
                  type="password"
                  value={wipePassword}
                  placeholder="wipe-ario-dev"
                  onIonInput={(e) => setWipePassword(e.detail.value || '')}
                />
              </IonItem>
              <IonButton
                expand="block"
                color="danger"
                className="ion-margin-top"
                disabled={wiping}
                onClick={() => void runWipe()}
              >
                {wiping ? 'در حال پاک‌سازی…' : 'پاک کردن بخش‌های انتخاب‌شده'}
              </IonButton>
            </div>
          )}

          {!isAdmin && (
            <div className="ios-glass-card" style={{ marginTop: 12 }}>
              <p className="hint">فقط مدیر می‌تواند تنظیمات را تغییر دهد — نمودار فروش برای همه قابل مشاهده است</p>
            </div>
          )}
        </div>

        <IonToast
          isOpen={toast.open}
          message={toast.msg}
          color={toast.color}
          duration={2200}
          onDidDismiss={() => setToast((t) => ({ ...t, open: false }))}
          position="top"
        />
      </IonContent>
    </IonPage>
  );
};

export default AppSettings;
