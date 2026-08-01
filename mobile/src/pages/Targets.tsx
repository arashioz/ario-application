import { useEffect, useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonCard,
  IonCardContent,
  IonItem,
  IonLabel,
  IonInput,
  IonButton,
  IonSelect,
  IonSelectOption,
  IonToast,
} from '@ionic/react';
import { wsClient } from '../api/ws';
import { useAuth } from '../auth/AuthContext';
import { formatRial, formatKg, parseAmount } from '../utils/format';

interface Marketer {
  _id: string;
  name: string;
  username: string;
}

const Targets: React.FC = () => {
  const { isAdmin } = useAuth();
  const [marketers, setMarketers] = useState<Marketer[]>([]);
  const [marketerId, setMarketerId] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [targetAmount, setTargetAmount] = useState('');
  const [targetKg, setTargetKg] = useState('');
  const [progress, setProgress] = useState<{
    amountPercent: number;
    kgPercent: number;
    achievedAmount: number;
    achievedKg: number;
  } | null>(null);
  const [toast, setToast] = useState({ open: false, msg: '', color: 'success' });

  useEffect(() => {
    if (!isAdmin) return;
    void wsClient.request<Marketer[]>('user.marketers').then((m) => {
      setMarketers(m);
      if (m[0]) setMarketerId(m[0]._id);
    });
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <IonPage>
        <IonContent>
          <p className="empty-state">فقط مدیر تارگت می‌گذارد</p>
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar color="primary">
          <IonTitle>تارگت بازاریاب</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="page-content">
        <div className="ion-padding compact">
          <IonCard className="tight-card">
            <IonCardContent>
              <IonItem>
                <IonLabel>بازاریاب</IonLabel>
                <IonSelect value={marketerId} onIonChange={(e) => setMarketerId(e.detail.value)}>
                  {marketers.map((m) => (
                    <IonSelectOption key={m._id} value={m._id}>
                      {m.name}
                    </IonSelectOption>
                  ))}
                </IonSelect>
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">سال</IonLabel>
                <IonInput type="number" value={year} onIonInput={(e) => setYear(e.detail.value || '')} />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">ماه</IonLabel>
                <IonInput type="number" value={month} onIonInput={(e) => setMonth(e.detail.value || '')} />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">تارگت مبلغ (تومان)</IonLabel>
                <IonInput value={targetAmount} onIonInput={(e) => setTargetAmount(e.detail.value || '')} />
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">تارگت کیلو</IonLabel>
                <IonInput value={targetKg} onIonInput={(e) => setTargetKg(e.detail.value || '')} />
              </IonItem>
              <IonButton
                expand="block"
                size="small"
                onClick={async () => {
                  try {
                    await wsClient.request('target.upsert', {
                      marketerId,
                      year: parseInt(year, 10),
                      month: parseInt(month, 10),
                      targetAmount: parseAmount(targetAmount) || 0,
                      targetKg: parseFloat(targetKg) || 0,
                    });
                    setToast({ open: true, msg: 'تارگت ذخیره شد', color: 'success' });
                  } catch (e) {
                    setToast({ open: true, msg: e instanceof Error ? e.message : 'خطا', color: 'danger' });
                  }
                }}
              >
                ذخیره تارگت
              </IonButton>
              <IonButton
                expand="block"
                size="small"
                fill="outline"
                className="ion-margin-top"
                onClick={async () => {
                  const p = await wsClient.request<{
                    amountPercent: number;
                    kgPercent: number;
                    achievedAmount: number;
                    achievedKg: number;
                  }>('target.get', {
                    marketerId,
                    year: parseInt(year, 10),
                    month: parseInt(month, 10),
                  });
                  setProgress(p);
                }}
              >
                مشاهده پیشرفت
              </IonButton>
              {progress && (
                <>
                  <div className="stat-row">
                    <span className="stat-label">مبلغ</span>
                    <span className="stat-value">
                      {formatRial(progress.achievedAmount)} ({progress.amountPercent}%)
                    </span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">کیلو</span>
                    <span className="stat-value">
                      {formatKg(progress.achievedKg)} ({progress.kgPercent}%)
                    </span>
                  </div>
                </>
              )}
            </IonCardContent>
          </IonCard>
        </div>
        <IonToast
          isOpen={toast.open}
          message={toast.msg}
          color={toast.color}
          duration={2000}
          onDidDismiss={() => setToast((t) => ({ ...t, open: false }))}
          position="top"
        />
      </IonContent>
    </IonPage>
  );
};

export default Targets;
