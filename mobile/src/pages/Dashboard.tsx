import { useCallback, useEffect, useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  IonButtons,
  IonButton,
  IonIcon,
  IonChip,
  IonModal,
  useIonViewWillEnter,
  RefresherEventDetail,
} from '@ionic/react';
import {
  cartOutline,
  receiptOutline,
  peopleOutline,
  walletOutline,
  fileTrayFullOutline,
  documentTextOutline,
  personOutline,
  cubeOutline,
  alertCircleOutline,
  checkmarkDoneOutline,
  bicycleOutline,
  eyeOutline,
  eyeOffOutline,
  closeOutline,
  pieChartOutline,
  createOutline,
  chevronBackOutline,
} from 'ionicons/icons';
import { wsClient } from '../api/ws';
import { useAuth } from '../auth/AuthContext';
import { formatKg, formatToman, formatDate, formatDateTime, todayIso } from '../utils/format';
import { useHistory } from 'react-router-dom';
import { PersianDateField } from '../components/PersianDateField';

const PROFIT_KEY = 'ario_dash_show_profit';

function loadShowProfit(): boolean {
  try {
    return localStorage.getItem(PROFIT_KEY) === '1';
  } catch {
    return false;
  }
}

interface InvProduct {
  id: string;
  name: string;
  stockKg: number;
  packages: number;
  kgPerPackage: number;
}

interface Dash {
  totalSales: number;
  soldKg: number;
  totalProfit?: number;
  netProfit: number;
  totalExpenses: number;
  creditSales?: number;
  period?: 'today' | 'week' | 'month';
  periodLabel?: string;
  salesCount: number;
  pendingApprovals?: number;
  shippedSplit?: {
    paid: {
      sales: number;
      profit: number;
      cost: number;
      kg: number;
      invoiceCount: number;
    };
    credit: {
      sales: number;
      profit: number;
      cost: number;
      kg: number;
      invoiceCount: number;
    };
  };
  inventory?: {
    totalKg: number;
    totalTons: number;
    totalPackages: number;
    totalValue: number;
    productCount: number;
    emptyCount: number;
    lowStock: InvProduct[];
    products: InvProduct[];
  };
  companyDebt?: { total: number; count: number };
  checks?: { overdueCount: number };
  shipping?: { count: number };
  debtors: {
    total: number;
    count: number;
    overdue: Array<{ name: string; remaining: number }>;
  };
  profitAverages?: {
    week: {
      invoiceCount: number;
      totalSales: number;
      totalProfit: number;
      totalKg: number;
      avgProfitPerInvoice: number;
      avgMarkupPercent: number;
      avgMarginPercent: number;
    };
    month: {
      invoiceCount: number;
      totalSales: number;
      totalProfit: number;
      totalKg: number;
      avgProfitPerInvoice: number;
      avgMarkupPercent: number;
      avgMarginPercent: number;
    };
    year: {
      invoiceCount: number;
      totalSales: number;
      totalProfit: number;
      totalKg: number;
      avgProfitPerInvoice: number;
      avgMarkupPercent: number;
      avgMarginPercent: number;
    };
    all: {
      invoiceCount: number;
      totalSales: number;
      totalProfit: number;
      totalKg: number;
      avgProfitPerInvoice: number;
      avgMarkupPercent: number;
      avgMarginPercent: number;
    };
  };
  dayLedger?: {
    soldGross: number;
    soldKg: number;
    soldProfit: number;
    soldCount: number;
    soldPaid: number;
    soldCredit: number;
    collectionsTotal: number;
    priorCreditCollected: number;
    sameDayCreditCollected: number;
    collections: Array<{
      invoiceId?: string;
      invoiceNumber?: string;
      customerName: string;
      amount: number;
      method: string;
      date: string;
      invoiceDate?: string;
      isPriorCredit: boolean;
      note?: string;
    }>;
    soldInvoices: Array<{
      invoiceId: string;
      invoiceNumber: string;
      customerName: string;
      totalAmount: number;
      totalKg: number;
      paid: number;
      credit: number;
      date: string;
    }>;
  };
}

type ShopNote = {
  id: string;
  text: string;
  done: boolean;
  color: 'yellow' | 'mint' | 'peach' | 'sky' | 'lavender';
};

const Dashboard: React.FC = () => {
  const { user, isAdmin, logout, online, queueLen } = useAuth();
  const history = useHistory();
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState('');
  const [kpiPeriod, setKpiPeriod] = useState<'today' | 'week' | 'month'>('today');
  const [viewDate, setViewDate] = useState(todayIso());
  const [showProfit, setShowProfit] = useState(loadShowProfit);
  const [invOpen, setInvOpen] = useState(false);
  const [notes, setNotes] = useState<ShopNote[]>([]);

  const loadNotes = useCallback(async () => {
    try {
      const list = await wsClient.request<ShopNote[]>('note.list', { includeDone: false });
      setNotes(Array.isArray(list) ? list.slice(0, 2) : []);
    } catch {
      setNotes([]);
    }
  }, []);

  const load = useCallback(
    async (period: 'today' | 'week' | 'month' = kpiPeriod, date = viewDate) => {
      try {
        const d = await wsClient.request<Dash>('dashboard.get', { period, date });
        setData(d);
        setError('');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'خطا');
      }
    },
    [kpiPeriod, viewDate]
  );

  useIonViewWillEnter(() => {
    void load(kpiPeriod);
    void loadNotes();
  });

  useEffect(() => {
    const unsub = wsClient.onEvent('data_changed', (payload: unknown) => {
      const p = payload as { entity?: string };
      if (p?.entity === 'note') void loadNotes();
      if (p?.entity === 'sale' || p?.entity === 'purchase' || p?.entity === 'product') {
        void load(kpiPeriod);
      }
    });
    return unsub;
  }, [loadNotes, load, kpiPeriod]);

  const onRefresh = async (ev: CustomEvent<RefresherEventDetail>) => {
    await Promise.all([load(kpiPeriod), loadNotes()]);
    ev.detail.complete();
  };

  const setPeriod = (p: 'today' | 'week' | 'month') => {
    setKpiPeriod(p);
    void load(p);
  };

  const quick = [
    { href: '/sale', icon: receiptOutline, label: 'فروش', color: 'qa-teal' },
    ...(isAdmin
      ? [{ href: '/purchase', icon: cartOutline, label: 'خرید', color: 'qa-amber' }]
      : []),
    { href: '/orders', icon: fileTrayFullOutline, label: 'سفارش', color: 'qa-blue' },
    { href: '/customers', icon: personOutline, label: 'مشتری', color: 'qa-indigo' },
    { href: '/debtors', icon: peopleOutline, label: 'نسیه', color: 'qa-rose' },
    ...(isAdmin
      ? [{ href: '/expense', icon: walletOutline, label: 'هزینه', color: 'qa-slate' }]
      : [{ href: '/checks', icon: documentTextOutline, label: 'چک', color: 'qa-violet' }]),
    { href: '/reports', icon: pieChartOutline, label: 'گزارش', color: 'qa-violet' },
  ];

  const inv = data?.inventory;
  const actionCount =
    (data?.shipping?.count || 0) +
    (data?.pendingApprovals || 0) +
    (data?.debtors?.overdue?.length || 0) +
    (data?.checks?.overdueCount || 0);

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonTitle>خانه</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => void logout()}>خروج</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="page-content ios-content">
        <IonRefresher slot="fixed" onIonRefresh={onRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        <div className="ion-padding compact">
          <div className="ios-hero">
            <div className="ios-hero-greeting">سلام {user?.name}</div>
            <div className="ios-caption">
              {user?.role === 'admin' ? 'مدیر' : 'بازاریاب'} · {online ? 'آنلاین' : 'آفلاین'}
              {queueLen > 0 ? ` · صف ${queueLen}` : ''}
              {actionCount > 0 ? ` · ${actionCount} مورد اقدام` : ''}
            </div>
          </div>

          {!data && !error && (
            <div className="ion-text-center ion-padding">
              <IonSpinner name="crescent" />
            </div>
          )}
          {error && <p className="hint danger-text">{error}</p>}

          {data && (
            <>
              <button type="button" className="warehouse-btn" onClick={() => setInvOpen(true)}>
                <div className="wh-btn-main">
                  <span className="wh-btn-eye">
                    <IonIcon icon={cubeOutline} /> موجودی انبار
                  </span>
                  <strong className="wh-btn-kg">{formatKg(inv?.totalKg || 0)}</strong>
                  <span className="wh-btn-sub">
                    {(inv?.totalPackages || 0).toLocaleString('fa-IR')} بسته · {inv?.productCount || 0}{' '}
                    محصول
                    {(inv?.emptyCount || 0) > 0 ? ` · ${inv?.emptyCount} تمام` : ''}
                  </span>
                </div>
                <span className="wh-btn-cta">مشاهده</span>
              </button>
              {(inv?.lowStock || []).length > 0 && (
                <div className="wh-low-hint">
                  <IonIcon icon={alertCircleOutline} />
                  کم‌موجود:{' '}
                  {(inv?.lowStock || [])
                    .slice(0, 2)
                    .map((p) => p.name)
                    .join(' · ')}
                </div>
              )}

              <div className="ios-section-title">دسترسی سریع</div>
              <div className="quick-grid">
                {quick.map((q) => (
                  <IonButton
                    key={q.href}
                    routerLink={q.href}
                    fill="clear"
                    className={`quick-tile ${q.color}`}
                  >
                    <div className="qt-inner">
                      <IonIcon icon={q.icon} />
                      <span>{q.label}</span>
                    </div>
                  </IonButton>
                ))}
              </div>

              <div className="ios-section-title">نیاز به اقدام</div>
              <div className="action-strip">
                <IonButton routerLink="/orders" fill="solid" className="action-chip warn">
                  <IonIcon slot="start" icon={bicycleOutline} />
                  بار {data.shipping?.count || 0}
                </IonButton>
                <IonButton routerLink="/orders" fill="solid" className="action-chip teal">
                  <IonIcon slot="start" icon={checkmarkDoneOutline} />
                  تأیید {data.pendingApprovals || 0}
                </IonButton>
                <IonButton routerLink="/debtors" fill="solid" className="action-chip rose">
                  <IonIcon slot="start" icon={peopleOutline} />
                  بدهی {data.debtors.count}
                </IonButton>
                <IonButton routerLink="/checks" fill="solid" className="action-chip violet">
                  <IonIcon slot="start" icon={documentTextOutline} />
                  چک {data.checks?.overdueCount || 0}
                </IonButton>
              </div>

              {/* یادداشت‌ها — وسط صفحه؛ فقط ۲ تای باز */}
              <button
                type="button"
                className="sticky-board sticky-board-preview"
                onClick={() => history.push('/notes')}
              >
                <div className="sticky-board-head">
                  <strong>
                    <IonIcon icon={createOutline} style={{ verticalAlign: 'middle', marginLeft: 4 }} />
                    یادداشت‌ها
                  </strong>
                  <span className="sticky-preview-more">
                    همه
                    <IonIcon icon={chevronBackOutline} />
                  </span>
                </div>
                <div className="sticky-grid sticky-grid-preview">
                  {notes.length === 0 && (
                    <div className="sticky-empty">یادداشتی نیست — بزن تا صفحه باز شود</div>
                  )}
                  {notes.map((n, i) => (
                    <div
                      key={n.id}
                      className={`sticky-note color-${n.color}`}
                      style={{ transform: `rotate(${((i % 3) - 1) * 1.1}deg)` }}
                    >
                      <p className="sticky-text">{n.text}</p>
                    </div>
                  ))}
                </div>
              </button>

              <div className="ios-section-title">
                خلاصه — {kpiPeriod === 'today' ? formatDate(viewDate + 'T12:00:00') : data.periodLabel || 'امروز'}
              </div>
              <PersianDateField
                label="روز گزارش"
                value={viewDate}
                onChange={(iso) => {
                  setViewDate(iso);
                  void load(kpiPeriod, iso);
                }}
              />
              <div className="chip-row" style={{ marginBottom: 8 }}>
                <IonChip
                  className={kpiPeriod === 'today' ? 'ios-chip-active' : 'ios-chip'}
                  onClick={() => setPeriod('today')}
                >
                  همین روز
                </IonChip>
                <IonChip
                  className={kpiPeriod === 'week' ? 'ios-chip-active' : 'ios-chip'}
                  onClick={() => setPeriod('week')}
                >
                  ۷ روز تا این تاریخ
                </IonChip>
                <IonChip
                  className={kpiPeriod === 'month' ? 'ios-chip-active' : 'ios-chip'}
                  onClick={() => setPeriod('month')}
                >
                  این ماه تا این تاریخ
                </IonChip>
              </div>

              <div className="day-split-grid stack">
                <div className="day-split-card paid">
                  <div className="day-split-title">
                    {kpiPeriod === 'today' ? 'فروش این روز' : kpiPeriod === 'week' ? 'فروش این ۷ روز' : 'فروش این ماه'}
                  </div>
                  <p className="day-split-sub">فاکتورهایی که تاریخ‌شان در این بازه است — بار رفته</p>
                  <div className="day-split-row">
                    <span>مبلغ فروخته‌شده</span>
                    <strong>
                      {formatToman(data.dayLedger?.soldGross ?? data.totalSales)}
                    </strong>
                  </div>
                  <div className="day-split-row">
                    <span>نقد / پوز همان فاکتورها</span>
                    <strong>{formatToman(data.dayLedger?.soldPaid ?? data.shippedSplit?.paid.sales ?? 0)}</strong>
                  </div>
                  <div className="day-split-row">
                    <span>نسیه همین فاکتورها</span>
                    <strong>
                      {formatToman(data.dayLedger?.soldCredit ?? data.shippedSplit?.credit.sales ?? 0)}
                    </strong>
                  </div>
                  <div className="day-split-row">
                    <span>تناژ</span>
                    <strong>{formatKg(data.dayLedger?.soldKg ?? data.soldKg)}</strong>
                  </div>
                  {showProfit && (
                    <div className="day-split-row">
                      <span>سود این فروش</span>
                      <strong className="success">
                        {formatToman(data.dayLedger?.soldProfit ?? data.totalProfit ?? 0)}
                      </strong>
                    </div>
                  )}
                  <div className="day-split-row">
                    <span>فاکتور</span>
                    <strong>{data.dayLedger?.soldCount ?? data.salesCount}</strong>
                  </div>
                  {(data.dayLedger?.soldInvoices || []).length > 0 && (
                    <div className="day-ledger-list">
                      {(data.dayLedger?.soldInvoices || []).slice(0, 8).map((inv) => (
                        <div key={inv.invoiceId} className="day-ledger-item">
                          <strong>{inv.customerName}</strong>
                          {' · '}
                          {inv.invoiceNumber}
                          {' · '}
                          {formatToman(inv.totalAmount)}
                          {inv.credit > 0 ? ` · نسیه ${formatToman(inv.credit)}` : ''}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="day-split-card collect">
                  <div className="day-split-title">
                    {kpiPeriod === 'today' ? 'تسویه نسیه این روز' : 'تسویه نسیه این بازه'}
                  </div>
                  <p className="day-split-sub">
                    نسیهٔ قبل که در این تاریخ پاس شده — روی فروش این روز حساب نمی‌شود
                  </p>
                  <div className="day-split-row">
                    <span>وصول نسیهٔ قبلی</span>
                    <strong>
                      {formatToman(data.dayLedger?.priorCreditCollected ?? 0)}
                    </strong>
                  </div>
                  {(data.dayLedger?.sameDayCreditCollected || 0) > 0 && (
                    <div className="day-split-row">
                      <span>نسیه همین‌روز که امروز گرفته شد</span>
                      <strong>{formatToman(data.dayLedger?.sameDayCreditCollected || 0)}</strong>
                    </div>
                  )}
                  {(data.dayLedger?.collections || []).filter((c) => c.isPriorCredit).length === 0 ? (
                    <p className="hint" style={{ margin: '8px 0 0' }}>
                      وصول نسیهٔ قدیمی در این بازه نبوده
                    </p>
                  ) : (
                    <div className="day-ledger-list">
                      {(data.dayLedger?.collections || [])
                        .filter((c) => c.isPriorCredit)
                        .slice(0, 10)
                        .map((c, i) => (
                          <div key={`${c.invoiceId || c.customerName}-${c.date}-${i}`} className="day-ledger-item">
                            <strong>{c.customerName}</strong>
                            {' پرداخت کرد · '}
                            {formatToman(c.amount)}
                            {c.method === 'cash'
                              ? ' نقد'
                              : c.method === 'card_to_card'
                                ? ' کارت‌به‌کارت'
                                : ' پوز'}
                            {c.invoiceNumber ? ` · فاکتور ${c.invoiceNumber}` : ''}
                            {c.invoiceDate ? ` · فاکتور ${formatDate(c.invoiceDate)}` : ''}
                            <div className="ios-caption">{formatDateTime(c.date)}</div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
              <p className="hint" style={{ marginTop: 8 }}>
                فروش هر روز روی تاریخ فاکتور می‌ماند. اگر تاریخ قدیم بزنی همان روز را می‌بینی.
                پولی که از نسیهٔ روزهای قبل امروز بیاید این‌جا جدا نوشته می‌شود.
              </p>

              {showProfit && data.profitAverages && (
                <div className="ios-glass-card" style={{ marginTop: 10 }}>
                  <div className="ios-section-title" style={{ marginTop: 0 }}>
                    میانگین سود فاکتور
                  </div>
                  {(
                    [
                      ['week', 'هفته'],
                      ['month', 'ماه'],
                      ['year', 'سال'],
                      ['all', 'کلی'],
                    ] as const
                  ).map(([key, label]) => {
                    const b = data.profitAverages![key];
                    return (
                      <div key={key} className="stat-row">
                        <span className="stat-label">
                          {label} · {b.avgMarkupPercent.toLocaleString('fa-IR')}٪
                        </span>
                        <span className="stat-value">{formatToman(b.avgProfitPerInvoice)}</span>
                      </div>
                    );
                  })}
                  <p className="hint" style={{ margin: '6px 0 0' }}>
                    عدد سمت راست = میانگین سود هر فاکتور ارسال‌شده
                  </p>
                </div>
              )}

              {showProfit && (
                <div className="ios-glass-card dash-money-summary">
                  <div className="stat-row">
                    <span className="stat-label">سود خالص</span>
                    <span
                      className={`stat-value ${(data.netProfit || 0) >= 0 ? 'success' : 'danger'}`}
                    >
                      {formatToman(data.netProfit || 0)}
                    </span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">هزینه عملیاتی</span>
                    <span className="stat-value danger">{formatToman(data.totalExpenses || 0)}</span>
                  </div>
                  {isAdmin && (
                    <div className="stat-row">
                      <span className="stat-label">بدهی شرکت</span>
                      <span className="stat-value warning">
                        {formatToman(data.companyDebt?.total || 0)}
                      </span>
                    </div>
                  )}
                  <IonButton expand="block" fill="outline" size="small" routerLink="/reports">
                    جزئیات گزارش مالی و فروش
                  </IonButton>
                </div>
              )}
            </>
          )}

          <div className="dash-privacy-bar">
            <IonButton
              size="small"
              className="dash-privacy-btn"
              fill="clear"
              color={showProfit ? 'medium' : 'primary'}
              onClick={() => {
                const next = !showProfit;
                setShowProfit(next);
                try {
                  localStorage.setItem(PROFIT_KEY, next ? '1' : '0');
                } catch {
                  /* ignore */
                }
              }}
            >
              <IonIcon slot="start" icon={showProfit ? eyeOffOutline : eyeOutline} />
              {showProfit ? 'مخفی کردن سود' : 'نمایش سود'}
            </IonButton>
          </div>
        </div>

        <IonModal isOpen={invOpen} onDidDismiss={() => setInvOpen(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>موجودی انبار</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setInvOpen(false)}>
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <div className="inv-modal-hero">
              <div className="inv-modal-kg">{formatKg(inv?.totalKg || 0)}</div>
              <div className="ios-caption">
                {(inv?.totalTons || 0).toLocaleString('fa-IR')} تن ·{' '}
                {(inv?.totalPackages || 0).toLocaleString('fa-IR')} بسته · {inv?.productCount || 0}{' '}
                محصول
              </div>
              {isAdmin && showProfit && (
                <div className="ios-caption" style={{ marginTop: 6 }}>
                  ارزش تقریبی {formatToman(inv?.totalValue || 0)}
                </div>
              )}
            </div>
            {(inv?.products || []).length === 0 && <p className="hint">محصولی در انبار نیست</p>}
            <div className="inv-modal-list">
              {(inv?.products || []).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`inv-modal-row${p.stockKg <= 0 ? ' empty' : p.stockKg < 200 ? ' low' : ''}`}
                  onClick={() => {
                    setInvOpen(false);
                    history.push(`/product-analytics/${p.id}`);
                  }}
                >
                  <div>
                    <strong>{p.name}</strong>
                    <div className="ios-caption">
                      {p.packages.toLocaleString('fa-IR')} بسته
                      {p.stockKg < 200 && p.stockKg > 0 ? ' · کم‌موجود' : ''}
                      {p.stockKg <= 0 ? ' · تمام‌شده' : ''}
                    </div>
                  </div>
                  <span className="stat-value">{formatKg(p.stockKg)}</span>
                </button>
              ))}
            </div>
            {isAdmin && (
              <IonButton
                expand="block"
                className="ios-primary-btn ion-margin-top"
                routerLink="/purchase"
                onClick={() => setInvOpen(false)}
              >
                ثبت خرید انبار
              </IonButton>
            )}
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
};

export default Dashboard;
