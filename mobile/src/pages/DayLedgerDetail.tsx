import { useCallback, useMemo, useState } from 'react';
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
  IonSegment,
  IonSegmentButton,
  IonLabel,
  useIonViewWillEnter,
  RefresherEventDetail,
} from '@ionic/react';
import { useLocation } from 'react-router-dom';
import { wsClient } from '../api/ws';
import { formatKg, formatToman, formatDate, formatDateTime, todayIso } from '../utils/format';

type Period = 'today' | 'week' | 'month';

type DayLedger = {
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

function qs(search: string) {
  const p = new URLSearchParams(search);
  const period = (p.get('period') as Period) || 'today';
  const date = p.get('date') || todayIso();
  const tab = (p.get('tab') as 'sold' | 'collect') || 'sold';
  return {
    period: period === 'week' || period === 'month' ? period : ('today' as Period),
    date,
    tab: tab === 'collect' ? ('collect' as const) : ('sold' as const),
  };
}

const DayLedgerDetail: React.FC = () => {
  const location = useLocation();
  const initial = useMemo(() => qs(location.search), [location.search]);
  const [period] = useState<Period>(initial.period);
  const [date] = useState(initial.date);
  const [tab, setTab] = useState<'sold' | 'collect'>(initial.tab);
  const [ledger, setLedger] = useState<DayLedger | null>(null);
  const [periodLabel, setPeriodLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await wsClient.request<{
        dayLedger?: DayLedger;
        periodLabel?: string;
      }>('dashboard.get', { period, date });
      setLedger(d.dayLedger || null);
      setPeriodLabel(d.periodLabel || '');
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا');
      setLedger(null);
    } finally {
      setLoading(false);
    }
  }, [period, date]);

  useIonViewWillEnter(() => {
    void load();
  });

  const onRefresh = async (ev: CustomEvent<RefresherEventDetail>) => {
    await load();
    ev.detail.complete();
  };

  const title =
    period === 'today'
      ? `جزئیات ${formatDate(date + 'T12:00:00')}`
      : period === 'week'
        ? 'جزئیات ۷ روز'
        : 'جزئیات این ماه';

  const priorCollections = (ledger?.collections || []).filter((c) => c.isPriorCredit);
  const soldInvoices = ledger?.soldInvoices || [];

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/dashboard" text="خانه" />
          </IonButtons>
          <IonTitle>{title}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="page-content ios-content">
        <IonRefresher slot="fixed" onIonRefresh={onRefresh}>
          <IonRefresherContent />
        </IonRefresher>
        <div className="ion-padding compact">
          <p className="hint" style={{ marginTop: 0 }}>
            {period === 'today'
              ? formatDate(date + 'T12:00:00')
              : periodLabel || 'بازه انتخاب‌شده'}
            {' · '}
            فروش روی تاریخ فاکتور · وصول نسیهٔ قبلی جدا
          </p>

          <IonSegment
            value={tab}
            className="ios-segment"
            onIonChange={(e) => setTab((e.detail.value as 'sold' | 'collect') || 'sold')}
          >
            <IonSegmentButton value="sold">
              <IonLabel>فاکتورهای فروش</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="collect">
              <IonLabel>تسویه نسیه</IonLabel>
            </IonSegmentButton>
          </IonSegment>

          {loading && !ledger ? (
            <div className="center-pad">
              <IonSpinner />
            </div>
          ) : error ? (
            <p className="hint danger">{error}</p>
          ) : tab === 'sold' ? (
            <>
              <div className="ios-glass-card" style={{ marginTop: 10 }}>
                <div className="stat-row">
                  <span>مبلغ فروخته‌شده</span>
                  <strong>{formatToman(ledger?.soldGross || 0)}</strong>
                </div>
                <div className="stat-row">
                  <span>نقد / پوز</span>
                  <strong>{formatToman(ledger?.soldPaid || 0)}</strong>
                </div>
                <div className="stat-row">
                  <span>نسیه همین فاکتورها</span>
                  <strong>{formatToman(ledger?.soldCredit || 0)}</strong>
                </div>
                <div className="stat-row">
                  <span>تناژ · تعداد</span>
                  <strong>
                    {formatKg(ledger?.soldKg || 0)} · {(ledger?.soldCount || 0).toLocaleString('fa-IR')}
                  </strong>
                </div>
              </div>

              {soldInvoices.length === 0 ? (
                <p className="hint">فاکتوری در این بازه نیست</p>
              ) : (
                soldInvoices.map((inv) => (
                  <div key={inv.invoiceId} className="ios-glass-card" style={{ marginTop: 8 }}>
                    <div className="ios-row">
                      <div>
                        <strong>{inv.customerName}</strong>
                        <div className="ios-caption">
                          {inv.invoiceNumber}
                          {inv.date ? ` · ${formatDate(inv.date)}` : ''}
                        </div>
                      </div>
                      <strong>{formatToman(inv.totalAmount)}</strong>
                    </div>
                    <div className="ios-caption" style={{ marginTop: 4 }}>
                      {formatKg(inv.totalKg)}
                      {inv.paid > 0 ? ` · پرداخت‌شده ${formatToman(inv.paid)}` : ''}
                      {inv.credit > 0 ? ` · نسیه ${formatToman(inv.credit)}` : ''}
                    </div>
                  </div>
                ))
              )}
            </>
          ) : (
            <>
              <div className="ios-glass-card" style={{ marginTop: 10 }}>
                <div className="stat-row">
                  <span>وصول نسیهٔ قبلی</span>
                  <strong>{formatToman(ledger?.priorCreditCollected || 0)}</strong>
                </div>
                {(ledger?.sameDayCreditCollected || 0) > 0 && (
                  <div className="stat-row">
                    <span>نسیه همین‌روز که گرفته شد</span>
                    <strong>{formatToman(ledger?.sameDayCreditCollected || 0)}</strong>
                  </div>
                )}
              </div>

              {priorCollections.length === 0 ? (
                <p className="hint">وصول نسیهٔ قدیمی در این بازه نبوده</p>
              ) : (
                priorCollections.map((c, i) => (
                  <div
                    key={`${c.invoiceId || c.customerName}-${c.date}-${i}`}
                    className="ios-glass-card"
                    style={{ marginTop: 8 }}
                  >
                    <div className="ios-row">
                      <div>
                        <strong>{c.customerName}</strong>
                        <div className="ios-caption">
                          {c.method === 'cash'
                            ? 'نقد'
                            : c.method === 'card_to_card'
                              ? 'کارت‌به‌کارت'
                              : 'پوز'}
                          {c.invoiceNumber ? ` · ${c.invoiceNumber}` : ''}
                          {c.invoiceDate ? ` · فاکتور ${formatDate(c.invoiceDate)}` : ''}
                        </div>
                        <div className="ios-caption">{formatDateTime(c.date)}</div>
                      </div>
                      <strong>{formatToman(c.amount)}</strong>
                    </div>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default DayLedgerDetail;
