import { useCallback, useEffect, useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonBackButton,
  IonButton,
  IonToast,
  IonRefresher,
  IonRefresherContent,
  useIonViewWillEnter,
  RefresherEventDetail,
  IonBadge,
  IonChip,
} from '@ionic/react';
import { wsClient, newMutationId } from '../api/ws';
import { formatToman, formatDate, formatMoneyInput, parseAmount } from '../utils/format';
import { MoneyInput } from '../components/MoneyInput';

interface Driver {
  _id: string;
  name: string;
  username?: string;
  cardNumber?: string;
  walletBalance?: number;
}

interface Inv {
  _id: string;
  invoiceNumber: string;
  customerName?: string;
  driverId?: string;
  driverEarned?: number;
  shippingCost?: number;
  deliveredAt?: string;
  driverPaid?: boolean;
}

const DriverPayouts: React.FC = () => {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [invoices, setInvoices] = useState<Inv[]>([]);
  const [payAmount, setPayAmount] = useState<Record<string, string>>({});
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });

  const load = useCallback(async () => {
    const data = await wsClient.request<{ invoices: Inv[]; drivers: Driver[] }>(
      'driver.payouts.pending',
      {}
    );
    setInvoices(data.invoices || []);
    setDrivers(data.drivers || []);
  }, []);

  useIonViewWillEnter(() => {
    void load().catch(console.warn);
  });

  useEffect(() => {
    const unsub = wsClient.onEvent('data_changed', (payload: unknown) => {
      const p = payload as { entity?: string };
      if (p?.entity === 'sale' || p?.entity === 'driver' || p?.entity === 'expense') {
        void load().catch(console.warn);
      }
    });
    return unsub;
  }, [load]);

  const driverOf = (id?: string) => drivers.find((d) => d._id === id);

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/more" text="بازگشت" />
          </IonButtons>
          <IonTitle>پرداخت راننده‌ها</IonTitle>
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
          <div className="ios-section-title">راننده‌ها · کارت و کیف پول</div>
          {drivers.length === 0 && <p className="hint">راننده‌ای نیست</p>}
          {drivers.map((d) => (
            <div key={d._id} className="ios-glass-card">
              <div className="ios-row">
                <div>
                  <strong>{d.name}</strong>
                  <div className="ios-caption">{d.username}</div>
                </div>
                <IonBadge color={(d.walletBalance || 0) > 0 ? 'warning' : 'medium'}>
                  {formatToman(d.walletBalance || 0)}
                </IonBadge>
              </div>
              <p className="hint convert-hint">
                کارت: {d.cardNumber ? d.cardNumber.replace(/(\d{4})(?=\d)/g, '$1 ') : 'ثبت نشده'}
              </p>
              {(d.walletBalance || 0) > 0 && (
                <>
                  <MoneyInput
                    label="مبلغ پرداخت (تومان)"
                    value={
                      payAmount[d._id] ??
                      formatMoneyInput(String(d.walletBalance || 0))
                    }
                    onChange={(v) => setPayAmount({ ...payAmount, [d._id]: v })}
                  />
                  <IonButton
                    expand="block"
                    size="small"
                    color="success"
                    onClick={async () => {
                      try {
                        const amount =
                          parseAmount(payAmount[d._id] || '') || d.walletBalance || 0;
                        const res = await wsClient.request<{
                          paid: number;
                          cardNumber?: string;
                        }>(
                          'driver.wallet.pay',
                          { driverId: d._id, amount },
                          { clientMutationId: newMutationId(), queueIfOffline: true }
                        );
                        setToast({
                          open: true,
                          msg: `پرداخت ${formatToman(res.paid)} · کارت ${
                            res.cardNumber || d.cardNumber || '—'
                          }`,
                          color: 'success',
                        });
                        await load();
                      } catch (e) {
                        setToast({
                          open: true,
                          msg: e instanceof Error ? e.message : 'خطا',
                          color: 'danger',
                        });
                      }
                    }}
                  >
                    پرداخت شد (واریز به کارت)
                  </IonButton>
                </>
              )}
            </div>
          ))}

          <div className="ios-section-title">فاکتورهای تحویل‌شده · منتظر پرداخت</div>
          {invoices.length === 0 && <div className="empty-state">موردی نیست</div>}
          {invoices.map((inv) => {
            const d = driverOf(inv.driverId);
            return (
              <div key={inv._id} className="ios-glass-card">
                <div className="ios-row">
                  <strong>{inv.invoiceNumber}</strong>
                  <IonChip color="warning" outline>
                    {formatToman(inv.driverEarned || inv.shippingCost || 0)}
                  </IonChip>
                </div>
                <div className="ios-caption">
                  {inv.customerName || '—'} · راننده: {d?.name || '—'}
                </div>
                {d?.cardNumber && (
                  <p className="hint">کارت راننده: {d.cardNumber.replace(/(\d{4})(?=\d)/g, '$1 ')}</p>
                )}
                {inv.deliveredAt && (
                  <p className="hint">تحویل: {formatDate(inv.deliveredAt)}</p>
                )}
                <IonButton
                  size="small"
                  color="success"
                  onClick={async () => {
                    try {
                      const res = await wsClient.request<{
                        paid: number;
                        cardNumber?: string;
                        driverName?: string;
                      }>(
                        'driver.payInvoice',
                        { id: inv._id },
                        { clientMutationId: newMutationId(), queueIfOffline: true }
                      );
                      setToast({
                        open: true,
                        msg: `پرداخت ${formatToman(res.paid)} به ${res.driverName || d?.name || 'راننده'}`,
                        color: 'success',
                      });
                      await load();
                    } catch (e) {
                      setToast({
                        open: true,
                        msg: e instanceof Error ? e.message : 'خطا',
                        color: 'danger',
                      });
                    }
                  }}
                >
                  پرداخت شد
                </IonButton>
              </div>
            );
          })}
        </div>

        <IonToast
          isOpen={toast.open}
          message={toast.msg}
          color={toast.color}
          duration={2600}
          onDidDismiss={() => setToast((t) => ({ ...t, open: false }))}
          position="top"
        />
      </IonContent>
    </IonPage>
  );
};

export default DriverPayouts;
