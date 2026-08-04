import { sanitizeNumberInput } from '../utils/format';
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
  IonToggle,
  IonToast,
  useIonViewWillEnter,
} from '@ionic/react';
import { wsClient } from '../api/ws';

const PlatformSettings: React.FC = () => {
  const [platformEnabled, setPlatformEnabled] = useState(true);
  const [commissionCompany, setCommissionCompany] = useState('3');
  const [commissionSelf, setCommissionSelf] = useState('5');
  const [minKg, setMinKg] = useState('500');
  const [cities, setCities] = useState('');
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });

  const load = useCallback(async () => {
    const c = await wsClient.request<{
      platformEnabled: boolean;
      commissionPercentCompany: number;
      commissionPercentSelf: number;
      platformMinOrderKg: number;
      platformCities: string[];
    }>('platform.config.get', {});
    setPlatformEnabled(c.platformEnabled !== false);
    setCommissionCompany(String(c.commissionPercentCompany ?? 3));
    setCommissionSelf(String(c.commissionPercentSelf ?? 5));
    setMinKg(String(c.platformMinOrderKg ?? 500));
    setCities((c.platformCities || []).join(','));
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
          <IonTitle>تنظیمات پلتفرم</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="page-content ios-content">
        <div className="ion-padding compact">
          <div className="ios-glass-card">
            <div className="ios-row">
              <span>پلتفرم فعال (ثبت‌نام و سفارش حجمی)</span>
              <IonToggle
                checked={platformEnabled}
                onIonChange={(e) => setPlatformEnabled(e.detail.checked)}
              />
            </div>
            <IonItem>
              <IonLabel position="stacked">درصد پورسانت · پخش با ماشین شرکت</IonLabel>
              <IonInput
                type="text" inputMode="numeric" pattern="[0-9]*"
                value={commissionCompany}
                onIonInput={(e) =>
                  setCommissionCompany(sanitizeNumberInput(e.detail.value || '', { decimal: true }) || '3')
                }
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">درصد پورسانت · پخش شخصی همکار</IonLabel>
              <IonInput
                type="text" inputMode="numeric" pattern="[0-9]*"
                value={commissionSelf}
                onIonInput={(e) =>
                  setCommissionSelf(sanitizeNumberInput(e.detail.value || '', { decimal: true }) || '5')
                }
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">حداقل کیلو سفارش حجمی</IonLabel>
              <IonInput
                type="text" inputMode="numeric" pattern="[0-9]*"
                value={minKg}
                onIonInput={(e) => setMinKg(sanitizeNumberInput(e.detail.value || '') || '500')}
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">شهرها (با کاما)</IonLabel>
              <IonInput value={cities} onIonInput={(e) => setCities(e.detail.value || '')} />
            </IonItem>
            <p className="hint">
              وقتی همکار «کار» را روشن کند و بفروشد، درصد به کیف پولش می‌رود. در سفارش حجمی بعد از
              تحویل پورسانت واریز می‌شود.
            </p>
            <IonButton
              expand="block"
              className="ios-primary-btn"
              onClick={async () => {
                try {
                  await wsClient.request('platform.config.update', {
                    platformEnabled,
                    commissionPercentCompany: parseFloat(commissionCompany) || 0,
                    commissionPercentSelf: parseFloat(commissionSelf) || 0,
                    platformMinOrderKg: parseFloat(minKg) || 500,
                    platformCities: cities,
                  });
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

export default PlatformSettings;
