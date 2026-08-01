import { useState } from 'react';
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
} from '@ionic/react';
import { useAuth } from '../auth/AuthContext';

const Login: React.FC = () => {
  const { login, online } = useAuth();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setLoading(true);
    setError('');
    try {
      await login(username.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در ورود');
    } finally {
      setLoading(false);
    }
  };

  return (
    <IonPage>
      <IonContent className="page-content login-page">
        <div className="login-wrap">
          <div className="login-brand">آریو</div>
          <p className="login-sub">مدیریت مغازه قند</p>
          {!online && <p className="offline-banner">در انتظار اتصال به سرور…</p>}
          <IonCard>
            <IonCardHeader>
              <IonCardTitle>ورود</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
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
              {error && (
                <IonText color="danger">
                  <p className="hint">{error}</p>
                </IonText>
              )}
              <IonButton expand="block" className="ion-margin-top" onClick={submit} disabled={loading || !online}>
                {loading ? <IonSpinner name="crescent" /> : 'ورود'}
              </IonButton>
              <IonButton expand="block" fill="clear" routerLink="/register" routerDirection="forward">
                ثبت‌نام همکار جدید
              </IonButton>
              <p className="hint">ادمین: admin / admin123 — بازاریاب: marketer / marketer123</p>
            </IonCardContent>
          </IonCard>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Login;
