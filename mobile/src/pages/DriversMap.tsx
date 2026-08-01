import { useCallback, useEffect, useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  useIonViewWillEnter,
  RefresherEventDetail,
  IonBadge,
} from '@ionic/react';
import { wsClient } from '../api/ws';
import { LocationPicker } from '../components/LocationPicker';

interface StaffLoc {
  id: string;
  name: string;
  role: 'driver' | 'marketer';
  lat: number;
  lng: number;
  workActive?: boolean;
  at?: string;
}

const DriversMap: React.FC = () => {
  const [staff, setStaff] = useState<StaffLoc[]>([]);

  const load = useCallback(async () => {
    try {
      const data = await wsClient.request<StaffLoc[]>('staff.locations', {});
      setStaff(data);
    } catch {
      const drivers = await wsClient.request<StaffLoc[]>('driver.locations', {});
      setStaff(drivers.map((d) => ({ ...d, role: 'driver' as const })));
    }
  }, []);

  useIonViewWillEnter(() => {
    void load().catch(console.warn);
  });

  useEffect(() => {
    const unsub = wsClient.onEvent('staff.location', (payload: unknown) => {
      const loc = payload as StaffLoc;
      if (!loc?.id || loc.lat == null) return;
      setStaff((prev) => {
        const rest = prev.filter((d) => d.id !== loc.id);
        return [...rest, loc];
      });
    });
    const unsub2 = wsClient.onEvent('driver.location', (payload: unknown) => {
      const loc = payload as StaffLoc;
      if (!loc?.id) return;
      setStaff((prev) => {
        const rest = prev.filter((d) => d.id !== loc.id);
        return [...rest, { ...loc, role: 'driver' }];
      });
    });
    const t = setInterval(() => void load().catch(console.warn), 12000);
    return () => {
      unsub();
      unsub2();
      clearInterval(t);
    };
  }, [load]);

  const drivers = staff.filter((s) => s.role === 'driver');
  const marketers = staff.filter((s) => s.role === 'marketer');

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonTitle>نقشه تیم</IonTitle>
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
          <div className="ios-glass-card">
            <LocationPicker
              readOnly
              height={360}
              extraMarkers={staff.map((d) => ({
                lat: d.lat,
                lng: d.lng,
                label: `${d.role === 'marketer' ? 'بازاریاب' : 'راننده'} · ${d.name}`,
                color: d.role === 'marketer' ? '#f59e0b' : '#10b981',
              }))}
            />
          </div>

          <div className="ios-section-title">راننده‌ها</div>
          {drivers.length === 0 && <p className="hint">موقعیت راننده نیست</p>}
          {drivers.map((d) => (
            <div key={d.id} className="ios-glass-card">
              <div className="ios-row">
                <strong>{d.name}</strong>
                <IonBadge color="success">راننده</IonBadge>
              </div>
              <div className="ios-caption">
                {d.lat.toFixed(5)} ، {d.lng.toFixed(5)}
                {d.at ? ` · ${new Date(d.at).toLocaleTimeString('fa-IR')}` : ''}
              </div>
            </div>
          ))}

          <div className="ios-section-title">بازاریاب‌های فعال</div>
          {marketers.length === 0 && (
            <p className="hint">کسی کار را روشن نکرده — بازاریاب باید «شروع کار» بزند</p>
          )}
          {marketers.map((d) => (
            <div key={d.id} className="ios-glass-card">
              <div className="ios-row">
                <strong>{d.name}</strong>
                <IonBadge color="warning">بازاریاب</IonBadge>
              </div>
              <div className="ios-caption">
                {d.lat.toFixed(5)} ، {d.lng.toFixed(5)}
                {d.at ? ` · ${new Date(d.at).toLocaleTimeString('fa-IR')}` : ''}
              </div>
            </div>
          ))}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default DriversMap;
