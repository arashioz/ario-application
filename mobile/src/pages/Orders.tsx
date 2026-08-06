import { useCallback, useEffect, useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonButton,
  IonInput,
  IonItem,
  IonToast,
  IonRefresher,
  IonRefresherContent,
  useIonViewWillEnter,
  RefresherEventDetail,
  IonBadge,
  IonSelect,
  IonSelectOption,
  IonChip,
} from '@ionic/react';
import { wsClient, newMutationId } from '../api/ws';
import { useAuth } from '../auth/AuthContext';
import { formatToman, formatKg, formatDate, formatMoneyInput, parseAmount } from '../utils/format';
import { MoneyInput } from '../components/MoneyInput';

interface SaleInv {
  _id: string;
  invoiceNumber: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  totalAmount: number;
  totalKg: number;
  totalProfit: number;
  discount?: number;
  status: string;
  isGolden?: boolean;
  shippingNotes?: string;
  shippingBy?: 'us' | 'customer' | 'none';
  shippingCost?: number;
  driverEarned?: number;
  driverPaid?: boolean;
  date: string;
  priceTier?: string;
  driverId?: string;
}

interface Driver {
  _id: string;
  name: string;
  lastLat?: number;
  lastLng?: number;
}

type ShippingBy = 'us' | 'customer' | 'none';

const STATUS: Record<string, string> = {
  pending: 'منتظر تأیید',
  approved: 'آماده ارسال',
  shipped: 'ارسال شده',
  delivered: 'تحویل شد',
  cancelled: 'لغو',
};

const SHIP_BY_LABEL: Record<ShippingBy, string> = {
  us: 'ارسال با ما',
  customer: 'ارسال با مشتری',
  none: 'بدون ارسال',
};

const Orders: React.FC = () => {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<'pending' | 'approved' | 'shipped' | 'delivered' | 'all'>('approved');
  const [list, setList] = useState<SaleInv[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [shipNotes, setShipNotes] = useState<Record<string, string>>({});
  const [shipDriver, setShipDriver] = useState<Record<string, string>>({});
  const [shipBy, setShipBy] = useState<Record<string, ShippingBy>>({});
  const [shipCost, setShipCost] = useState<Record<string, string>>({});
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });

  const load = useCallback(async () => {
    const status = tab === 'all' ? undefined : tab;
    const data = await wsClient.request<SaleInv[]>('sale.list', { status });
    setList(data);
  }, [tab]);

  const loadDrivers = useCallback(async () => {
    if (!isAdmin) return;
    const data = await wsClient.request<Driver[]>('driver.list', {});
    setDrivers(data);
  }, [isAdmin]);

  useIonViewWillEnter(() => {
    void load().catch(console.warn);
    void loadDrivers().catch(console.warn);
  });

  useEffect(() => {
    void load().catch(console.warn);
  }, [load]);

  useEffect(() => {
    const unsub = wsClient.onEvent('data_changed', (payload: unknown) => {
      const p = payload as { entity?: string };
      if (p?.entity === 'sale') void load().catch(console.warn);
    });
    return unsub;
  }, [load]);

  const openPdf = async (id: string) => {
    const res = await wsClient.request<{ html: string }>('sale.pdf', { id });
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(res.html);
      w.document.close();
    }
  };

  const driverName = (id?: string) => drivers.find((d) => d._id === id)?.name;

  const resolveBy = (inv: SaleInv): ShippingBy =>
    shipBy[inv._id] || inv.shippingBy || 'none';

  const shippingControls = (inv: SaleInv) => {
    const by = resolveBy(inv);
    return (
      <div className="ship-controls" style={{ width: '100%', marginTop: 8 }}>
        <p className="hint convert-hint">نوع ارسال</p>
        <div className="chip-row">
          {(['us', 'customer', 'none'] as ShippingBy[]).map((v) => (
            <IonChip
              key={v}
              className={by === v ? 'ios-chip-active' : 'ios-chip'}
              onClick={() => setShipBy({ ...shipBy, [inv._id]: v })}
            >
              {SHIP_BY_LABEL[v]}
            </IonChip>
          ))}
        </div>
        {by === 'us' && (
          <>
            <MoneyInput
              label="هزینه ارسال (تومان) — اختیاری"
              value={
                shipCost[inv._id] ??
                (inv.shippingCost ? formatMoneyInput(String(inv.shippingCost)) : '')
              }
              onChange={(v) => setShipCost({ ...shipCost, [inv._id]: v })}
            />
            <IonItem className="ship-input">
              <IonSelect
                interface="popover"
                placeholder="راننده (اختیاری)"
                value={shipDriver[inv._id] ?? inv.driverId ?? ''}
                onIonChange={(e) =>
                  setShipDriver({ ...shipDriver, [inv._id]: String(e.detail.value || '') })
                }
              >
                <IonSelectOption value="">بدون راننده — فقط ارسال شده</IonSelectOption>
                {drivers.map((d) => (
                  <IonSelectOption key={d._id} value={d._id}>
                    {d.name}
                  </IonSelectOption>
                ))}
              </IonSelect>
            </IonItem>
          </>
        )}
        {by !== 'us' && (
          <p className="hint">بدون راننده ثبت می‌شود و وضعیت «ارسال شده» می‌خورد</p>
        )}
        <IonItem className="ship-input">
          <IonInput
            placeholder="توضیح ارسال…"
            value={shipNotes[inv._id] || inv.shippingNotes || ''}
            onIonInput={(e) => setShipNotes({ ...shipNotes, [inv._id]: e.detail.value || '' })}
          />
        </IonItem>
      </div>
    );
  };

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonTitle>سفارش‌ها</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="page-content ios-content">
        <IonRefresher
          slot="fixed"
          onIonRefresh={async (e: CustomEvent<RefresherEventDetail>) => {
            await load();
            await loadDrivers();
            e.detail.complete();
          }}
        >
          <IonRefresherContent />
        </IonRefresher>

        <div className="ion-padding orders-page">
          <IonSegment
            value={tab}
            className="ios-segment"
            onIonChange={(e) => setTab((e.detail.value as typeof tab) || 'approved')}
          >
            <IonSegmentButton value="approved">
              <IonLabel>آماده ارسال</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="pending">
              <IonLabel>تأیید</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="shipped">
              <IonLabel>ارسال‌شده</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="delivered">
              <IonLabel>تحویل</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="all">
              <IonLabel>همه</IonLabel>
            </IonSegmentButton>
          </IonSegment>

          {list.length === 0 && <div className="empty-state">موردی نیست</div>}

          {list.map((inv) => (
            <div key={inv._id} className={`ios-glass-card ${inv.isGolden ? 'golden-card' : ''}`}>
              <div className="ios-row">
                <div>
                  <strong>
                    {inv.isGolden ? '⭐ ' : ''}
                    {inv.invoiceNumber}
                  </strong>
                  <div className="ios-caption">
                    {inv.customerName || '—'} · {inv.customerPhone || ''}
                  </div>
                </div>
                <IonBadge
                  color={
                    inv.status === 'pending'
                      ? 'warning'
                      : inv.status === 'shipped'
                        ? 'primary'
                        : inv.status === 'delivered'
                          ? 'success'
                          : 'medium'
                  }
                >
                  {STATUS[inv.status] || inv.status}
                </IonBadge>
              </div>
              <div className="stat-row">
                <span className="stat-label">مبلغ</span>
                <span className="stat-value">{formatToman(inv.totalAmount)}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">تناژ</span>
                <span className="stat-value">{formatKg(inv.totalKg)}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">تاریخ</span>
                <span className="stat-value">{formatDate(inv.date)}</span>
              </div>
              {inv.customerAddress && <p className="hint">📍 {inv.customerAddress}</p>}
              {inv.shippingBy && inv.shippingBy !== 'none' && (
                <p className="hint">
                  🚚 {SHIP_BY_LABEL[inv.shippingBy]}
                  {inv.shippingCost ? ` · ${formatToman(inv.shippingCost)}` : ''}
                </p>
              )}
              {inv.shippingNotes && <p className="hint">📝 {inv.shippingNotes}</p>}
              {inv.driverId && (
                <IonChip color="success" outline>
                  راننده: {driverName(inv.driverId) || 'ارجاع‌شده'}
                </IonChip>
              )}

              <div className="chip-row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                <IonButton size="small" fill="outline" onClick={() => void openPdf(inv._id)}>
                  PDF
                </IonButton>

                {isAdmin && inv.status === 'pending' && (
                  <>
                    {shippingControls(inv)}
                    <IonButton
                      size="small"
                      color="success"
                      expand="block"
                      onClick={async () => {
                        try {
                          const by = resolveBy(inv);
                          const dId = shipDriver[inv._id] || undefined;
                          await wsClient.request(
                            'sale.approve',
                            {
                              id: inv._id,
                              shippingBy: by,
                              shippingCost:
                                by === 'us' ? parseAmount(shipCost[inv._id] || '') || 0 : 0,
                              shippingNotes: shipNotes[inv._id] || undefined,
                              driverId: dId || null,
                            },
                            { clientMutationId: newMutationId(), queueIfOffline: true }
                          );
                          setToast({
                            open: true,
                            msg: dId
                              ? 'تأیید شد و برای راننده ارسال شد'
                              : 'تأیید شد',
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
                      تأیید
                      {resolveBy(inv) === 'us' && (parseAmount(shipCost[inv._id] || '') || 0) > 0
                        ? ' + ثبت هزینه ارسال'
                        : ''}
                    </IonButton>
                  </>
                )}

                {isAdmin && inv.status === 'approved' && (
                  <>
                    {shippingControls(inv)}
                    <IonButton
                      size="small"
                      color="primary"
                      expand="block"
                      onClick={async () => {
                        try {
                          const by = resolveBy(inv);
                          const dId = shipDriver[inv._id] || undefined;
                          await wsClient.request(
                            'sale.ship',
                            {
                              id: inv._id,
                              shippingNotes: shipNotes[inv._id] || inv.shippingNotes || 'ارسال شد',
                              driverId: dId || null,
                              shippingBy: by,
                              shippingCost:
                                by === 'us'
                                  ? parseAmount(shipCost[inv._id] || '') || inv.shippingCost || 0
                                  : 0,
                            },
                            { clientMutationId: newMutationId(), queueIfOffline: true }
                          );
                          setToast({
                            open: true,
                            msg: dId
                              ? 'ارسال شده · در لیست راننده است'
                              : 'ارسال شده · بدون راننده',
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
                      ارسال شده
                    </IonButton>
                  </>
                )}

                {isAdmin && inv.status === 'shipped' && (
                  <>
                    <IonItem className="ship-input">
                      <IonSelect
                        interface="popover"
                        placeholder="راننده"
                        value={shipDriver[inv._id] ?? inv.driverId ?? ''}
                        onIonChange={(e) =>
                          setShipDriver({ ...shipDriver, [inv._id]: String(e.detail.value || '') })
                        }
                      >
                        <IonSelectOption value="">بدون راننده</IonSelectOption>
                        {drivers.map((d) => (
                          <IonSelectOption key={d._id} value={d._id}>
                            {d.name}
                          </IonSelectOption>
                        ))}
                      </IonSelect>
                    </IonItem>
                    <IonButton
                      size="small"
                      fill="outline"
                      onClick={async () => {
                        try {
                          await wsClient.request('sale.assignDriver', {
                            id: inv._id,
                            driverId: shipDriver[inv._id] || null,
                          });
                          setToast({ open: true, msg: 'راننده به‌روز شد', color: 'success' });
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
                      ذخیره راننده
                    </IonButton>
                  </>
                )}

                {isAdmin && inv.status === 'delivered' && (
                  <div style={{ width: '100%', marginTop: 8 }}>
                    {(inv.driverEarned || 0) > 0 && (
                      <p className="hint">
                        طلب راننده: {formatToman(inv.driverEarned || 0)}
                        {inv.driverPaid ? ' · پرداخت شده' : ' · منتظر پرداخت'}
                      </p>
                    )}
                    {!inv.driverPaid && (inv.driverEarned || 0) > 0 && (
                      <IonButton
                        size="small"
                        color="success"
                        expand="block"
                        onClick={async () => {
                          try {
                            const res = await wsClient.request<{ paid: number; cardNumber?: string }>(
                              'driver.payInvoice',
                              { id: inv._id },
                              { clientMutationId: newMutationId(), queueIfOffline: true }
                            );
                            setToast({
                              open: true,
                              msg: `پرداخت ${formatToman(res.paid)}${
                                res.cardNumber ? ` · کارت ${res.cardNumber}` : ''
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
                        پرداخت به راننده شد
                      </IonButton>
                    )}
                    {inv.driverPaid && (
                      <IonBadge color="success">پرداخت به راننده ثبت شد</IonBadge>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
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

export default Orders;
