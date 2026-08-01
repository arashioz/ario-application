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
  IonToast,
  IonRefresher,
  IonRefresherContent,
  useIonViewWillEnter,
  RefresherEventDetail,
} from '@ionic/react';
import { wsClient } from '../api/ws';
import { useAuth } from '../auth/AuthContext';

/** تنظیمات عمومی مغازه — برند و کاتالوگ در «مدیریت کاتالوگ» */
const AppSettings: React.FC = () => {
  const { isAdmin } = useAuth();
  const [shopName, setShopName] = useState('');
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });

  const load = useCallback(async () => {
    const s = await wsClient.request<{ shopName?: string }>('settings.get');
    setShopName(s.shopName || '');
  }, []);

  useIonViewWillEnter(() => {
    void load().catch(console.warn);
  });

  return (
    <IonPage>
      <IonHeader translucent className="ios-header">
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/more" text="بازگشت" />
          </IonButtons>
          <IonTitle>تنظیمات اپ</IonTitle>
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
            <p className="hint">
              لینک کاتالوگ، برند، لوگو، عکس محصول و پله‌های قیمت در{' '}
              <a href="/catalog-admin">مدیریت کاتالوگ</a> است.
            </p>
            <IonItem>
              <IonLabel position="stacked">نام مغازه (سیستم داخلی)</IonLabel>
              <IonInput
                value={shopName}
                disabled={!isAdmin}
                onIonInput={(e) => setShopName(e.detail.value || '')}
              />
            </IonItem>
            {isAdmin && (
              <IonButton
                expand="block"
                className="ios-primary-btn"
                onClick={async () => {
                  try {
                    await wsClient.request('settings.update', { shopName });
                    setToast({ open: true, msg: 'ذخیره شد', color: 'success' });
                  } catch (e) {
                    setToast({
                      open: true,
                      msg: e instanceof Error ? e.message : 'خطا',
                      color: 'danger',
                    });
                  }
                }}
              >
                ذخیره
              </IonButton>
            )}
          </div>
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

export default AppSettings;
