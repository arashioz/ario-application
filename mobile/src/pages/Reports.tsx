import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
  IonButtons,
  IonBackButton,
  IonChip,
  IonSpinner,
  IonToast,
  IonIcon,
  IonRouterLink,
  IonRefresher,
  IonRefresherContent,
  RefresherEventDetail,
} from '@ionic/react';
import {
  listOutline,
  peopleOutline,
  locationOutline,
  cashOutline,
  walletOutline,
  documentTextOutline,
  personOutline,
} from 'ionicons/icons';
import { wsClient } from '../api/ws';
import {
  formatToman,
  formatKg,
  formatDate,
  todayIso,
  monthStartIso,
  daysAgoIso,
} from '../utils/format';
import { PersianDateField } from '../components/PersianDateField';
import { useAuth } from '../auth/AuthContext';
import { expenseTypes } from '../theme/colors';

type DailyPoint = {
  date: string;
  sales: number;
  soldKg: number;
  profit?: number;
  netProfit: number;
  expenses?: number;
  creditCollected?: number;
  priorCreditCollected?: number;
};

type Period = {
  totalSales: number;
  soldKg: number;
  totalProfit: number;
  totalCost?: number;
  totalExpenses: number;
  excludedExpenses?: number;
  netProfit?: number;
  invoiceCount?: number;
  expenseByType?: Record<string, number>;
  payment?: { cash: number; card: number; credit: number };
  soldByProduct?: Array<{
    productId: string;
    name: string;
    soldKg: number;
    revenue: number;
  }>;
  creditByCustomer?: Array<{
    name: string;
    credit: number;
    invoices: number;
  }>;
  daily?: DailyPoint[];
  dayLedger?: {
    soldGross: number;
    priorCreditCollected: number;
    collections: Array<{
      customerName: string;
      amount: number;
      invoiceNumber?: string;
      date: string;
      isPriorCredit: boolean;
    }>;
  };
};

const EXPENSE_LABELS: Record<string, string> = Object.fromEntries(
  expenseTypes.map((t) => [t.value, t.label])
);

const Reports: React.FC = () => {
  const { isAdmin } = useAuth();
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(todayIso());
  const [period, setPeriod] = useState<Period | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState({ open: false, msg: '', color: 'danger' });
  const [chartRange, setChartRange] = useState<'7' | '30' | '90'>('30');
  const [chartDays, setChartDays] = useState<DailyPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(false);

  const runReport = useCallback(
    async (f = from, t = to) => {
      if (!f || !t) return;
      setLoading(true);
      try {
        const data = await wsClient.request<Period>('dashboard.period', { from: f, to: t });
        setPeriod(data);
      } catch (e) {
        setToast({
          open: true,
          msg: e instanceof Error ? e.message : 'خطا در گزارش',
          color: 'danger',
        });
      } finally {
        setLoading(false);
      }
    },
    [from, to]
  );

  const loadChart = useCallback(async (range: '7' | '30' | '90' = chartRange) => {
    setChartLoading(true);
    try {
      const days = parseInt(range, 10);
      const nextTo = todayIso();
      const nextFrom = daysAgoIso(days - 1);
      const data = await wsClient.request<{ daily?: DailyPoint[] }>('dashboard.period', {
        from: nextFrom,
        to: nextTo,
      });
      setChartDays(Array.isArray(data.daily) ? data.daily : []);
    } catch {
      setChartDays([]);
    } finally {
      setChartLoading(false);
    }
  }, [chartRange]);

  useEffect(() => {
    void runReport();
    void loadChart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyPreset = (preset: 'today' | 'week' | 'month') => {
    const nextTo = todayIso();
    const nextFrom =
      preset === 'today' ? nextTo : preset === 'week' ? daysAgoIso(6) : monthStartIso();
    setFrom(nextFrom);
    setTo(nextTo);
    void runReport(nextFrom, nextTo);
  };

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
      profit += d.profit ?? d.netProfit ?? 0;
    }
    return { sales, kg, profit };
  }, [chartDays]);

  const profit = period?.totalProfit ?? 0;
  const expenses = period?.totalExpenses ?? 0;
  const net = period?.netProfit ?? profit - expenses;
  const cost = period?.totalCost ?? 0;

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/more" text="بازگشت" />
          </IonButtons>
          <IonTitle>گزارشات</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="page-content ios-content">
        <IonRefresher
          slot="fixed"
          onIonRefresh={async (e: CustomEvent<RefresherEventDetail>) => {
            await Promise.all([runReport(), loadChart()]);
            e.detail.complete();
          }}
        >
          <IonRefresherContent />
        </IonRefresher>

        <div className="ion-padding cashbox-page">
          <div className="cash-section-title">گزارش فروش</div>
          <div className="ios-glass-card" style={{ marginBottom: 14 }}>
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
                  <span className="stat-label">سود فروش</span>
                  <span className="stat-value success">{formatToman(chartTotals.profit)}</span>
                </div>
                {chartDays.length === 0 ? (
                  <p className="hint">در این بازه فروشی نیست</p>
                ) : (
                  <div className="pa-trend" style={{ marginTop: 10 }}>
                    {chartDays.map((d) => (
                      <div key={d.date} className="pa-trend-row">
                        <span className="pa-trend-label">
                          {formatDate(d.date).replace(/\/\d{4}$/, '')}
                        </span>
                        <div className="pa-trend-bar-wrap">
                          <div
                            className="pa-trend-bar"
                            style={{
                              width: `${Math.max(4, ((d.sales || 0) / maxSales) * 100)}%`,
                            }}
                          />
                        </div>
                        <span className="pa-trend-val">
                          {formatToman(d.sales)}
                          {(d.priorCreditCollected || 0) > 0
                            ? ` · وصول ${formatToman(d.priorCreditCollected || 0)}`
                            : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="more-square-grid" style={{ marginBottom: 16 }}>
            {[
              { href: '/invoices', icon: listOutline, label: 'فاکتورها', desc: 'فروش و خرید' },
              { href: '/customers', icon: personOutline, label: 'مشتریان', desc: 'لیست و گزارش' },
              { href: '/customers-map', icon: locationOutline, label: 'نقشه', desc: 'موقعیت' },
              { href: '/debtors', icon: peopleOutline, label: 'نسیه', desc: 'بدهکاران' },
            ].map((l) => (
              <IonRouterLink key={l.href} routerLink={l.href} className="more-square">
                <span className="more-square-icon">
                  <IonIcon icon={l.icon} />
                </span>
                <span className="more-square-label">{l.label}</span>
                <span className="more-square-desc">{l.desc}</span>
              </IonRouterLink>
            ))}
          </div>

          {period && (period.soldByProduct || []).length > 0 && (
            <div className="ios-glass-card">
              <div className="ios-section-title" style={{ marginTop: 0 }}>
                پرفروش‌ترین‌ها در بازه
              </div>
              {(period.soldByProduct || []).slice(0, 8).map((it) => (
                <div key={it.productId} className="stat-row">
                  <span className="stat-label">
                    {it.name} · {formatKg(it.soldKg)}
                  </span>
                  <span className="stat-value">{formatToman(it.revenue)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="cash-section-title">بازه گزارش مالی</div>
          <div className="cash-range-card">
            <div className="chip-row" style={{ marginBottom: 8 }}>
              <IonChip className="ios-chip" onClick={() => applyPreset('today')}>
                امروز
              </IonChip>
              <IonChip className="ios-chip" onClick={() => applyPreset('week')}>
                ۷ روز
              </IonChip>
              <IonChip className="ios-chip" onClick={() => applyPreset('month')}>
                این ماه
              </IonChip>
            </div>
            <PersianDateField label="از تاریخ" value={from} onChange={setFrom} />
            <PersianDateField label="تا تاریخ" value={to} onChange={setTo} />
            <IonButton
              expand="block"
              className="ios-primary-btn"
              size="small"
              disabled={loading || !from || !to}
              onClick={() => void runReport()}
            >
              {loading ? <IonSpinner name="crescent" /> : 'اعمال بازه'}
            </IonButton>
          </div>

          <div className="cash-section-title">گزارش مالی</div>
          {period ? (
            <>
              <div className={`cash-profit-card ${profit >= 0 ? 'ok' : 'bad'}`}>
                <div className="cash-profit-label">سود فروش</div>
                <div className="cash-profit-value">{formatToman(profit)}</div>
                <div className="cash-profit-meta">
                  {formatDate(from)} تا {formatDate(to)}
                  {period.invoiceCount != null ? ` · ${period.invoiceCount} فاکتور` : ''}
                </div>
              </div>
              <div className="cash-summary-card">
                <div className="cash-sum-row">
                  <span>فروش (تاریخ فاکتور)</span>
                  <strong>{formatToman(period.totalSales)}</strong>
                </div>
                {(period.dayLedger?.priorCreditCollected || 0) > 0 && (
                  <div className="cash-sum-row">
                    <span>وصول نسیهٔ قبلی در این بازه</span>
                    <strong>{formatToman(period.dayLedger?.priorCreditCollected || 0)}</strong>
                  </div>
                )}
                <div className="cash-sum-row">
                  <span>هزینه خرید کالا (بهای تمام‌شده)</span>
                  <strong>{formatToman(cost)}</strong>
                </div>
                <div className="cash-sum-row good">
                  <span>سود فروش</span>
                  <strong>{formatToman(profit)}</strong>
                </div>
                <div className="cash-sum-row cost">
                  <span>هزینه عملیاتی مغازه</span>
                  <strong>{formatToman(expenses)}</strong>
                </div>
                {(period.excludedExpenses || 0) > 0 && (
                  <div className="cash-sum-row">
                    <span>برداشت / قرض (در هزینه حساب نشده)</span>
                    <strong>{formatToman(period.excludedExpenses || 0)}</strong>
                  </div>
                )}
                <div className={`cash-sum-row result ${net < 0 ? 'loss' : 'win'}`}>
                  <span>{net < 0 ? 'زیان خالص' : 'سود خالص'}</span>
                  <strong>{formatToman(Math.abs(net))}</strong>
                </div>
              </div>

              {period.payment && (
                <div className="ios-glass-card">
                  <div className="ios-section-title" style={{ marginTop: 0 }}>
                    ترکیب پرداخت
                  </div>
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
                </div>
              )}

              {period.expenseByType && Object.keys(period.expenseByType).length > 0 && (
                <div className="ios-glass-card">
                  <div className="ios-section-title" style={{ marginTop: 0 }}>
                    جزئیات هزینه عملیاتی
                  </div>
                  {Object.entries(period.expenseByType)
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, v]) => (
                      <div key={k} className="stat-row">
                        <span>{EXPENSE_LABELS[k] || k}</span>
                        <span>{formatToman(v)}</span>
                      </div>
                    ))}
                </div>
              )}
            </>
          ) : (
            <p className="hint">{loading ? 'در حال بارگذاری…' : 'گزارشی نیست'}</p>
          )}

          <div className="cash-section-title">میانبر مالی</div>
          <div className="more-square-grid">
            {[
              { href: '/history', icon: cashOutline, label: 'صندوق', desc: 'موجودی' },
              ...(isAdmin
                ? [{ href: '/expense', icon: walletOutline, label: 'هزینه', desc: 'ثبت هزینه' }]
                : []),
              { href: '/checks', icon: documentTextOutline, label: 'چک', desc: 'سررسید' },
            ].map((l) => (
              <IonRouterLink key={l.href} routerLink={l.href} className="more-square">
                <span className="more-square-icon">
                  <IonIcon icon={l.icon} />
                </span>
                <span className="more-square-label">{l.label}</span>
                <span className="more-square-desc">{l.desc}</span>
              </IonRouterLink>
            ))}
          </div>
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

export default Reports;
