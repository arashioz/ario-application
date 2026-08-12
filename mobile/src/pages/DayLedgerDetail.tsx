import { useCallback, useMemo, useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonBackButton,
  IonButton,
  IonModal,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonToast,
  useIonViewWillEnter,
  RefresherEventDetail,
} from '@ionic/react';
import { useLocation } from 'react-router-dom';
import { wsClient } from '../api/ws';
import { formatKg, formatToman, formatDate, todayIso } from '../utils/format';
import { SaleInvoiceDetailBody, SaleDetailInv } from '../components/SaleInvoiceDetailBody';

type Period = 'today' | 'week' | 'month';
type Tab = 'paid' | 'credit';

type SoldInv = {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  totalAmount: number;
  totalKg: number;
  paid: number;
  credit: number;
  date: string;
};

type DashPayload = {
  periodLabel?: string;
  shippedSplit?: {
    paid: { sales: number; profit: number; kg: number; invoiceCount: number };
    credit: { sales: number; profit: number; kg: number; invoiceCount: number };
  };
  dayLedger?: {
    soldPaid: number;
    soldCredit: number;
    soldInvoices: SoldInv[];
  };
};

function qs(search: string) {
  const p = new URLSearchParams(search);
  const period = (p.get('period') as Period) || 'today';
  const date = p.get('date') || todayIso();
  const rawTab = p.get('tab') || 'paid';
  const tab: Tab = rawTab === 'credit' || rawTab === 'collect' ? 'credit' : 'paid';
  return {
    period: period === 'week' || period === 'month' ? period : ('today' as Period),
    date,
    tab,
  };
}

const DayLedgerDetail: React.FC = () => {
  const location = useLocation();
  const initial = useMemo(() => qs(location.search), [location.search]);
  const [period] = useState<Period>(initial.period);
  const [date] = useState(initial.date);
  const [tab, setTab] = useState<Tab>(initial.tab);
  const [data, setData] = useState<DashPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<SaleDetailInv | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await wsClient.request<DashPayload>('dashboard.get', { period, date });
      setData(d);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا');
      setData(null);
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

  const openInvoice = async (invoiceId: string) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const inv = await wsClient.request<SaleDetailInv & { _id?: string }>('sale.get', {
        id: invoiceId,
      });
      setDetail(inv);
    } catch (e) {
      setToast({
        open: true,
        msg: e instanceof Error ? e.message : 'فاکتور لود نشد',
        color: 'danger',
      });
    } finally {
      setDetailLoading(false);
    }
  };

  const title =
    period === 'today'
      ? `فاکتورها · ${formatDate(date + 'T12:00:00')}`
      : period === 'week'
        ? 'فاکتورها · ۷ روز'
        : 'فاکتورها · این ماه';

  const all = data?.dayLedger?.soldInvoices || [];
  const paidList = all.filter((inv) => (inv.paid || 0) > 0);
  const creditList = all.filter((inv) => (inv.credit || 0) > 0);
  const list = tab === 'paid' ? paidList : creditList;
  const split = tab === 'paid' ? data?.shippedSplit?.paid : data?.shippedSplit?.credit;

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
              : data?.periodLabel || 'بازه انتخاب‌شده'}
            {' · '}
            روی فاکتور بزن تا جزئیات باز شود
          </p>

          <IonSegment
            value={tab}
            className="ios-segment"
            onIonChange={(e) => setTab((e.detail.value as Tab) || 'paid')}
          >
            <IonSegmentButton value="paid">
              <IonLabel>پرداخت‌شده</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="credit">
              <IonLabel>نسیه ارسال‌شده</IonLabel>
            </IonSegmentButton>
          </IonSegment>

          {loading && !data ? (
            <div className="center-pad">
              <IonSpinner />
            </div>
          ) : error ? (
            <p className="hint danger">{error}</p>
          ) : (
            <>
              <div className="ios-glass-card" style={{ marginTop: 10 }}>
                <div className="stat-row">
                  <span>{tab === 'paid' ? 'فروش پرداخت‌شده' : 'نسیه ارسال‌شده'}</span>
                  <strong>
                    {formatToman(
                      split?.sales ??
                        (tab === 'paid'
                          ? data?.dayLedger?.soldPaid || 0
                          : data?.dayLedger?.soldCredit || 0)
                    )}
                  </strong>
                </div>
                <div className="stat-row">
                  <span>تناژ</span>
                  <strong>{formatKg(split?.kg || 0)}</strong>
                </div>
                <div className="stat-row">
                  <span>تعداد فاکتور</span>
                  <strong>{(split?.invoiceCount ?? list.length).toLocaleString('fa-IR')}</strong>
                </div>
              </div>

              {list.length === 0 ? (
                <p className="hint">
                  {tab === 'paid' ? 'فاکتور پرداخت‌شده‌ای نیست' : 'فاکتور نسیه ارسال‌شده‌ای نیست'}
                </p>
              ) : (
                list.map((inv) => (
                  <button
                    key={inv.invoiceId}
                    type="button"
                    className="ios-glass-card tap"
                    style={{
                      marginTop: 8,
                      width: '100%',
                      textAlign: 'right',
                      border: 'none',
                      cursor: 'pointer',
                      font: 'inherit',
                      color: 'inherit',
                    }}
                    onClick={() => void openInvoice(inv.invoiceId)}
                  >
                    <div className="ios-row">
                      <div>
                        <strong>{inv.customerName}</strong>
                        <div className="ios-caption">
                          {inv.invoiceNumber}
                          {inv.date ? ` · ${formatDate(inv.date)}` : ''}
                        </div>
                      </div>
                      <strong>{formatToman(tab === 'paid' ? inv.paid : inv.credit)}</strong>
                    </div>
                    <div className="ios-caption" style={{ marginTop: 4 }}>
                      مبلغ فاکتور {formatToman(inv.totalAmount)} · {formatKg(inv.totalKg)}
                      {inv.paid > 0 && inv.credit > 0
                        ? ` · نقد/کارت ${formatToman(inv.paid)} · نسیه ${formatToman(inv.credit)}`
                        : ''}
                    </div>
                  </button>
                ))
              )}
            </>
          )}
        </div>

        <IonModal
          isOpen={!!detail || detailLoading}
          onDidDismiss={() => {
            setDetail(null);
            setDetailLoading(false);
          }}
        >
          <IonHeader>
            <IonToolbar>
              <IonTitle>جزئیات فاکتور</IonTitle>
              <IonButtons slot="end">
                <IonButton
                  onClick={() => {
                    setDetail(null);
                    setDetailLoading(false);
                  }}
                >
                  بستن
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            {detailLoading && !detail ? (
              <div className="center-pad">
                <IonSpinner />
              </div>
            ) : detail ? (
              <SaleInvoiceDetailBody
                inv={detail}
                onToast={(msg, color) =>
                  setToast({ open: true, msg, color: color || 'success' })
                }
              />
            ) : null}
          </IonContent>
        </IonModal>

        <IonToast
          isOpen={toast.open}
          message={toast.msg}
          color={toast.color}
          duration={2000}
          onDidDismiss={() => setToast((t) => ({ ...t, open: false }))}
        />
      </IonContent>
    </IonPage>
  );
};

export default DayLedgerDetail;
