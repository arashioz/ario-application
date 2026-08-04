import { useCallback, useState } from 'react';
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
  navigateOutline,
  personOutline,
  chatbubbleEllipsesOutline,
  cubeOutline,
  alertCircleOutline,
  checkmarkDoneOutline,
  bicycleOutline,
} from 'ionicons/icons';
import { wsClient } from '../api/ws';
import { useAuth } from '../auth/AuthContext';
import { formatKg, formatToman, formatRial, formatDate } from '../utils/format';
import { useHistory } from 'react-router-dom';

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
  netProfit: number;
  totalExpenses: number;
  cashBalance: number;
  cardBalance: number;
  salesCount: number;
  cashSales?: number;
  cardSales?: number;
  creditSales?: number;
  pendingApprovals?: number;
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
  month?: {
    totalSales: number;
    soldKg: number;
    totalProfit: number;
    salesCount: number;
  };
  companyDebt?: { total: number; count: number };
  checks?: {
    pendingCount: number;
    overdueCount: number;
    overdue: Array<{
      id: string;
      payerName: string;
      amount: number;
      invoiceNumber?: string;
      dueDate: string;
      followUpDate: string;
    }>;
    upcoming: Array<{
      id: string;
      payerName: string;
      amount: number;
      invoiceNumber?: string;
      dueDate: string;
      followUpDate: string;
    }>;
  };
  shipping?: {
    count: number;
    ready: Array<{
      id: string;
      invoiceNumber: string;
      customerName?: string;
      customerAddress?: string;
      totalKg: number;
      totalAmount: number;
      date: string;
    }>;
  };
  crm?: {
    followUpSameDayLastMonth: Array<{
      customerId: string;
      name: string;
      phone?: string;
      lastAmount: number;
      lastKg?: number;
      lastDate: string;
      suggestedDiscount?: number;
      suggestReason?: string;
      preferredTier?: string;
    }>;
    followUpDue?: Array<{
      customerId: string;
      name: string;
      phone?: string;
      lastAmount: number;
      lastKg?: number;
      lastDate: string;
      suggestedDiscount?: number;
      suggestReason?: string;
      preferredTier?: string;
      daysSince?: number;
    }>;
  };
  debtors: {
    total: number;
    count: number;
    overdue: Array<{ name: string; remaining: number; dueDate: string; phone?: string }>;
  };
}

const Dashboard: React.FC = () => {
  const { user, isAdmin, logout, online, queueLen } = useAuth();
  const history = useHistory();
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await wsClient.request<Dash>('dashboard.get', {});
      setData(d);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا');
    }
  }, []);

  useIonViewWillEnter(() => {
    void load();
  });

  const onRefresh = async (ev: CustomEvent<RefresherEventDetail>) => {
    await load();
    ev.detail.complete();
  };

  const quick = [
    { href: '/sale', icon: receiptOutline, label: 'فروش', color: 'qa-teal' },
    ...(isAdmin
      ? [{ href: '/purchase', icon: cartOutline, label: 'خرید', color: 'qa-amber' }]
      : []),
    { href: '/orders', icon: fileTrayFullOutline, label: 'سفارش‌ها', color: 'qa-blue' },
    { href: '/customers', icon: personOutline, label: 'مشتری', color: 'qa-indigo' },
    { href: '/debtors', icon: peopleOutline, label: 'نسیه', color: 'qa-rose' },
    ...(isAdmin
      ? [
          { href: '/expense', icon: walletOutline, label: 'هزینه', color: 'qa-slate' },
          { href: '/drivers-map', icon: navigateOutline, label: 'نقشه', color: 'qa-cyan' },
          { href: '/checks', icon: documentTextOutline, label: 'چک', color: 'qa-violet' },
        ]
      : [
          { href: '/checks', icon: documentTextOutline, label: 'چک', color: 'qa-violet' },
          { href: '/chat', icon: chatbubbleEllipsesOutline, label: 'چت', color: 'qa-cyan' },
        ]),
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
              {/* انبار قند */}
              <div className="warehouse-hero">
                <div className="wh-top">
                  <div>
                    <div className="wh-eyebrow">
                      <IonIcon icon={cubeOutline} /> موجودی انبار
                    </div>
                    <div className="wh-kg">{formatKg(inv?.totalKg || 0)}</div>
                    <div className="wh-sub">
                      {inv?.totalTons != null ? `${inv.totalTons.toLocaleString('fa-IR')} تن` : '—'} · حدود{' '}
                      {(inv?.totalPackages || 0).toLocaleString('fa-IR')} بسته
                    </div>
                  </div>
                  <div className="wh-side">
                    <div className="wh-pill">{inv?.productCount || 0} محصول</div>
                    {(inv?.emptyCount || 0) > 0 && (
                      <div className="wh-pill danger">{inv?.emptyCount} تمام‌شده</div>
                    )}
                    {isAdmin && (
                      <div className="wh-value">ارزش ≈ {formatToman(inv?.totalValue || 0)}</div>
                    )}
                  </div>
                </div>
                {(inv?.products || []).length > 0 && (
                  <div className="wh-products">
                    {(inv?.products || []).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`wh-prod${p.stockKg <= 0 ? ' empty' : p.stockKg < 200 ? ' low' : ''}`}
                        onClick={() => history.push(`/product-analytics/${p.id}`)}
                      >
                        <span className="wh-prod-name">{p.name}</span>
                        <span className="wh-prod-kg">{formatKg(p.stockKg)}</span>
                      </button>
                    ))}
                  </div>
                )}
                {(inv?.lowStock || []).length > 0 && (
                  <div className="wh-low">
                    <IonIcon icon={alertCircleOutline} />
                    کم‌موجود:{' '}
                    {(inv?.lowStock || [])
                      .slice(0, 3)
                      .map((p) => `${p.name} (${formatKg(p.stockKg)})`)
                      .join(' · ')}
                  </div>
                )}
                {isAdmin && (
                  <IonButton size="small" fill="clear" routerLink="/purchase" className="wh-cta">
                    ثبت خرید انبار
                  </IonButton>
                )}
              </div>

              {/* دسترسی سریع */}
              <div className="ios-section-title">دسترسی سریع</div>
              <div className="quick-grid">
                {quick.map((q) => (
                  <IonButton key={q.href} routerLink={q.href} fill="clear" className={`quick-tile ${q.color}`}>
                    <div className="qt-inner">
                      <IonIcon icon={q.icon} />
                      <span>{q.label}</span>
                    </div>
                  </IonButton>
                ))}
              </div>

              {/* اکشن‌های فوری */}
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

              <div className="ios-section-title">امروز</div>
              <div className="ios-kpi-grid">
                <div className="ios-kpi blue">
                  <div className="k-label">فروش</div>
                  <div className="k-value">{formatToman(data.totalSales)}</div>
                </div>
                <div className="ios-kpi orange">
                  <div className="k-label">تناژ فروخته</div>
                  <div className="k-value">{formatKg(data.soldKg)}</div>
                </div>
                <div className="ios-kpi green">
                  <div className="k-label">سود خالص</div>
                  <div className={`k-value${(data.netProfit || 0) < 0 ? ' warning' : ''}`}>
                    {formatToman(data.netProfit || 0)}
                  </div>
                </div>
                <div className="ios-kpi gray">
                  <div className="k-label">فاکتور</div>
                  <div className="k-value">{data.salesCount}</div>
                </div>
              </div>

              {(data.cashSales != null || data.cardSales != null || data.creditSales != null) && (
                <div className="ios-glass-card">
                  <div className="ios-section-title" style={{ marginTop: 0 }}>
                    ترکیب پرداخت امروز
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">نقد</span>
                    <span className="stat-value">{formatToman(data.cashSales || 0)}</span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">کارت / پوز</span>
                    <span className="stat-value">{formatToman(data.cardSales || 0)}</span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">نسیه</span>
                    <span className="stat-value warning">{formatToman(data.creditSales || 0)}</span>
                  </div>
                </div>
              )}

              <div className="ios-section-title">بارهای آماده ارسال</div>
              <div className="ios-glass-card">
                {(data.shipping?.ready || []).length === 0 && <p className="hint">باری در صف ارسال نیست</p>}
                {(data.shipping?.ready || []).slice(0, 5).map((s) => (
                  <div key={s.id} className="day-row">
                    <strong>{s.invoiceNumber}</strong> · {s.customerName || '—'} · {formatKg(s.totalKg)} ·{' '}
                    {formatToman(s.totalAmount)}
                    {s.customerAddress ? (
                      <>
                        <br />
                        <span className="ios-caption">📍 {s.customerAddress}</span>
                      </>
                    ) : null}
                  </div>
                ))}
                {(data.shipping?.count || 0) > 0 && (
                  <IonButton size="small" fill="outline" routerLink="/orders" expand="block">
                    مدیریت ارسال
                  </IonButton>
                )}
              </div>

              <div className="ios-section-title">بدهکاران فوری</div>
              <div className="ios-glass-card">
                {data.debtors.overdue.length === 0 && <p className="hint">معوقه‌ای نیست</p>}
                {data.debtors.overdue.slice(0, 5).map((d, i) => (
                  <div key={i} className="stat-row">
                    <span className="overdue-badge">
                      {d.name} · {formatDate(d.dueDate)}
                    </span>
                    <span className="stat-value danger">{formatRial(d.remaining)}</span>
                  </div>
                ))}
                <div className="stat-row">
                  <span className="stat-label">جمع بدهی باز</span>
                  <span className="stat-value danger">{formatRial(data.debtors.total)}</span>
                </div>
              </div>

              <div className="ios-section-title">پیگیری مشتری</div>
              <div className="ios-glass-card">
                {(() => {
                  const same = data.crm?.followUpSameDayLastMonth || [];
                  const due = data.crm?.followUpDue || [];
                  const list = [
                    ...same.map((c) => ({ ...c, tag: 'همین روز ماه قبل' })),
                    ...due.map((c) => ({
                      ...c,
                      tag: c.daysSince ? `${c.daysSince} روز گذشته` : 'موعد فالوآپ',
                    })),
                  ];
                  if (!list.length) {
                    return <p className="hint">امروز فالوآپی نیست</p>;
                  }
                  return list.slice(0, 8).map((c) => (
                    <div key={`${c.customerId}-${c.tag}`} className="follow-card">
                      <div className="ios-row">
                        <strong>{c.name}</strong>
                        <span className="ios-caption">{c.phone || ''}</span>
                      </div>
                      <div className="ios-caption">{c.tag}</div>
                      <div className="ios-caption">
                        خرید قبلی {formatToman(c.lastAmount)}
                        {c.lastKg != null ? ` · ${formatKg(c.lastKg)}` : ''} · {formatDate(c.lastDate)}
                      </div>
                      <p className="hint convert-hint">
                        {c.suggestReason || 'پیشنهاد'} · تخفیف {formatToman(c.suggestedDiscount || 0)}
                      </p>
                      <IonButton
                        size="small"
                        onClick={() =>
                          history.push('/sale', {
                            followUpCustomerId: c.customerId,
                            followUpDiscount: c.suggestedDiscount || 0,
                            followUpTier: c.preferredTier,
                          })
                        }
                      >
                        فاکتور پیشنهادی
                      </IonButton>
                    </div>
                  ));
                })()}
              </div>

              {data.month && (
                <div className="ios-glass-card">
                  <div className="ios-section-title" style={{ marginTop: 0 }}>
                    این ماه
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">فروش</span>
                    <span className="stat-value">{formatToman(data.month.totalSales)}</span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">تناژ</span>
                    <span className="stat-value">{formatKg(data.month.soldKg)}</span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">سود</span>
                    <span className="stat-value success">{formatToman(data.month.totalProfit)}</span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">تعداد فاکتور</span>
                    <span className="stat-value">{data.month.salesCount}</span>
                  </div>
                </div>
              )}

              {isAdmin && (
                <div className="ios-glass-card">
                  <div className="ios-section-title" style={{ marginTop: 0 }}>
                    صندوق و شرکت
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">نقد</span>
                    <span className="stat-value">{formatRial(data.cashBalance)}</span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">کارت</span>
                    <span className="stat-value">{formatRial(data.cardBalance)}</span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">بدهی شرکت</span>
                    <span className="stat-value danger">{formatRial(data.companyDebt?.total || 0)}</span>
                  </div>
                </div>
              )}

              {data.checks && (data.checks.overdueCount > 0 || (data.checks.upcoming?.length || 0) > 0) && (
                <div className="ios-glass-card">
                  <div className="ios-section-title" style={{ marginTop: 0 }}>
                    چک‌ها
                  </div>
                  {(data.checks.overdue || [])
                    .concat(data.checks.upcoming || [])
                    .slice(0, 4)
                    .map((c) => (
                      <div key={c.id} className="day-row">
                        {c.payerName}
                        {c.invoiceNumber ? ` · ${c.invoiceNumber}` : ''} · {formatToman(c.amount)} ·{' '}
                        {formatDate(c.followUpDate)}
                      </div>
                    ))}
                </div>
              )}
            </>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Dashboard;
