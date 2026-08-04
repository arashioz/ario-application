import { useCallback, useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonBackButton,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  IonButton,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  useIonViewWillEnter,
  RefresherEventDetail,
} from '@ionic/react';
import { useParams, useHistory } from 'react-router-dom';
import { wsClient } from '../api/ws';
import { formatKg, formatToman, formatDate } from '../utils/format';
import { useAuth } from '../auth/AuthContext';

type PeriodKey = 'overall' | 'today' | 'month' | 'year';

interface AnalyticsPayload {
  product: {
    id: string;
    name: string;
    stockKg: number;
    packages: number;
    kgPerPackage: number;
    avgCostPerKg: number;
    lastPurchasePricePerKg: number;
    imageUrl?: string;
    categoryName: string;
    profitRetail?: number;
    profitSupermarket?: number;
    profitWholesale?: number;
  };
  overall: {
    soldKg: number;
    soldPackages: number;
    revenue: number;
    cost: number;
    profit: number;
    marginPercent: number;
    discount: number;
    invoiceCount: number;
    lineCount: number;
    avgPricePerKg: number;
    avgProfitPerKg: number;
  };
  periods: {
    today: { soldKg: number; revenue: number; profit: number; invoiceCount: number };
    month: { soldKg: number; revenue: number; profit: number; invoiceCount: number };
    year: { soldKg: number; revenue: number; profit: number; invoiceCount: number };
  };
  byTier: Array<{ tier: string; soldKg: number; revenue: number; profit: number }>;
  monthlyTrend: Array<{ year: number; month: number; soldKg: number; revenue: number; profit: number }>;
  topCustomers: Array<{
    customerId: string | null;
    name: string;
    soldKg: number;
    revenue: number;
    profit: number;
    times: number;
    lastDate: string;
  }>;
  recent: Array<{
    invoiceId: string;
    invoiceNumber: string;
    date: string;
    customerName: string;
    isGolden: boolean;
    qtyKg: number;
    qtyPackages: number;
    revenue: number;
    profit: number;
    unitPricePerKg: number;
    priceTier?: string;
  }>;
}

const TIER_FA: Record<string, string> = {
  retail: 'تکی',
  supermarket: 'سوپر',
  wholesale: 'عمده',
};

const ProductAnalytics: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const history = useHistory();
  const { isAdmin } = useAuth();
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState<PeriodKey>('overall');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const res = await wsClient.request<AnalyticsPayload>('product.analytics', { id });
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در بارگذاری');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useIonViewWillEnter(() => {
    void load();
  });

  const stats =
    period === 'overall'
      ? data?.overall
      : data?.periods?.[period as 'today' | 'month' | 'year'];

  const maxTrend = Math.max(1, ...(data?.monthlyTrend || []).map((t) => t.revenue));

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/dashboard" text="بازگشت" />
          </IonButtons>
          <IonTitle>{data?.product.name || 'آنالیز محصول'}</IonTitle>
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

        <div className="ion-padding compact pa-page">
          {loading && !data && (
            <div className="ion-text-center ion-padding">
              <IonSpinner name="crescent" />
            </div>
          )}
          {error && <p className="hint danger-text">{error}</p>}

          {data && (
            <>
              <div className="pa-hero ios-glass-card">
                <div className="pa-hero-top">
                  <div>
                    <div className="ios-caption">{data.product.categoryName}</div>
                    <h2 className="pa-title">{data.product.name}</h2>
                    <div className="pa-stock">
                      موجودی: <strong>{formatKg(data.product.stockKg)}</strong>
                      {data.product.packages > 0 && (
                        <span> · {data.product.packages.toLocaleString('fa-IR')} بسته</span>
                      )}
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="pa-cost">
                      <div className="ios-caption">میانگین هزینه</div>
                      <strong>{formatToman(data.product.avgCostPerKg)}/کیلو</strong>
                    </div>
                  )}
                </div>
                <div className="chip-row" style={{ marginTop: 10 }}>
                  <IonButton size="small" routerLink="/sale" className="ios-primary-btn">
                    فروش این محصول
                  </IonButton>
                  {isAdmin && (
                    <IonButton size="small" fill="outline" routerLink="/catalog-admin">
                      ویرایش کاتالوگ
                    </IonButton>
                  )}
                </div>
              </div>

              <IonSegment
                value={period}
                onIonChange={(e) => setPeriod((e.detail.value as PeriodKey) || 'overall')}
                className="pa-segment"
              >
                <IonSegmentButton value="overall">
                  <IonLabel>کل</IonLabel>
                </IonSegmentButton>
                <IonSegmentButton value="today">
                  <IonLabel>امروز</IonLabel>
                </IonSegmentButton>
                <IonSegmentButton value="month">
                  <IonLabel>ماه</IonLabel>
                </IonSegmentButton>
                <IonSegmentButton value="year">
                  <IonLabel>سال</IonLabel>
                </IonSegmentButton>
              </IonSegment>

              <div className="ios-section-title">آنالیز فروش</div>
              <div className="ios-kpi-grid">
                <div className="ios-kpi blue">
                  <div className="k-label">فروش (مبلغ)</div>
                  <div className="k-value">{formatToman(stats?.revenue || 0)}</div>
                </div>
                <div className="ios-kpi green">
                  <div className="k-label">سود</div>
                  <div className="k-value">{formatToman(stats?.profit || 0)}</div>
                </div>
                <div className="ios-kpi orange">
                  <div className="k-label">مقدار فروخته</div>
                  <div className="k-value">{formatKg(stats?.soldKg || 0)}</div>
                </div>
                <div className="ios-kpi gray">
                  <div className="k-label">تعداد فاکتور</div>
                  <div className="k-value">
                    {(stats && 'invoiceCount' in stats
                      ? stats.invoiceCount
                      : data.overall.invoiceCount
                    ).toLocaleString('fa-IR')}
                  </div>
                </div>
              </div>

              {period === 'overall' && (
                <>
                  <div className="ios-glass-card pa-detail">
                    <div className="ios-section-title" style={{ marginTop: 0 }}>
                      شاخص‌های تخصصی
                    </div>
                    <div className="pa-row">
                      <span>حاشیه سود</span>
                      <strong className="stat-value success">{data.overall.marginPercent}٪</strong>
                    </div>
                    <div className="pa-row">
                      <span>میانگین قیمت فروش / کیلو</span>
                      <strong>{formatToman(data.overall.avgPricePerKg)}</strong>
                    </div>
                    <div className="pa-row">
                      <span>میانگین سود / کیلو</span>
                      <strong className="stat-value success">
                        {formatToman(data.overall.avgProfitPerKg)}
                      </strong>
                    </div>
                    {isAdmin && (
                      <div className="pa-row">
                        <span>هزینه کل فروش‌رفته</span>
                        <strong>{formatToman(data.overall.cost)}</strong>
                      </div>
                    )}
                    <div className="pa-row">
                      <span>تخفیف اقلام</span>
                      <strong>{formatToman(data.overall.discount)}</strong>
                    </div>
                    <div className="pa-row">
                      <span>بسته فروخته‌شده</span>
                      <strong>{data.overall.soldPackages.toLocaleString('fa-IR')}</strong>
                    </div>
                    {(data.product.profitRetail != null ||
                      data.product.profitSupermarket != null ||
                      data.product.profitWholesale != null) && (
                      <div className="pa-row">
                        <span>٪ سود تعریف‌شده</span>
                        <strong>
                          تکی {data.product.profitRetail ?? '—'} · سوپر{' '}
                          {data.product.profitSupermarket ?? '—'} · عمده{' '}
                          {data.product.profitWholesale ?? '—'}
                        </strong>
                      </div>
                    )}
                  </div>

                  {data.byTier.length > 0 && (
                    <>
                      <div className="ios-section-title">بر اساس سطح قیمت</div>
                      <div className="ios-glass-card">
                        {data.byTier.map((t) => (
                          <div key={String(t.tier)} className="pa-row">
                            <span>{TIER_FA[t.tier] || t.tier}</span>
                            <strong>
                              {formatKg(t.soldKg)} · {formatToman(t.revenue)}
                              <span className="stat-value success"> · سود {formatToman(t.profit)}</span>
                            </strong>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {data.monthlyTrend.length > 0 && (
                    <>
                      <div className="ios-section-title">روند ۶ ماه اخیر</div>
                      <div className="ios-glass-card pa-trend">
                        {data.monthlyTrend.map((t) => (
                          <div key={`${t.year}-${t.month}`} className="pa-trend-row">
                            <span className="pa-trend-label">
                              {t.month}/{String(t.year).slice(2)}
                            </span>
                            <div className="pa-trend-bar-wrap">
                              <div
                                className="pa-trend-bar"
                                style={{ width: `${Math.max(6, (t.revenue / maxTrend) * 100)}%` }}
                              />
                            </div>
                            <span className="pa-trend-val">{formatToman(t.revenue)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  <div className="ios-section-title">برترین مشتریان این محصول</div>
                  {data.topCustomers.length === 0 && (
                    <p className="hint">هنوز فروشی ثبت نشده</p>
                  )}
                  {data.topCustomers.map((c, i) => (
                    <div key={`${c.customerId || c.name}-${i}`} className="ios-glass-card pa-cust">
                      <div className="ios-row">
                        <div>
                          <strong>
                            {i + 1}. {c.name}
                          </strong>
                          <div className="ios-caption">
                            {c.times.toLocaleString('fa-IR')} بار · آخرین{' '}
                            {c.lastDate ? formatDate(c.lastDate) : '—'}
                          </div>
                        </div>
                        <div className="pa-cust-nums">
                          <div>{formatToman(c.revenue)}</div>
                          <div className="stat-value success">{formatToman(c.profit)} سود</div>
                          <div className="ios-caption">{formatKg(c.soldKg)}</div>
                        </div>
                      </div>
                    </div>
                  ))}

                  <div className="ios-section-title">آخرین فروش‌ها</div>
                  {data.recent.length === 0 && <p className="hint">موردی نیست</p>}
                  {data.recent.map((r) => (
                    <button
                      key={`${r.invoiceId}-${r.date}`}
                      type="button"
                      className={`ios-glass-card pa-recent${r.isGolden ? ' golden-card' : ''}`}
                      onClick={() => history.push('/invoices')}
                    >
                      <div className="ios-row">
                        <div>
                          <strong>
                            {r.isGolden ? '⭐ ' : ''}
                            {r.invoiceNumber}
                          </strong>
                          <div className="ios-caption">
                            {r.customerName} · {formatDate(r.date)}
                            {r.priceTier ? ` · ${TIER_FA[r.priceTier] || r.priceTier}` : ''}
                          </div>
                        </div>
                        <div className="pa-cust-nums">
                          <div>{formatKg(r.qtyKg)}</div>
                          <div>{formatToman(r.revenue)}</div>
                          <div className="stat-value success">{formatToman(r.profit)}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default ProductAnalytics;
