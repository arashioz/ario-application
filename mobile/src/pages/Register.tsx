import { useEffect, useState } from 'react';
import {
  IonPage,
  IonContent,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonItem,
  IonLabel,
  IonInput,
  IonButton,
  IonText,
  IonSpinner,
  IonSelect,
  IonSelectOption,
} from '@ionic/react';
import { wsClient } from '../api/ws';
import { DigitInput } from '../components/DigitInput';
import { normalizePhone } from '../utils/format';

const CITIES = [
  'مشهد',
  'نیشابور',
  'سبزوار',
  'تربت حیدریه',
  'قوچان',
  'کاشمر',
  'گناباد',
  'تربت جام',
  'چناران',
  'سایر',
];

const Register: React.FC = () => {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('مشهد');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    wsClient.connect();
  }, []);

  const submit = async () => {
    setLoading(true);
    setError('');
    setDone('');
    try {
      const res = await wsClient.request<{ message: string }>('auth.register', {
        name,
        username,
        password,
        phone: phone ? normalizePhone(phone) || undefined : undefined,
        city,
      });
      setDone(res.message || 'ثبت شد — منتظر تأیید مدیر');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ثبت‌نام نشد');
    } finally {
      setLoading(false);
    }
  };

  return (
    <IonPage>
      <IonContent className="page-content login-page">
        <div className="login-wrap">
          <div className="login-brand">آریو</div>
          <p className="login-sub">ثبت‌نام همکار پخش / بازاریاب</p>
          <IonCard>
            <IonCardHeader>
              <IonCardTitle>ثبت‌نام</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <IonItem>
                <IonLabel position="stacked">نام کامل</IonLabel>
                <IonInput value={name} onIonInput={(e) => setName(e.detail.value || '')} />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">نام کاربری</IonLabel>
                <IonInput value={username} onIonInput={(e) => setUsername(e.detail.value || '')} />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">رمز عبور</IonLabel>
                <IonInput
                  type="password"
                  value={password}
                  onIonInput={(e) => setPassword(e.detail.value || '')}
                />
              </IonItem>
              <DigitInput label="موبایل" mode="phone" value={phone} onChange={setPhone} />
              <IonItem>
                <IonLabel position="stacked">شهر فعالیت</IonLabel>
                <IonSelect
                  interface="popover"
                  value={city}
                  onIonChange={(e) => setCity(String(e.detail.value))}
                >
                  {CITIES.map((c) => (
                    <IonSelectOption key={c} value={c}>
                      {c}
                    </IonSelectOption>
                  ))}
                </IonSelect>
              </IonItem>
              {error && (
                <IonText color="danger">
                  <p className="hint">{error}</p>
                </IonText>
              )}
              {done && (
                <IonText color="success">
                  <p className="hint">{done}</p>
                </IonText>
              )}
              <IonButton
                expand="block"
                className="ion-margin-top"
                disabled={loading}
                onClick={() => void submit()}
              >
                {loading ? <IonSpinner name="crescent" /> : 'ثبت‌نام'}
              </IonButton>
              <IonButton expand="block" fill="clear" routerLink="/" routerDirection="root">
                بازگشت به ورود
              </IonButton>
            </IonCardContent>
          </IonCard>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Register;
