import { useEffect, useState } from 'react';
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
  IonToast,
  IonSpinner,
  IonRefresher,
  IonRefresherContent,
  IonModal,
  IonButtons,
  IonChip,
  RefresherEventDetail,
} from '@ionic/react';
import { wsClient } from '../api/ws';
import { formatToman, formatKg, formatDate, todayIso, formatMoneyInput, parseAmount } from '../utils/format';
import { PersianDateField } from '../components/PersianDateField';
import { MoneyInput } from '../components/MoneyInput';
import { useAuth } from '../auth/AuthContext';

interface Period {
  totalSales: number;
  soldKg: number;
  soldTons?: number;
  totalProfit: number;
  totalExpenses: number;
  netProfit?: number;
  invoiceCount?: number;
  payment?: { cash: number; card: number; credit: number };
  golden?: { count: number; amount: number; kg: number };
  balances?: { cashBalance: number; cardBalance: number; shopName: string };
  inventory?: {
    totalKg: number;
    totalValue: number;
    productCount: number;
    items: Array<{ id: string; name: string; stockKg: number; avgCostPerKg: number }>;
  };
  soldByProduct?: Array<{
    productId: string;
    name: string;
    soldKg: number;
    soldPackages: number;
    revenue: number;
  }>;
  debtors?: {
    total: number;
    count: number;
    byPerson: Array<{
      name: string;
      phone?: string;
      remaining: number;
      invoiceCount: number;
      overdue: boolean;
      dueDate: string;
    }>;
  };
  creditByCustomer?: Array<{
    name: string;
    phone?: string;
    credit: number;
    kg: number;
    invoices: number;
  }>;
  daily: Array<{
    date: string;
    sales: number;
    soldKg: number;
    profit?: number;
    netProfit: number;
    expenses?: number;
  }>;
}

const History: React.FC = () => {
  const { isAdmin } = useAuth();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(todayIso());
  const [shopName, setShopName] = useState('');
  const [openingDate, setOpeningDate] = useState('');
  const [cashBalance, setCashBalance] = useState('');
  const [cardBalance, setCardBalance] = useState('');
  const [liveCash, setLiveCash] = useState(0);
  const [liveCard, setLiveCard] = useState(0);
  const [period, setPeriod] = useState<Period | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });
  const [companyDebt, setCompanyDebt] = useState<{
    remainingDebt: number;
    totalPaidToCompany: number;
    totalPaidOnDebts: number;
    totalDebtAmount: number;
    openCount: number;
    debts: Array<{
      id: string;
      supplier: string;
      remaining: number;
      amount: number;
      paidAmount: number;
      date: string;
    }>;
    recentPayments: Array<{
      _id: string;
      supplier: string;
      amount: number;
      method: string;
      date: string;
    }>;
  } | null>(null);
  const [cashTxs, setCashTxs] = useState<
    Array<{
      _id: string;
      type: string;
      amount: number;
      direction: 'in' | 'out';
      description: string;
      date: string;
      paymentMethod?: 'cash' | 'card' | 'card_to_card';
    }>
  >([]);
  const [cashDetail, setCashDetail] = useState<(typeof cashTxs)[0] | null>(null);
  const [cashMethod, setCashMethod] = useState<'cash' | 'card' | 'card_to_card'>('cash');
  const [cashPw, setCashPw] = useState('');
  const [cashSaving, setCashSaving] = useState(false);

  const loadSettings = async () => {
    const s = await wsClient.request<{
      openingDate: string;
      cashBalance: number;
      cardBalance: number;
      shopName: string;
    }>('settings.get');
    setOpeningDate(s.openingDate.split('T')[0]);
    if (!from) setFrom(s.openingDate.split('T')[0]);
    setShopName(s.shopName || '');
    setCashBalance(formatMoneyInput(String(s.cashBalance || 0)));
    setCardBalance(formatMoneyInput(String(s.cardBalance || 0)));
    setLiveCash(s.cashBalance || 0);
    setLiveCard(s.cardBalance || 0);
  };

  const loadCashTxs = async () => {
    if (!isAdmin) return;
    try {
      const list = await wsClient.request<typeof cashTxs>('cash.list', { limit: 40 });
      setCashTxs(Array.isArray(list) ? list : []);
    } catch {
      setCashTxs([]);
    }
  };

  const loadCompanyDebt = async () => {
    if (!isAdmin) return;
    try {
      const s = await wsClient.request<NonNullable<typeof companyDebt>>('companyDebt.summary', {});
      setCompanyDebt(s);
    } catch {
      setCompanyDebt(null);
    }
  };

  useEffect(() => {
    void loadSettings().catch(console.warn);
    void loadCashTxs();
    void loadCompanyDebt();
  }, []);

  const runReport = async () => {
    setLoading(true);
    try {
      const data = await wsClient.request<Period>('dashboard.period', { from, to });
      setPeriod(data);
      if (data.balances) {
        setLiveCash(data.balances.cashBalance);
        setLiveCard(data.balances.cardBalance);
      }
    } catch (e) {
      setToast({ open: true, msg: e instanceof Error ? e.message : 'خطا', color: 'danger' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonTitle>صندوق شرکت</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="page-content ios-content">
        <IonRefresher
          slot="fixed"
          onIonRefresh={async (e: CustomEvent<RefresherEventDetail>) => {
            await loadSettings();
            await loadCashTxs();
            await loadCompanyDebt();
            if (from && to) await runReport();
            e.detail.complete();
          }}
        >
          <IonRefresherContent />
        </IonRefresher>

        <div className="ion-padding compact">
          <div className="ios-section-title" style={{ marginTop: 0 }}>
            صندوق شرکت (زنده)
          </div>
          <div className="ios-kpi-grid">
            <div className="ios-kpi blue">
              <div className="k-label">نقد</div>
              <div className="k-value">{formatToman(liveCash)}</div>
            </div>
            <div className="ios-kpi orange">
              <div className="k-label">کارتخوان / کارت</div>
              <div className="k-value">{formatToman(liveCard)}</div>
            </div>
          </div>

          {isAdmin && companyDebt && (
            <>
              <div className="ios-section-title">بدهی و پرداخت به شرکت</div>
              <div className="ios-kpi-grid">
                <div className="ios-kpi rose">
                  <div className="k-label">هنوز بدهکارم</div>
                  <div className="k-value">{formatToman(companyDebt.remainingDebt || 0)}</div>
                </div>
                <div className="ios-kpi green">
                  <div className="k-label">پرداخت‌شده به شرکت</div>
                  <div className="k-value">{formatToman(companyDebt.totalPaidToCompany || 0)}</div>
                </div>
              </div>
              <div className="ios-glass-card">
                <div className="stat-row">
                  <span className="stat-label">کل بدهی ثبت‌شده</span>
                  <span className="stat-value">{formatToman(companyDebt.totalDebtAmount || 0)}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">پرداخت روی بدهی‌ها</span>
                  <span className="stat-value">{formatToman(companyDebt.totalPaidOnDebts || 0)}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">فاکتور بدهی باز</span>
                  <span className="stat-value">{companyDebt.openCount}</span>
                </div>
                {(companyDebt.debts || []).slice(0, 8).map((d) => (
                  <div key={String(d.id)} className="day-row" style={{ marginTop: 6 }}>
                    <div className="ios-row">
                      <div>
                        <strong>{d.supplier}</strong>
                        <div className="ios-caption">{formatDate(d.date)}</div>
                      </div>
                      <div className="inv-card-amount">
                        <div className="stat-value danger">{formatToman(d.remaining)}</div>
                        <div className="ios-caption">
                          از {formatToman(d.amount)} · پرداختی {formatToman(d.paidAmount)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {(companyDebt.recentPayments || []).length > 0 && (
                  <>
                    <div className="ios-section-title">آخرین پرداخت‌ها به شرکت</div>
                    {companyDebt.recentPayments.slice(0, 8).map((p) => (
                      <div key={p._id} className="stat-row">
                        <span className="stat-label">
                          {formatDate(p.date)} · {p.supplier} ·{' '}
                          {p.method === 'cash'
                            ? 'نقد'
                            : p.method === 'card_to_card'
                              ? 'کارت‌به‌کارت'
                              : 'کارت'}
                        </span>
                        <span className="stat-value">{formatToman(p.amount)}</span>
                      </div>
                    ))}
                  </>
                )}
                <IonButton expand="block" fill="outline" size="small" routerLink="/expense">
                  ثبت پرداخت / هزینه
                </IonButton>
              </div>
            </>
          )}

          {isAdmin && (
            <div className="ios-glass-card">
              <div className="ios-section-title" style={{ marginTop: 0 }}>
                مدیریت مغازه
              </div>
              <IonItem>
                <IonLabel position="stacked">نام مغازه</IonLabel>
                <IonInput value={shopName} onIonInput={(e) => setShopName(e.detail.value || '')} />
              </IonItem>
              <PersianDateField label="تاریخ باز شدن مغازه" value={openingDate} onChange={setOpeningDate} />
              <MoneyInput label="موجودی نقد (تومان)" value={cashBalance} onChange={setCashBalance} />
              <MoneyInput label="موجودی کارتخوان (تومان)" value={cardBalance} onChange={setCardBalance} />
              <IonButton
                expand="block"
                className="ios-primary-btn"
                size="small"
                onClick={async () => {
                  try {
                    await wsClient.request('settings.update', {
                      shopName,
                      openingDate,
                      cashBalance: parseAmount(cashBalance) || 0,
                      cardBalance: parseAmount(cardBalance) || 0,
                    });
                    setLiveCash(parseAmount(cashBalance) || 0);
                    setLiveCard(parseAmount(cardBalance) || 0);
                    setToast({ open: true, msg: 'تنظیمات مغازه ذخیره شد', color: 'success' });
                  } catch (e) {
                    setToast({
                      open: true,
                      msg: e instanceof Error ? e.message : 'خطا',
                      color: 'danger',
                    });
                  }
                }}
              >
                ذخیره تنظیمات مغازه
              </IonButton>
            </div>
          )}

          {isAdmin && (
            <>
              <div className="ios-section-title">گردش صندوق</div>
              <div className="ios-glass-card">
                {cashTxs.length === 0 && <p className="hint">تراکنشی ثبت نشده</p>}
                {cashTxs.map((tx) => (
                  <div
                    key={tx._id}
                    className="day-row tap"
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setCashDetail(tx);
                      const inferred =
                        tx.paymentMethod ||
                        (/کارت به کارت|کارت‌به‌کارت/i.test(tx.description)
                          ? 'card_to_card'
                          : /کارت|پوز|کارتخوان/i.test(tx.description)
                            ? 'card'
                            : 'cash');
                      setCashMethod(inferred as 'cash' | 'card' | 'card_to_card');
                      setCashPw('');
                    }}
                  >
                    <div className="ios-row">
                      <div>
                        <strong>{tx.description}</strong>
                        <div className="ios-caption">
                          {formatDate(tx.date)} · {tx.direction === 'in' ? 'ورود' : 'خروج'}
                          {tx.paymentMethod
                            ? ` · ${
                                tx.paymentMethod === 'cash'
                                  ? 'نقد'
                                  : tx.paymentMethod === 'card_to_card'
                                    ? 'کارت‌به‌کارت'
                                    : 'کارت'
                              }`
                            : ''}
                        </div>
                      </div>
                      <div
                        className="stat-value"
                        style={{
                          color:
                            tx.direction === 'in'
                              ? 'var(--ion-color-success)'
                              : 'var(--ion-color-danger)',
                        }}
                      >
                        {tx.direction === 'in' ? '+' : '−'}
                        {formatToman(tx.amount)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="ios-section-title">گزارش بازه</div>
          <div className="ios-glass-card">
            <PersianDateField label="از تاریخ" value={from} onChange={setFrom} />
            <PersianDateField label="تا تاریخ" value={to} onChange={setTo} />
            <IonButton
              expand="block"
              className="ios-primary-btn"
              size="small"
              disabled={loading}
              onClick={() => void runReport()}
            >
              {loading ? <IonSpinner name="crescent" /> : 'نمایش گزارش'}
            </IonButton>

            {period && (
              <>
                <div className="ios-kpi-grid ion-margin-top">
                  <div className="ios-kpi blue">
                    <div className="k-label">فروش مبلغی</div>
                    <div className="k-value">{formatToman(period.totalSales)}</div>
                  </div>
                  <div className="ios-kpi orange">
                    <div className="k-label">فروش تناژ</div>
                    <div className="k-value">{formatKg(period.soldKg)}</div>
                    {period.soldTons != null && (
                      <div className="ios-caption">{period.soldTons.toLocaleString('fa-IR')} تن</div>
                    )}
                  </div>
                  <div className="ios-kpi green">
                    <div className="k-label">سود فروش</div>
                    <div className="k-value">{formatToman(period.totalProfit)}</div>
                  </div>
                  {period.totalProfit < 0 && (
                    <p className="hint" style={{ gridColumn: '1 / -1', margin: 0 }}>
                      سود منفی یعنی قیمت فروش (بعد از تخفیف) کمتر از هزینه خرید بوده — تخفیف سنگین، قیمت دستی پایین، یا هزینه خرید اشتباه/بالا.
                    </p>
                  )}
                  <div className="ios-kpi">
                    <div className="k-label">هزینه</div>
                    <div className="k-value">{formatToman(period.totalExpenses)}</div>
                  </div>
                  <div className="ios-kpi teal">
                    <div className="k-label">سود خالص</div>
                    <div className="k-value">
                      {formatToman(period.netProfit ?? period.totalProfit - period.totalExpenses)}
                    </div>
                  </div>
                  <div className="ios-kpi">
                    <div className="k-label">تعداد فاکتور</div>
                    <div className="k-value">{period.invoiceCount ?? '—'}</div>
                  </div>
                </div>

                {period.payment && (
                  <>
                    <div className="ios-section-title">ترکیب پرداخت</div>
                    <div className="stat-row">
                      <span className="stat-label">نقد</span>
                      <span className="stat-value">{formatToman(period.payment.cash)}</span>
                    </div>
                    <div className="stat-row">
                      <span className="stat-label">کارتخوان / کارت</span>
                      <span className="stat-value">{formatToman(period.payment.card)}</span>
                    </div>
                    <div className="stat-row">
                      <span className="stat-label">نسیه</span>
                      <span className="stat-value">{formatToman(period.payment.credit)}</span>
                    </div>
                  </>
                )}

                {period.debtors && (
                  <>
                    <div className="ios-section-title">بدهکاران (به تفکیک نفر)</div>
                    <div className="ios-kpi-grid">
                      <div className="ios-kpi rose">
                        <div className="k-label">جمع بدهی باز</div>
                        <div className="k-value">{formatToman(period.debtors.total)}</div>
                      </div>
                      <div className="ios-kpi">
                        <div className="k-label">تعداد نفر</div>
                        <div className="k-value">{period.debtors.count}</div>
                      </div>
                    </div>
                    {period.debtors.byPerson.length === 0 && (
                      <p className="hint">بدهکار بازی نیست</p>
                    )}
                    {period.debtors.byPerson.map((d, i) => (
                      <div key={`${d.name}-${i}`} className="ios-glass-card" style={{ marginTop: 8 }}>
                        <div className="ios-row">
                          <div>
                            <strong>{d.name}</strong>
                            {d.overdue && (
                              <span className="overdue-badge" style={{ marginRight: 8 }}>
                                معوق
                              </span>
                            )}
                            <div className="ios-caption">
                              {d.phone || '—'}
                              {d.invoiceCount > 1 ? ` · ${d.invoiceCount} فاکتور` : ''}
                              {' · سررسید '}
                              {formatDate(d.dueDate)}
                            </div>
                          </div>
                          <span className="stat-value danger">{formatToman(d.remaining)}</span>
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {period.creditByCustomer && period.creditByCustomer.length > 0 && (
                  <>
                    <div className="ios-section-title">نسیه همین بازه (به تفکیک مشتری)</div>
                    {period.creditByCustomer.map((c, i) => (
                      <div key={`${c.name}-c-${i}`} className="ios-glass-card" style={{ marginTop: 8 }}>
                        <div className="ios-row">
                          <div>
                            <strong>{c.name}</strong>
                            <div className="ios-caption">
                              {c.phone || '—'} · {c.invoices} فاکتور · {formatKg(c.kg)}
                            </div>
                          </div>
                          <span className="stat-value warning">{formatToman(c.credit)}</span>
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {period.golden && (
                  <>
                    <div className="ios-section-title">فاکتورهای طلایی</div>
                    <div className="stat-row">
                      <span className="stat-label">تعداد</span>
                      <span className="stat-value">{period.golden.count}</span>
                    </div>
                    <div className="stat-row">
                      <span className="stat-label">مبلغ</span>
                      <span className="stat-value">{formatToman(period.golden.amount)}</span>
                    </div>
                    <div className="stat-row">
                      <span className="stat-label">تناژ</span>
                      <span className="stat-value">{formatKg(period.golden.kg)}</span>
                    </div>
                  </>
                )}

                {period.soldByProduct && period.soldByProduct.length > 0 && (
                  <>
                    <div className="ios-section-title">فروش انبار در بازه (به تفکیک محصول)</div>
                    {period.soldByProduct.map((it) => (
                      <div key={it.productId} className="ios-glass-card" style={{ marginTop: 8 }}>
                        <div className="ios-row">
                          <strong>{it.name}</strong>
                          <span className="stat-value">{formatToman(it.revenue)}</span>
                        </div>
                        <div className="stat-row">
                          <span className="stat-label">تناژ فروخته</span>
                          <span className="stat-value">{formatKg(it.soldKg)}</span>
                        </div>
                        <div className="stat-row">
                          <span className="stat-label">بسته</span>
                          <span className="stat-value">
                            {Math.round(it.soldPackages || 0).toLocaleString('fa-IR')}
                          </span>
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {period.inventory && (
                  <>
                    <div className="ios-section-title">موجودی فعلی انبار</div>
                    <div className="stat-row">
                      <span className="stat-label">تعداد محصول</span>
                      <span className="stat-value">{period.inventory.productCount}</span>
                    </div>
                    <div className="stat-row">
                      <span className="stat-label">موجودی کل</span>
                      <span className="stat-value">{formatKg(period.inventory.totalKg)}</span>
                    </div>
                    <div className="stat-row">
                      <span className="stat-label">ارزش موجودی (هزینه)</span>
                      <span className="stat-value">{formatToman(period.inventory.totalValue)}</span>
                    </div>
                    {period.inventory.items.map((it) => (
                      <div key={it.id} className="stat-row">
                        <span className="stat-label">{it.name}</span>
                        <span className="stat-value">{formatKg(it.stockKg)}</span>
                      </div>
                    ))}
                  </>
                )}

                <div className="ios-section-title">روزبه‌روز — فروش و تناژ</div>
                {period.daily.map((d) => (
                  <div key={d.date} className="ios-glass-card" style={{ marginTop: 8 }}>
                    <strong>{formatDate(d.date)}</strong>
                    <div className="stat-row">
                      <span className="stat-label">فروش مبلغی</span>
                      <span className="stat-value">{formatToman(d.sales)}</span>
                    </div>
                    <div className="stat-row">
                      <span className="stat-label">تناژ فروخته‌شده انبار</span>
                      <span className="stat-value">{formatKg(d.soldKg)}</span>
                    </div>
                    <div className="stat-row">
                      <span className="stat-label">سود فروش روز</span>
                      <span className="stat-value success">
                        {formatToman(d.profit ?? d.netProfit)}
                      </span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        <IonModal isOpen={!!cashDetail} onDidDismiss={() => setCashDetail(null)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>ویرایش گردش صندوق</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setCashDetail(null)}>بستن</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            {cashDetail && (
              <>
                <p>
                  <b>شرح:</b> {cashDetail.description}
                </p>
                <p>
                  <b>مبلغ:</b> {formatToman(cashDetail.amount)}
                </p>
                <p>
                  <b>تاریخ:</b> {formatDate(cashDetail.date)}
                </p>
                <p className="hint">روش پرداخت را عوض کنید تا موجودی نقد / کارت اصلاح شود</p>
                <div className="chip-row">
                  <IonChip
                    className={cashMethod === 'cash' ? 'ios-chip-active' : 'ios-chip'}
                    onClick={() => setCashMethod('cash')}
                  >
                    نقدی
                  </IonChip>
                  <IonChip
                    className={cashMethod === 'card_to_card' ? 'ios-chip-active' : 'ios-chip'}
                    onClick={() => setCashMethod('card_to_card')}
                  >
                    کارت به کارت
                  </IonChip>
                  <IonChip
                    className={cashMethod === 'card' ? 'ios-chip-active' : 'ios-chip'}
                    onClick={() => setCashMethod('card')}
                  >
                    کارت / پوز
                  </IonChip>
                </div>
                <IonItem>
                  <IonLabel position="stacked">رمز عملیات</IonLabel>
                  <IonInput
                    type="password"
                    value={cashPw}
                    onIonInput={(e) => setCashPw(e.detail.value || '')}
                  />
                </IonItem>
                <IonButton
                  expand="block"
                  className="ios-primary-btn ion-margin-top"
                  disabled={cashSaving || !cashPw}
                  onClick={async () => {
                    if (!cashDetail) return;
                    setCashSaving(true);
                    try {
                      await wsClient.request('cash.updateMethod', {
                        id: cashDetail._id,
                        password: cashPw,
                        paymentMethod: cashMethod,
                      });
                      setToast({ open: true, msg: 'روش پرداخت ذخیره شد', color: 'success' });
                      setCashDetail(null);
                      await loadCashTxs();
                      await loadSettings();
                    } catch (e) {
                      setToast({
                        open: true,
                        msg: e instanceof Error ? e.message : 'خطا',
                        color: 'danger',
                      });
                    } finally {
                      setCashSaving(false);
                    }
                  }}
                >
                  ذخیره روش پرداخت
                </IonButton>
              </>
            )}
          </IonContent>
        </IonModal>

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

export default History;
