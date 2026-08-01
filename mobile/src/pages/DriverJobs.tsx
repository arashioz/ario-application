import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
  IonToggle,
  IonItem,
  IonLabel,
  IonInput,
  IonToast,
  IonRefresher,
  IonRefresherContent,
  useIonViewWillEnter,
  RefresherEventDetail,
  IonBadge,
} from '@ionic/react';
import { checkmarkCircleOutline, cardOutline } from 'ionicons/icons';
import { IonIcon } from '@ionic/react';
import { wsClient } from '../api/ws';
import { formatToman, formatKg, formatDate } from '../utils/format';
import { useAuth } from '../auth/AuthContext';
import { geoErrorMessage, isGeoSecureContext } from '../utils/geo';

interface Job {
  _id: string;
  invoiceNumber: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  totalAmount: number;
  totalKg: number;
  status: string;
  shippingNotes?: string;
  shippingBy?: string;
  shippingCost?: number;
  driverEarned?: number;
  driverPaid?: boolean;
  date: string;
}

interface Profile {
  cardNumber: string;
  walletBalance: number;
  name: string;
}

const DriverJobs: React.FC = () => {
  const { user, logout, online } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [profile, setProfile] = useState<Profile>({ cardNumber: '', walletBalance: 0, name: '' });
  const [cardDraft, setCardDraft] = useState('');
  const [tracking, setTracking] = useState(true);
  const [lastSent, setLastSent] = useState('');
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });
  const [busyId, setBusyId] = useState('');
  const watchRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    const [data, prof] = await Promise.all([
      wsClient.request<Job[]>('driver.jobs', {}),
      wsClient.request<Profile>('driver.profile.get', {}),
    ]);
    setJobs(data);
    setProfile(prof);
    setCardDraft(prof.cardNumber || '');
  }, []);

  useIonViewWillEnter(() => {
    void load().catch(console.warn);
  });

  useEffect(() => {
    const unsub = wsClient.onEvent('data_changed', (payload: unknown) => {
      const p = payload as { entity?: string };
      if (p?.entity === 'sale' || p?.entity === 'driver') void load().catch(console.warn);
    });
    return unsub;
  }, [load]);

  useEffect(() => {
    if (!tracking || user?.role !== 'driver') {
      if (watchRef.current != null) {
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      }
      return;
    }
    if (!navigator.geolocation || !isGeoSecureContext()) {
      setToast({
        open: true,
        msg: !isGeoSecureContext() ? geoErrorMessage(null) : 'GPS در دسترس نیست',
        color: 'danger',
      });
      return;
    }
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        void wsClient
          .request('driver.location.update', {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          })
          .then(() => setLastSent(new Date().toLocaleTimeString('fa-IR')))
          .catch(console.warn);
      },
      (err) => setToast({ open: true, msg: geoErrorMessage(err), color: 'warning' }),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    return () => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, [tracking, user?.role]);

  const saveCard = async () => {
    try {
      const res = await wsClient.request<Profile>('driver.profile.update', {
        cardNumber: cardDraft,
      });
      setProfile(res);
      setToast({ open: true, msg: 'شماره کارت ذخیره شد', color: 'success' });
    } catch (e) {
      setToast({ open: true, msg: e instanceof Error ? e.message : 'ذخیره نشد', color: 'danger' });
    }
  };

  const deliver = async (id: string) => {
    setBusyId(id);
    try {
      const res = await wsClient.request<{
        credited: number;
        walletBalance: number;
      }>('driver.deliver', { id });
      setToast({
        open: true,
        msg:
          res.credited > 0
            ? `تحویل شد · ${formatToman(res.credited)} به کیف پول اضافه شد`
            : 'تحویل شد',
        color: 'success',
      });
      await load();
    } catch (e) {
      setToast({ open: true, msg: e instanceof Error ? e.message : 'خطا', color: 'danger' });
    } finally {
      setBusyId('');
    }
  };

  const statusLabel = (s: string) => {
    if (s === 'delivered') return 'تحویل شد';
    if (s === 'shipped') return 'ارسال شد';
    return 'آماده ارسال';
  };

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonTitle>ارسال‌های من</IonTitle>
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
          <div className="ios-hero">
            <div className="ios-hero-greeting">{user?.name}</div>
            <div className="ios-caption">راننده · {online ? 'آنلاین' : 'آفلاین'}</div>
          </div>

          <div className="ios-glass-card">
            <div className="ios-row">
              <div>
                <div className="ios-label">کیف پول</div>
                <strong>{formatToman(profile.walletBalance || 0)}</strong>
                <div className="ios-caption">طلب ارسال‌های تحویل‌شده</div>
              </div>
            </div>
          </div>

          <div className="ios-glass-card">
            <div className="ios-section-title" style={{ marginTop: 0 }}>
              <IonIcon icon={cardOutline} /> تنظیمات · شماره کارت
            </div>
            <IonItem lines="none">
              <IonLabel position="stacked">شماره کارت (۱۶ رقم)</IonLabel>
              <IonInput
                inputmode="numeric"
                value={cardDraft}
                placeholder="6037…"
                onIonInput={(e) => setCardDraft(e.detail.value || '')}
              />
            </IonItem>
            <IonButton size="small" expand="block" onClick={() => void saveCard()}>
              ذخیره شماره کارت
            </IonButton>
            <p className="hint">ادمین این شماره را برای واریز می‌بیند</p>
          </div>

          <div className="ios-glass-card ios-row">
            <div>
              <div className="ios-label">اشتراک‌گذاری موقعیت</div>
              <div className="ios-caption">
                {tracking ? `فعال${lastSent ? ` · آخرین ارسال ${lastSent}` : ''}` : 'خاموش'}
              </div>
            </div>
            <IonToggle checked={tracking} onIonChange={(e) => setTracking(e.detail.checked)} />
          </div>

          <div className="ios-section-title">فاکتورهای ارجاع‌شده</div>
          {jobs.length === 0 && <div className="empty-state">ارسالی نیست</div>}
          {jobs.map((j) => (
            <div key={j._id} className="ios-glass-card">
              <div className="ios-row">
                <strong>{j.invoiceNumber}</strong>
                <IonBadge
                  color={
                    j.status === 'delivered' ? 'success' : j.status === 'shipped' ? 'primary' : 'warning'
                  }
                >
                  {statusLabel(j.status)}
                </IonBadge>
              </div>
              <div className="ios-caption">
                {j.customerName || '—'} · {j.customerPhone || ''}
              </div>
              {j.customerAddress && <p className="hint">📍 {j.customerAddress}</p>}
              <div className="stat-row">
                <span className="stat-label">مبلغ</span>
                <span className="stat-value">{formatToman(j.totalAmount)}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">تناژ</span>
                <span className="stat-value">{formatKg(j.totalKg)}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">تاریخ</span>
                <span className="stat-value">{formatDate(j.date)}</span>
              </div>
              {j.shippingNotes && <p className="hint">🚚 {j.shippingNotes}</p>}
              {j.shippingBy === 'us' && (j.shippingCost || 0) > 0 && (
                <div className="stat-row">
                  <span className="stat-label">هزینه ارسال</span>
                  <span className="stat-value">{formatToman(j.shippingCost || 0)}</span>
                </div>
              )}
              {j.status === 'delivered' && (
                <p className="hint convert-hint">
                  {j.driverPaid
                    ? `پرداخت شده · ${formatToman(j.driverEarned || 0)}`
                    : (j.driverEarned || 0) > 0
                      ? `در کیف پول · ${formatToman(j.driverEarned || 0)} — منتظر واریز ادمین`
                      : 'تحویل ثبت شد'}
                </p>
              )}
              {j.customerAddress && (
                <IonButton
                  size="small"
                  fill="outline"
                  onClick={() =>
                    window.open(
                      `https://maps.google.com/?q=${encodeURIComponent(j.customerAddress || '')}`,
                      '_blank'
                    )
                  }
                >
                  مسیر روی نقشه
                </IonButton>
              )}
              {(j.status === 'approved' || j.status === 'shipped') && (
                <IonButton
                  expand="block"
                  color="success"
                  className="ion-margin-top"
                  disabled={busyId === j._id}
                  onClick={() => void deliver(j._id)}
                >
                  <IonIcon slot="start" icon={checkmarkCircleOutline} />
                  تحویل شد
                </IonButton>
              )}
            </div>
          ))}

          <IonButton expand="block" fill="clear" color="medium" onClick={() => void logout()}>
            خروج
          </IonButton>
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

export default DriverJobs;
