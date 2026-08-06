import { useCallback, useEffect, useState } from 'react';
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

type CompanyDebt = {
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
};

type CashTx = {
  _id: string;
  type: string;
  amount: number;
  direction: 'in' | 'out';
  description: string;
  date: string;
  paymentMethod?: 'cash' | 'card' | 'card_to_card';
};

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
  const [companyDebt, setCompanyDebt] = useState<CompanyDebt | null>(null);
  const [cashTxs, setCashTxs] = useState<CashTx[]>([]);
  const [cashDetail, setCashDetail] = useState<CashTx | null>(null);
  const [cashMethod, setCashMethod] = useState<'cash' | 'card' | 'card_to_card'>('cash');
  const [cashPw, setCashPw] = useState('');
  const [cashSaving, setCashSaving] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showReportExtras, setShowReportExtras] = useState(false);

  const runReport = useCallback(async (f?: string, t?: string) => {
    const fromDate = f || from;
    const toDate = t || to;
    if (!fromDate || !toDate) return;
    setLoading(true);
    try {
      const data = await wsClient.request<Period>('dashboard.period', {
        from: fromDate,
        to: toDate,
      });
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
  }, [from, to]);

  const loadSettings = useCallback(async () => {
    const s = await wsClient.request<{
      openingDate: string;
      cashBalance: number;
      cardBalance: number;
      shopName: string;
    }>('settings.get');
    const openDay = s.openingDate.split('T')[0];
    setOpeningDate(openDay);
    setShopName(s.shopName || '');
    setCashBalance(formatMoneyInput(String(s.cashBalance || 0)));
    setCardBalance(formatMoneyInput(String(s.cardBalance || 0)));
    setLiveCash(s.cashBalance || 0);
    setLiveCard(s.cardBalance || 0);
    const nextFrom = from || openDay;
    const nextTo = to || todayIso();
    if (!from) setFrom(nextFrom);
    if (!to) setTo(nextTo);
    return { from: nextFrom, to: nextTo };
  }, [from, to]);

  const loadCashTxs = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const list = await wsClient.request<CashTx[]>('cash.list', { limit: 40 });
      setCashTxs(Array.isArray(list) ? list : []);
    } catch {
      setCashTxs([]);
    }
  }, [isAdmin]);

  const loadCompanyDebt = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const s = await wsClient.request<CompanyDebt>('companyDebt.summary', {});
      setCompanyDebt(s);
    } catch {
      setCompanyDebt(null);
    }
  }, [isAdmin]);

  useEffect(() => {
    void (async () => {
      try {
        const range = await loadSettings();
        await Promise.all([loadCashTxs(), loadCompanyDebt()]);
        await runReport(range.from, range.to);
      } catch (e) {
        console.warn(e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const profit = period?.totalProfit ?? 0;
  const expenses = period?.totalExpenses ?? 0;
  const net = period?.netProfit ?? profit - expenses;
  const inLoss = net < 0;

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
            const range = await loadSettings().catch(() => ({ from, to }));
            await loadCashTxs();
            await loadCompanyDebt();
            await runReport(range.from, range.to);
            e.detail.complete();
          }}
        >
          <IonRefresherContent />
        </IonRefresher>

        <div className="ion-padding cashbox-page">
          {/* موجودی زنده */}
          <div className="cash-hero">
            <div className="cash-hero-label">موجودی صندوق</div>
            <div className="cash-hero-grid">
              <div>
                <div className="cash-hero-k">نقد</div>
                <div className="cash-hero-v">{formatToman(liveCash)}</div>
              </div>
              <div>
                <div className="cash-hero-k">کارت</div>
                <div className="cash-hero-v">{formatToman(liveCard)}</div>
              </div>
            </div>
          </div>

          {/* سود واقعی فروش */}
          <div className="cash-section-title">سود واقعی فروش</div>
          <div className={`cash-profit-card ${profit >= 0 ? 'ok' : 'bad'}`}>
            <div className="cash-profit-label">سود فروش (بازه انتخابی)</div>
            <div className="cash-profit-value">{formatToman(profit)}</div>
            <div className="cash-profit-meta">
              {from && to
                ? `${formatDate(from)} تا ${formatDate(to)}`
                : 'بازه را انتخاب کنید'}
              {period?.invoiceCount != null ? ` · ${period.invoiceCount} فاکتور` : ''}
              {period ? ` · فروش ${formatToman(period.totalSales)}` : ''}
            </div>
          </div>

          <div className="cash-summary-card">
            <div className="cash-sum-row good">
              <span>اینقدر سود کردی</span>
              <strong>{formatToman(profit)}</strong>
            </div>
            <div className="cash-sum-row cost">
              <span>اینقدر هزینه کردی</span>
              <strong>{formatToman(expenses)}</strong>
            </div>
            <div className={`cash-sum-row result ${inLoss ? 'loss' : 'win'}`}>
              <span>{inLoss ? 'الان اینقدر تو ضرری' : 'الان اینقدر سود خالص داری'}</span>
              <strong>{formatToman(Math.abs(net))}</strong>
            </div>
            <p className="hint" style={{ margin: '10px 0 0' }}>
              سود فروش = فروش بعد از تخفیف − هزینه خرید کالا. هزینه مغازه جدا کم می‌شود.
            </p>
          </div>

          {/* بدهی شرکت */}
          {isAdmin && companyDebt && (
            <>
              <div className="cash-section-title">بدهی به شرکت</div>
              <div className="cash-company-card">
                <div className="cash-company-main">
                  <div className="cash-company-k">مانده بدهی</div>
                  <div className="cash-company-v">
                    {formatToman(companyDebt.remainingDebt || 0)}
                  </div>
                  <div className="cash-company-formula">
                    کل بدهی {formatToman(companyDebt.totalDebtAmount || 0)}
                    {' − '}
                    پرداخت‌شده {formatToman(companyDebt.totalPaidToCompany || 0)}
                  </div>
                </div>
                <div className="cash-company-stats">
                  <div className="stat-row">
                    <span className="stat-label">کل بدهی خرید نسیه</span>
                    <span className="stat-value">
                      {formatToman(companyDebt.totalDebtAmount || 0)}
                    </span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">پرداخت‌شده به شرکت</span>
                    <span className="stat-value success">
                      {formatToman(companyDebt.totalPaidToCompany || 0)}
                    </span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">مانده (= کل − پرداخت)</span>
                    <span className="stat-value danger">
                      {formatToman(companyDebt.remainingDebt || 0)}
                    </span>
                  </div>
                </div>

                {(companyDebt.recentPayments || []).length > 0 && (
                  <div className="cash-mini-list">
                    <div className="ios-caption" style={{ fontWeight: 800, marginBottom: 6 }}>
                      آخرین پرداخت‌ها
                    </div>
                    {companyDebt.recentPayments.slice(0, 5).map((p) => (
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
                  </div>
                )}

                {(companyDebt.debts || []).length > 0 && (
                  <div className="cash-mini-list">
                    <div className="ios-caption" style={{ fontWeight: 800, marginBottom: 6 }}>
                      فاکتورهای بدهی باز
                    </div>
                    {companyDebt.debts.slice(0, 6).map((d) => (
                      <div key={String(d.id)} className="cash-debt-line">
                        <div>
                          <strong>{d.supplier}</strong>
                          <div className="ios-caption">
                            {formatDate(d.date)} · اصل {formatToman(d.amount)}
                            {(d.paidAmount || 0) > 0
                              ? ` · پرداختی ${formatToman(d.paidAmount)}`
                              : ''}
                          </div>
                        </div>
                        <div className="stat-value danger">{formatToman(d.remaining)}</div>
                      </div>
                    ))}
                  </div>
                )}

                <IonButton expand="block" fill="outline" size="small" routerLink="/expense">
                  ثبت پرداخت به شرکت / هزینه
                </IonButton>
              </div>
            </>
          )}

          {/* گردش */}
          {isAdmin && (
            <>
              <div className="cash-section-title">گردش صندوق</div>
              <div className="cash-ledger">
                {cashTxs.length === 0 && <p className="hint">تراکنشی ثبت نشده</p>}
                {cashTxs.slice(0, 12).map((tx) => (
                  <button
                    type="button"
                    key={tx._id}
                    className="cash-tx-row"
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
                    <div className="cash-tx-main">
                      <strong>{tx.description}</strong>
                      <span className="ios-caption">
                        {formatDate(tx.date)} · {tx.direction === 'in' ? 'ورود' : 'خروج'}
                      </span>
                    </div>
                    <span className={tx.direction === 'in' ? 'cash-tx-in' : 'cash-tx-out'}>
                      {tx.direction === 'in' ? '+' : '−'}
                      {formatToman(tx.amount)}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* گزارش بازه */}
          <div className="cash-section-title">بازه گزارش</div>
          <div className="cash-range-card">
            <PersianDateField label="از تاریخ" value={from} onChange={setFrom} />
            <PersianDateField label="تا تاریخ" value={to} onChange={setTo} />
            <IonButton
              expand="block"
              className="ios-primary-btn"
              size="small"
              disabled={loading || !from || !to}
              onClick={() => void runReport()}
            >
              {loading ? <IonSpinner name="crescent" /> : 'به‌روز کردن گزارش'}
            </IonButton>

            {period && (
              <>
                <div className="cash-kpi-row">
                  <div>
                    <div className="ios-caption">فروش</div>
                    <strong>{formatToman(period.totalSales)}</strong>
                  </div>
                  <div>
                    <div className="ios-caption">تناژ</div>
                    <strong>{formatKg(period.soldKg)}</strong>
                  </div>
                  <div>
                    <div className="ios-caption">فاکتور</div>
                    <strong>{period.invoiceCount ?? '—'}</strong>
                  </div>
                </div>

                <IonButton
                  size="small"
                  fill="clear"
                  onClick={() => setShowReportExtras((v) => !v)}
                >
                  {showReportExtras ? 'بستن جزئیات' : 'جزئیات بیشتر'}
                </IonButton>

                {showReportExtras && (
                  <div className="cash-extras">
                    {period.payment && (
                      <>
                        <div className="stat-row">
                          <span>نقد</span>
                          <span>{formatToman(period.payment.cash)}</span>
                        </div>
                        <div className="stat-row">
                          <span>کارت</span>
                          <span>{formatToman(period.payment.card)}</span>
                        </div>
                        <div className="stat-row">
                          <span>نسیه</span>
                          <span>{formatToman(period.payment.credit)}</span>
                        </div>
                      </>
                    )}
                    {period.daily.slice(-7).map((d) => (
                      <div key={d.date} className="cash-day-line">
                        <span>{formatDate(d.date)}</span>
                        <span>{formatToman(d.sales)}</span>
                        <span className={(d.profit ?? d.netProfit) >= 0 ? 'success' : 'danger'}>
                          {formatToman(d.profit ?? d.netProfit)}
                        </span>
                      </div>
                    ))}
                    {(period.soldByProduct || []).slice(0, 6).map((it) => (
                      <div key={it.productId} className="stat-row">
                        <span className="stat-label">
                          {it.name} · {formatKg(it.soldKg)}
                        </span>
                        <span className="stat-value">{formatToman(it.revenue)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* تنظیمات */}
          {isAdmin && (
            <>
              <IonButton
                expand="block"
                fill="clear"
                size="small"
                onClick={() => setShowSettings((v) => !v)}
              >
                {showSettings ? 'بستن تنظیمات مغازه' : 'تنظیمات مغازه'}
              </IonButton>
              {showSettings && (
                <div className="cash-settings-card">
                  <IonItem>
                    <IonLabel position="stacked">نام مغازه</IonLabel>
                    <IonInput
                      value={shopName}
                      onIonInput={(e) => setShopName(e.detail.value || '')}
                    />
                  </IonItem>
                  <PersianDateField
                    label="تاریخ باز شدن مغازه"
                    value={openingDate}
                    onChange={setOpeningDate}
                  />
                  <MoneyInput
                    label="موجودی نقد (تومان)"
                    value={cashBalance}
                    onChange={setCashBalance}
                  />
                  <MoneyInput
                    label="موجودی کارتخوان (تومان)"
                    value={cardBalance}
                    onChange={setCardBalance}
                  />
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
                    ذخیره
                  </IonButton>
                </div>
              )}
            </>
          )}
        </div>

        <IonModal isOpen={!!cashDetail} onDidDismiss={() => setCashDetail(null)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>ویرایش گردش</IonTitle>
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
                      setToast({ open: true, msg: 'ذخیره شد', color: 'success' });
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
