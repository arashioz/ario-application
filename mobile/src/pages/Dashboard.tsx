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
import { formatKg, formatToman } from '../utils/format';
import { useHistory } from 'react-router-dom';

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
    async (period: 'today' | 'week' | 'month' = kpiPeriod) => {
      try {
        const d = await wsClient.request<Dash>('dashboard.get', { period });
        setData(d);
        setError('');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'خطا');
      }
    },
    [kpiPeriod]
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

              <div className="ios-section-title">خلاصه — {data.periodLabel || 'امروز'}</div>
              <div className="chip-row" style={{ marginBottom: 8 }}>
                <IonChip
                  className={kpiPeriod === 'today' ? 'ios-chip-active' : 'ios-chip'}
                  onClick={() => setPeriod('today')}
                >
                  امروز
                </IonChip>
                <IonChip
                  className={kpiPeriod === 'week' ? 'ios-chip-active' : 'ios-chip'}
                  onClick={() => setPeriod('week')}
                >
                  ۷ روز
                </IonChip>
                <IonChip
                  className={kpiPeriod === 'month' ? 'ios-chip-active' : 'ios-chip'}
                  onClick={() => setPeriod('month')}
                >
                  این ماه
                </IonChip>
              </div>
              <div className="ios-kpi-grid">
                <div className="ios-kpi blue">
                  <div className="k-label">فروش</div>
                  <div className="k-value">{formatToman(data.totalSales)}</div>
                  {(data.creditSales || 0) > 0 && (
                    <div className="ios-caption" style={{ marginTop: 4 }}>
                      نسیه باز جدا: {formatToman(Number(data.creditSales || 0))}
                    </div>
                  )}
                </div>
                <div className="ios-kpi orange">
                  <div className="k-label">تناژ</div>
                  <div className="k-value">{formatKg(data.soldKg)}</div>
                </div>
                {showProfit ? (
                  <div className="ios-kpi green">
                    <div className="k-label">سود فروش</div>
                    <div className="k-value">{formatToman(data.totalProfit || 0)}</div>
                  </div>
                ) : (
                  <div className="ios-kpi green dash-kpi-locked">
                    <div className="k-label">سود فروش</div>
                    <div className="k-value">••••</div>
                  </div>
                )}
                <div className="ios-kpi gray">
                  <div className="k-label">فاکتور</div>
                  <div className="k-value">{data.salesCount}</div>
                </div>
              </div>

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
