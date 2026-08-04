import { useCallback, useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonBackButton,
  IonItem,
  IonLabel,
  IonInput,
  IonButton,
  IonChip,
  IonToast,
  IonRefresher,
  IonRefresherContent,
  useIonViewWillEnter,
  RefresherEventDetail,
  IonBadge,
} from '@ionic/react';
import { wsClient, newMutationId } from '../api/ws';
import { formatToman, formatKg, sanitizeNumberInput } from '../utils/format';
import { useAuth } from '../auth/AuthContext';

interface Product {
  _id: string;
  name: string;
  kgPerPackage?: number;
  stockKg?: number;
}

interface Order {
  _id: string;
  orderNumber: string;
  city: string;
  totalKg: number;
  totalAmount: number;
  status: string;
  deliveryMode: string;
  commissionAmount: number;
  commissionPercent: number;
  priceTier: string;
  marketerName?: string;
}

const VolumeOrders: React.FC = () => {
  const { isAdmin, user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('20');
  const [city, setCity] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [address, setAddress] = useState('');
  const [tier, setTier] = useState<'supermarket' | 'wholesale'>('supermarket');
  const [deliveryMode, setDeliveryMode] = useState<'company' | 'self'>('company');
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });
  const [cfg, setCfg] = useState({ minKg: 500, company: 3, self: 5 });

  const load = useCallback(async () => {
    const [plist, olist, conf] = await Promise.all([
      wsClient.request<Product[]>('product.list', {}),
      wsClient.request<Order[]>('volumeOrder.list', {}),
      wsClient.request<{
        platformMinOrderKg: number;
        commissionPercentCompany: number;
        commissionPercentSelf: number;
      }>('platform.config.get', {}),
    ]);
    setProducts(Array.isArray(plist) ? plist : []);
    setOrders(Array.isArray(olist) ? olist : []);
    setCfg({
      minKg: conf.platformMinOrderKg || 500,
      company: conf.commissionPercentCompany || 3,
      self: conf.commissionPercentSelf || 5,
    });
    if (!productId && plist?.[0]) setProductId(plist[0]._id);
  }, [productId]);

  useIonViewWillEnter(() => {
    void load().catch(console.warn);
  });

  const create = async () => {
    try {
      await wsClient.request(
        'volumeOrder.create',
        {
          city: city || 'مشهد',
          customerName,
          address,
          priceTier: tier,
          deliveryMode,
          items: [{ productId, unit: 'package', qtyInput: parseFloat(qty) || 1 }],
        },
        { clientMutationId: newMutationId(), queueIfOffline: true }
      );
      setToast({ open: true, msg: 'سفارش حجمی ثبت شد', color: 'success' });
      await load();
    } catch (e) {
      setToast({ open: true, msg: e instanceof Error ? e.message : 'خطا', color: 'danger' });
    }
  };

  const statusLabel: Record<string, string> = {
    pending: 'منتظر تأیید',
    approved: 'تأیید',
    shipping: 'در ارسال',
    delivered: 'تحویل',
    cancelled: 'لغو',
  };

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/more" text="بازگشت" />
          </IonButtons>
          <IonTitle>سفارش حجمی</IonTitle>
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
          <p className="hint">
            حداقل {cfg.minKg} کیلو · پورسانت شرکت {cfg.company}٪ · پخش شخصی {cfg.self}٪
          </p>

          {!isAdmin && (
            <div className="ios-glass-card">
              <div className="ios-section-title" style={{ marginTop: 0 }}>
                ثبت سفارش جدید
              </div>
              <IonItem>
                <IonLabel position="stacked">شهر</IonLabel>
                <IonInput
                  value={city}
                  placeholder={user?.name ? 'شهر شما' : ''}
                  onIonInput={(e) => setCity(e.detail.value || '')}
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">نام سوپر / مشتری</IonLabel>
                <IonInput
                  value={customerName}
                  onIonInput={(e) => setCustomerName(e.detail.value || '')}
                />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">آدرس</IonLabel>
                <IonInput value={address} onIonInput={(e) => setAddress(e.detail.value || '')} />
              </IonItem>
              <p className="hint">نوع قیمت</p>
              <div className="chip-row">
                <IonChip
                  className={tier === 'supermarket' ? 'ios-chip-active' : 'ios-chip'}
                  onClick={() => setTier('supermarket')}
                >
                  سوپرمارکت
                </IonChip>
                <IonChip
                  className={tier === 'wholesale' ? 'ios-chip-active' : 'ios-chip'}
                  onClick={() => setTier('wholesale')}
                >
                  عمده
                </IonChip>
              </div>
              <p className="hint">نحوه ارسال</p>
              <div className="chip-row">
                <IonChip
                  className={deliveryMode === 'company' ? 'ios-chip-active' : 'ios-chip'}
                  onClick={() => setDeliveryMode('company')}
                >
                  پخش شرکت ({cfg.company}٪)
                </IonChip>
                <IonChip
                  className={deliveryMode === 'self' ? 'ios-chip-active' : 'ios-chip'}
                  onClick={() => setDeliveryMode('self')}
                >
                  پخش خودم ({cfg.self}٪)
                </IonChip>
              </div>
              <div className="chip-row" style={{ marginTop: 8 }}>
                {products.slice(0, 12).map((p) => (
                  <IonChip
                    key={p._id}
                    className={productId === p._id ? 'ios-chip-active' : 'ios-chip'}
                    onClick={() => setProductId(p._id)}
                  >
                    {p.name}
                  </IonChip>
                ))}
              </div>
              <IonItem>
                <IonLabel position="stacked">تعداد بسته</IonLabel>
                <IonInput
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={qty}
                  onIonInput={(e) => setQty(sanitizeNumberInput(e.detail.value || ''))}
                />
              </IonItem>
              <IonButton expand="block" className="ios-primary-btn" onClick={() => void create()}>
                ثبت سفارش
              </IonButton>
            </div>
          )}

          <div className="ios-section-title">سفارش‌ها</div>
          {orders.length === 0 && <div className="empty-state">سفارشی نیست</div>}
          {orders.map((o) => (
            <div key={o._id} className="ios-glass-card">
              <div className="ios-row">
                <strong>{o.orderNumber}</strong>
                <IonBadge>{statusLabel[o.status] || o.status}</IonBadge>
              </div>
              <div className="ios-caption">
                {o.marketerName ? `${o.marketerName} · ` : ''}
                {o.city} · {o.priceTier} ·{' '}
                {o.deliveryMode === 'self' ? 'پخش شخصی' : 'پخش شرکت'}
              </div>
              <div className="stat-row">
                <span className="stat-label">مبلغ</span>
                <span className="stat-value">{formatToman(o.totalAmount)}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">تناژ</span>
                <span className="stat-value">{formatKg(o.totalKg)}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">پورسانت</span>
                <span className="stat-value">
                  {formatToman(o.commissionAmount)} ({o.commissionPercent}٪)
                </span>
              </div>
              {isAdmin && o.status === 'pending' && (
                <IonButton
                  size="small"
                  onClick={() =>
                    void wsClient
                      .request('volumeOrder.status', { id: o._id, status: 'approved' })
                      .then(load)
                  }
                >
                  تأیید
                </IonButton>
              )}
              {isAdmin && (o.status === 'approved' || o.status === 'shipping') && (
                <IonButton
                  size="small"
                  color="success"
                  onClick={() =>
                    void wsClient
                      .request('volumeOrder.status', { id: o._id, status: 'delivered' })
                      .then(load)
                  }
                >
                  تحویل شد (واریز پورسانت)
                </IonButton>
              )}
            </div>
          ))}
        </div>
        <IonToast
          isOpen={toast.open}
          message={toast.msg}
          color={toast.color}
          duration={2400}
          onDidDismiss={() => setToast((t) => ({ ...t, open: false }))}
          position="top"
        />
      </IonContent>
    </IonPage>
  );
};

export default VolumeOrders;
